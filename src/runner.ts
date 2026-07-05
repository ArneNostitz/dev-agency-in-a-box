/**
 * Runner: scans GitHub for work and dispatches it to a bounded pool of workers, so several
 * issues/PRs can be handled at once (AGENCY_CONCURRENCY, default 3). Each unit (issue or PR)
 * is keyed so it's never worked twice concurrently.
 *
 *   once    - scan, run everything to completion, exit
 *   watch   - scan on a timer
 *   webhook - scan on GitHub events (instant) + a slow safety poll
 */
import { rm, mkdir, unlink } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type Config } from "./config.js";
import {
  commentOnIssue,
  cloneRepo,
  commentThread,
  listAgencyPrs,
  listAllOpenIssues,
  listComments,
  AGENCY_MARKER,
  listRecentThreads,
  threadSignals,
  getIssue as getIssueFromGitHub,
  isNoOpComment,
  findPrForBranch,
  ensureDraftPr,
  createIssue,
  commentOnPr,
  prHealth,
  prMergeStatus,
  fetchCheckout,
  mergeBaseInto,
  repoBaseBranch,
  mergePrForBranch,
  prMerged,
  closeIssue,
  canTrigger,
  type Issue,
} from "./github.js";
import { seedAdmin, resetAdminPassword } from "./auth.js";
import { sNum } from "./settings.js";
import { githubReady, ghUserToken, ghBotToken } from "./creds.js";
import { decideThreadAction } from "./route.js";
import { reconcileEpics, onChildMerged } from "./epics.js";
import { indexRepo } from "./gitnexus.js";
import { pushActivity } from "./activity.js";
import { roleForHandle, ALL_ROLES, type RoleName } from "./agents/roles.js";
import { resolveWorkflow, workflowLeadRole } from "./workflow.js";
import { getWorkflow, getDefaultWorkflowId } from "./db/workflows.js";
import { getIssueWorkflow, setIssueWorkflow } from "./db/providers.js";
import { pickDealerDispatch } from "./agents/dealer.js";
import { runPipeline, runWorkflowEngine, runDeveloperSolo, runPrFix, runFollowUp, runResumeBuild, runReviewFix } from "./pipeline.js";
import { runRole } from "./agents/roleAgent.js";
import { runChatAgent } from "./agents/chat.js";
import { parseAuditProposals } from "./auditparse.js";
import {
  recordIssueState,
  recordIssueStatus,
  getIssueStatus,
  recordPr,
  getIssueRole,
  getAutofixCount,
  incAutofix,
  resetAutofix,
  issueSpend,
  getThreadCursor,
  setThreadCursor,
  recentIssues,
  lastPlan,
  getSetting,
  setSetting,
  setRateLimited,
  clearRateLimited,
  dueRateLimited,
  getReview,
  clearReview,
  autoEnabled,
  autoAttempts,
  bumpAutoAttempts,
  resetAutoAttempts,
  setAuto,
  getFallbackChain,
  getAutoSwitchOnLimit,
  setSessionFallback,
  clearSessionFallback,
  listAgentDefs,
  seedChatAgents,
  seedWorkflows,
  seedLibrary,
  clearIssueModelOverride,
  filesFor,
  recordIncident,
  getLocalIssue,
} from "./store.js";

/**
 * Local-first issue lookup (ADR-0001): the DB copy (local_issue, or the head snapshot the dashboard
 * saved) answers instantly; GitHub is only consulted when the issue was never imported. This is what
 * removed the ~1-minute "GitHub round-trip" lag from the Approve/Resume/Fix buttons.
 */
async function getIssue(repo: string, number: number): Promise<Issue | null> {
  const li = getLocalIssue(repo, number);
  if (li && (li.title || li.body)) return { number, title: li.title, body: li.body };
  try {
    const head = JSON.parse(getSetting(`head:${repo}#${number}`) || "null") as { title?: string; body?: string } | null;
    if (head?.title) return { number, title: head.title, body: head.body ?? "" };
  } catch { /* fall through */ }
  return getIssueFromGitHub(repo, number);
}
import { claimFiles, releaseFiles, claimBarrier } from "./locks.js";
import { afterMerge } from "./merge_hooks.js";
import { isStructural, structuralFlagKey } from "./coordination.js";
import { parseRateLimit, nextWindowReset, RateLimitedError } from "./ratelimit.js";
import { isProviderRateLimited, clearProviderRateLimited } from "./db/ratelimit.js";
import { startPreviewSweeper, killAllApps } from "./apprun.js";
import { setActive, clearActive, getActive } from "./activity.js";
import { stopRuns, requestStop, clearStop, isStopRequested, requestHold, clearHold, queueSteer } from "./abort.js";
import { flushOldAttachments } from "./db/attachments.js";
import { pruneEphemeral } from "./db/connection.js";
import { dispatch, drain, stop as stopPool, poolStatus, inFlightKeys } from "./pool.js";
import { loadBudget, overBudget, effectiveLimits } from "./budget.js";
import { maybeSelfImprove } from "./reflect.js";
import { parseLegacyStatus, withStatus, setBlocked, isWaitingOnHuman } from "./state.js";
import {
  handleControlCommands,
  handleMergeCommands,
  effectiveRepos,
  ensureAllRepoAccess,
  recoverOrphans,
} from "./commands.js";

const MAX_AUTOFIX = 2;

// ---- usage-limit handling (pure script — works with zero tokens) ----
// Rate limits are now PER-PROVIDER (set in roleAgent where the provider is known, stored in the
// rate_limited table with a provider_id). There is no global pause anymore — a Claude 429 never
// blocks a GLM run. These helpers are kept as no-ops for backward-compat with any remaining callers.

/** @deprecated No global pause — rate limits are per-provider. Always returns false. */
function pausedUntil(): number {
  return 0;
}
/** @deprecated No global pause — rate limits are per-provider. No-op. */
function agentsArePaused(): boolean {
  return false;
}
/**
 * Pause new dispatch until untilMs. A `parsed` reset (read straight from Claude's "resets …" error)
 * is AUTHORITATIVE — set it exactly, even if it's EARLIER than a previously-set time (so a stale
 * fallback guess can't make us over-wait). A fallback/guessed time only ever EXTENDS the pause.
 */
function pauseAgents(untilMs: number, parsed = false): void {
  const next = parsed ? untilMs : Math.max(pausedUntil(), untilMs);
  setSetting("agents_paused_until", new Date(next).toISOString());
}
/** Next usage-window reset, honoring a manually-set/just-set anchor. */
function nextResetMs(): number {
  const hours = Number(getSetting("window_hours")) || Number(process.env.SESSION_WINDOW_HOURS?.trim()) || 5;
  return nextWindowReset(Date.now(), hours, getSetting("window_anchor"));
}

/**
 * Handle a rate-limit wall for a SPECIFIC provider. Returns:
 *   false    — not a rate limit / no RateLimitedError (caller handles as normal error)
 *   true     — parked for auto-resume (caller returns early)
 *   "switch" — switched to the next-best available provider in the fallback chain (caller retries)
 *
 * The rate limit is scoped to the provider that hit the wall (its piKey/id) — a Claude 429 never
 * blocks a GLM run. When a fallback chain is configured, we walk it best→worst, skip providers that
 * are themselves rate-limited, and switch+continue on the first available. Only when NO fallback is
 * available do we park the issue (auto-resume after THIS provider's reset).
 */
