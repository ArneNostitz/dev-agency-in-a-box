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
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import { recentRuns, recentIssues, recentActivity, archiveIssue, spendSince, recordIssueState, recordPr, tokensSince, tokensByModelSince, epicsByParent, getSetting, setSetting, setAgentOverride, deleteAgentOverride, listAgentRevisions, getAgentRevision, addWatchedRepo, getProviders, setProviders, getRoleModels, setRoleModels, getReview, recordReview, listReviews, getAutoRaw, setAuto, autoEnabled, type AutoKind, type Provider } from "./store.js";
import { mergeEpic, isEpic } from "./epics.js";
import { renderDashboard, renderHistory } from "./dashboard.js";
import { renderShell } from "./shell.js";
import { addLabel, removeLabel } from "./github.js";
import { subscribe, getActive } from "./activity.js";
import { inFlightKeys } from "./pool.js";
import { listRateLimited } from "./store.js";
import { effectiveRepos } from "./commands.js";
import { getThreadFull, commentAsHuman, mergePrForBranch, closeIssue, deleteIssueHard, findPrForBranch, prMergeStatus, detectReviewVerdict, createIssue, readRepoFile, putRepoBase64, listUserRepos } from "./github.js";
import { listAgentFiles, readAgentFile, isSafeAgentPath } from "./memory.js";
import { startApp, stopApp, getApp, pickWebDevScript, isTauriPackage, buildLocalCommand } from "./apprun.js";
import { ensureRepoAccess } from "./commands.js";
import { previewUrlFor, runChecksNow } from "./preview.js";
import { dispatch } from "./pool.js";

type ProcessAll = (cfg: Config) => Promise<number>;
type Resume = (repo: string, number: number) => Promise<void>;

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

/** Gate the dashboard with HTTP Basic Auth if DASHBOARD_PASSWORD is set. */
function checkAuth(cfg: Config, req: IncomingMessage, res: ServerResponse): boolean {
  if (!cfg.dashboardPassword) return true;
  const m = /^Basic (.+)$/.exec((req.headers["authorization"] as string) ?? "");
  if (m) {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    const a = Buffer.from(pass);
    const b = Buffer.from(cfg.dashboardPassword);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  res.writeHead(401, { "www-authenticate": 'Basic realm="dev-agency"' });
  res.end("Authentication required.");
  return false;
}

function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!secret) return true; // no secret configured -> skip verification (not recommended)
  if (!header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// "unlabeled" lets you retrigger an issue instantly: remove its agency:* label and it
// becomes actionable again (the @handle in the body re-pins it) — no need to rewrite anything.
const RELEVANT_ACTIONS = new Set(["opened", "reopened", "labeled", "unlabeled", "edited"]);
const PR_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review", "edited"]);

// Static assets (PWA shell extras) live in web/ at the repo root; from the compiled dist/ that's ../web.
const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));
const MIME: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".html": "text/html; charset=utf-8" };
/** Serve a static file from web/ for the PWA (no auth — these carry no secrets). Returns true if handled. */
function serveStatic(pathname: string, res: ServerResponse): boolean {
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
  const cache = pathname === "/sw.js" || pathname === "/web/app.js" ? "no-cache" : "public, max-age=3600";
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": cache });
  res.end(readFileSync(file));
  return true;
}

