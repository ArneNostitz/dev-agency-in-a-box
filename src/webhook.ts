/**
 * Event-driven mode (RUN_MODE=webhook): instead of polling every N seconds, run an
 * HTTP server that GitHub calls the instant an issue is opened/labeled/reopened.
 *
 * Configure a GitHub webhook (repo or org Settings -> Webhooks):
 *   Payload URL : https://<your-coolify-domain>/webhook
 *   Content type: application/json
 *   Secret      : same value as GITHUB_WEBHOOK_SECRET
 *   Events      : "Issues" (at least)
 *
 * The server verifies the signature, then triggers a processing pass. A safety poll
 * still runs occasionally so nothing is missed if a webhook delivery is dropped.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, statSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import { recentRuns, roleRunsByIssue, filesFor, recentIssues, recentActivity, archiveIssue, spendSince, recordIssueState, recordIssueStatus, recordPr, tokensSince, tokensByModelSince, tokensByRoleSince, tokensByDaySince, topIssuesByTokensSince, tokensByIssueAll, toolStatsSince, runStepCountSince, recentLessons, recordConflict, getConflict, clearConflict, listConflicts, epicsByParent, getSetting, setSetting, setAgentOverride, deleteAgentOverride, listAgentRevisions, getAgentRevision, addWatchedRepo, removeWatchedRepo, getProviders, setProviders, getRoleModels, setRoleModels, getGlobalModel, setGlobalModel, getFallbackChain, setFallbackChain, getAutoSwitchOnLimit, setIssueModelOverride, getIssueModelOverride, clearIssueModelOverride, setIssueWorkflow, getIssueWorkflow, clearIssueWorkflow, getWorkflow, getIssueProvider, setIssueProvider, clearIssueProvider, getIssueAgentModels, setIssueAgentModel, getIssueUseFallback, setIssueUseFallback, getReview, recordReview, listReviews, getAutoRaw, setAuto, autoEnabled, getIssueRow, clearRateLimited, getDb, listAgentDefs, upsertAgentDef, deleteAgentDef, listWorkflows, upsertWorkflow, deleteWorkflow, getDefaultWorkflowId, setDefaultWorkflowId, listSkills, upsertSkill, deleteSkill, listHooks, upsertHook, deleteHook, type AutoKind, type Provider, type AgentDef, type Skill, type Hook } from "./store.js";
import { mergeEpic, isEpic } from "./epics.js";
import { versionInfo } from "./version.js";
import { startDeviceFlow, pollDeviceToken, fetchGitHubUser } from "./github-oauth.js";
import { githubOAuthClientId, githubOAuthToken, githubIdentity } from "./creds.js";
import { binaryAvailable } from "./runners/registry.js";
import { installSpec, installCli, RUNNER_PACKAGES } from "./runners/install.js";
import { parseLegacyStatus, withStatus, setBlocked } from "./state.js";
import { runOrchestratorChat } from "./agents/orchestrator-chat.js";
import { listOrchThread, clearOrchThread, setByAgent } from "./store.js";
import { getIssueBudget, setIssueBudget } from "./budget.js";
import { renderShell } from "./shell.js";
import { afterMerge } from "./merge_hooks.js";
import { activeClaims } from "./locks.js";
import { authEnabled, userFromReq, setSessionCookie, clearSessionCookie, parseCookies, SESSION_COOKIE, verifyRecoveryKey } from "./auth.js";
import { OPS_SETTINGS, opsSettingsValues } from "./settings.js";
import { getSecretSetting, setSecretSetting, getUserSecretStatus } from "./store.js";
import { masterKeyConfigured } from "./crypto.js";
import { ghBotToken, ghUserToken, claudeToken, anthropicApiKey } from "./creds.js";
import { providerAuth } from "./agents/provider-auth.js";
import { discoverProviderModels } from "./db/discover.js";
import { testClaudeAuth } from "./agents/roleAgent.js";
import { ALL_ROLES, roleForText, loadHandleRoleMap } from "./agents/roles.js";
import { resolveWorkflow } from "./workflow.js";
import { hasActiveRun, requestHold, queueSteer, peekSteer, isHoldRequested } from "./abort.js";
import { renderLogin, renderInvite, renderSetup, renderForgot, renderReset } from "./authpages.js";
import { authenticate, createSession, revokeSession, getInvite, acceptInvite, createInvite, createUser, listUsers, listInvites, setUserSecret, listUserSecretKeys, countUsers, setUserPassword, getUserByName, getUserByNameOrEmail, createPasswordReset, consumePasswordReset, type User } from "./store.js";
import { emailEnabled, sendPasswordReset } from "./email.js";
import { subscribe, getActive, pushActivity, clearActivity } from "./activity.js";
import { inFlightKeys } from "./pool.js";
import { listRateLimited } from "./store.js";
import { getConversation, conversationCount, foldInGitHubComment, recordOutgoingComment, setCommentGhId, updateCommentBody } from "./store.js";
import { recentFailuresSince } from "./store.js";
import { effectiveRepos } from "./commands.js";
import { getThreadFull, commentAsHuman, editCommentAsHuman, commentOnIssue, mergePrForBranch, closeIssue, deleteIssueHard, findPrForBranch, prMergeStatus, mergeProbe, branchHeadSha, detectReviewVerdict, createIssue, readRepoFile, putRepoBase64, listUserRepos, fetchNativeSubIssues, deleteAgencyComments, type NativeSubIssueData } from "./github.js";
import { listAgentFiles, readAgentFile, isSafeAgentPath } from "./memory.js";
import { startApp, stopApp, getApp, pickWebDevScript, isTauriPackage, buildLocalCommand } from "./apprun.js";
import { ensureRepoAccess } from "./commands.js";
import { previewUrlFor, runChecksNow } from "./preview.js";
import { putAttachment, getAttachment } from "./db/attachments.js";
import { dispatch } from "./pool.js";
import { trackerMode, syncInIssue, syncInComment } from "./tracker.js";
import { ensureRepoIndex } from "./gitnexus.js";

type ProcessAll = (cfg: Config) => Promise<number>;
type Resume = (repo: string, number: number) => Promise<void>;

/**
 * Stamp each provider row with its auth status so the frontend model pickers can show a provider's
 * models ONLY when it's actually authenticated (auth !== "missing"). Mirrors the runtime's own
 * providerAuth() decision, so the picker's view matches what a run will actually use.
 */
function annotateProviders(list: Provider[]): (Provider & { auth: "apiKey" | "subscription" | "missing" })[] {
  const hasClaudeCred = Boolean(claudeToken() || anthropicApiKey());
  return (list || []).map((p) => ({ ...p, auth: providerAuth(p, hasClaudeCred) }));
}

// Cache native sub-issue relationships per repo (TTL: 60s) so the 5s poll doesn't hammer GitHub.
const _nativeSubIssueCache = new Map<string, { ts: number; data: NativeSubIssueData }>();
const NATIVE_SUB_TTL = 60_000;
async function getNativeSubIssues(repo: string): Promise<NativeSubIssueData> {
  const now = Date.now();
  const cached = _nativeSubIssueCache.get(repo);
  if (cached && now - cached.ts < NATIVE_SUB_TTL) return cached.data;
  const data = await fetchNativeSubIssues(repo).catch(() => ({ parentToChildren: {}, childToParent: {} } as NativeSubIssueData));
  _nativeSubIssueCache.set(repo, { ts: now, data });
  return data;
}

/** Session window/budget come from dashboard settings first, then env, then defaults. */
function sessionWindowHours(): number {
  return Number(getSetting("window_hours")) || Number(process.env.SESSION_WINDOW_HOURS?.trim()) || 5;
}
function sessionBudget(): number {
  return Number(getSetting("token_budget")) || Number(process.env.SESSION_TOKEN_BUDGET?.trim()) || 0;
}
/**
 * Start of the current window. If you've set an anchor (the moment your real session window
 * began), we align to it and roll forward in fixed `windowHours` steps; otherwise it's a plain
 * rolling "last N hours". Returns the window start + when it next resets.
 */
function sessionWindow(): { startIso: string; resetsIso: string } {
  const winMs = sessionWindowHours() * 3600_000;
  const now = Date.now();
  const anchor = Date.parse(getSetting("window_anchor") ?? "");
  let start: number;
  if (Number.isFinite(anchor) && anchor <= now) {
    start = anchor + Math.floor((now - anchor) / winMs) * winMs;
  } else {
    start = now - winMs;
  }
  return { startIso: new Date(start).toISOString(), resetsIso: new Date(start + winMs).toISOString() };
}

function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!secret) return true; // no secret configured -> skip verification (not recommended)
  if (!header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Complexity-based cost ESTIMATE per issue ("should" cost) — a deterministic heuristic from the
// signals we have (declared file footprint, epic size, scope text). Compared against real spend in
// the dashboard so an issue that's running hot is obvious. ~$5/Mtok blended.
function estimateCost(footprint: number, epicTotal: number, titleLen: number): { tokens: number; usd: number } {
  let tokens = 25000; // base: orient + plan
  tokens += footprint * 18000; // each declared file ~ a focused edit + tests
  tokens += epicTotal * 60000; // each sub-issue is a whole build
  tokens += Math.min(titleLen, 140) * 250; // rough scope from the title length
  const usd = Math.round((tokens / 1e6) * 5 * 100) / 100;
  return { tokens, usd };
}
// Throttle the /data PR-number backfill: at most one `gh` lookup per issue per 60s (was per 5s poll).
const prBackfillChecked = new Map<string, number>();
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const RELEVANT_ACTIONS = new Set(["opened", "reopened", "edited"]);
const PR_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review", "edited"]);

// Static assets (PWA shell extras) live in web/ at the repo root; from the compiled dist/ that's ../web.
// Ensure trailing slash so new URL(rel, 'file://' + WEB_DIR) treats it as a DIRECTORY, not a file
// (without it, nested paths like 'data/providers.js' resolve against the parent, not into web/).
const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url)).replace(/\/*$/, "/");
const MIME: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".html": "text/html; charset=utf-8" };
/** Serve a static file from web/ for the PWA (no auth — these carry no secrets). Returns true if handled. */
function serveStatic(pathname: string, res: ServerResponse): boolean {
  // Computed at request time so the SHA reflects the deployed commit (SOURCE_COMMIT env) even though
  // the container's build had no .git to stamp it.
  if (pathname === "/web/version.json") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
    res.end(JSON.stringify(versionInfo()));
    return true;
  }
  // CSS is now inlined in the shell (renderShell) — no separate /app.css route needed.
  let rel: string | null = null;
  if (pathname === "/sw.js") rel = "sw.js";
  else if (pathname === "/manifest.webmanifest") rel = "manifest.webmanifest";
  else if (pathname.startsWith("/web/")) rel = pathname.slice(5);
  if (rel == null) return false;
  if (rel.includes("..")) { res.writeHead(403).end(); return true; }
  const file = fileURLToPath(new URL(rel, "file://" + WEB_DIR));
  if (!file.startsWith(WEB_DIR) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end("not found"); return true; }
  const ext = file.slice(file.lastIndexOf("."));
  // sw.js must not be long-cached; other assets are network-first in the SW anyway.
  // Code modules (app.js + every split ./*.js + the vendor .mjs) must revalidate each load, or a
  // redeploy serves stale UI for up to an hour. Static assets (logos/icons/manifest) stay cached.
  const isModule = /\.(mjs|js)$/.test(pathname);
  const cache = pathname === "/sw.js" || pathname === "/web/version.json" || isModule ? "no-cache" : "public, max-age=3600";
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": cache });
  res.end(readFileSync(file));
  return true;
}