async function maybeParkRateLimited(repo: string, number: number, err: unknown, isPr = false): Promise<boolean | "switch"> {
  // Only react to a typed RateLimitedError (the string-parse version is gone — detection now happens
  // in roleAgent where the provider is known).
  const rlError = err instanceof RateLimitedError ? err : null;
  if (!rlError) {
    // Legacy: some callers may still pass a raw error whose message looks like a limit. Detect that
    // too, but we have no provider context → treat as a generic (empty-provider) limit.
    const msg = (err as Error)?.message ?? String(err);
    const rl = parseRateLimit(msg);
    if (!rl.limited) return false;
    const resetAt = rl.resetAt && rl.resetAt > Date.now() ? rl.resetAt : nextResetMs();
    setRateLimited(repo, number, "", new Date(resetAt).toISOString());
    recordIssueStatus(repo, number, setBlocked(withStatus("working"), "rateLimited"));
    const when = new Date(resetAt).toLocaleString();
    await commentOnIssue(repo, number, `⏳ Rate-limited — I'll **auto-resume** after the window resets (~${when}).`).catch(() => {});
    return true;
  }

  const { providerId, resetAt } = rlError;
  const when = new Date(resetAt).toLocaleString();

  // Walk the fallback chain best→worst for the next available (non-rate-limited) provider.
  const chain = getFallbackChain();
  const next = chain.find((entry) => entry.providerId !== providerId && !isProviderRateLimited(entry.providerId));
  if (next) {
    // Switch all unassigned roles to this provider/model for the retry (session-only).
    setSessionFallback(next);
    await commentOnIssue(
      repo,
      number,
      `🔄 Provider rate-limited — switched to **${next.model}** and continuing. (Will return to the preferred model after ~${when}.)`,
    ).catch(() => {});
    console.log(`[agency] rate-limited ${repo} #${number} (provider ${providerId}): switched to ${next.model}`);
    return "switch";
  }

  // No fallback available → park this issue for THIS provider's auto-resume.
  setRateLimited(repo, number, providerId, new Date(resetAt).toISOString());
  recordIssueStatus(repo, number, setBlocked(withStatus("working"), "rateLimited"));
  if (isPr) {
    await commentOnPr(repo, number, `⏳ Rate-limited — I'll retry automatically after the window resets (~${when}).`).catch(() => {});
  } else {
    await commentOnIssue(repo, number, `⏳ Rate-limited — I'll **auto-resume** after the window resets (~${when}) — no action needed.`).catch(() => {});
  }
  console.log(`[agency] rate-limited ${repo} #${number} (provider ${providerId}); auto-resume after ${new Date(resetAt).toISOString()}`);
  return true;
}
/** Don't re-engage closed threads older than this (keeps the scan cheap). DB-first → env → 21. */
const followupWindowDays = (): number => sNum("followup_window_days", "FOLLOWUP_WINDOW_DAYS", 21);
/** An in-progress issue with no live run, idle this long, is treated as an orphan. */
let lastAttachmentFlush = 0;
const ORPHAN_GRACE_MS = (Number(process.env.ORPHAN_GRACE_MIN?.trim()) || 12) * 60_000;
const LOCK_PATH = join(process.cwd(), ".agency.lock");

function acquireLock(): boolean {
  if (existsSync(LOCK_PATH)) {
    const pid = Number(readFileSync(LOCK_PATH, "utf8").trim());
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      /* stale */
    }
  }
  writeFileSync(LOCK_PATH, String(process.pid));
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function workdirFor(repo: string, key: string): string {
  return join(process.cwd(), ".work", repo.replace("/", "__"), key);
}

// ---- workers (run inside the pool) ----

/** Process one actionable issue end to end. */
async function processIssue(cfg: Config, repo: string, issue: Issue, opts: { fresh?: boolean } = {}): Promise<void> {
  clearStop(repo, issue.number); // a fresh dispatch clears any prior Stop request
  clearHold(repo, issue.number); // …and any prior Hold (resume/continue)
  // Chat agents (v3): interactive, non-repo. Routed by the DB role pin (dashboard selection), never
  // by @-handles in the issue text (issue #140). Skip the clone/branch/PR machinery.
  const rolePin = (getSetting(`issue_role_pin.${repo}#${issue.number}`) || "").trim();
  const chatDef = rolePin
    ? listAgentDefs().find((a) => a.mode === "chat" && ((a.handle || `@${a.name}`).toLowerCase() === rolePin.toLowerCase() || a.name.toLowerCase() === rolePin.replace(/^@/, "").toLowerCase())) ?? null
    : null;
  if (chatDef) {
    void cfg;
    recordIssueStatus(repo, issue.number, withStatus("working"), { title: issue.title, role: chatDef.name });
    const chatThread = await commentThread(repo, issue.number);
    const runChat = () => runChatAgent(chatDef, repo, issue.number, chatThread);
    try {
      await runChat();
    } catch (err) {
      // Same rate-limit handling as the coding pipeline: auto-switch to the fallback model (when
      // enabled) and retry once; otherwise park for auto-resume. Chat previously ignored this, so a
      // usage-limited chat agent just posted "failed" instead of falling back like the other roles.
      const msg = (err as Error).message ?? String(err);
      const rl = await maybeParkRateLimited(repo, issue.number, err);
      if (rl === "switch") {
        try {
          await runChat();
        } catch (err2) {
          const msg2 = (err2 as Error).message ?? String(err2);
          if (!(await maybeParkRateLimited(repo, issue.number, err2))) {
            await commentOnIssue(repo, issue.number, `❌ ${chatDef.name} failed: ${msg2.slice(0, 200)}`).catch(() => {});
          }
        }
      } else if (!rl) {
        await commentOnIssue(repo, issue.number, `❌ ${chatDef.name} failed: ${msg.slice(0, 200)}`).catch(() => {});
      }
      // rl === true → parked for auto-resume; no failure comment.
    } finally {
      clearIssueModelOverride(repo, issue.number); // one-shot chatbox override: consume it after the run
      clearSessionFallback(); // one-shot auto-switch: revert to the user's permanent Settings
    }
    // Interactive: park as awaiting so the next human reply re-engages (resumes the session).
    recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "awaitingAnswer"));
    return;
  }

  const resuming = isWaitingOnHuman(getIssueStatus(repo, issue.number));
  // 🎲 Dealer's choice: the issue was created with no concrete agent/workflow — let a small LLM pick
  // the route ONCE on first start. A workflow pick is pinned; a role pick is stored as the issue's
  // role pin. Everything lives in the DB (issue #140: no @-handle text parsing anywhere).
  const dealerKey = `issue_dealer.${repo}#${issue.number}`;
  if (!resuming && getSetting(dealerKey) === "1") {
    const pick = await pickDealerDispatch(repo, issue).catch(() => null);
    setSetting(dealerKey, ""); // consume — one roll per issue, even if the pick was null
    if (pick) {
      const w = resolveWorkflow(pick);
      if (w) { setIssueWorkflow(repo, issue.number, w.id); await commentOnIssue(repo, issue.number, `🎲 Dealer's choice → workflow **${w.name}**.`).catch(() => {}); }
      else { setSetting(`issue_role_pin.${repo}#${issue.number}`, pick); await commentOnIssue(repo, issue.number, `🎲 Dealer's choice → **${pick}**.`).catch(() => {}); }
    }
  }
  // A persisted per-issue WORKFLOW override (set from the dashboard) wins and is honored even on
  // resume — so "run this workflow" sticks across runs.
  const pinnedWf = (() => { const id = getIssueWorkflow(repo, issue.number); return id ? getWorkflow(id) : null; })();
  // A single-agent pin is the DB role pin the dashboard (or the dealer) stored — never derived from
  // issue/comment text. Re-read (the dealer may have just stored one). No pin and no workflow → the
  // global DEFAULT workflow.
  const pinnedHandle = resuming || pinnedWf ? null : ((getSetting(`issue_role_pin.${repo}#${issue.number}`) || "").trim() || null);
  let handleRole = pinnedHandle ? roleForHandle(pinnedHandle) : null;
  if (!handleRole && pinnedHandle) {
    // A custom (non-chat) agent pin runs on its base role: repo-writing agents as developer,
    // docs/planning agents as planner (same defaults the workflow engine uses for custom steps).
    const def = listAgentDefs().find((d) => (d.handle || `@${d.name}`).toLowerCase() === pinnedHandle.toLowerCase() || d.name.toLowerCase() === pinnedHandle.replace(/^@/, "").toLowerCase());
    if (def) handleRole = def.canWriteCode ? "developer" : "planner";
  }
  const wf = pinnedWf ?? ((!resuming && handleRole === null) ? getWorkflow(getDefaultWorkflowId()) : null);
  const role: RoleName = wf
    ? workflowLeadRole(wf)
    : resuming
    ? ((getIssueRole(repo, issue.number) as RoleName) ?? "developer")
    : handleRole ?? "developer";
  // A single explicit pin (no workflow) runs JUST that one agent — @dev / a code agent = solo
  // developer + PR; @plan/@arch/@review/@test = a single specialist. The multi-step build is the
  // Full build workflow (@build). A bare issue with no recognised handle falls back to Full build.
  const single = !resuming && !wf && !pinnedWf && handleRole !== null;
  // Persist whether this is a SOLO single-role pin (e.g. @dev → just the developer) vs a multi-step
  // workflow, so the dashboard shows the ONE real step instead of defaulting to the full build. Only
  // write on a fresh run (resume forces single=false but the issue is still solo) so it's not wiped.
  if (!resuming) setSetting(`issue_solo.${repo}#${issue.number}`, single ? role : "");
  console.log(`[agency] ${repo} #${issue.number}: ${issue.title} -> role:${role}${resuming ? " (resume)" : ""}`);
  pushActivity(repo, issue.number, role, "start", "▶ starting…"); // instant feedback before the GitHub prep + clone

  // Budget gate: park runaway issues instead of silently burning more. Per-issue override +
  // unlimited flag live in the DB (ADR-0001/0003: no GitHub label has power here).
  const limits = effectiveLimits(repo, issue.number);
  if (!limits.unlimited) {
    const reason = overBudget(issueSpend(repo, issue.number), limits);
    if (reason) {
      await commentOnIssue(
        repo,
        issue.number,
        `⛔ **Budget exceeded** — this issue has ${reason} across all agent runs. ` +
          `Set a higher per-issue budget or toggle unlimited in the dashboard, then re-start. ` +
          `Or split the work into smaller issues.`,
      );
      recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "budgetExceeded"));
      console.log(`[agency] ${repo} #${issue.number}: over budget (${reason}) — parked.`);
      return;
    }
  }

  recordIssueStatus(repo, issue.number, withStatus("working"), { title: issue.title, role });
  if (!resuming) {
    await commentOnIssue(repo, issue.number, `🏗️ On it (role: **${role}**) — branch \`agency/issue-${issue.number}\`.`);
  }

  const thread = opts.fresh ? "" : await commentThread(repo, issue.number); // fresh dashboard issue has no thread — skip the GitHub read
  const workdir = workdirFor(repo, `${issue.number}`);
  // Mark active + show progress BEFORE the slow prep so the card spins and the live stream isn't
  // silent while we clone (and the GitNexus index now builds in the background, off this path).
  // A custom workflow runs via the step engine; a single @dev/code pin runs the solo developer; the
  // proven full-build path stays on runPipeline. (Full build = the @build workflow.)
  const runFlow = () =>
    (wf && wf.id !== "full-build") ? runWorkflowEngine(cfg, repo, issue, wf, workdir, thread, resuming)
    : (single && role === "developer") ? runDeveloperSolo(repo, issue, workdir, thread)
    : runPipeline(cfg, repo, issue, role, workdir, thread);
  setActive(repo, issue.number, "issue", role, issue.title);
  try {
    pushActivity(repo, issue.number, role, "tool", `📥 cloning ${repo}… 0%`);
    await rm(workdir, { recursive: true, force: true });
    await mkdir(join(workdir, ".."), { recursive: true });
    await cloneRepo(repo, workdir, (percent, phase) => {
      pushActivity(repo, issue.number, role, "tool", `📥 cloning ${repo}… ${phase === "cloned" ? "done" : percent + "%"}`);
    });
    // RESUME must continue the EXISTING work, not restart on a fresh default branch. cloneRepo only
    // fetches the default branch, so deterministically check out the issue's branch if it was ever
    // pushed (same as processResume/processFix). Without this, every workflow resume silently threw
    // the worked-on code away.
    if (resuming) await fetchCheckout(workdir, `agency/issue-${issue.number}`).catch(() => {});
    await indexRepo(workdir, repo, (s) => pushActivity(repo, issue.number, role, "tool", s));
    await runFlow();
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] pipeline error ${repo} #${issue.number}:`, msg);
    const rl = await maybeParkRateLimited(repo, issue.number, err);
    if (rl === "switch") {
      // Auto-switched to fallback model — retry the pipeline in the same workdir (no re-clone).
      try {
        await runFlow();
      } catch (err2) {
        const msg2 = (err2 as Error).message ?? String(err2);
        console.error(`[agency] pipeline error after model switch ${repo} #${issue.number}:`, msg2);
        if (await maybeParkRateLimited(repo, issue.number, err2)) return;
        recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "needsAttention"));
        await commentOnIssue(repo, issue.number, `❌ Run failed even after model switch: ${msg2.slice(0, 300)} — fix and re-pin.`).catch(() => {});
      }
      return;
    }
    if (rl) return;
    recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "needsAttention"));
    await commentOnIssue(repo, issue.number, `❌ Run failed: ${msg.slice(0, 300)} — fix and re-pin.`).catch(() => {});
  } finally {
    clearActive(repo, issue.number);
    clearIssueModelOverride(repo, issue.number); // one-shot chatbox override: consume it after each run
    clearSessionFallback(); // one-shot auto-switch: revert to user's permanent role assignments
  }
}