export async function runWebhook(cfg: Config, processAll: ProcessAll, resume?: Resume, approve?: Resume, fix?: Resume, start?: Resume): Promise<void> {
  const port = Number(process.env.PORT?.trim() || "3000");
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim() || "";
  // Catches 👍 reactions (GitHub doesn't webhook those) and anything a delivery missed.
  const safetyPollMs = Math.max(30, cfg.pollIntervalSeconds) * 1000;

  // Serialize processing: a single chain, with a "pending" flag to coalesce bursts.
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
      if (!checkAuth(cfg, req, res)) return;

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

      if (url === "/data") {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        void (async () => {
          const issues = recentIssues(60);
          // Backfill PR links for delivered issues opened before PR linkage existed (one-time:
          // we persist what we find, so later polls read it straight from the DB).
          for (const i of issues) {
            if (!i.pr_number && i.state === "agency:ready") {
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
          const reviews = listReviews(); // verdict per "repo#number" — cheap, for the card badge
          const enriched = issues.map((i) => {
            const byParent = (epicCache[i.repo] ??= epicsByParent(i.repo));
            const kids = byParent[i.number];
            return {
              ...i,
              previewUrl: i.pr_number ? previewUrlFor(i.repo, i.pr_number, `agency/issue-${i.number}`) : null,
              epic: kids
                ? { total: kids.length, done: kids.filter((c) => c.closed).length, children: kids }
                : null,
              app: getApp(i.repo, i.number),
              review: reviews[`${i.repo}#${i.number}`] ?? null,
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
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              repos: effectiveRepos(cfg),
              auto: { resume: getAutoRaw("resume"), merge: getAutoRaw("merge") },
              autoRepos: Object.fromEntries(
                effectiveRepos(cfg).map((r) => [r, { resume: getAutoRaw("resume", r), merge: getAutoRaw("merge", r) }]),
              ),
              active: getActive(),
              inflight: inFlightKeys(),
              rateLimited: listRateLimited(),
              issues: enriched,
              runs: recentRuns(40),
              activity: recentActivity(400),
              spendToday: spendSince(midnight.toISOString()),
              session: {
                tokens: sess.tokens,
                costUsd: sess.costUsd,
                budget,
                windowHours: winH,
                windowStart: win.startIso,
                resetsAt: win.resetsIso,
                anchored: Boolean(Date.parse(getSetting("window_anchor") ?? "")),
                byModel: tokensByModelSince(win.startIso),
              },
              config: {
                skipArchitect: (getSetting("skip_architect") ?? "") || (process.env.SKIP_ARCHITECT?.trim().toLowerCase() === "false" ? "off" : "on"),
                gitnexus: (getSetting("gitnexus") ?? "") || (process.env.GITNEXUS?.trim().toLowerCase() === "true" ? "on" : "off"),
                maxTokensPerRun: Number(getSetting("max_tokens_per_run")) || Number(process.env.MAX_TOKENS_PER_RUN?.trim()) || 600000,
                maxReviseRounds: getSetting("max_revise_rounds") !== null ? Number(getSetting("max_revise_rounds")) : (Number(process.env.MAX_REVISE_ROUNDS?.trim()) || 1),
              },
            }),
          );
        })();
        return;
      }

      // Models panel: providers, per-role assignments, and quick presets.
      if (url === "/models") {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            providers: getProviders(),
            roleModels: getRoleModels(),
            roles: ["planner", "architect", "developer", "reviewer", "tester", "librarian"],
            // Editable presets — all expose a native Anthropic-compatible endpoint.
            presets: [
              { name: "GLM (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/anthropic", models: ["glm-4.6", "glm-4.5"] },
              { name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", models: ["deepseek-chat", "deepseek-reasoner"] },
              { name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/anthropic", models: ["kimi-k2-0905-preview"] },
              { name: "Custom (Anthropic-compatible)", baseUrl: "", models: [] },
            ],
          }),
        );
        return;
      }

      // Repo picker: all repos your token can access, minus the ones already watched.
      if (url === "/repos-available") {
        const token = cfg.adminToken ?? cfg.githubToken;
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
          const merge = repo && number ? await prMergeStatus(repo, `agency/issue-${number}`).catch(() => null) : null;
          res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ review, merge }));
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

      // Side-panel: the full GitHub conversation for one issue/PR.
      if (url === "/thread") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const repo = q.get("repo") ?? "";
        const number = Number(q.get("number"));
        if (!repo || !number) {
          res.writeHead(400).end("{}");
          return;
        }
        void getThreadFull(repo, number)
          .then((t) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(t)))
          .catch(() => res.writeHead(200, { "content-type": "application/json" }).end("{}"));
        return;
      }

      // Live status dashboard (client fetches /data + /events). No-store so a redeploy's new
      // UI shows up immediately instead of the browser serving a stale cached page.
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
      });
      // New Preact UI at /; old dashboard kept at /classic as a fallback; /history unchanged.
      res.end(url === "/history" ? renderHistory() : url === "/classic" ? renderDashboard() : renderShell());
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    // Dashboard actions (password-protected, not GitHub webhooks).
    const path = (req.url ?? "").split("?")[0];
    if (["/archive", "/comment", "/run-checks", "/merge", "/delete", "/resume", "/fix", "/auto", "/start", "/new-issue", "/approve", "/settings", "/agent-save", "/agent-revert", "/app-run", "/app-stop", "/upload-image", "/upload-file", "/add-repo", "/models"].includes(path)) {
      if (!checkAuth(cfg, req, res)) return;
      void readBody(req).then(async (body) => {
        let p: { repo?: string; number?: number; body?: string; title?: string; role?: string; path?: string; content?: string; windowHours?: number; budget?: number; anchorNow?: boolean; anchor?: string; dataUrl?: string; name?: string; providers?: Provider[]; roleModels?: Record<string, { providerId: string; model: string }>; kind?: string; value?: string; skipArchitect?: string; gitnexus?: string; maxTokensPerRun?: number; maxReviseRounds?: number; start?: boolean } = {};
        try {
          p = JSON.parse(body.toString("utf8"));
        } catch {
          /* ignore */
        }
        const repo = p.repo ?? "";
        const number = Number(p.number);
        const ok = (payload = '{"ok":true}') =>
          res.writeHead(200, { "content-type": "application/json" }).end(payload);

        if (path === "/archive") {
          if (repo && number) archiveIssue(repo, number);
          return ok();
        }
        if (path === "/comment") {
          // Inline reply -> posts to GitHub as the human (no agency marker) so it re-engages.
          if (!repo || !number || !p.body?.trim()) return res.writeHead(400).end("{}");
          try {
            // Post under the owner's account (admin token) so it shows your name, not the bot's.
            await commentAsHuman(repo, number, p.body.trim(), cfg.adminToken);
            void trigger("dashboard-comment");
            return ok();
          } catch (err) {
            return res.writeHead(500).end(JSON.stringify({ error: (err as Error).message }));
          }
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
          // Pipeline knobs moved out of env — apply live, no redeploy.
          if (p.skipArchitect === "on" || p.skipArchitect === "off") setSetting("skip_architect", p.skipArchitect);
          if (p.gitnexus === "on" || p.gitnexus === "off") setSetting("gitnexus", p.gitnexus);
          if (p.maxTokensPerRun !== undefined && p.maxTokensPerRun >= 0) setSetting("max_tokens_per_run", String(Math.round(p.maxTokensPerRun)));
          if (p.maxReviseRounds !== undefined && p.maxReviseRounds >= 0) setSetting("max_revise_rounds", String(Math.round(p.maxReviseRounds)));
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
            await closeIssue(repo, number, `🚀 Merged ${r.msg} from the dashboard.`).catch(() => {});
            recordIssueState(repo, number, { state: "merged" });
            return ok();
          }
          return res.writeHead(409).end(JSON.stringify({ error: r.msg }));
        }
        if (path === "/delete") {
          // Try a real delete (owner-only); otherwise close + hide from the board.
          if (!repo || !number) return res.writeHead(400).end("{}");
          const r = await deleteIssueHard(repo, number, cfg.adminToken);
          if (!r.ok) await closeIssue(repo, number).catch(() => {});
          archiveIssue(repo, number);
          return ok(JSON.stringify({ ok: true, deleted: r.ok }));
        }
        if (path === "/resume") {
          // Unstick an issue and re-run it, whatever state it's in.
          if (!repo || !number || !resume) return res.writeHead(400).end("{}");
          await resume(repo, number).catch(() => {});
          return ok();
        }
        if (path === "/fix") {
          // Address the PR's outstanding review (and resolve conflicts) on its branch.
          if (!repo || !number || !fix) return res.writeHead(400).end("{}");
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
        if (path === "/models") {
          // Save providers + per-role model assignments (live, next run uses them).
          if (Array.isArray(p.providers)) setProviders(p.providers);
          if (p.roleModels && typeof p.roleModels === "object") setRoleModels(p.roleModels);
          return ok();
        }
        if (path === "/add-repo") {
          // Add a repo to the watch list + invite the bot + register the webhook — live, no redeploy.
          if (!repo) return res.writeHead(400).end("{}");
          addWatchedRepo(repo);
          let note = "";
          try {
            note = await ensureRepoAccess(cfg, repo);
          } catch {
            /* best effort */
          }
          void trigger("dashboard-add-repo");
          return ok(JSON.stringify({ ok: true, note }));
        }
        if (path === "/upload-image" || path === "/upload-file") {
          // Commit a pasted/picked file (image, pdf, csv, xlsx, json…) to the repo and return
          // markdown to embed: images inline, everything else as a download link.
          if (!repo || !p.dataUrl) return res.writeHead(400).end("{}");
          if (!cfg.adminToken) return res.writeHead(409).end(JSON.stringify({ error: "needs ADMIN_GITHUB_TOKEN" }));
          const m = /^data:([\w.+-]+\/[\w.+-]+)?;base64,(.+)$/.exec(p.dataUrl);
          if (!m) return res.writeHead(400).end(JSON.stringify({ error: "not a base64 data URL" }));
          const mime = m[1] || "application/octet-stream";
          const isImage = mime.startsWith("image/");
          const safe = (p.name ?? "").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-64);
          const extFromMime = mime.split("/")[1]?.replace("jpeg", "jpg").replace(/[^\w]/g, "") || "bin";
          const fname = safe && /\.[\w]+$/.test(safe) ? safe : `${safe || "file"}.${extFromMime}`;
          const file = `.devagency/attachments/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${fname}`;
          const r = await putRepoBase64(repo, file, m[2], `dev-agency: dashboard attachment ${fname}`, cfg.adminToken);
          if (!r.ok || !r.url) return res.writeHead(500).end(JSON.stringify({ error: r.msg }));
          const label = p.name || fname;
          const md = isImage ? `![${label}](${r.url})` : `[📎 ${label}](${r.url})`;
          return ok(JSON.stringify({ url: r.url, md, isImage }));
        }
        if (path === "/new-issue") {
          // Create a new issue (authored by you). start=true → begin immediately; otherwise it
          // lands in the Planned column with a play button and does NOT auto-start.
          if (!repo || !p.title?.trim()) return res.writeHead(400).end("{}");
          const handle = (p.role ?? "@dev").trim();
          const issueBody = `${handle} ${p.body ?? ""}`.trim();
          try {
            const created = await createIssue(repo, p.title.trim(), issueBody, cfg.adminToken);
            if (p.start) {
              recordIssueState(repo, created.number, { title: p.title.trim(), state: "agency:in-progress" });
              void trigger("dashboard-new-issue");
            } else {
              await addLabel(repo, created.number, "agency:planned").catch(() => {});
              recordIssueState(repo, created.number, { title: p.title.trim(), state: "planned" });
            }
            return ok(JSON.stringify({ ok: true, number: created.number, url: created.url }));
          } catch (err) {
            return res.writeHead(500).end(JSON.stringify({ error: (err as Error).message }));
          }
        }
        if (path === "/start") {
          // Play button: start a Planned issue now.
          if (!repo || !number || !start) return res.writeHead(400).end("{}");
          await removeLabel(repo, number, "agency:planned").catch(() => {});
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
      if (!verifySignature(secret, body, req.headers["x-hub-signature-256"] as string)) {
        console.warn("[agency] rejected webhook: bad signature");
        res.writeHead(401).end("bad signature");
        return;
      }
      const event = req.headers["x-github-event"] as string;
      let payload: {
        action?: string;
        pull_request?: { merged?: boolean; head?: { ref?: string } };
        repository?: { full_name?: string };
      } = {};
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        /* ignore */
      }
      const action = payload.action ?? "";
      // Respond immediately; process in the background.
      res.writeHead(202).end("accepted");

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
          recordIssueState(full, Number(m[1]), { state: "merged" });
          console.log(`[agency] ${full} #${m[1]} -> merged (PR closed)`);
        }
        void trigger("pull_request.closed");
      } else if (event === "pull_request" && PR_ACTIONS.has(action)) {
        void trigger(`pull_request.${action}`);
      } else if (event === "push") {
        // Base-branch (or any) push can create/clear merge conflicts.
        void trigger("push");
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