type CreatePr = (repo: string, number: number) => Promise<{ ok: boolean; url?: string; msg?: string }>;
type Audit = (repo: string) => Promise<void>;
export async function runWebhook(cfg: Config, processAll: ProcessAll, resume?: Resume, approve?: Resume, fix?: Resume, start?: Resume, stop?: Resume, createPr?: CreatePr, onComment?: Resume, audit?: Audit, startNew?: (repo: string, number: number, title: string, body: string) => Promise<void>): Promise<void> {
  const port = Number(process.env.PORT?.trim() || "3000");
  // Webhook secret is read live (dashboard → env) so it can be set/rotated without a redeploy.
  const webhookSecret = (): string => getSecretSetting("github_webhook_secret") || process.env.GITHUB_WEBHOOK_SECRET?.trim() || "";
  // Catches 👍 reactions (GitHub doesn't webhook those) and anything a delivery missed.
  const safetyPollMs = Math.max(30, cfg.pollIntervalSeconds) * 1000;

  // Serialize processing: a single chain, with a "pending" flag to coalesce bursts.
  // In-flight GitHub device-flow login (single admin at a time).
  let ghDevice: { deviceCode: string; adminId: number; at: number } | null = null;
  let running = false;
  let pending = false;
  async function trigger(reason: string): Promise<void> {
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending) {
        pending = false;
        console.log(`[agency] processing (trigger: ${reason})`);
        const n = await processAll(cfg);
        console.log(`[agency] processed ${n} issue(s).`);
      }
    } catch (err) {
      console.error("[agency] processing error:", (err as Error).message);
    } finally {
      running = false;
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // ── Analyzer API for the standalone watchdog (handled before the GET/POST split so the issue
    // POST is reachable). Separate Bearer auth (ANALYZER_API_KEY), NOT the session cookie. The
    // analyzer needs almost no config of its own: it reads aggregate telemetry + tuning here, and the
    // agency opens the advisory issue on its behalf (so the analyzer carries no GitHub token/repo).
    // Least-privilege: aggregate metrics only (no secrets/bodies) + a rate-limited advisory issue the
    // agency never acts on without approval. Disabled (503) unless a strong key is set.
    {
      const aurl = (req.url ?? "/").split("?")[0];
      if (aurl === "/telemetry" || aurl === "/analyzer-issue") {
        const key = (process.env.ANALYZER_API_KEY || getSetting("analyzer_api_key") || "").trim();
        if (!key || key.length < 16) return void res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "analyzer API disabled (set a strong ANALYZER_API_KEY)" }));
        const hdr = (req.headers["authorization"] || "").toString();
        const got = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : "";
        const a = Buffer.from(got), b = Buffer.from(key);
        if (!(a.length === b.length && timingSafeEqual(a, b))) return void res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
        if (aurl === "/telemetry") {
          if (req.method !== "GET") return void res.writeHead(405).end();
          setSetting("analyzer_last_pull", new Date().toISOString()); // heartbeat — surfaced in the dashboard
          const since = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("since") || new Date(0).toISOString();
          return void res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({
            since,
            runStepCount: runStepCountSince(since),
            toolStats: toolStatsSince(since),
            tokensByRole: tokensByRoleSince(since),
            failures: recentFailuresSince(since), // operational problems (rate limits, failing commands)
            topIssues: topIssuesByTokensSince(since, 8), // token-heavy issues = wasteful / looping work
            lessons: recentLessons(10),
            config: { minSteps: Number(getSetting("analyzer_min_steps")) || 15, intervalHours: Number(getSetting("analyzer_interval_hours")) || 1 },
          }));
        }
        // POST /analyzer-issue — the agency opens the advisory issue for the analyzer. Rate-limited.
        if (req.method !== "POST") return void res.writeHead(405).end();
        const lastTs = Date.parse(getSetting("analyzer_last_issue_ts") || "");
        if (Number.isFinite(lastTs) && Date.now() - lastTs < 10 * 60_000) return void res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: "rate limited" }));
        void (async () => {
          let pp: { title?: string; body?: string } = {};
          try { pp = JSON.parse((await readBody(req)).toString("utf8")); } catch { /* ignore */ }
          const title = (pp.title || "Process Analyzer: proposals").slice(0, 200);
          const ibody = (pp.body || "").slice(0, 60000);
          if (!ibody.trim()) return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "empty body" }));
          const repoT = (getSetting("analyzer_repo") || effectiveRepos(cfg)[0] || "").trim();
          if (!repoT) return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "no analyzer_repo / watched repo configured" }));
          const r = await createIssue(repoT, title, ibody).catch(() => ({ number: 0 }));
          // Advisory only — no DB status set, so it surfaces in Inbox like any other untouched issue.
          if (r.number) setSetting("analyzer_last_issue_ts", new Date().toISOString());
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ number: r.number }));
        })();
        return;
      }
    }
    if (req.method === "GET") {
      const url = (req.url ?? "/").split("?")[0];
      if (url === "/health") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("dev-agency: ok");
        return;
      }
      // PWA static assets (service worker, manifest, app bundle, icons) — no auth so the
      // installed app can boot and the SW can cache them. They contain no secrets.
      if (serveStatic(url, res)) return;

      // Auth gate — always multi-user (session cookies). First visitor creates the admin.
      let sessionUser: User | null = null;
      {
        const htmlHead = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
        // First run: no accounts yet → force the in-browser admin setup screen.
        if (countUsers() === 0) return void res.writeHead(200, htmlHead).end(renderSetup());
        if (url === "/login") return void res.writeHead(200, htmlHead).end(renderLogin());
        if (url === "/forgot") return void res.writeHead(200, htmlHead).end(renderForgot({ emailOn: emailEnabled() }));
        if (url === "/reset") {
          const t = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("token") ?? "";
          return void res.writeHead(200, htmlHead).end(renderReset(t));
        }
        if (url === "/logout") {
          const tok = parseCookies(req)[SESSION_COOKIE];
          if (tok) revokeSession(tok);
          clearSessionCookie(res);
          return void res.writeHead(302, { location: "/login" }).end();
        }
        if (url === "/invite") {
          const t = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("token") ?? "";
          const inv = getInvite(t);
          if (!inv) return void res.writeHead(302, { location: "/login" }).end();
          return void res.writeHead(200, htmlHead).end(renderInvite(inv.token, inv.email));
        }
        sessionUser = userFromReq(req);
        if (!sessionUser) {
          const isNav = url === "/";
          if (isNav) return void res.writeHead(302, { location: "/login" }).end();
          return void res.writeHead(401, { "content-type": "text/plain" }).end("authentication required");
        }
      }

      if (url === "/events") {
        // Server-sent events: live thought-stream from the agents.
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        const unsub = subscribe((e) => {
          try {
            res.write(`data: ${JSON.stringify(e)}\n\n`);
          } catch {
            /* client gone */
          }
        });
        const keepalive = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch {
            /* ignore */
          }
        }, 25000);
        req.on("close", () => {
          clearInterval(keepalive);
          unsub();
        });
        return;
      }

      // Local-first attachments: serve image/file bytes straight from the DB (never the repo).
      if (url.startsWith("/attach/")) {
        const att = getAttachment(url.slice("/attach/".length));
        if (!att) return void res.writeHead(404).end("not found");
        res.writeHead(200, { "content-type": att.mime || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" });
        return void res.end(att.bytes);
      }
      if (url === "/data") {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        void (async () => {
          const issues = recentIssues(60);
          // Backfill PR links: an agent can open a PR mid-run (and a restart can interrupt before the
          // orchestrator records it), so detect+persist the PR for any post-build issue that lacks one
          // — not just "ready". Without this the dashboard shows "Create PR" while the PR is already
          // open. We persist what we find, so later polls read it straight from the DB (one gh call/issue
          // only until it's recorded). Skip planned / awaiting-approval (no branch yet).
          for (const i of issues) {
            const _pk = `${i.repo}#${i.number}`;
            if (!i.pr_number && (i.state === "working" || i.state === "review") && Date.now() - (prBackfillChecked.get(_pk) ?? 0) > 60_000) {
              prBackfillChecked.set(_pk, Date.now());
              try {
                const pr = await findPrForBranch(i.repo, `agency/issue-${i.number}`);
                if (pr) {
                  i.pr_number = pr.number;
                  i.pr_url = pr.url;
                  recordPr(i.repo, i.number, pr.number, pr.url);
                }
              } catch {
                /* ignore */
              }
            }
          }
          const epicCache: Record<string, ReturnType<typeof epicsByParent>> = {};
          for (const i of issues) epicCache[i.repo] ??= epicsByParent(i.repo);
          // child issue number → parent number, per repo
          const childToParentNum: Record<string, Record<number, number>> = {};
          // parent issue number → title (from tracked issues), keyed by the epics table (isEpic()),
          // not a lifecycle state — epic-ness is orthogonal to the IssueState enum.
          const epicTitleMap: Record<string, Record<number, string>> = {};
          for (const [repo, byParent] of Object.entries(epicCache)) {
            childToParentNum[repo] = {};
            const titles: Record<number, string> = {};
            for (const [parentStr, kids] of Object.entries(byParent)) {
              for (const kid of kids) childToParentNum[repo][kid.child] = Number(parentStr);
              const parentNum = Number(parentStr);
              const parentIssue = issues.find((i) => i.repo === repo && i.number === parentNum);
              if (parentIssue) titles[parentNum] = parentIssue.title;
            }
            epicTitleMap[repo] = titles;
          }
          // Fetch GitHub-native parent/sub-issue links and merge with DB-backed maps so issues
          // created as sub-issues directly in GitHub (not via the agency planner) are included.
          const nativeByRepo: Record<string, NativeSubIssueData> = {};
          {
            const repos = [...new Set(issues.map((i) => i.repo))];
            await Promise.all(repos.map(async (r) => { nativeByRepo[r] = await getNativeSubIssues(r); }));
            // Fold native child→parent into childToParentNum (DB wins on conflict).
            for (const [repo, native] of Object.entries(nativeByRepo)) {
              const cm = (childToParentNum[repo] ??= {});
              for (const [childStr, p] of Object.entries(native.childToParent)) {
                const c = Number(childStr);
                if (!(c in cm)) cm[c] = p.number;
              }
            }
          }
          const reviews = listReviews(); // verdict per "repo#number" — cheap, for the card badge
          const tokenMap = tokensByIssueAll(); // lifetime tokens/cost/model per "repo#number"
          const conflictMap = listConflicts(); // conflicting files per "repo#number"
          const claimMap = new Map(activeClaims().map((c) => [`${c.repo}#${c.number}`, c.files])); // live file locks per issue
          const runMap = roleRunsByIssue(); // per-role run counts → loop-back badges
          // Last agent that actually ran per issue, from recent activity (most recent role wins).
          const _recentAct = recentActivity(300);
          const lastRoleMap: Record<string, string> = {};
          for (const a of _recentAct) { if (a && a.role) lastRoleMap[`${a.repo}#${a.number}`] = a.role; }
          const handleRoleMap = loadHandleRoleMap(); // load once, not per-issue (reads a file)
          const enriched = issues.map((i) => {
            const byParent = epicCache[i.repo] ?? {};
            const dbKids = byParent[i.number];
            const rawNativeKids = (nativeByRepo[i.repo]?.parentToChildren ?? {})[i.number];
            const nativeKids = rawNativeKids?.map((c) => ({
              child: c.number, title: c.title,
              state: c.closed ? "done" : "open",
              closed: c.closed ? 1 : 0,
            }));
            // DB takes precedence; fall back to native children
            const kids = dbKids ?? nativeKids;
            const conflictFilesFor = conflictMap[`${i.repo}#${i.number}`];
            const parentNum = (childToParentNum[i.repo] ?? {})[i.number];
            const nativeParent = (nativeByRepo[i.repo]?.childToParent ?? {})[i.number];
            const parentEpic =
              parentNum != null
                ? {
                    number: parentNum,
                    title: (epicTitleMap[i.repo] ?? {})[parentNum] ?? nativeParent?.title ?? `#${parentNum}`,
                  }
                : null;
            return {
              ...i,
              usage: tokenMap[`${i.repo}#${i.number}`] ?? null,
              conflict: conflictFilesFor ? { files: conflictFilesFor } : null,
              previewUrl: i.pr_number ? previewUrlFor(i.repo, i.pr_number, `agency/issue-${i.number}`) : null,
              epic: kids
                ? { total: kids.length, done: kids.filter((c) => c.closed).length, children: kids }
                : null,
              app: getApp(i.repo, i.number),
              review: reviews[`${i.repo}#${i.number}`] ?? null,
              modelOverride: getIssueModelOverride(i.repo, i.number),
              workflowId: getIssueWorkflow(i.repo, i.number),
              providerOverride: getIssueProvider(i.repo, i.number),
              agentModels: getIssueAgentModels(i.repo, i.number),
              useFallback: getIssueUseFallback(i.repo, i.number),
              ...(((): { wfSteps?: Array<{ agent: string; name: string; role: string }>; wfStep?: number; soloRole?: string } => {
                // The issue's resolved workflow steps → ONE timeline dot per real step (8 for HolyMoly),
                // each with its agent (custom name/avatar). Falls back to the generic 4 when none.
                const wfId = getIssueWorkflow(i.repo, i.number);
                const wf = wfId ? getWorkflow(wfId) : null;
                if (!wf || !wf.steps?.length) {
                  // No workflow → if this issue resolved to a SOLO single-role pin (e.g. @dev), show that
                  // one step instead of the generic Plan→Dev→Test→Review (which wrongly reads "full build").
                  const solo = (getSetting(`issue_solo.${i.repo}#${i.number}`) || "").trim();
                  if (solo) {
                    const name = solo.charAt(0).toUpperCase() + solo.slice(1);
                    // wfStep stays 0 (step is current while running); the board sets it done from issue state.
                    return { wfSteps: [{ agent: `@${solo}`, name, role: solo }], wfStep: 0, soloRole: solo };
                  }
                  return {};
                }
                const defs = listAgentDefs();
                const ROLE_OF: Record<string, string> = { "@dev": "developer", "@plan": "planner", "@arch": "architect", "@review": "reviewer", "@test": "tester", "@split": "decomposer" };
                const steps = wf.steps.map((st) => {
                  const h = (st.agent || "").toLowerCase();
                  const def = defs.find((d) => (d.handle || `@${d.name}`).toLowerCase() === h || d.name.toLowerCase() === h.replace(/^@/, ""));
                  const name = def ? def.name : (h.replace(/^@/, "") || "developer");
                  const role = ROLE_OF[h] || name.toLowerCase();
                  return { agent: st.agent || "", name, role };
                });
                const wfRuns = (runMap[`${i.repo}#${i.number}`] || {}) as Record<string, number>;
                const done = Object.values(wfRuns).reduce((a, b) => a + (b || 0), 0);
                return { wfSteps: steps, wfStep: Math.min(done, steps.length) };
              })()),
              held: isHoldRequested(i.repo, i.number) || undefined,
              steers: peekSteer(i.repo, i.number),
              lastRole: lastRoleMap[`${i.repo}#${i.number}`] ?? null,
              budget: getIssueBudget(i.repo, i.number),
              // True iff a Claude run is actually executing for this issue right now (abort registry
              // — the precise signal). Drives the Stop button so it's reliably shown only while live.
              running: hasActiveRun(i.repo, i.number),
              byAgent: !!(i.by_agent),
              editing: claimMap.get(`${i.repo}#${i.number}`) ?? [], // files this run has live-claimed (overwrite lock)
              estCost: estimateCost(filesFor(i.repo, i.number).length, kids ? kids.length : 0, (i.title || "").length),
              runs: runMap[`${i.repo}#${i.number}`] ?? {},
              created_at: i.created_at ?? null,
              auto: {
                resume: autoEnabled("resume", i.repo, i.number),
                merge: autoEnabled("merge", i.repo, i.number),
                resumeRaw: getAutoRaw("resume", i.repo, i.number),
                mergeRaw: getAutoRaw("merge", i.repo, i.number),
              },
            };
          });
          const winH = sessionWindowHours();
          const budget = sessionBudget();
          const win = sessionWindow();
          const sess = tokensSince(win.startIso);
          // Manual calibration: the user can set "current usage = X%" to match Claude's real meter.
          // We store an offset (extra tokens) and add it to the gauge — but only while it belongs to
          // the current window (it's discarded after a reset so the gauge re-bases automatically).
          const offAt = Date.parse(getSetting("usage_offset_at") ?? "");
          const offTok = Number.isFinite(offAt) && new Date(offAt).toISOString() >= win.startIso ? Number(getSetting("usage_offset_tokens") || 0) : 0;
          const gaugeTokens = sess.tokens + (offTok > 0 ? offTok : 0);
          // Static config (providers, workflows, agents, skills, hooks, ops, users, …) changes rarely,
          // so the 5s poll requests ?lite=1 and the server omits it; the client retains the last full
          // copy. Full /data (initial load + any user action) still carries everything.
          const lite = (req.url || "").includes("lite=1");
          const heavy: Record<string, unknown> = lite ? {} : {
              secretKeys: sessionUser ? listUserSecretKeys(sessionUser.id) : [],
              secretsHealth: sessionUser
                ? {
                    masterKey: masterKeyConfigured(),
                    claude_token: getUserSecretStatus(sessionUser.id, "claude_token"),
                    anthropic_api_key: getUserSecretStatus(sessionUser.id, "anthropic_api_key"),
                    github_bot_token: getUserSecretStatus(sessionUser.id, "github_bot_token"),
                    github_user_token: getUserSecretStatus(sessionUser.id, "github_user_token"),
                  }
                : null,
              users: sessionUser && sessionUser.role === "admin" ? listUsers() : [],
              invites: sessionUser && sessionUser.role === "admin" ? listInvites() : [],
              webhookSecretSet: sessionUser && sessionUser.role === "admin" ? Boolean(getSecretSetting("github_webhook_secret") || process.env.GITHUB_WEBHOOK_SECRET) : false,
              github: { connected: Boolean(githubOAuthToken()), user: githubIdentity(), clientIdSet: Boolean(githubOAuthClientId()) },
              ops: opsSettingsValues(),
              opsMeta: OPS_SETTINGS,
              providers: annotateProviders(getProviders()),
              roleModels: getRoleModels(),
              globalModel: getGlobalModel(),
              agentDefs: listAgentDefs(),
              workflows: listWorkflows(),
              defaultWorkflowId: getDefaultWorkflowId(),
              skills: listSkills(),
              hooks: listHooks(),
              config: {
                skipArchitect: (getSetting("skip_architect") ?? "") || (process.env.SKIP_ARCHITECT?.trim().toLowerCase() === "false" ? "off" : "on"),
                gitnexus: (getSetting("gitnexus") ?? "") || (process.env.GITNEXUS?.trim().toLowerCase() === "true" ? "on" : "off"),
                maxTokensPerRun: Number(getSetting("max_tokens_per_run")) || Number(process.env.MAX_TOKENS_PER_RUN?.trim()) || 600000,
                maxReviseRounds: getSetting("max_revise_rounds") !== null ? Number(getSetting("max_revise_rounds")) : (Number(process.env.MAX_REVISE_ROUNDS?.trim()) || 1),
                auditThreshold: Number(getSetting("audit_threshold")) || Number(process.env.AUDIT_THRESHOLD?.trim()) || 10,
                avatars: getSetting("avatars") === "off" ? "off" : "on",
                agentRunner: (getSetting("agent_runner") ?? process.env.AGENT_RUNNER?.trim() ?? "claude-sdk"),
                agentCliCommand: (getSetting("agent_cli_command") ?? process.env.AGENT_CLI_COMMAND?.trim() ?? ""),
                tracker: (getSetting("tracker") ?? process.env.TRACKER?.trim() ?? "local"),
                newIssueDefault: (getSetting("new_issue_default") || "@dev"),
              },
          };
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              env: process.env.AGENCY_ENV?.trim() || process.env.APP_ENV?.trim() || "production",
              authEnabled: authEnabled(),
              user: sessionUser ? { id: sessionUser.id, username: sessionUser.username, role: sessionUser.role, email: sessionUser.email } : null,
              onboarded: sessionUser ? getSetting(`onboarded:${sessionUser.id}`) === "1" : true,
              ...heavy,
              repos: effectiveRepos(cfg),
              scanning: running, // a GitHub scan/refresh is in progress (drives the reload spinner)
              auto: { resume: getAutoRaw("resume"), merge: getAutoRaw("merge") },
              autoRepos: Object.fromEntries(
                effectiveRepos(cfg).map((r) => [r, { resume: getAutoRaw("resume", r), merge: getAutoRaw("merge", r) }]),
              ),
              active: getActive(),
              inflight: inFlightKeys(),
              rateLimited: listRateLimited(),
              issues: enriched,
              runs: recentRuns(40),
              activity: recentActivity(150), // SSE streams live deltas; the poll only needs a recent backlog
              spendToday: { ...spendSince(midnight.toISOString()), tokens: tokensSince(midnight.toISOString()).tokens },
              session: {
                tokens: gaugeTokens,
                costUsd: sess.costUsd,
                budget,
                windowHours: winH,
                windowStart: win.startIso,
                resetsAt: win.resetsIso,
                anchored: Boolean(Date.parse(getSetting("window_anchor") ?? "")),
                byModel: tokensByModelSince(win.startIso),
              },
              analyzer: {
                enabled: Boolean((process.env.ANALYZER_API_KEY || getSetting("analyzer_api_key") || "").trim()),
                lastPull: getSetting("analyzer_last_pull") || null,
                lastIssueAt: getSetting("analyzer_last_issue_ts") || null,
                url: getSetting("analyzer_url") || null,
              },
            }),
          );
        })();
        return;
      }

      // Token-usage statistics (fetched when the Usage view opens — not on the 5s poll).
      if (url === "/usage") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const range = q.get("range") || "window";
        const now = Date.now();
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const sinceFor: Record<string, string> = {
          today: midnight.toISOString(),
          window: sessionWindow().startIso,
          "7d": new Date(now - 7 * 86400_000).toISOString(),
          "30d": new Date(now - 30 * 86400_000).toISOString(),
          all: new Date(0).toISOString(),
        };
        const since = sinceFor[range] ?? sinceFor.window;
        const total = tokensSince(since);
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            range,
            since,
            total,
            byModel: tokensByModelSince(since),
            byRole: tokensByRoleSince(since),
            byDay: tokensByDaySince(since),
            topIssues: topIssuesByTokensSince(since, 12),
          }),
        );
        return;
      }

      // Models panel: providers, per-role assignments, fallback chain, and quick presets.
      if (url === "/models") {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            providers: annotateProviders(getProviders()),
            roleModels: getRoleModels(),
            globalModel: getGlobalModel(),
            fallbackChain: getFallbackChain(),
            autoSwitchOnLimit: getAutoSwitchOnLimit(),
            roles: ALL_ROLES,
          }),
        );
        return;
      }

      // Which CLI runners are installed (binary on PATH) — drives the Settings runner picker so the
      // user sees ✓ / "Install" instead of discovering a missing binary mid-run.
      if (url === "/runner-status") {
        const cli = Object.entries(RUNNER_PACKAGES).map(([kind, r]) => ({
          kind, label: r.label, binary: r.binary, pkg: r.pkg, available: binaryAvailable(r.binary),
        }));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          runners: [{ kind: "claude-sdk", label: "Claude Agent SDK (built-in)", binary: null, available: true }, ...cli],
        }));
        return;
      }

      // Repo picker: all repos your token can access, minus the ones already watched.
      if (url === "/repos-available") {
        const token = ghUserToken() || ghBotToken() || cfg.adminToken || cfg.githubToken || "";
        void listUserRepos(token)
          .then((all) => {
            const watched = new Set(effectiveRepos(cfg));
            const repos = all.filter((r) => !watched.has(r.full_name));
            res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ repos }));
          })
          .catch(() => res.writeHead(200, { "content-type": "application/json" }).end('{"repos":[]}'));
        return;
      }

      // Agent editor: list the editable memory files, or fetch one's content.
      if (url === "/agents") {
        void listAgentFiles()
          .then((files) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ files })))
          .catch(() => res.writeHead(200, { "content-type": "application/json" }).end('{"files":[]}'));
        return;
      }
      if (url === "/agent") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const p = q.get("path") ?? "";
        if (!isSafeAgentPath(p)) {
          res.writeHead(400).end("{}");
          return;
        }
        void readAgentFile(p)
          .then((content) =>
            res
              .writeHead(200, { "content-type": "application/json" })
              .end(JSON.stringify({ path: p, content: content ?? "", revisions: listAgentRevisions(p, 20) })),
          )
          .catch(() => res.writeHead(200, { "content-type": "application/json" }).end("{}"));
        return;
      }
      if (url === "/agent-revision") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const id = Number(q.get("id"));
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ content: getAgentRevision(id) ?? "" }));
        return;
      }

      // PR status for the drawer: review verdict (DB) + live conflict check (one gh read). Lets
      // the action bar choose Fix vs Merge-anyway vs conflict-only without the user reading.
      if (url === "/pr-status") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const repo = q.get("repo") ?? "";
        const number = Number(q.get("number"));
        void (async () => {
          let review = repo && number ? getReview(repo, number) : null;
          // Retroactive: PRs reviewed before verdict-capture have no DB row — read the verdict
          // from the thread once and persist it, so the Fix button + card badge light up.
          if (!review && repo && number) {
            const d = await detectReviewVerdict(repo, number).catch(() => null);
            if (d) {
              recordReview(repo, number, d.verdict, d.summary);
              review = { verdict: d.verdict, summary: d.summary };
            }
          }
          const branch = `agency/issue-${number}`;
          const merge = repo && number ? await prMergeStatus(repo, branch).catch(() => null) : null;
          let conflict: { files: string[] } | null = null;
          if (repo && number) {
            // GROUND TRUTH: a real branch→main merge test on the fresh remote, NOT GitHub's `mergeable`
            // flag (it lags badly after a push — both false "conflict" and false "clean"). The action
            // bar's mergeable is overridden from this so Fix/Merge reflect reality.
            const probe = await mergeProbe(repo, branch).catch(() => ({ ok: false, files: [] as string[] }));
            if (probe.ok && merge) merge.mergeable = probe.files.length ? "conflict" : "clean";
            if (probe.ok && probe.files.length) {
              const sha = await branchHeadSha(repo, branch).catch(() => "");
              const stored = getConflict(repo, number);
              if (stored && stored.sha === sha) {
                conflict = { files: stored.files };
              } else {
                const firstTime = !stored; // only announce a conflict ONCE — each Fix changes the SHA.
                recordConflict(repo, number, sha, probe.files);
                conflict = { files: probe.files };
                if (firstTime) {
                  const list = probe.files.length ? probe.files.map((f) => `- \`${f}\``).join("\n") : "_(open the PR to see them)_";
                  await commentOnIssue(
                    repo,
                    number,
                    `🔀 **Merge conflicts with \`main\`** — this PR can't merge until they're resolved.\n\nConflicting file${probe.files.length === 1 ? "" : "s"}:\n${list}\n\nPress **Fix merge conflicts** on the card to have the agency resolve them automatically.`,
                  ).catch(() => {});
                }
              }
            } else if (probe.ok) {
              clearConflict(repo, number); // truly mergeable now — drop the stale conflict box
            } else {
              const stored = getConflict(repo, number); // probe failed — keep last known, don't flip-flop
              if (stored) conflict = { files: stored.files };
            }
          }
          res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ review, merge, conflict }));
        })();
        return;
      }

      // App panel: is this PR a web app (browser preview) or a Tauri/native app (run locally)?
      if (url === "/app-info") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const repo = q.get("repo") ?? "";
        const number = Number(q.get("number"));
        void (async () => {
          let kind = "unknown";
          let devScript: string | null = null;
          const pkg = repo ? await readRepoFile(repo, "package.json") : null;
          if (pkg) {
            const hasSrcTauri = (await readRepoFile(repo, "src-tauri/Cargo.toml")) != null;
            kind = isTauriPackage(pkg, hasSrcTauri) ? "tauri" : "web";
            try {
              devScript = pickWebDevScript((JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts ?? {});
            } catch {
              /* ignore */
            }
          } else if (repo) {
            kind = "none"; // no package.json — nothing to run
          }
          res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ kind, devScript, app: getApp(repo, number) }));
        })();
        return;
      }
      // Tauri/native: download a one-double-click .command that runs the PR on the user's Mac.
      if (url === "/app-local") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const repo = q.get("repo") ?? "";
        const number = Number(q.get("number"));
        const [owner, name] = repo.split("/");
        if (!owner || !name || !number) {
          res.writeHead(400).end("bad request");
          return;
        }
        const script = buildLocalCommand(owner, name, `agency/issue-${number}`);
        // raw=1 → serve as plain text so it can be piped straight into bash from Terminal
        // (`curl … | bash`). This bypasses macOS Gatekeeper, which blocks unsigned downloaded
        // .command files. Otherwise serve as a downloadable .command (legacy/fallback).
        if (q.get("raw") === "1") {
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          res.end(script);
          return;
        }
        res.writeHead(200, {
          "content-type": "text/x-shellscript",
          "content-disposition": `attachment; filename="${name}-pr-${number}.command"`,
        });
        res.end(script);
        return;
      }

      // Side-panel conversation. The DB is the source of truth: we serve the cached, time-sorted
      // thread instantly (resilient if GitHub is slow/down) and reconcile GitHub in the background.
      if (url === "/thread") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const repo = q.get("repo") ?? "";
        const number = Number(q.get("number"));
        if (!repo || !number) {
          res.writeHead(400).end("{}");
          return;
        }
        const headKey = `head:${repo}#${number}`;
        // Pull GitHub's thread and fold it into the DB (incoming comments + a cached issue head).
        const reconcile = async (): Promise<void> => {
          const t = await getThreadFull(repo, number);
          for (const c of t.comments) {
            if (c.id) foldInGitHubComment({ repo, number, gh_id: c.id, author: c.author, body: c.body, created_at: c.createdAt, isAgency: c.isAgency });
          }
          setSetting(headKey, JSON.stringify({ title: t.title, body: t.body, author: t.author, createdAt: t.createdAt, state: t.state }));
        };
        const respond = (): void => {
          let head: { title?: string; body?: string; author?: string; createdAt?: string; state?: string } = {};
          try { head = JSON.parse(getSetting(headKey) || "{}"); } catch { /* none cached yet */ }
          const comments = getConversation(repo, number);
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
            title: head.title ?? `#${number}`,
            body: head.body ?? "",
            author: head.author ?? "?",
            createdAt: head.createdAt ?? "",
            state: head.state ?? "open",
            comments,
          }));
        };
        // First time we've ever seen this issue (nothing cached) → reconcile synchronously so the
        // panel isn't empty. Otherwise serve the DB immediately and refresh in the background.
        // No cached comments yet → reconcile synchronously so an issue that's "full on GitHub" never
        // shows empty (even if a prior head fetch cached a head but the comments fetch came up empty).
        const cold = conversationCount(repo, number) === 0;
        if (cold) {
          reconcile().then(respond).catch(respond);
        } else {
          respond();
          void reconcile().catch(() => {});
        }
        return;
      }

      if (url === "/orch") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const repo = q.get("repo") ?? "";
        if (!repo) return void res.writeHead(400).end("{}");
        return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ thread: listOrchThread(repo, 200) }));
      }

      // Live status dashboard (client fetches /data + /events). No-store so a redeploy's new
      // UI shows up immediately instead of the browser serving a stale cached page.
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
      });
      // Preact UI at /.
      res.end(renderShell());
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    const path = (req.url ?? "").split("?")[0];

    // Auth forms (urlencoded, no auth required) — setup, login, accept-invite, logout, reset.
    if (path === "/setup" || path === "/login" || path === "/invite" || path === "/logout" || path === "/forgot" || path === "/forgot-link" || path === "/reset") {
      const htmlHead = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
      void readBody(req).then(async (body) => {
        const form = new URLSearchParams(body.toString("utf8"));
        const emailOn = emailEnabled();
        if (path === "/forgot-link") {
          // Email a one-time reset link. Always respond generically (no account enumeration).
          const notice = "If an account matches, we've sent a reset link. Check your email.";
          const identifier = (form.get("identifier") ?? "").trim();
          const u = identifier ? getUserByNameOrEmail(identifier) : null;
          if (u && u.email && emailOn) {
            const token = createPasswordReset(u.id);
            if (token) {
              const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() || "https";
              const base = cfg.publicUrl?.replace(/\/$/, "") || `${proto}://${req.headers["host"] ?? ""}`;
              try {
                await sendPasswordReset(u.email, `${base}/reset?token=${token}`);
              } catch (err) {
                console.warn("[agency] reset email failed:", (err as Error).message);
              }
            }
          }
          return void res.writeHead(200, htmlHead).end(renderForgot({ notice, emailOn }));
        }
        if (path === "/reset") {
          // Set a new password from a one-time email-link token.
          const token = (form.get("token") ?? "").trim();
          const np = form.get("password") ?? "";
          if (np.length < 8) return void res.writeHead(200, htmlHead).end(renderReset(token, "Password must be at least 8 characters."));
          const userId = consumePasswordReset(token);
          if (!userId) return void res.writeHead(200, htmlHead).end(renderReset(token, "This reset link is invalid or has expired. Request a new one."));
          setUserPassword(userId, np);
          setSessionCookie(req, res, createSession(userId)); // log them straight in
          return void res.writeHead(303, { location: "/" }).end();
        }
        if (path === "/forgot") {
          // Reset using the server's MASTER_KEY as the recovery secret (no email needed).
          if (!verifyRecoveryKey(form.get("key") ?? "")) return void res.writeHead(200, htmlHead).end(renderForgot({ error: "Recovery key is incorrect.", emailOn }));
          const u = getUserByName((form.get("username") ?? "").trim());
          const np = form.get("password") ?? "";
          if (!u) return void res.writeHead(200, htmlHead).end(renderForgot({ error: "No account with that username.", emailOn }));
          if (np.length < 8) return void res.writeHead(200, htmlHead).end(renderForgot({ error: "Password must be at least 8 characters.", emailOn }));
          setUserPassword(u.id, np);
          setSessionCookie(req, res, createSession(u.id)); // log them straight in
          return void res.writeHead(303, { location: "/" }).end();
        }
        if (path === "/setup") {
          // First-run admin creation. Only valid while there are no users (prevents takeover).
          if (countUsers() > 0) return void res.writeHead(303, { location: "/login" }).end();
          const username = (form.get("username") ?? "").trim();
          const pw = form.get("password") ?? "";
          if (username.length < 2 || pw.length < 8) return void res.writeHead(200, htmlHead).end(renderSetup("Username and an 8+ character password are required."));
          const admin = createUser(username, pw, "admin", form.get("email") || null);
          if (!admin) return void res.writeHead(200, htmlHead).end(renderSetup("Couldn’t create the account — try a different username."));
          setSessionCookie(req, res, createSession(admin.id));
          return void res.writeHead(303, { location: "/" }).end();
        }
        if (path === "/logout") {
          const tok = parseCookies(req)[SESSION_COOKIE];
          if (tok) revokeSession(tok);
          clearSessionCookie(res);
          return void res.writeHead(303, { location: "/login" }).end();
        }
        if (path === "/login") {
          const u = authenticate((form.get("username") ?? "").trim(), form.get("password") ?? "");
          if (!u) return void res.writeHead(200, htmlHead).end(renderLogin("Wrong username or password."));
          setSessionCookie(req, res, createSession(u.id));
          return void res.writeHead(303, { location: "/" }).end();
        }
        // /invite
        const token = form.get("token") ?? "";
        const inv = getInvite(token);
        if (!inv) return void res.writeHead(200, htmlHead).end(renderInvite(token, null, "This invite is invalid or already used."));
        const username = (form.get("username") ?? "").trim();
        const pw = form.get("password") ?? "";
        if (username.length < 2 || pw.length < 8) return void res.writeHead(200, htmlHead).end(renderInvite(token, inv.email, "Username and an 8+ character password are required."));
        const created = createUser(username, pw, inv.role, form.get("email") || inv.email);
        if (!created) return void res.writeHead(200, htmlHead).end(renderInvite(token, inv.email, "That username is taken."));
        acceptInvite(token);
        setSessionCookie(req, res, createSession(created.id));
        return void res.writeHead(303, { location: "/" }).end();
      });
      return;
    }

    // Dashboard actions (auth required), not GitHub webhooks.
    if (["/archive", "/comment", "/comment-edit", "/run-checks", "/merge", "/close", "/close-not-planned", "/create-pr", "/delete", "/resume", "/stop", "/hold", "/fix", "/auto", "/start", "/new-issue", "/approve", "/audit", "/settings", "/agent-save", "/agent-revert", "/app-run", "/app-stop", "/upload-image", "/upload-file", "/add-repo", "/remove-repo", "/models", "/discover-models", "/invite-create", "/user-secret", "/onboarded", "/set-password", "/test-claude", "/model-override", "/issue-workflow", "/issue-provider", "/issue-agent-model", "/issue-use-fallback", "/issue-budget", "/agent-def-save", "/agent-def-delete", "/skill-save", "/skill-delete", "/skill-import", "/hook-save", "/hook-delete", "/analyzer-run", "/refresh", "/refresh-issue", "/cancel", "/reset-issue", "/install-cli", "/gh-connect", "/gh-connect-poll", "/gh-disconnect", "/workflow-save", "/workflow-delete", "/default-workflow", "/orch-chat", "/orch-handoff", "/orch-clear"].includes(path)) {
      const actor = userFromReq(req);
      if (!actor) return void res.writeHead(401, { "content-type": "application/json" }).end('{"error":"auth required"}');
      void readBody(req).then(async (body) => {
        let p: { repo?: string; number?: number; commentId?: number; body?: string; title?: string; role?: string; path?: string; content?: string; windowHours?: number; budget?: number; anchorNow?: boolean; anchor?: string; pctNow?: number; tracker?: string; agentDef?: Partial<AgentDef> & { name: string }; agentName?: string; workflow?: { id: string; name: string; trigger?: string; steps?: unknown[]; gates?: unknown[]; hooks?: unknown[] }; workflowId?: string; skill?: Partial<Skill> & { name: string }; skillName?: string; hook?: { id?: number; target: string; phase: "pre" | "post"; command: string; enabled?: boolean }; hookId?: number; dataUrl?: string; name?: string; providers?: Provider[]; roleModels?: Record<string, { providerId: string; model: string }>; globalModel?: { providerId: string; model: string } | null; fallbackChain?: Array<{ providerId: string; model: string }>; autoSwitchOnLimit?: boolean; model?: { providerId: string; model: string } | null; agentModels?: Record<string, string>; newIssueDefault?: string; kind?: string; value?: string; skipArchitect?: string; gitnexus?: string; maxTokensPerRun?: number; maxReviseRounds?: number; auditThreshold?: number; start?: boolean; email?: string; key?: string; ops?: Record<string, string | number | boolean>; agentRunner?: string; agentCliCommand?: string; webhookSecret?: string; analyzerUrl?: string; avatars?: string; source?: string; id?: string; discover?: boolean } = {};
        try {
          p = JSON.parse(body.toString("utf8"));
        } catch {
          /* ignore */
        }
        const repo = p.repo ?? "";
        const number = Number(p.number);
        const ok = (payload = '{"ok":true}') =>
          res.writeHead(200, { "content-type": "application/json" }).end(payload);
        // Owner-identity token for "acts as you" actions — dashboard-stored creds, then env.
        const ownerToken = ghUserToken() || ghBotToken() || cfg.adminToken || "";

        // --- multi-user: invites + per-user encrypted secrets ---
        if (path === "/invite-create") {
          if (!actor || actor.role !== "admin") return res.writeHead(403).end('{"error":"admin only"}');
          const token = createInvite(p.email ?? null, p.role === "admin" ? "admin" : "member", actor.id);
          const base = (req.headers["x-forwarded-proto"] ? `${(req.headers["x-forwarded-proto"] as string).split(",")[0]}://` : "https://") + (req.headers["host"] ?? "");
          return ok(JSON.stringify({ ok: true, token, url: `${base}/invite?token=${token}` }));
        }
        if (path === "/user-secret") {
          // Write-only: store an encrypted credential for the signed-in user. Never returned.
          if (!actor) return res.writeHead(409).end('{"error":"multi-user not enabled"}');
          if (!p.key) return res.writeHead(400).end("{}");
          // Trim surrounding whitespace — a pasted token with a stray space/newline 401s.
          setUserSecret(actor.id, String(p.key), String(p.value ?? "").trim());
          return ok();
        }
        if (path === "/set-password") {
          // Set a new password — your own, or (admin) another user's via `number`=userId. No
          // current-password check, by request. Min 8 chars.
          if (!actor) return res.writeHead(409).end("{}");
          const np = String(p.value ?? "");
          if (np.length < 8) return res.writeHead(400).end(JSON.stringify({ error: "Password must be at least 8 characters" }));
          const targetId = number && actor.role === "admin" ? number : actor.id;
          setUserPassword(targetId, np);
          return ok();
        }
        if (path === "/onboarded") {
          // Mark (or reset, with value:"0") the onboarding wizard done for the signed-in user.
          if (!actor) return res.writeHead(409).end("{}");
          setSetting(`onboarded:${actor.id}`, p.value === "0" ? "0" : "1");
          return ok();
        }

        if (path === "/archive") {
          if (repo && number) archiveIssue(repo, number);
          return ok();
        }
        if (path === "/comment") {
          // Inline reply -> posts to GitHub as the human (no agency marker) so it re-engages.
          if (!repo || !number || !p.body?.trim()) return res.writeHead(400).end("{}");
          // If a model override is attached (from the chatbox model picker), store it.
          // It's applied as the provider route for all roles on the next run of this issue, then cleared.
          if (p.hasOwnProperty("model")) {
            if (p.model && typeof p.model === "object" && p.model.providerId && p.model.model) {
              setIssueModelOverride(repo, number, p.model.providerId, p.model.model);
            } else {
              clearIssueModelOverride(repo, number);
            }
          }
          const text = p.body.trim();
          // DB-first: record the reply locally now so the dashboard shows it instantly, then mirror.
          const localId = recordOutgoingComment({ repo, number, author: actor?.username || "you", body: text, source: "human" });
          try {
            // Post under the owner's account (your token) so it shows your name, not the bot's.
            const res = await commentAsHuman(repo, number, text, ownerToken);
            if (res?.id) setCommentGhId(localId, res.id, res.created_at);
          } catch (errOwner) {
            // The "acts as you" token often lacks Issues:write on this repo (or isn't scoped to it).
            // Rather than fail, fall back to the bot identity (which already works the repo).
            const bot = ghBotToken();
            if (bot && bot !== ownerToken) {
              try {
                const res = await commentAsHuman(repo, number, text, bot);
                if (res?.id) setCommentGhId(localId, res.id, res.created_at);
              } catch (errBot) {
                return res.writeHead(500).end(
                  JSON.stringify({
                    error:
                      `GitHub rejected the comment on ${repo}. Check the token has **Issues: Read & write** on this repo ` +
                      `(and the bot account is a collaborator). Details: ${(errBot as Error).message.slice(0, 200)}`,
                  }),
                );
              }
            } else {
              return res.writeHead(500).end(
                JSON.stringify({
                  error:
                    `GitHub rejected the comment on ${repo}. The GitHub token needs **Issues: Read & write** on this repo. ` +
                    `Details: ${(errOwner as Error).message.slice(0, 200)}`,
                }),
              );
            }
          }
          // Make the agent act on the reply. onComment re-engages to ADDRESS the message even if a
          // PR exists (unlike plain Resume, which just offers the merge).
          // Exception: planned / awaiting-approval issues have no branch yet — posting a comment should
          // NOT kick off a run automatically. The human will start it explicitly when ready.
          const issueRow = getIssueRow(repo, number);
          const issueState = issueRow?.state ?? "";
          // "planned, no branch yet" — the three legacy spellings (bare 'planned', the
          // 'agency:planned' label, and 'agency:awaiting-approval' which is planned+blocked)
          // all parse to IssueState 'planned'. See src/state.ts (#66).
          const isPlanned = parseLegacyStatus(issueState).state === "planned";
          const reengage = isPlanned ? null : (onComment ?? resume);
          if (hasActiveRun(repo, number) && reengage) {
            // QUEUE: don't interrupt the current run. The comment is already posted; re-engage once the
            // issue goes idle so the agent re-reads the thread (with this message) and acts on it.
            const waitThenReengage = (): void => {
              if (hasActiveRun(repo, number)) {
                setTimeout(waitThenReengage, 5000);
                return;
              }
              void reengage(repo, number);
            };
            setTimeout(waitThenReengage, 5000);
          } else if (reengage) {
            void reengage(repo, number);
          } else {
            void trigger("dashboard-comment");
          }
          return ok();
        }
        if (path === "/comment-edit") {
          // Edit an existing comment by its id (from getThreadFull). Attempts owner token first,
          // falls back to bot token — so you can edit both your own comments and agency comments.
          if (!repo || !number || !p.commentId || !p.body?.trim()) return res.writeHead(400).end("{}");
          const text = p.body.trim();
          try {
            await editCommentAsHuman(repo, p.commentId, text, ownerToken);
          } catch (errOwner) {
            const bot = ghBotToken();
            if (bot && bot !== ownerToken) {
              try {
                await editCommentAsHuman(repo, p.commentId, text, bot);
              } catch (errBot) {
                return res.writeHead(500).end(JSON.stringify({ error: `Couldn't edit comment: ${(errBot as Error).message.slice(0, 200)}` }));
              }
            } else {
              return res.writeHead(500).end(JSON.stringify({ error: `Couldn't edit comment: ${(errOwner as Error).message.slice(0, 200)}` }));
            }
          }
          updateCommentBody(Number(p.commentId), text); // keep the DB copy in step
          return ok();
        }
        if (path === "/settings") {
          // Save token-budget settings from the dashboard (no redeploy needed).
          if (p.windowHours && p.windowHours > 0) setSetting("window_hours", String(Math.round(p.windowHours)));
          if (p.budget !== undefined && p.budget >= 0) setSetting("token_budget", String(Math.round(p.budget)));
          if (p.anchorNow) setSetting("window_anchor", new Date().toISOString()); // "my window starts now"
          if (p.anchor) {
            const t = Date.parse(p.anchor); // manual: "my session started at <time>"
            if (Number.isFinite(t)) setSetting("window_anchor", new Date(t).toISOString());
          }
          if (p.pctNow !== undefined && p.pctNow >= 0) {
            // Calibrate the gauge to "X% right now": store the extra tokens needed to reach X% of
            // the budget on top of what we've actually counted this window.
            const b = sessionBudget();
            const counted = tokensSince(sessionWindow().startIso).tokens;
            const target = Math.round((Math.min(100, p.pctNow) / 100) * b);
            setSetting("usage_offset_tokens", String(Math.max(0, target - counted)));
            setSetting("usage_offset_at", new Date().toISOString());
          }
          // Pipeline knobs moved out of env — apply live, no redeploy.
          if (p.tracker === "local" || p.tracker === "github") setSetting("tracker", p.tracker); // DB-authoritative vs GitHub-authoritative tracking (Phase 4)
          if (p.skipArchitect === "on" || p.skipArchitect === "off") setSetting("skip_architect", p.skipArchitect);
          if (typeof p.newIssueDefault === "string" && p.newIssueDefault.trim()) setSetting("new_issue_default", p.newIssueDefault.trim());
          if (p.gitnexus === "on" || p.gitnexus === "off") setSetting("gitnexus", p.gitnexus);
          if (p.maxTokensPerRun !== undefined && p.maxTokensPerRun >= 0) setSetting("max_tokens_per_run", String(Math.round(p.maxTokensPerRun)));
          if (p.maxReviseRounds !== undefined && p.maxReviseRounds >= 0) setSetting("max_revise_rounds", String(Math.round(p.maxReviseRounds)));
          if (p.auditThreshold !== undefined && p.auditThreshold >= 1) setSetting("audit_threshold", String(Math.round(p.auditThreshold)));
          if (p.avatars === "on" || p.avatars === "off") setSetting("avatars", p.avatars);
          // Default runner backend (#63): claude-sdk (default) | claude-cli | pi-cli | custom-cli.
          if (p.agentRunner === "claude-sdk" || p.agentRunner === "claude-cli" || p.agentRunner === "pi-cli" || p.agentRunner === "custom-cli") setSetting("agent_runner", p.agentRunner);
          if (typeof p.agentCliCommand === "string") setSetting("agent_cli_command", p.agentCliCommand);
          // Operations panel (global, admin-only when multi-user is on).
          if (p.ops && typeof p.ops === "object" && actor.role === "admin") {
            for (const [k, v] of Object.entries(p.ops)) {
              if (OPS_SETTINGS.some((s) => s.key === k)) setSetting(k, typeof v === "boolean" ? (v ? "on" : "off") : String(v));
            }
          }
          // Encrypted GitHub webhook secret (admin, write-only).
          if (p.webhookSecret !== undefined && actor.role === "admin") {
            setSecretSetting("github_webhook_secret", p.webhookSecret.trim());
          }
          // Analyzer base URL — lets the dashboard's "Run now" button reach the standalone watchdog.
          if (p.analyzerUrl !== undefined && actor.role === "admin") {
            setSetting("analyzer_url", p.analyzerUrl.trim().replace(/\/+$/, ""));
          }
          return ok();
        }
        if (path === "/agent-save") {
          // Live edit: store the override in the DB so it applies on the next agent run (no
          // redeploy). The change is versioned in agent_revisions.
          if (!p.path || !isSafeAgentPath(p.path) || typeof p.content !== "string") return res.writeHead(400).end("{}");
          setAgentOverride(p.path, p.content, "dashboard", "");
          return ok();
        }
        if (path === "/agent-revert") {
          // Drop the override so the file reverts to its on-disk default.
          if (!p.path || !isSafeAgentPath(p.path)) return res.writeHead(400).end("{}");
          deleteAgentOverride(p.path);
          return ok();
        }
        if (path === "/approve") {
          // Direct approve: marks it approved + moves it to Working immediately, then builds.
          if (!repo || !number || !approve) return res.writeHead(400).end("{}");
          if (p.hasOwnProperty("model")) {
            if (p.model && typeof p.model === "object" && p.model.providerId && p.model.model) {
              setIssueModelOverride(repo, number, p.model.providerId, p.model.model);
            } else {
              clearIssueModelOverride(repo, number);
            }
          }
          await approve(repo, number).catch(() => {});
          return ok();
        }
        if (path === "/merge") {
          // One-tap merge: squash the issue's PR (or, for an epic, all sub-issue PRs).
          if (!repo || !number) return res.writeHead(400).end("{}");
          if (isEpic(repo, number)) {
            const e = await mergeEpic(repo, number);
            return e.ok ? ok() : res.writeHead(409).end(JSON.stringify({ error: e.msg }));
          }
          const r = await mergePrForBranch(repo, `agency/issue-${number}`);
          if (r.ok) {
            afterMerge(repo, number, r.files);
            await closeIssue(repo, number, `🚀 Merged ${r.msg} from the dashboard.`).catch(() => {});
            recordIssueStatus(repo, number, withStatus("done"));
            clearConflict(repo, number);
            return ok();
          }
          return res.writeHead(409).end(JSON.stringify({ error: r.msg }));
        }
        if (path === "/create-pr") {
          // Deterministic, token-free: open a PR from the already-pushed branch (reviewer approved).
          if (!repo || !number || !createPr) return res.writeHead(400).end("{}");
          const r = await createPr(repo, number);
          return r.ok ? ok(JSON.stringify({ ok: true, url: r.url })) : res.writeHead(409).end(JSON.stringify({ error: r.msg }));
        }
        if (path === "/audit") {
          // "Audit now": run the independent codebase Auditor — opens scoped refactor issues in Planned.
          if (!repo || !audit) return res.writeHead(400).end("{}");
          void audit(repo);
          return ok();
        }
        if (path === "/close") {
          // Close an issue that has no PR to merge — e.g. a master/epic issue whose sub-issues are
          // all done, or a planning issue. For an epic, merge any remaining sub-PRs first.
          if (!repo || !number) return res.writeHead(400).end("{}");
          try {
            if (isEpic(repo, number)) {
              const e = await mergeEpic(repo, number); // closes the parent when all children are done
              if (e.ok) return ok();
              // some child PR couldn't merge — the user still asked to close, so close the parent.
            }
            await closeIssue(repo, number, "✅ Closed from the dashboard.").catch(() => {});
            recordIssueStatus(repo, number, withStatus("done")); // closed ≠ merged — keep the chip honest
            return ok();
          } catch (err) {
            return res.writeHead(500).end(JSON.stringify({ error: (err as Error).message }));
          }
        }
        if (path === "/refresh") {
          // Manual "reload from GitHub": re-scan the watched repos so every open issue's title/state
          // is re-pulled into the DB and any new issues are ingested. Returns immediately; the scan
          // updates the DB in the background and the board picks it up on its next poll.
          void trigger("dashboard-refresh");
          return ok();
        }
        if (path === "/refresh-issue") {
          // Re-pull ONE issue from GitHub: fold its whole conversation into the DB + refresh head/title.
          // Awaited so the dashboard's follow-up thread reload sees the freshly-synced comments.
          if (!repo || !number) return res.writeHead(400).end("{}");
          try {
            const t = await getThreadFull(repo, number);
            for (const c of t.comments) {
              if (c.id) foldInGitHubComment({ repo, number, gh_id: c.id, author: c.author, body: c.body, created_at: c.createdAt, isAgency: c.isAgency });
            }
            setSetting(`head:${repo}#${number}`, JSON.stringify({ title: t.title, body: t.body, author: t.author, createdAt: t.createdAt, state: t.state }));
            if (t.title) recordIssueState(repo, number, { title: t.title });
            return ok();
          } catch (err) {
            return res.writeHead(502).end(JSON.stringify({ error: `Couldn't reach GitHub: ${(err as Error).message.slice(0, 160)}` }));
          }
        }
        if (path === "/cancel") {
          // Reset to Planned regardless of state — even with a PR / work done. Aborts any run, parks
          // it in Planned (DB is the source of truth; the branch/PR stays on GitHub untouched).
          if (!repo || !number) return res.writeHead(400).end("{}");
          if (stop) await stop(repo, number).catch(() => {});
          recordIssueStatus(repo, number, withStatus("planned"));
          return ok();
        }
        if (path === "/reset-issue") {
          // FULL reset: wipe ALL progress — activity stream, plan, session, overrides, rate-limits,
          // AND the agency's GitHub comments — returning the issue to its initial post state.
          // Human comments are preserved. The branch/PR stays on GitHub.
          if (!repo || !number) return res.writeHead(400).end("{}");
          if (stop) await stop(repo, number).catch(() => {});
          clearActivity(repo, number);
          clearIssueModelOverride(repo, number);
          clearIssueWorkflow(repo, number);
          clearIssueProvider(repo, number);
          // Wipe per-issue settings (plan, role, solo, dealer, budget, agent models).
          for (const key of [`issue_plan.${repo}#${number}`, `issue_role.${repo}#${number}`, `issue_solo.${repo}#${number}`, `issue_dealer.${repo}#${number}`, `issue_budget.${repo}#${number}`, `issue_provider.${repo}#${number}`, `issue_agent_models.${repo}#${number}`, `issue_use_fallback.${repo}#${number}`, `issue_workflow.${repo}#${number}`, `issue_model.${repo}#${number}`]) {
            try { const d = getDb(); if (d) d.prepare("DELETE FROM settings WHERE key = ?").run(key); } catch { /* best effort */ }
          }
          clearRateLimited(repo, number);
          // Delete ALL agency comments from the GitHub issue (human comments stay).
          const deleted = await deleteAgencyComments(repo, number).catch(() => 0);
          recordIssueStatus(repo, number, withStatus("planned"));
          return ok(JSON.stringify({ ok: true, deletedComments: deleted }));
        }
        if (path === "/close-not-planned") {
          // Dismiss a Planned issue we won't do: close it on GitHub as "not planned" (informative)
          // and hide it from the board. No PR/merge logic — it was never started.
          if (!repo || !number) return res.writeHead(400).end("{}");
          await closeIssue(repo, number, "🗂 Closed as **not planned** from the dashboard.", "not planned").catch(() => {});
          recordIssueStatus(repo, number, withStatus("done"));
          archiveIssue(repo, number);
          return ok();
        }
        if (path === "/delete") {
          // Try a real delete (owner-only); otherwise close + hide from the board.
          if (!repo || !number) return res.writeHead(400).end("{}");
          const r = await deleteIssueHard(repo, number, ownerToken);
          if (!r.ok) await closeIssue(repo, number).catch(() => {});
          archiveIssue(repo, number);
          return ok(JSON.stringify({ ok: true, deleted: r.ok }));
        }
        if (path === "/resume") {
          // Unstick an issue and re-run it, whatever state it's in.
          if (!repo || !number || !resume) return res.writeHead(400).end("{}");
          if (p.hasOwnProperty("model")) {
            if (p.model && typeof p.model === "object" && p.model.providerId && p.model.model) {
              setIssueModelOverride(repo, number, p.model.providerId, p.model.model);
            } else {
              clearIssueModelOverride(repo, number);
            }
          }
          await resume(repo, number).catch(() => {});
          return ok();
        }
        if (path === "/stop") {
          // Abort any in-flight agent run, turn off auto, and park the issue back in Planned.
          if (!repo || !number || !stop) return res.writeHead(400).end("{}");
          await stop(repo, number).catch(() => {});
          return ok();
        }
        if (path === "/hold") {
          // Interrupt & steer: queue the chat message and pause the workflow at the next safe break
          // (does NOT abort the in-flight run — the current agent finishes, then the pipeline holds).
          if (!repo || !number) return res.writeHead(400).end("{}");
          const steerText = (p.body ?? "").trim();
          if (steerText) queueSteer(repo, number, steerText);
          requestHold(repo, number);
          pushActivity(repo, number, "developer", "text", "⏸ Interrupt queued — pausing at the next safe break for your steer.");
          return ok();
        }
        if (path === "/test-claude") {
          // Make a tiny real Agent SDK call with the resolved Claude credential so a bad/mismatched
          // token (wrong type, expired, MASTER_KEY mismatch) is caught here, not at first run.
          const r = await testClaudeAuth().catch((e) => ({ ok: false, via: "", error: (e as Error).message }));
          return ok(JSON.stringify(r));
        }
        if (path === "/fix") {
          // Address the PR's outstanding review (and resolve conflicts) on its branch.
          if (!repo || !number || !fix) return res.writeHead(400).end("{}");
          if (p.hasOwnProperty("model")) {
            if (p.model && typeof p.model === "object" && p.model.providerId && p.model.model) {
              setIssueModelOverride(repo, number, p.model.providerId, p.model.model);
            } else {
              clearIssueModelOverride(repo, number);
            }
          }
          await fix(repo, number).catch(() => {});
          return ok();
        }
        if (path === "/auto") {
          // Toggle auto-resume / auto-merge at the global, per-repo, or per-issue scope.
          const kind = p.kind === "merge" ? "merge" : p.kind === "resume" ? "resume" : null;
          const value = p.value === "on" || p.value === "off" || p.value === "inherit" ? p.value : null;
          if (!kind || !value) return res.writeHead(400).end("{}");
          setAuto(kind as AutoKind, value === "inherit" ? "" : value, repo || undefined, number || undefined);
          void trigger("auto-toggle"); // let it act immediately if something is now eligible
          return ok();
        }
        if (path === "/app-run") {
          // Start a web preview (dev server + public tunnel) for the PR.
          if (!repo || !number) return res.writeHead(400).end("{}");
          const pkg = await readRepoFile(repo, "package.json");
          let ds: string | null = null;
          try {
            ds = pkg ? pickWebDevScript((JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts ?? {}) : null;
          } catch {
            /* ignore */
          }
          if (!ds) return res.writeHead(409).end(JSON.stringify({ error: "no web dev script found" }));
          void startApp(repo, number, ds);
          return ok();
        }
        if (path === "/app-stop") {
          if (!repo || !number) return res.writeHead(400).end("{}");
          stopApp(repo, number);
          return ok();
        }
        if (path === "/model-override") {
          if (!repo || !number) return res.writeHead(400).end("{}");
          if (p.model && typeof p.model === "object" && p.model.providerId && p.model.model) {
            setIssueModelOverride(repo, number, p.model.providerId, p.model.model);
          } else {
            clearIssueModelOverride(repo, number);
          }
          return ok();
        }
        if (path === "/default-workflow") {
          // Set the GLOBAL default workflow (configured in the workflow manager). Empty → reset.
          if (p.workflowId && typeof p.workflowId === "string") setDefaultWorkflowId(p.workflowId);
          else setDefaultWorkflowId("");
          return ok();
        }
        if (path === "/issue-provider") {
          if (!repo || !number) return res.writeHead(400).end("{}");
          setIssueProvider(repo, number, (p as { providerId?: string }).providerId || "");
          return ok();
        }
        if (path === "/issue-agent-model") {
          // Per-agent model override on an issue: { agent: "<role|@handle>", model: "providerId/model" | "" }.
          if (!repo || !number) return res.writeHead(400).end("{}");
          const pp = p as { agent?: string; model?: string };
          if (pp.agent) setIssueAgentModel(repo, number, pp.agent, pp.model || "");
          return ok();
        }
        if (path === "/issue-use-fallback") {
          if (!repo || !number) return res.writeHead(400).end("{}");
          setIssueUseFallback(repo, number, (p as { value?: string | boolean }).value === true || (p as { value?: string }).value === "on" || (p as { value?: string }).value === "1");
          return ok();
        }
        if (path === "/issue-workflow") {
          // Pin (or clear) the workflow this issue runs — persisted, honored on resume.
          if (!repo || !number) return res.writeHead(400).end("{}");
          if (p.workflowId && typeof p.workflowId === "string") setIssueWorkflow(repo, number, p.workflowId);
          else clearIssueWorkflow(repo, number);
          return ok();
        }
        if (path === "/issue-budget") {
          // Set or clear a per-issue budget override { maxCostUsd?, maxTurns?, maxTokensPerRun?, unlimited? }.
          if (!repo || !number) return res.writeHead(400).end("{}");
          if (p.budget && typeof p.budget === "object") {
            const budget = p.budget as Record<string, unknown>;
            const b: Record<string, number | boolean> = {};
            for (const k of ["maxCostUsd", "maxTurns", "maxTokensPerRun"]) {
              const v = budget[k];
              if (typeof v === "number" && Number.isFinite(v) && v >= 0) b[k] = v;
            }
            if (budget.unlimited === true) b.unlimited = true;
            setIssueBudget(repo, number, Object.keys(b).length ? b : null);
          } else {
            setIssueBudget(repo, number, null);
          }
          return ok();
        }
        if (path === "/models") {
          // Save providers, per-role assignments, and fallback chain (live, next run uses them).
          if (Array.isArray(p.providers)) setProviders(p.providers);
          if (p.roleModels && typeof p.roleModels === "object") setRoleModels(p.roleModels);
          if (p.hasOwnProperty("globalModel")) setGlobalModel(p.globalModel ?? null);
          if (Array.isArray(p.fallbackChain)) setFallbackChain(p.fallbackChain);
          if (typeof p.autoSwitchOnLimit === "boolean") setSetting("auto_switch_on_limit", p.autoSwitchOnLimit ? "on" : "off");
          return ok();
        }
        if (path === "/discover-models") {
          // Live model discovery for one provider (on add + manual Refresh). pi is the only source:
          // `pi --list-models` (with the key registered into pi's config dir). Persists the discovered
          // models into the row, applies pi-cli as the runner when the row has none, returns the result.
          if (!actor || actor.role !== "admin") return void res.writeHead(403, { "content-type": "application/json" }).end('{"error":"admin only"}');
          const id = String(p.id ?? "").trim();
          const list = getProviders();
          const provider = list.find((x) => x.id === id);
          if (!provider) return void res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "Provider not found." }));
          const r = await discoverProviderModels(provider);
          if (r.models.length) {
            const next = list.map((x) => x.id === id ? { ...x, models: r.models, ...(x.runner ? {} : r.runner ? { runner: r.runner } : {}) } : x);
            setProviders(next);
          }
          return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: r.models.length > 0, models: r.models, via: r.via, runner: r.runner, error: r.error }));
        }
        if (path === "/install-cli") {
          if (!actor || actor.role !== "admin") return void res.writeHead(403, { "content-type": "application/json" }).end('{"error":"admin only"}');
          const spec = installSpec(String(p.kind ?? ""), p.value);
          if (!spec) return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "Unknown runner, or invalid package name." }));
          const r = await installCli(spec.pkg);
          const available = spec.binary ? binaryAvailable(spec.binary) : r.ok;
          return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: r.ok, available, pkg: spec.pkg, log: r.log }));
        }
        if (path === "/gh-connect") {
          if (!actor || actor.role !== "admin") return void res.writeHead(403, { "content-type": "application/json" }).end('{"error":"admin only"}');
          if (typeof p.value === "string" && p.value.trim()) setSetting("github_oauth_client_id", p.value.trim());
          const clientId = githubOAuthClientId();
          if (!clientId) return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "Set the OAuth App client ID first." }));
          try {
            const d = await startDeviceFlow(clientId);
            ghDevice = { deviceCode: d.device_code, adminId: actor.id, at: Date.now() };
            return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ user_code: d.user_code, verification_uri: d.verification_uri, interval: d.interval, expires_in: d.expires_in }));
          } catch (e) {
            return void res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: (e as Error).message }));
          }
        }
        if (path === "/gh-connect-poll") {
          if (!actor || actor.role !== "admin") return void res.writeHead(403, { "content-type": "application/json" }).end('{"error":"admin only"}');
          if (!ghDevice) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: "No pending login." }));
          const r = await pollDeviceToken(githubOAuthClientId(), ghDevice.deviceCode);
          if (r.status === "ok") {
            setUserSecret(ghDevice.adminId, "github_oauth_token", r.token);
            try {
              const u = await fetchGitHubUser(r.token);
              setSetting("github_user_login", u.login);
              setSetting("github_user_name", u.name);
              setSetting("github_user_id", String(u.id));
            } catch { /* token saved; identity best-effort */ }
            ghDevice = null;
            return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, user: githubIdentity() }));
          }
          if (r.status === "error") { ghDevice = null; return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ error: r.error })); }
          return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ pending: true, ...(r.status === "slow_down" ? { interval: r.interval } : {}) }));
        }
        if (path === "/gh-disconnect") {
          if (!actor || actor.role !== "admin") return void res.writeHead(403, { "content-type": "application/json" }).end('{"error":"admin only"}');
          setUserSecret(actor.id, "github_oauth_token", "");
          setSetting("github_user_login", ""); setSetting("github_user_name", ""); setSetting("github_user_id", "");
          ghDevice = null;
          return void ok();
        }
        if (path === "/agent-def-save") {
          // Create/edit a custom agent (v3 agent editor).
          if (!p.agentDef?.name || !/^[\w-]+$/.test(p.agentDef.name)) return res.writeHead(400).end(JSON.stringify({ error: "Name must be letters/numbers/-/_" }));
          upsertAgentDef(p.agentDef);
          return ok();
        }
        if (path === "/agent-def-delete") {
          if (!p.agentName) return res.writeHead(400).end("{}");
          deleteAgentDef(p.agentName);
          return ok();
        }
        if (path === "/workflow-save") {
          if (!actor || actor.role !== "admin") return void res.writeHead(403, { "content-type": "application/json" }).end('{"error":"admin only"}');
          if (!p.workflow || !p.workflow.id || !/^[\w-]+$/.test(p.workflow.id) || !p.workflow.name) return void res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "id (letters/numbers/-/_) + name required" }));
          upsertWorkflow({ id: p.workflow.id, name: p.workflow.name, trigger: p.workflow.trigger ?? "", steps: (p.workflow.steps as never) ?? [], gates: (p.workflow.gates as never) ?? [], hooks: (p.workflow.hooks as never) ?? [] });
          return ok();
        }
        if (path === "/workflow-delete") {
          if (!actor || actor.role !== "admin") return void res.writeHead(403, { "content-type": "application/json" }).end('{"error":"admin only"}');
          if (p.workflowId) deleteWorkflow(p.workflowId);
          return ok();
        }
        if (path === "/skill-save") {
          if (!p.skill?.name || !/^[\w-]+$/.test(p.skill.name)) return res.writeHead(400).end(JSON.stringify({ error: "Skill name: letters/numbers/-/_" }));
          upsertSkill(p.skill);
          return ok();
        }
        if (path === "/skill-delete") { if (p.skillName) deleteSkill(p.skillName); return ok(); }
        if (path === "/skill-import") {
          if (actor.role !== "admin") return res.writeHead(403).end(JSON.stringify({ error: "Admins only" }));
          const src = String(p.source || "").trim();
          const mm = /github\.com[/:]([\w.-]+\/[\w.-]+)/.exec(src) || /^([\w.-]+\/[\w.-]+)$/.exec(src);
          if (!mm) return res.writeHead(400).end(JSON.stringify({ error: "Use owner/repo or a GitHub URL" }));
          const repo = mm[1].replace(/\.git$/, "");
          const tmp = mkdtempSync(join(tmpdir(), "skillimport-"));
          try {
            execSync(`git clone --depth 1 https://github.com/${repo}.git ${tmp}/r`, { stdio: "ignore", timeout: 60_000 });
            const files: string[] = [];
            const walk = (dir: string, depth: number): void => { if (depth > 6) return; for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.name === ".git" || e.name === "node_modules") continue; const fp = join(dir, e.name); if (e.isDirectory()) walk(fp, depth + 1); else if (e.name.toLowerCase() === "skill.md") files.push(fp); } };
            walk(`${tmp}/r`, 0);
            const names: string[] = [];
            for (const fp of files) {
              const text = readFileSync(fp, "utf8");
              const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
              if (!fm) continue;
              const nameM = /^\s*name:\s*(.+)$/m.exec(fm[1]);
              if (!nameM) continue;
              const name = nameM[1].trim().replace(/^["']|["']$/g, "").replace(/[^\w-]/g, "-").slice(0, 64);
              const descM = /^\s*description:\s*(.+)$/m.exec(fm[1]);
              const description = descM ? descM[1].trim().replace(/^["']|["']$/g, "").slice(0, 300) : "";
              if (!name) continue;
              upsertSkill({ name, description, body: (fm[2] || "").trim().slice(0, 20000) });
              names.push(name);
            }
            return ok(JSON.stringify({ imported: names.length, names }));
          } catch (e) {
            return res.writeHead(500).end(JSON.stringify({ error: "Import failed: " + ((e as Error).message || "").slice(0, 180) }));
          } finally {
            try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
          }
        }
        if (path === "/hook-save") {
          if (!p.hook?.target || !p.hook.command || (p.hook.phase !== "pre" && p.hook.phase !== "post")) return res.writeHead(400).end("{}");
          upsertHook(p.hook);
          return ok();
        }
        if (path === "/hook-delete") { if (p.hookId) deleteHook(p.hookId); return ok(); }
        if (path === "/analyzer-run") {
          // Manually kick the standalone watchdog: proxy a forced POST /run so the shared key never
          // leaves the server. Admin-only.
          if (actor.role !== "admin") return res.writeHead(403).end('{"error":"admin only"}');
          const base = (getSetting("analyzer_url") || "").trim().replace(/\/+$/, "");
          const key = (process.env.ANALYZER_API_KEY || getSetting("analyzer_api_key") || "").trim();
          if (!base) return res.writeHead(400).end(JSON.stringify({ error: "Set the analyzer URL in Settings first" }));
          if (!key || key.length < 16) return res.writeHead(400).end(JSON.stringify({ error: "Set a strong ANALYZER_API_KEY first" }));
          try {
            const r = await fetch(`${base}/run`, { method: "POST", headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
            if (r.status === 202) return ok(JSON.stringify({ ok: true, started: true }));
            if (r.status === 409) return res.writeHead(409).end(JSON.stringify({ error: "Analyzer is already running a pass" }));
            const txt = await r.text().catch(() => "");
            return res.writeHead(502).end(JSON.stringify({ error: `Analyzer responded ${r.status}`, detail: txt.slice(0, 200) }));
          } catch (e) {
            return res.writeHead(502).end(JSON.stringify({ error: `Could not reach analyzer: ${(e as Error).message}` }));
          }
        }
        if (path === "/add-repo") {
          // Add a repo to the watch list + invite the bot + register the webhook — live, no redeploy.
          // Require a full owner/name so malformed entries (just an owner) can't be added.
          const full = repo.trim();
          if (!/^[\w.-]+\/[\w.-]+$/.test(full)) return res.writeHead(400).end(JSON.stringify({ error: "Use owner/name, e.g. acme/app" }));
          addWatchedRepo(full);
          ensureRepoIndex(full); // warm the code-graph cache now, so the first run isn't slowed by it
          let note = "";
          try {
            note = await ensureRepoAccess(cfg, full);
          } catch {
            /* best effort */
          }
          void trigger("dashboard-add-repo");
          return ok(JSON.stringify({ ok: true, note }));
        }
        if (path === "/remove-repo") {
          if (!repo) return res.writeHead(400).end("{}");
          removeWatchedRepo(repo.trim());
          return ok();
        }
        if (path === "/upload-image" || path === "/upload-file") {
          // Store a pasted/picked file (image, pdf, csv…) LOCALLY in the DB and return markdown that
          // points at /attach/<id>. No GitHub token needed — attachments are local-first.
          if (!repo || !p.dataUrl) return res.writeHead(400).end("{}");
          const m = /^data:([\w.+-]+\/[\w.+-]+)?;base64,(.+)$/.exec(p.dataUrl);
          if (!m) return res.writeHead(400).end(JSON.stringify({ error: "not a base64 data URL" }));
          const mime = m[1] || "application/octet-stream";
          const isImage = mime.startsWith("image/");
          const safe = (p.name ?? "").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-64);
          const extFromMime = mime.split("/")[1]?.replace("jpeg", "jpg").replace(/[^\w]/g, "") || "bin";
          const fname = safe && /\.[\w]+$/.test(safe) ? safe : `${safe || "file"}.${extFromMime}`;
          // LOCAL-FIRST: store the bytes in the DB and serve them from /attach/<id>. Do NOT commit
          // attachments to the GitHub repo (slow, pollutes history, and concurrent commits collided
          // so only one image survived). GitHub only ever gets the reference in the body text.
          const bytes = Buffer.from(m[2], "base64");
          const id = putAttachment(repo, typeof p.number === "number" ? p.number : 0, fname, mime, bytes);
          const localUrl = `/attach/${id}`;
          const label = p.name || fname;
          const md = isImage ? `![${label}](${localUrl})` : `[📎 ${label}](${localUrl})`;
          return ok(JSON.stringify({ url: localUrl, md, isImage }));
        }
        if (path === "/orch-chat") {
          // One turn of the repo Orchestrator chat. DB-first: the thread lives in orch_msg.
          const text = (p.body ?? "").trim();
          if (!repo) return res.writeHead(400).end(JSON.stringify({ error: "repo required" }));
          if (!text) return res.writeHead(400).end(JSON.stringify({ error: "empty message" }));
          try {
            const r = await runOrchestratorChat(repo, text);
            return ok(JSON.stringify({ ok: true, reply: r.reply, proposal: r.proposal, thread: listOrchThread(repo, 200) }));
          } catch (err) {
            return res.writeHead(500).end(JSON.stringify({ error: `Orchestrator failed — ${(err as Error).message}` }));
          }
        }
        if (path === "/orch-clear") {
          if (!repo) return res.writeHead(400).end("{}");
          clearOrchThread(repo);
          return ok();
        }
        if (path === "/orch-handoff") {
          // Confirmed handoff: create the proposed issues as PLANNED + by-agent (user approves each
          // and presses Start). DB-first markers; GitHub is only the mirror.
          if (!repo) return res.writeHead(400).end(JSON.stringify({ error: "repo required" }));
          if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res.writeHead(400).end(JSON.stringify({ error: `Bad repo "${repo}"` }));
          const ph = p as { workflow?: string; issues?: Array<{ title?: string; scope?: string }> };
          const wf = (ph.workflow ?? "full-build");
          const HANDLE: Record<string, string> = { "quick-fix": "@quickfix", "full-build": "@build", "plan-only": "@planonly", "split": "@split" };
          const handle = HANDLE[wf] ?? "@build";
          const issues = Array.isArray(ph.issues) ? ph.issues : [];
          if (!issues.length) return res.writeHead(400).end(JSON.stringify({ error: "no issues to create" }));
          const userTok = ghUserToken();
          if (!userTok) return res.writeHead(409).end(JSON.stringify({ error: "Add your GitHub token in Settings → credentials so the agency can create issues." }));
          const created: Array<{ number: number; title: string; url: string }> = [];
          try {
            for (let n = 0; n < issues.length; n++) {
              const it = issues[n];
              const title = (it.title ?? "").trim();
              if (!title) continue;
              const pos = issues.length > 1 ? `\n\n— Part ${n + 1} of ${issues.length}.` : "";
              const body = `${handle} ${(it.scope ?? "").trim()}${pos}\n\nProposed by the 🧭 Orchestrator from a chat. Review and press ▶ Start when ready.`;
              const c = await createIssue(repo, title, body, userTok);
              if (!c.number) continue;
              recordIssueStatus(repo, c.number, withStatus("planned"), { title });
              setByAgent(repo, c.number, true);
              created.push({ number: c.number, title, url: c.url });
            }
            return ok(JSON.stringify({ ok: true, created }));
          } catch (err) {
            return res.writeHead(500).end(JSON.stringify({ error: `Couldn't create issues — ${(err as Error).message}` }));
          }
        }
        if (path === "/new-issue") {
          // Create a new issue (authored by you). start=true → begin immediately; otherwise it
          // lands in the Planned column with a play button and does NOT auto-start.
          if (!repo || !p.title?.trim()) return res.writeHead(400).end("{}");
          if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res.writeHead(400).end(JSON.stringify({ error: `Bad repo "${repo}" — expected owner/name` }));
          // Authored as YOU — needs your own GitHub token (not the bot's).
          const userTok = ghUserToken();
          if (!userTok) return res.writeHead(409).end(JSON.stringify({ error: "Add your GitHub token in Settings → credentials to create issues under your name." }));
          const handle = (p.role ?? "@dev").trim();
          // 🎲 Dealer's choice: no concrete handle prepended — the dispatcher rolls the route on start
          // (see runner). A real handle is prepended so text resolution + the GitHub mirror agree.
          const dealer = handle.toLowerCase() === "@auto";
          const issueBody = (dealer ? (p.body ?? "") : `${handle} ${p.body ?? ""}`).trim();
          try {
            const created = await createIssue(repo, p.title.trim(), issueBody, userTok);
            if (!created.number) throw new Error("couldn't read the new issue number");
            if (p.model && typeof p.model === "object" && p.model.providerId && p.model.model) {
              setIssueModelOverride(repo, created.number, p.model.providerId, p.model.model);
            }
            // Per-step model overrides chosen in the composer (workflow runs): persist each so the
            // pipeline routes that step's agent to the selected model (resolveAssignment, priority 1).
            if (p.agentModels && typeof p.agentModels === "object") {
              for (const [agent, ref] of Object.entries(p.agentModels as Record<string, string>)) {
                if (agent && typeof ref === "string") setIssueAgentModel(repo, created.number, agent, ref);
              }
            }
            // Persist the dropdown selection STRUCTURALLY so it's authoritative on instant-start,
            // planned-start, AND resume — not re-derived from body text (which a later comment can
            // shadow, silently falling back to the default full build). If the chosen handle is a
            // workflow trigger, pin that workflow; a single agent/role keeps resolving from the
            // prepended handle (and processIssue persists its role on first run). Dealer's choice
            // pins nothing — it flags the issue so the dispatcher picks the route on start.
            if (dealer) setSetting(`issue_dealer.${repo}#${created.number}`, "1");
            const selWf = dealer ? null : resolveWorkflow(handle);
            if (selWf) setIssueWorkflow(repo, created.number, selWf.id);
            if (p.start) {
              recordIssueStatus(repo, created.number, withStatus("working"), { title: p.title.trim() });
              // Dashboard-first INSTANT start: dispatch from the title/body we already have — no GitHub
              // read, no scan. (GitHub gets the comments/PR reported in the background.)
              if (startNew) void startNew(repo, created.number, p.title.trim(), issueBody).catch(() => {});
              else if (start) void start(repo, created.number).catch(() => {});
            } else {
              recordIssueStatus(repo, created.number, withStatus("planned"), { title: p.title.trim() });
            }
            return ok(JSON.stringify({ ok: true, number: created.number, url: created.url }));
          } catch (err) {
            return res.writeHead(500).end(JSON.stringify({ error: `Couldn't create the issue — does your GitHub token have Issues: Read & write on ${repo}? (${(err as Error).message})` }));
          }
        }
        if (path === "/start") {
          // Play button: start a Planned issue now.
          if (!repo || !number || !start) return res.writeHead(400).end("{}");
          if (p.hasOwnProperty("model")) {
            if (p.model && typeof p.model === "object" && p.model.providerId && p.model.model) {
              setIssueModelOverride(repo, number, p.model.providerId, p.model.model);
            } else {
              clearIssueModelOverride(repo, number);
            }
          }
          await start(repo, number).catch(() => {});
          return ok();
        }
        // /run-checks -> run the tester on the issue's branch now (no merge).
        if (!repo || !number) return res.writeHead(400).end("{}");
        dispatch(`${repo}#checks-${number}`, () => runChecksNow(repo, number, p.title ?? ""));
        return ok();
      });
      return;
    }

    void readBody(req).then((body) => {
      if (!verifySignature(webhookSecret(), body, req.headers["x-hub-signature-256"] as string)) {
        console.warn("[agency] rejected webhook: bad signature");
        res.writeHead(401).end("bad signature");
        return;
      }
      const event = req.headers["x-github-event"] as string;
      let payload: {
        action?: string;
        pull_request?: { merged?: boolean; head?: { ref?: string } };
        repository?: { full_name?: string };
        issue?: { number?: number; title?: string; body?: string };
        comment?: { id?: number; body?: string; created_at?: string; user?: { login?: string } };
        sender?: { type?: string };
      } = {};
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        /* ignore */
      }
      const action = payload.action ?? "";
      // Respond immediately; process in the background.
      res.writeHead(202).end("accepted");

      // Inbound sync (Phase 4): when DB-authoritative tracking is on, fold GitHub activity into the
      // DB in real time so the dashboard's local source of truth stays current. No-op in github mode.
      const syncRepo = payload.repository?.full_name ?? "";
      if (syncRepo) {
        try {
          // Comments always fold into the DB conversation cache (dashboard = source of truth), so a
          // comment made directly on GitHub shows up in the dashboard in real time.
          if (event === "issue_comment" && action === "created" && payload.issue?.number && payload.comment?.id) {
            const isAgency = (payload.comment.body ?? "").includes("<!-- dev-agency -->");
            syncInComment(syncRepo, payload.issue.number, payload.comment.id, payload.comment.user?.login ?? "user", payload.comment.body ?? "", isAgency, payload.comment.created_at ?? "");
          } else if (trackerMode() === "local" && event === "issues" && payload.issue?.number) {
            // Issue body only adopts into the DB when DB-authoritative tracking is enabled.
            syncInIssue(syncRepo, payload.issue.number, payload.issue.title ?? "", payload.issue.body ?? "");
          }
        } catch { /* best effort */ }
      }

      if (event === "ping") {
        console.log("[agency] webhook ping ok");
      } else if (event === "issues" && RELEVANT_ACTIONS.has(action)) {
        void trigger(`issues.${action}`);
      } else if (event === "issue_comment" && action === "created") {
        // A new comment may be an answer/approval to resume a paused issue. (The agency's own
        // comments are ignored downstream — they don't count as a human reply.)
        void trigger("issue_comment");
      } else if ((event === "check_suite" || event === "workflow_run") && action === "completed") {
        // CI finished — react instantly to fix failures.
        void trigger(`${event}.completed`);
      } else if (event === "pull_request" && action === "closed") {
        // Merged on GitHub directly -> move the linked issue to "merged" right away.
        const ref = payload.pull_request?.head?.ref ?? "";
        const full = payload.repository?.full_name ?? "";
        const m = /^agency\/issue-(\d+)$/.exec(ref);
        if (payload.pull_request?.merged && full && m) {
          recordIssueStatus(full, Number(m[1]), withStatus("done"));
          console.log(`[agency] ${full} #${m[1]} -> merged (PR closed)`);
        }
        void trigger("pull_request.closed");
      } else if (event === "pull_request" && PR_ACTIONS.has(action)) {
        void trigger(`pull_request.${action}`);
      } else if (event === "push") {
        // Base-branch (or any) push can create/clear merge conflicts.
        void trigger("push");
        // Keep the code-graph cache warm OUTSIDE agent runs: a push changed the code, so refresh the
        // index now (in the background) — future runs just restore it instead of indexing inline.
        if (syncRepo) ensureRepoIndex(syncRepo);
      }
    });
  });

  server.listen(port, () => {
    console.log(`[agency] mode: webhook, listening on :${port} (POST /webhook)`);
  });

  // Webhook + collaborator registration happens in main() via ensureAllRepoAccess before
  // this server starts. Here we just serve and process.

  // Drain anything already queued at startup, then keep a slow safety poll.
  await trigger("startup");
  setInterval(() => void trigger("safety-poll"), safetyPollMs);
}