/** Apply review feedback (@dev/@fix) left on a PR. */
async function processPrFeedbackOne(
  repo: string,
  pr: { number: number; title: string; branch: string; issueNumber: number },
  thread: string,
): Promise<void> {
  const workdir = workdirFor(repo, `pr-${pr.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(workdir, ".."), { recursive: true });
  await cloneRepo(repo, workdir);
  await indexRepo(workdir, repo, (s) => pushActivity(repo, pr.number, "developer", "tool", s));
  setActive(repo, pr.number, "pr", "developer", pr.title);
  try {
    await runPrFix(repo, pr.issueNumber, pr.number, pr.branch, workdir, thread);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] pr-fix error ${repo} PR#${pr.number}:`, msg);
    if (await maybeParkRateLimited(repo, pr.number, err, true)) return;
    await commentOnPr(repo, pr.number, `❌ Couldn't apply the fix: ${msg.slice(0, 300)}`).catch(() => {});
  } finally {
    clearActive(repo, pr.number);
  }
}

/** Self-heal one PR (merge conflict / failing CI), bounded by MAX_AUTOFIX. */
async function processHealOne(
  repo: string,
  pr: { number: number; title: string; branch: string; issueNumber: number },
): Promise<void> {
  const health = await prHealth(repo, pr.number);
  if (health.status === "ok") {
    resetAutofix(repo, pr.number);
    return;
  }
  if (health.status !== "failing" && health.status !== "conflict") return;

  const attempts = getAutofixCount(repo, pr.number);
  if (attempts > MAX_AUTOFIX) return;
  if (attempts === MAX_AUTOFIX) {
    await commentOnPr(
      repo,
      pr.number,
      `⚠️ Still unhealthy (${health.detail}) after ${MAX_AUTOFIX} auto-fix attempts — needs a human. Comment \`@dev <hint>\` to guide me.`,
    );
    incAutofix(repo, pr.number);
    return;
  }
  incAutofix(repo, pr.number);

  console.log(`[agency] auto-heal ${repo} PR#${pr.number}: ${health.detail} (attempt ${attempts + 1})`);
  const workdir = workdirFor(repo, `pr-${pr.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(workdir, ".."), { recursive: true });
  await cloneRepo(repo, workdir);

  // For conflicts, do the base merge deterministically (the shallow clone + a weak model can't be
  // trusted to run the right git commands) and hand the agent only the conflicted files to resolve.
  let instruction: string;
  if (health.status === "conflict") {
    const base = await repoBaseBranch(repo);
    await fetchCheckout(workdir, pr.branch);
    const m = await mergeBaseInto(workdir, base);
    if (m.status === "clean") {
      instruction = `[system] The latest ${base} has ALREADY been merged into this branch cleanly (staged in the working tree). Do NOT run git merge/rebase again. Run the project's checks, fix anything the merge broke, commit, and push.`;
    } else if (m.status === "conflicts") {
      instruction = `[system] A merge of origin/${base} is IN PROGRESS with conflicts in: ${m.files.map((f) => "`" + f + "`").join(", ")}. Resolve each (remove all conflict markers), \`git add\` them, run the project's checks, then commit and push. Do NOT run git merge/rebase again or \`git merge --abort\`.`;
    } else {
      instruction = `[system] This PR has merge conflicts and the auto-merge failed. Run \`git fetch origin ${base} && git merge origin/${base}\`, resolve ALL conflicts, run the project's checks, commit, and push.`;
    }
  } else {
    instruction = `[system] The PR's CI checks are failing. Run the project's checks locally, find and fix the failures (and anything blocking the tests), commit, and push.`;
  }

  await indexRepo(workdir, repo, (s) => pushActivity(repo, pr.number, "developer", "tool", s));
  setActive(repo, pr.number, "pr", "developer", pr.title);
  try {
    await runPrFix(repo, pr.issueNumber, pr.number, pr.branch, workdir, instruction);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] auto-heal error ${repo} PR#${pr.number}:`, msg);
    if (await maybeParkRateLimited(repo, pr.number, err, true)) return;
    await commentOnPr(repo, pr.number, `❌ Auto-heal failed: ${msg.slice(0, 300)}`).catch(() => {});
  } finally {
    clearActive(repo, pr.number);
  }
}

/** Re-engage a thread the agency already delivered (often after a merge): build a fix PR. */
async function processFollowUp(cfg: Config, repo: string, issue: Issue): Promise<void> {
  console.log(`[agency] ${repo} #${issue.number}: follow-up on a new comment`);
  recordIssueStatus(repo, issue.number, withStatus("working"), { title: issue.title, role: "developer" });

  const thread = await commentThread(repo, issue.number);
  const workdir = workdirFor(repo, `${issue.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(workdir, ".."), { recursive: true });
  await cloneRepo(repo, workdir);
  await indexRepo(workdir, repo, (s) => pushActivity(repo, issue.number, "developer", "tool", s));

  setActive(repo, issue.number, "issue", "developer", issue.title);
  try {
    await runFollowUp(repo, issue, workdir, thread);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] follow-up error ${repo} #${issue.number}:`, msg);
    if (await maybeParkRateLimited(repo, issue.number, err)) return;
    recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "needsAttention"));
    await commentOnIssue(repo, issue.number, `❌ Follow-up failed: ${msg.slice(0, 300)} — comment again to retry.`).catch(() => {});
  } finally {
    clearActive(repo, issue.number);
  }
}

/**
 * Manual "Resume" from the dashboard: unstick an issue no matter what state it's in (orphaned
 * in-progress, parked needs-attention, blocked, or just quiet) and re-run it. Clears any zombie
 * active entry, then re-dispatches the pipeline.
 */
export async function forceResume(cfg: Config, repo: string, number: number, addressComment = false): Promise<void> {
  const issue = await getIssue(repo, number);
  if (!issue) return;
  // Don't let a manual Resume hammer the usage wall — it'll auto-resume after the reset.
  if (agentsArePaused()) {
    const until = new Date(pausedUntil()).toLocaleString();
    setRateLimited(repo, number, "", new Date(Date.now() + 5 * 3600000).toISOString());
    recordIssueStatus(repo, number, setBlocked(withStatus("working"), "rateLimited"));
    await commentOnIssue(
      repo,
      number,
      `⏳ Still rate-limited until ~${until} — I'll auto-resume after the reset, no need to press Resume.`,
    ).catch(() => {});
    console.log(`[agency] resume blocked (rate-limited) ${repo} #${number}`);
    return;
  }
  // If a PR is ALREADY open for this issue, the work is done — do NOT rebuild/retest (that's the
  // cause of "resume re-ran the whole test suite even though the PR was open & approved, then timed
  // out"). Record the PR, surface the review verdict, and either route to Ready (merge) or run just
  // the Fix when the reviewer asked for changes.
  // An audit tracking issue resumes by RE-RUNNING the auditor (not the dev pipeline). This is how a
  // usage-limit-interrupted audit auto-resumes after the reset (or via the Resume button).
  if (getSetting(`audit_tracking.${repo}`) === String(number)) {
    console.log(`[agency] resume → re-run audit ${repo} #${number}`);
    return runAuditOn(cfg, repo, number);
  }
  // When the human left a steering comment (addressComment), DON'T short-circuit — re-engage so the
  // agent addresses it, even if a PR exists. Only the plain Resume button / auto-resume short-circuits.
  const prBranch = `agency/issue-${number}`;
  const existingPr = addressComment ? null : await findPrForBranch(repo, prBranch).catch(() => null);
  if (existingPr) {
    recordPr(repo, number, existingPr.number, existingPr.url);
    const review = getReview(repo, number);
    clearActive(repo, number);
    if (review?.verdict === "changes") {
      await commentOnIssue(repo, number, `🔧 PR ${existingPr.url} is already open with requested changes — addressing the review on the existing branch (not rebuilding).`).catch(() => {});
      console.log(`[agency] resume → existing PR ${existingPr.url}, has changes → fix`);
      return forceFix(cfg, repo, number);
    }
    recordIssueStatus(repo, number, withStatus("review"));
    await commentOnIssue(repo, number, `✅ PR ${existingPr.url} is already open${review?.verdict === "approved" ? " and approved" : ""} — nothing to rebuild. Press **Merge** on the dashboard.`).catch(() => {});
    console.log(`[agency] resume → existing PR ${existingPr.url}; routed to review (no rerun)`);
    return;
  }
  setThreadCursor(repo, number, 0); // let any prior comment count again
  clearActive(repo, number); // drop a zombie "working" entry if a run died
  // If a plan already exists, skip the (Opus) planner and resume the build from the branch —
  // otherwise run the full pipeline (the planner resumes its own session if it was interrupted).
  if (lastPlan(repo, number)) {
    console.log(`[agency] resume (build) ${repo} #${number}`);
    dispatch(`${repo}#${number}`, () => processResume(cfg, repo, issue));
  } else {
    console.log(`[agency] resume (full) ${repo} #${number}`);
    dispatch(`${repo}#${number}`, () => processIssue(cfg, repo, issue));
  }
}

/** Worker: resume a build (plan already exists) — continue the branch, don't redo finished work. */
async function processResume(cfg: Config, repo: string, issue: Issue): Promise<void> {
  void cfg;
  clearStop(repo, issue.number); // explicit resume clears any prior Stop request
  clearHold(repo, issue.number); // resume also lifts a Hold so the workflow advances
  recordIssueStatus(repo, issue.number, withStatus("working"), { title: issue.title, role: "developer" });
  const thread = await commentThread(repo, issue.number);
  const workdir = workdirFor(repo, `${issue.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(workdir, ".."), { recursive: true });
  await cloneRepo(repo, workdir);
  // Resume must continue the EXISTING work, not start over on a fresh `main`. cloneRepo only fetches
  // the default branch (shallow), so check out the issue's branch deterministically here — mirroring
  // processFix — instead of relying on the agent prompt to `git fetch` it (best-effort, often missed →
  // the agent rebuilt from scratch). If the branch doesn't exist yet, fall through on main.
  await fetchCheckout(workdir, `agency/issue-${issue.number}`).catch(() => {});
  await indexRepo(workdir, repo, (s) => pushActivity(repo, issue.number, "developer", "tool", s));
  setActive(repo, issue.number, "issue", "developer", issue.title);
  try {
    await runResumeBuild(repo, issue, workdir, thread);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] resume error ${repo} #${issue.number}:`, msg);
    if (await maybeParkRateLimited(repo, issue.number, err)) return;
    recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "needsAttention"));
    await commentOnIssue(repo, issue.number, `❌ Resume failed: ${msg.slice(0, 300)} — press Resume again.`).catch(() => {});
  } finally {
    clearActive(repo, issue.number);
  }
}

/**
 * Dashboard "Fix" button: address an open PR's outstanding review (and resolve conflicts with
 * main if any) on its existing branch, then re-test/re-review and update the same PR. Detects
 * conflicts up front (no tokens) so the fix run also rebases when needed.
 */
export async function forceFix(cfg: Config, repo: string, number: number): Promise<void> {
  const issue = await getIssue(repo, number);
  if (!issue) return;
  if (agentsArePaused()) {
    setRateLimited(repo, number, "", new Date(Date.now() + 5 * 3600000).toISOString());
    recordIssueStatus(repo, number, setBlocked(withStatus("working"), "rateLimited"));
    await commentOnIssue(repo, number, `⏳ Rate-limited — I'll run the fix automatically after the usage window resets (~${new Date(pausedUntil()).toLocaleString()}).`).catch(() => {});
    return;
  }
  const branch = `agency/issue-${number}`;
  const ms = await prMergeStatus(repo, branch).catch(() => null);
  const conflict = ms?.mergeable === "conflict";
  recordIssueStatus(repo, number, withStatus("working"));
  console.log(`[agency] fix ${repo} #${number} (conflict=${conflict})`);
  dispatch(`${repo}#${number}`, () => processFix(cfg, repo, issue, conflict));
}

/** Worker: run the review-fix pipeline on the PR's existing branch. */
async function processFix(cfg: Config, repo: string, issue: Issue, conflict: boolean): Promise<void> {
  void cfg;
  recordIssueStatus(repo, issue.number, withStatus("working"), { title: issue.title, role: "developer" });
  const workdir = workdirFor(repo, `${issue.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(workdir, ".."), { recursive: true });
  await cloneRepo(repo, workdir);
  await fetchCheckout(workdir, `agency/issue-${issue.number}`); // put the work back, then fix on top
  await indexRepo(workdir, repo, (s) => pushActivity(repo, issue.number, "developer", "tool", s));
  setActive(repo, issue.number, "issue", "developer", issue.title);
  try {
    await runReviewFix(repo, issue, workdir, { conflict });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] fix error ${repo} #${issue.number}:`, msg);
    if (await maybeParkRateLimited(repo, issue.number, err)) return;
    recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "needsAttention"));
    await commentOnIssue(repo, issue.number, `❌ Fix run failed: ${msg.slice(0, 300)} — press Fix again.`).catch(() => {});
  } finally {
    clearActive(repo, issue.number);
  }
}

/**
 * Play button: start a Planned issue now. Drops the planned hold, then runs the full pipeline
 * (planner → … ). If we're inside the usage-limit window, queue it to auto-resume after the reset.
 */
/** Dashboard-first instant start: dispatch from the title/body we already have — no GitHub read. */
export async function forceStartWith(cfg: Config, repo: string, number: number, title: string, body: string): Promise<void> {
  if (agentsArePaused()) {
    setRateLimited(repo, number, "", new Date(Date.now() + 5 * 3600000).toISOString());
    recordIssueStatus(repo, number, setBlocked(withStatus("working"), "rateLimited"));
    return;
  }
  recordIssueStatus(repo, number, withStatus("working"), { title });
  console.log(`[agency] start (dashboard, instant) ${repo} #${number}`);
  dispatch(`${repo}#${number}`, () => processIssue(cfg, repo, { number, title, body }, { fresh: true }));
}

export async function forceStart(cfg: Config, repo: string, number: number): Promise<void> {
  const issue = await getIssue(repo, number);
  if (!issue) return;
  if (agentsArePaused()) {
    setRateLimited(repo, number, "", new Date(Date.now() + 5 * 3600000).toISOString());
    recordIssueStatus(repo, number, setBlocked(withStatus("working"), "rateLimited"));
    await commentOnIssue(repo, number, `⏳ Rate-limited — I'll start this automatically after the usage window resets (~${new Date(pausedUntil()).toLocaleString()}).`).catch(() => {});
    return;
  }
  recordIssueStatus(repo, number, withStatus("working"), { title: issue.title });
  console.log(`[agency] start (play) ${repo} #${number}`);
  dispatch(`${repo}#${number}`, () => processIssue(cfg, repo, issue));
}

/**
 * One-click approve from the dashboard: mark the proposal approved (👍 the agency comment so
 * the pipeline's approval check passes), move the issue to Working *immediately* (so it never
 * sits in "waiting" while it queues), and dispatch the build.
 */
export async function forceApprove(cfg: Config, repo: string, number: number): Promise<void> {
  const issue = await getIssue(repo, number);
  if (!issue) return;
  // DB-only approval (ADR-0001): the pipeline reads this flag — no GitHub reaction round-trip.
  setSetting(`issue_approved.${repo}#${number}`, "1");
  // Approving during the usage-limit window: queue the build for auto-resume after the reset
  // (so you can approve anytime, even rate-limited).
  if (agentsArePaused()) {
    setRateLimited(repo, number, "", new Date(Date.now() + 5 * 3600000).toISOString());
    recordIssueStatus(repo, number, setBlocked(withStatus("working"), "rateLimited"));
    await commentOnIssue(
      repo,
      number,
      `👍 Approved — I'll build it automatically after the usage window resets (~${new Date(pausedUntil()).toLocaleString()}).`,
    ).catch(() => {});
    console.log(`[agency] approve queued (rate-limited) ${repo} #${number}`);
    return;
  }
  // Instant UI: show it as working even if the pool is at capacity (it'll be queued).
  recordIssueStatus(repo, number, withStatus("working"));
  console.log(`[agency] approve+build ${repo} #${number}`);
  dispatch(`${repo}#${number}`, () => processIssue(cfg, repo, issue));
}

/**
 * Dashboard "Stop": abort any in-flight agent runs for the issue, turn off its auto-resume/merge,
 * and park it back in Planned. The sweeper skips Planned, so nothing restarts it — no further AI
 * interaction until the user presses ▶ again.
 */
/**
 * Dashboard "Interrupt & steer": queue the user's message and request a HOLD. Unlike Stop, this does
 * NOT abort the in-flight run — the current agent finishes, then the pipeline pauses at the next
 * step boundary (status → held) and folds the steer into the next step when the user resumes.
 */
export function forceHold(repo: string, number: number, steer: string): void {
  if (steer && steer.trim()) queueSteer(repo, number, steer.trim());
  requestHold(repo, number);
  pushActivity(repo, number, "developer", "text", "⏸ Interrupt queued — the agency will pause at the next safe break for your steer.");
  console.log(`[agency] hold requested ${repo} #${number}`);
}

export async function forceStop(_cfg: Config, repo: string, number: number): Promise<void> {
  requestStop(repo, number); // authoritative halt — the workflow/pipeline checks this between steps
  const aborted = stopRuns(repo, number); // abort the live SDK subprocess(es)
  clearActive(repo, number);
  if (number === 0) {
    // The codebase Auditor runs under the sentinel #0 — there's no GitHub issue to touch.
    pushActivity(repo, 0, "auditor", "done", `⏹ audit stopped${aborted ? ` (${aborted} run aborted)` : ""}.`);
    console.log(`[agency] audit stop ${repo} (${aborted} aborted)`);
    return;
  }
  const abortedNote = aborted ? ` (${aborted} run${aborted > 1 ? "s" : ""} aborted)` : "";
  // If the work already produced a PR, stopping shouldn't bury it in Planned — keep it in Review
  // so you can just merge. Otherwise park it back in Planned.
  const existingPr = await findPrForBranch(repo, `agency/issue-${number}`).catch(() => null);
  if (existingPr) {
    recordPr(repo, number, existingPr.number, existingPr.url);
    setAuto("resume", "off", repo, number); // stop auto from re-running it
    recordIssueStatus(repo, number, withStatus("review"));
    clearRateLimited(repo, number);
    await commentOnIssue(repo, number, `⏹ Stopped${abortedNote}. PR ${existingPr.url} is open — press **Merge** when you're ready.`).catch(() => {});
    console.log(`[agency] stop ${repo} #${number} → kept PR ${existingPr.url} (Review)`);
    return;
  }
  // Stop = halt and STAY halted (NOT Planned — that's what Cancel is for). Park at needs-attention,
  // auto off; nothing re-runs it until the user presses Resume (or Cancel → Planned).
  setAuto("resume", "off", repo, number);
  setAuto("merge", "off", repo, number);
  recordIssueStatus(repo, number, setBlocked(withStatus("working"), "needsAttention"));
  clearRateLimited(repo, number);
  await commentOnIssue(
    repo,
    number,
    `⏹ Stopped${abortedNote}. Press **Resume** to continue, or **Cancel** to reset to Planned.`,
  ).catch(() => {});
  console.log(`[agency] stop ${repo} #${number} → needs-attention (${aborted} aborted)`);
}

/**
 * Dashboard "Create PR": deterministic, token-free (no agent). Opens a PR from the already-pushed
 * `agency/issue-<n>` branch (or returns the existing one), and moves the issue to Ready. Use after
 * the reviewer approved but no PR was opened.
 */
export async function forceCreatePr(_cfg: Config, repo: string, number: number): Promise<{ ok: boolean; url?: string; msg?: string }> {
  const branch = `agency/issue-${number}`;
  let pr = await findPrForBranch(repo, branch);
  if (!pr) {
    const issue = await getIssue(repo, number);
    pr = await ensureDraftPr(repo, number, branch, issue?.title || `Work for #${number}`);
  }
  if (!pr) {
    return { ok: false, msg: `No pushed \`${branch}\` branch to open a PR from yet — the agency hasn't produced any commits. Press Resume to build it.` };
  }
  recordIssueStatus(repo, number, withStatus("review"));
  recordPr(repo, number, pr.number, pr.url);
  await commentOnIssue(repo, number, `📎 Opened PR ${pr.url} from the dashboard (reviewer-approved). Press **Merge** when you're ready.`).catch(() => {});
  console.log(`[agency] create-pr ${repo} #${number} -> ${pr.url}`);
  return { ok: true, url: pr.url };
}

const AUDIT_TASK = [
  "Audit this repository's overall health and propose the highest-impact issues to fix.",
  "Build the knowledge graph with graphify, read graphify-out/GRAPH_REPORT.md (god nodes + surprising",
  "connections), cross-check against the actual code and `git log --oneline -30`, then return your",
  "proposals as a STRICT JSON array (at most 5) of {title, body}, highest-impact first. Each must be a",
  "small, reviewable refactor/cleanup with concrete evidence (files/symbols). If the codebase is healthy,",
  "return []. Do NOT change code or create issues — output only the JSON array and stop.",
].join("\n");

const AUDIT_ISSUE_BODY =
  "The Dev Agency **Auditor** is reviewing this codebase's health (architecture, duplication, dead " +
  "code, complexity, test coverage) and will open scoped refactor/cleanup issues into Planned.\n\n" +
  "This tracking issue auto-closes when the audit completes. If it's interrupted (e.g. a usage " +
  "limit), it persists here — press **Resume** to re-run it.";

/**
 * Manual "Audit now": the independent codebase Auditor. Opens (or reuses) a real GitHub **tracking
 * issue** so the audit survives errors/restarts and can be resumed, then runs the audit under it.
 */
export async function forceAudit(cfg: Config, repo: string): Promise<void> {
  // Reuse an open audit tracking issue (e.g. one a usage-limit interrupted) instead of duplicating.
  // "Kind" tracking is a DB flag (not a label): at most one open audit-tracking issue per repo.
  const trackingKey = `audit_tracking.${repo}`;
  let number = Number(getSetting(trackingKey) || 0) || undefined;
  if (number && getIssueStatus(repo, number).state === "done") number = undefined; // prior audit finished — start fresh
  if (!number) {
    const created = await createIssue(
      repo,
      `🔎 Codebase audit — ${new Date().toISOString().slice(0, 10)}`,
      AUDIT_ISSUE_BODY,
      ghUserToken() || ghBotToken(),
    ).catch(() => null);
    if (!created || !created.number) {
      console.error(`[agency] audit ${repo}: couldn't open a tracking issue`);
      return;
    }
    number = created.number;
    setSetting(trackingKey, String(number));
  }
  await runAuditOn(cfg, repo, number);
}

/** Run (or re-run) the auditor under an existing tracking issue. Persists on the issue; resumable. */
export async function runAuditOn(cfg: Config, repo: string, number: number): Promise<void> {
  dispatch(`${repo}#${number}`, async () => {
    const workdir = workdirFor(repo, `audit-${number}`);
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
    setActive(repo, number, "issue", "auditor", "Codebase audit");
    recordIssueStatus(repo, number, withStatus("working"), { title: "🔎 Codebase audit" });
    try {
      await cloneRepo(repo, workdir);
      const res = await runRole("auditor", { task: AUDIT_TASK, workdir, repo, issueNumber: number });
      const proposals = parseAuditProposals(res.text).slice(0, 5);
      const owner = ghUserToken() || ghBotToken();
      const created: string[] = [];
      for (const p of proposals) {
        const issue = await createIssue(
          repo,
          p.title.slice(0, 250),
          `${p.body}\n\n— _opened by the Dev Agency **Auditor** (tracking #${number}). Review, then ▶ Start to build it._`,
          owner,
        ).catch(() => null);
        if (!issue || !issue.number) continue;
        recordIssueStatus(repo, issue.number, withStatus("planned"), { title: p.title });
        created.push(`#${issue.number}`);
      }
      const summary = created.length
        ? `🔎 **Audit complete** — opened ${created.length} issue(s) in Planned: ${created.join(", ")}.`
        : "🔎 **Audit complete** — no issues to propose; the codebase looks healthy.";
      await commentOnIssue(repo, number, summary).catch(() => {});
      await closeIssue(repo, number, "Audit complete.").catch(() => {});
      recordIssueStatus(repo, number, withStatus("done")); // → Done
      setSetting(`audit_tracking.${repo}`, ""); // free the slot for the next audit
      console.log(`[agency] audit ${repo} #${number}: opened ${created.length} issue(s)`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // Survive a usage limit (auto-resumes after reset) or any error (resumable) — the tracking
      // issue persists either way, so the audit is never silently lost.
      if (!(await maybeParkRateLimited(repo, number, err))) {
        recordIssueStatus(repo, number, setBlocked(withStatus("working"), "needsAttention"));
        await commentOnIssue(repo, number, `❌ Audit run failed: ${msg.slice(0, 300)} — press **Resume** to retry.`).catch(() => {});
      }
      console.error(`[agency] audit ${repo} #${number} failed:`, msg);
    } finally {
      clearActive(repo, number);
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

// ---- scan + dispatch ----

const recentEnough = (iso: string): boolean =>
  !iso || Date.now() - new Date(iso).getTime() <= followupWindowDays() * 86400_000;

/** Scan one repo and dispatch all eligible work to the pool (deduped by key). */
async function scanRepo(cfg: Config, repo: string): Promise<void> {
  // Quick management commands first (no agent runs).
  await handleControlCommands(cfg, repo);
  await handleMergeCommands(cfg, repo);

  // While walled off by the usage limit, don't start NEW agent work (it would just fail and
  // burn attempts). Epics/commands above still run; parked work auto-resumes after the reset.
  const paused = agentsArePaused();

  // Pass 1 — issues (any state). One rule: once the agency has touched a thread, a new comment
  // re-engages it (open or closed, no re-tag); a thread the agency has never triaged sits in Inbox.
  const threads = await listRecentThreads(repo, 100);
  const threadMap = new Map(threads.map((t) => [t.number, t]));
  // Structural changes (refactors/renames/moves) go FIRST so they can grab the exclusive barrier
  // ahead of ordinary work in the same scan (priority + drain).
  threads.sort((a, b) => (isStructural(b.title, b.body) ? 1 : 0) - (isStructural(a.title, a.body) ? 1 : 0));
  let holdNewWork = false; // a structural change is queued/running — don't start new ordinary runs
  for (const t of threads) {
    // Keep the DB's title fresh for every open issue (cheap title-only upsert) so cards never show
    // blank/stale — this is what a manual "reload from GitHub" relies on to repopulate the board.
    if (!t.closed && t.title) recordIssueState(repo, t.number, { title: t.title });

    // DB truth (ADR-0001/0003): the lifecycle state + blocked reason come from getIssueStatus —
    // GitHub carries no signal of its own (no labels, nothing read back).
    let status = getIssueStatus(repo, t.number);
    if (status.state === "planned") continue; // parked in Planned — waits for the play button

    // Backstop for threads finished on GitHub directly: a closed thread the agency had already
    // triaged (anything past Inbox) is terminal. One gh read, and only once per thread (state
    // flips to done, so the next scan skips it).
    if (t.closed && status.state !== "notPlanned" && status.state !== "done") {
      await prMerged(repo, `agency/issue-${t.number}`).catch(() => false); // best-effort — the change journal records the actual merge
      recordIssueStatus(repo, t.number, withStatus("done"), { title: t.title });
      status = { state: "done", blocked: null };
    }

    if (status.state === "working") continue; // being handled (or swept below if stale)
    if (t.closed && !recentEnough(t.updatedAt)) continue; // ignore stale closed threads

    const awaiting = status.blocked === "awaitingApproval" || status.blocked === "awaitingAnswer";
    // The dashboard is the control plane — nothing auto-starts a fresh GitHub issue anymore. A
    // never-triaged issue just surfaces in Inbox; a human promotes it to Planned or Working.

    // Only inspect comments when it can matter (triaged, has comments, or paused).
    let owned = status.state !== "notPlanned";
    let newHumanComment = false;
    let approvedReaction = false;
    let lastCommentId = 0;
    if (owned || awaiting || t.comments > 0) {
      const sig = await threadSignals(repo, t.number, t.updatedAt);
      owned = owned || sig.agencyEverCommented;
      lastCommentId = sig.lastCommentId;
      // Re-engage on a new comment only when it's from a repo member (owner/member/collaborator).
      newHumanComment = sig.lastIsHuman && sig.lastCommentId > getThreadCursor(repo, t.number) && canTrigger(sig.lastAuthorAssoc);
      if (awaiting && !newHumanComment) approvedReaction = sig.approvedByReaction;
    }

    // Is there an open PR for this issue? (only relevant when there's a new comment to route)
    let openPr: { number: number; isDraft: boolean } | null = null;
    if (newHumanComment && owned && !awaiting) {
      openPr = await findPrForBranch(repo, `agency/issue-${t.number}`);
    }

    const action = decideThreadAction({
      ignored: false,
      inProgress: false,
      closed: t.closed,
      ready: status.state === "review",
      needsAttention: status.blocked === "needsAttention",
      awaiting,
      owned,
      newHumanComment,
      approvedReaction,
      hasOpenPr: Boolean(openPr),
    });
    if (action === "skip") {
      // A never-triaged, still-open GitHub issue lands in Inbox. Nothing auto-starts it — a human
      // promotes it to Planned or Working from the dashboard.
      if (!owned && !t.closed) {
        recordIssueStatus(repo, t.number, withStatus("notPlanned"), { title: t.title });
      }
      continue;
    }
    if (paused) continue; // usage-limit wall — leave it; it resumes after the reset

    const issue: Issue = { number: t.number, title: t.title, body: t.body };

    // FILE-LOCK GATE (overwrite protection, repo-wide, any issue↔issue): claim this issue's declared
    // file footprint. If another in-flight run holds an overlapping file, DON'T dispatch now — defer
    // to a later scan when it frees (serializes only the overlapping work; disjoint work runs in
    // parallel). An unknown footprint never blocks (the feature-aware merge is the backstop).
    const structural = isStructural(t.title, t.body);
    if (structural) {
      setSetting(structuralFlagKey(repo, t.number), "1"); // DB-first flag the agent reads
      const bar = claimBarrier(repo, t.number);
      if (!bar.ok) {
        // Can't run exclusively yet — in-flight work must drain first. Hold ordinary work this scan
        // so the queue empties and the refactor can take the repo on a later scan.
        holdNewWork = true;
        recordIncident("barrier-waiting", `#${t.number} (structural) waits to run exclusively — draining #${bar.blockedBy}`);
        continue;
      }
    } else {
      if (holdNewWork) {
        recordIncident("barrier-hold", `#${t.number} held — a structural change is queued for this repo`);
        continue;
      }
      const claim = claimFiles(repo, t.number, filesFor(repo, t.number));
      if (!claim.ok) {
        recordIncident("file-lock-deferred", `#${t.number} waits on \`${claim.file}\` (held by #${claim.blockedBy})`);
        continue;
      }
    }
    const release = () => { releaseFiles(repo, t.number); if (structural) try { setSetting(structuralFlagKey(repo, t.number), ""); } catch { /* noop */ } };
    // Mark this comment handled now so re-polls during the run don't double-fire.
    if (newHumanComment) setThreadCursor(repo, t.number, lastCommentId);

    if (action === "prfix" && openPr) {
      const thread = await commentThread(repo, t.number);
      const pr = { number: openPr.number, title: t.title, branch: `agency/issue-${t.number}`, issueNumber: t.number };
      dispatch(`${repo}#pr-${pr.number}`, () => processPrFeedbackOne(repo, pr, thread).finally(release));
    } else if (action === "followup") {
      dispatch(`${repo}#${t.number}`, () => processFollowUp(cfg, repo, issue).finally(release));
    } else {
      // fresh or resume — processIssue picks the role and sorts approve/answer/change.
      dispatch(`${repo}#${t.number}`, () => processIssue(cfg, repo, issue).finally(release));
    }
  }

  // Pass 2 — open agency PRs: comments on the PR's own thread, then auto-heal.
  for (const pr of await listAgencyPrs(repo)) {
    if (paused) break; // usage-limit wall — skip PR agent work until reset
    const sig = await threadSignals(repo, pr.number);
    const newComment = sig.lastIsHuman && sig.lastCommentId > getThreadCursor(repo, pr.number);
    if (newComment) {
      setThreadCursor(repo, pr.number, sig.lastCommentId);
      if (!isNoOpComment(sig.lastHumanBody)) {
        const thread = await commentThread(repo, pr.number);
        dispatch(`${repo}#pr-${pr.number}`, () => processPrFeedbackOne(repo, pr, thread));
        continue;
      }
    }
    if (getAutofixCount(repo, pr.number) > MAX_AUTOFIX) continue; // already gave up
    const health = await prHealth(repo, pr.number);
    if (health.status === "failing" || health.status === "conflict") {
      dispatch(`${repo}#pr-${pr.number}`, () => processHealOne(repo, pr));
    } else if (health.status === "ok") {
      resetAutofix(repo, pr.number);
    }
  }

  // Epics: refresh sub-issue tracking and review the parent when all children are done.
  await reconcileEpics(repo, threadMap).catch((err) =>
    console.error(`[agency] epic reconcile error on ${repo}:`, (err as Error).message),
  );
}

/**
 * Sweep stored state for "stuck" issues: anything marked in-progress that no run is actually
 * working on, idle past the grace window, is parked to needs-attention in the DB. This is what
 * stops a card sitting in "Working" forever after an interrupted run — the dashboard reads
 * stored state, so the stored state must reflect reality.
 */
async function sweepStuck(): Promise<void> {
  for (const i of recentIssues(100)) {
    // "stuck" = IssueState 'working' + blocked == null on consistently-stored rows. This is
    // tighter on drifted data: an issue parked as needs-attention / awaiting-answer is
    // NOT swept as stuck. See src/state.ts (#66).
    const st = parseLegacyStatus(i.state);
    // The blocked REASON lives in its own column (i.blocked), not in i.state (which is the bare
    // "working" enum). Reading it back from i.state alone always saw blocked==null, so an already-
    // parked issue was re-parked + re-logged on EVERY 60s poll — an endless "Run interrupted —
    // parked at needs-attention" spam loop (no LLM, but real feed/label churn). Honour the column.
    if (st.state !== "working" || st.blocked != null || i.blocked != null) continue;
    const running = getActive().some((a) => a.repo === i.repo && a.number === i.number);
    const idleMs = i.updated_at ? Date.now() - new Date(i.updated_at).getTime() : Infinity;
    if (running || idleMs <= ORPHAN_GRACE_MS) continue;
    recordIssueStatus(i.repo, i.number, setBlocked(withStatus("working"), "needsAttention"));
    // DB-only notice (NOT a GitHub comment): GitHub comments here emailed on every scan AND were
    // misread as "new human comment" next scan, which re-dispatched the run → an endless loop.
    pushActivity(i.repo, i.number, "agency", "done", "⏸ Run interrupted — parked at needs-attention. Press Resume to retry.");
    recordIncident("stuck-swept", `#${i.number} interrupted with no live run; parked at needs-attention`);
    console.log(`[agency] swept stuck ${i.repo} #${i.number}`);
  }
}

/** Scan every watched repo and dispatch work. Returns immediately; the pool runs it. */
export async function processAllRepos(cfg: Config): Promise<number> {
  if (!githubConfigured(cfg)) return 0; // no credentials → no GitHub scanning (login still works)
  for (const repo of effectiveRepos(cfg)) {
    try {
      await scanRepo(cfg, repo);
    } catch (err) {
      console.error(`[agency] scan error on ${repo} (continuing):`, (err as Error).message);
    }
  }
  await sweepStuck().catch(() => {});
  // Housekeeping: drop local attachment blobs older than a week (≤ hourly, cheap DELETE).
  if (Date.now() - lastAttachmentFlush > 3_600_000) {
    lastAttachmentFlush = Date.now();
    try { const n = flushOldAttachments(7); if (n) console.log(`[agency] flushed ${n} old attachment(s)`); } catch { /* noop */ }
    try { const p = pruneEphemeral(); if (p.activity || p.runStep) console.log(`[agency] pruned ${p.activity} activity + ${p.runStep} run-step row(s)`); } catch { /* noop */ }
  }
  // Self-evolving loop: fold accumulated lessons into the playbooks via a draft PR.
  maybeSelfImprove(cfg);
  return 0;
}

async function runOnce(cfg: Config): Promise<void> {
  if (!acquireLock()) {
    console.log("[agency] another run is already in progress; exiting.");
    return;
  }
  try {
    await processAllRepos(cfg);
    await drain(); // wait for all dispatched work to finish
  } finally {
    await unlink(LOCK_PATH).catch(() => {});
  }
}

async function runWatch(cfg: Config): Promise<void> {
  console.log(`[agency] mode: watch (every ${cfg.pollIntervalSeconds}s)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await processAllRepos(cfg);
    await sleep(cfg.pollIntervalSeconds * 1000);
  }
}

/**
 * One-shot reconcile at startup: find issues that were parked as "needs-attention" by a run
 * that actually hit the usage/session limit (before the rate-limit detection existed, or while
 * a previous build lacked the fix). We detect them by scanning each needs-attention issue's
 * recent agency comments for a usage-limit signal, then move them into the rate-limited state so
 * they show the ⌛ hourglass in Working and auto-resume after the reset. Pure GitHub reads + DB —
 * no agent/AI calls, zero tokens. This is what makes "scan all issues after redeploy" work.
 */
async function reconcileRateLimited(cfg: Config): Promise<void> {
  let moved = 0;
  for (const repo of effectiveRepos(cfg)) {
    let issues: Issue[];
    try {
      issues = await listAllOpenIssues(repo);
    } catch {
      continue;
    }
    for (const issue of issues) {
      try {
        const st = getIssueStatus(repo, issue.number);
        if (st.blocked !== "needsAttention") continue;
        const comments = await listComments(repo, issue.number).catch(() => [] as Array<{ body: string }>);
        // Only trust an agency-authored failure note as the rate-limit signal.
        const hit = comments
          .slice(-6)
          .reverse()
          .find((c) => c.body.includes(AGENCY_MARKER) && parseRateLimit(c.body).limited);
        if (!hit) continue;
        const rl = parseRateLimit(hit.body);
        const at = rl.resetAt && rl.resetAt > Date.now() ? rl.resetAt : nextResetMs();
        setRateLimited(repo, issue.number, "", new Date(at).toISOString());
        recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "rateLimited"));
        // If the reset is still in the future, hold new dispatch too so we don't re-hit the wall.
        if (at > Date.now()) pauseAgents(at);
        moved++;
        console.log(`[agency] reconciled rate-limited ${repo} #${issue.number} (auto-resume ${new Date(at).toISOString()})`);
      } catch (err) {
        console.error(`[agency] reconcile error on ${repo} #${issue.number}:`, (err as Error).message);
      }
    }
  }
  if (moved) console.log(`[agency] reconcile: moved ${moved} parked issue(s) into auto-resume.`);
}

/**
 * Pure-script auto-resume: every minute, re-run any issue whose per-provider rate-limit reset has
 * passed. Rate limits are per-provider, so a GLM reset re-runs the issue on the best available model
 * (GLM is eligible again). No global pause anymore.
 */
function startAutoResume(cfg: Config): void {
  setInterval(() => {
    if (shuttingDown) return;
    try {
      const due = dueRateLimited(new Date().toISOString());
      for (const r of due) {
        clearRateLimited(r.repo, r.number, r.providerId);
        console.log(`[agency] auto-resume after provider reset: ${r.repo} #${r.number} (provider ${r.providerId})`);
        void forceResume(cfg, r.repo, r.number);
      }
    } catch (err) {
      console.error("[agency] auto-resume tick error:", (err as Error).message);
    }
  }, 60_000);
}

/** Hard cap on automatic retries per issue so a broken one can't loop forever burning tokens. */
const AUTO_MAX_ATTEMPTS = Number(process.env.AUTO_MAX_ATTEMPTS?.trim()) || 8;
const AUTO_INTERVAL_MS = (Number(process.env.AUTO_INTERVAL_SEC?.trim()) || 150) * 1000;

/**
 * Auto-mode loop: for issues you've opted into auto, drive a PR all the way to merged without you
 * pressing buttons — auto-merge when the review approved + no conflicts + checks green, otherwise
 * auto-resume/fix (address review, resolve conflicts, fix failing checks) until it gets there.
 * Bounded by AUTO_MAX_ATTEMPTS. Pure orchestration; it reuses the same Fix/merge paths as the UI.
 */
function startAutoMode(cfg: Config): void {
  const inFlight = (repo: string, n: number): boolean => inFlightKeys().includes(`${repo}#${n}`);
  const tick = async (): Promise<void> => {
    if (shuttingDown || agentsArePaused() || !githubConfigured(cfg)) return;
    for (const repo of effectiveRepos(cfg)) {
      // PRs in flight: merge when ready, otherwise nudge them toward mergeable.
      let prs: Awaited<ReturnType<typeof listAgencyPrs>> = [];
      try {
        prs = await listAgencyPrs(repo);
      } catch {
        /* skip repo this tick */
      }
      for (const pr of prs) {
        const n = pr.issueNumber;
        try {
          const wantMerge = autoEnabled("merge", repo, n);
          const wantResume = autoEnabled("resume", repo, n);
          if (!wantMerge && !wantResume) continue;
          if (inFlight(repo, n)) continue;
          const verdict = getReview(repo, n)?.verdict;
          const health = await prHealth(repo, pr.number); // ok | pending | failing | conflict
          if (verdict === "approved" && health.status === "ok") resetAutoAttempts(repo, n); // reached a good state
          // Ready to ship: reviewer approved, no conflicts, checks not failing/pending.
          if (wantMerge && verdict === "approved" && health.status === "ok") {
            const r = await mergePrForBranch(repo, pr.branch);
            if (r.ok) {
              afterMerge(repo, n, r.files);
              await closeIssue(repo, n, `🤖 **Auto-merged** ${r.msg} — review approved, no conflicts, checks green.`).catch(() => {});
              recordIssueStatus(repo, n, withStatus("done"));
              clearReview(repo, n);
              resetAutoAttempts(repo, n);
              // Epic bookkeeping + ▶ Play auto-advance: next sub-issue starts when this one merges.
              await onChildMerged(repo, n, (rp, num) => forceStart(cfg, rp, num)).catch(() => {});
              console.log(`[agency] auto-merged ${repo} #${n}`);
            }
            continue;
          }
          // Not there yet: if it needs work and auto-resume is on, take another bounded pass.
          if (wantResume) {
            const needsWork = verdict === "changes" || health.status === "conflict" || health.status === "failing";
            if (!needsWork) continue; // approved+clean but merge off, or checks pending — just wait
            if (autoAttempts(repo, n) >= AUTO_MAX_ATTEMPTS) continue; // give up quietly; leave for human
            bumpAutoAttempts(repo, n);
            console.log(`[agency] auto-fix ${repo} #${n} (attempt ${autoAttempts(repo, n)}, verdict=${verdict ?? "?"}, health=${health.status})`);
            await forceFix(cfg, repo, n);
          }
        } catch (err) {
          console.error(`[agency] auto-mode PR error ${repo} #${n}:`, (err as Error).message);
        }
      }
      // Parked issues (needs-attention, no live PR) with auto-resume on → re-run, bounded.
      try {
        for (const i of await listAllOpenIssues(repo)) {
          if (getIssueStatus(repo, i.number).blocked !== "needsAttention") continue;
          if (!autoEnabled("resume", repo, i.number)) continue;
          if (inFlight(repo, i.number)) continue;
          if (autoAttempts(repo, i.number) >= AUTO_MAX_ATTEMPTS) continue;
          bumpAutoAttempts(repo, i.number);
          console.log(`[agency] auto-resume ${repo} #${i.number} (attempt ${autoAttempts(repo, i.number)})`);
          await forceResume(cfg, repo, i.number);
        }
      } catch {
        /* skip */
      }
    }
  };
  setInterval(() => void tick().catch((e) => console.error("[agency] auto-mode tick error:", (e as Error).message)), AUTO_INTERVAL_MS);
}

/** True once the agency has GitHub credentials to act with (env OR dashboard-stored). Until then
 * we do NO GitHub work — the dashboard + login/admin-setup run fine without it. Read live so saving
 * a token in the dashboard starts the agency without a redeploy. */
function githubConfigured(_cfg: Config): boolean {
  return githubReady();
}

/** GitHub-dependent startup work (repo access, orphan recovery, rate-limit reconcile). */
async function backgroundInit(cfg: Config): Promise<void> {
  if (!githubConfigured(cfg)) {
    console.log("[agency] GitHub not configured yet — login/setup only; repo work starts once a token is set.");
    return;
  }
  try {
    await ensureAllRepoAccess(cfg);
    await recoverOrphans(cfg);
    await reconcileRateLimited(cfg);
  } catch (e) {
    console.error("[agency] background init error:", (e as Error).message);
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  seedAdmin(); // multi-user: create the admin from env on first boot (no-op if MASTER_KEY unset)
  seedChatAgents(); // v3: register the starter chat agents (spec-creator, grill-me) once
  seedWorkflows(); // workflows: seed the built-in templates (full-build / quick-fix / plan-only / review-only)
  seedLibrary(); // skills + hooks: seed the baseline library (idempotent — only when empty)
  resetAdminPassword(); // forgot-password recovery via RESET_ADMIN_PASSWORD env (no-op if unset)
  startAutoResume(cfg);
  startAutoMode(cfg);
  startPreviewSweeper();
  // Both "watch" and "webhook" run the HTTP server (so the dashboard is always reachable — a
  // watch-mode deploy with no server is what made Coolify 502). The server's safety poll uses
  // pollIntervalSeconds, so watch-style polling still happens; webhook deliveries (if configured)
  // just trigger it sooner. Only "once" stays headless.
  if (cfg.runMode === "webhook" || cfg.runMode === "watch") {
    // Start listening IMMEDIATELY; do the GitHub-dependent init in the background so a slow or
    // failing `gh` call (e.g. no token yet) can never stop the server binding → no 502 loop.
    void backgroundInit(cfg);
    const { runWebhook } = await import("./webhook.js");
    await runWebhook(
      cfg,
      processAllRepos,
      (repo, number) => forceResume(cfg, repo, number),
      (repo, number) => forceApprove(cfg, repo, number),
      (repo, number) => forceFix(cfg, repo, number),
      (repo, number) => forceStart(cfg, repo, number),
      (repo, number) => forceStop(cfg, repo, number),
      (repo, number) => forceCreatePr(cfg, repo, number),
      (repo, number) => forceResume(cfg, repo, number, true), // onComment: re-engage to address the new message (no PR short-circuit)
      (repo) => forceAudit(cfg, repo),
      (repo, number, title, body) => forceStartWith(cfg, repo, number, title, body),
    );
  } else {
    await backgroundInit(cfg);
    await runOnce(cfg);
  }
}

// Graceful shutdown: on deploy/restart, stop taking new work and let in-flight agent runs
// finish (up to GRACEFUL_SHUTDOWN_MS) instead of killing them mid-build. Pair this with a
// matching `stop_grace_period` in docker-compose so the platform waits before SIGKILL.
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopPool(); // no new dispatches
  killAllApps(); // stop any running preview dev servers + tunnels
  const { running, queued } = poolStatus();
  const graceMs = sNum("graceful_shutdown_ms", "GRACEFUL_SHUTDOWN_MS", 570_000); // ~9.5 min
  console.log(`[agency] ${signal}: draining ${running} running + ${queued} queued (grace ${Math.round(graceMs / 1000)}s)…`);
  await Promise.race([drain(), new Promise((r) => setTimeout(r, graceMs))]);
  console.log("[agency] drained — exiting cleanly.");
  process.exit(0);
}
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

// Resilience: a bad run must never crash the agency (which would restart and loop).
process.on("unhandledRejection", (reason) => console.error("[agency] unhandledRejection:", reason));
process.on("uncaughtException", (err) => console.error("[agency] uncaughtException:", err));

main().catch((err) => {
  console.error("[agency] fatal error during startup:", err);
  process.exitCode = 1;
});
