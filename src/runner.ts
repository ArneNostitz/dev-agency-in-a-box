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
  addLabel,
  removeLabel,
  commentOnIssue,
  cloneRepo,
  commentThread,
  acknowledge,
  listAgencyPrs,
  listAllOpenIssues,
  listComments,
  AGENCY_MARKER,
  listRecentThreads,
  threadSignals,
  reopenIssue,
  getIssue,
  isNoOpComment,
  findPrForBranch,
  ensureDraftPr,
  createIssue,
  approvedByReaction,
  approveLastProposal,
  commentOnPr,
  prHealth,
  prMergeStatus,
  fetchCheckout,
  mergePrForBranch,
  closeIssue,
  mentionsHandle,
  AWAITING_LABELS,
  type Issue,
} from "./github.js";
import { seedAdmin, resetAdminPassword } from "./auth.js";
import { sNum } from "./settings.js";
import { githubReady, ghUserToken, ghBotToken } from "./creds.js";
import { decideThreadAction } from "./route.js";
import { reconcileEpics } from "./epics.js";
import { indexRepo } from "./gitnexus.js";
import { pushActivity } from "./activity.js";
import { loadHandleRoleMap, roleForText, type RoleName } from "./agents/roles.js";
import { runPipeline, runPrFix, runFollowUp, runResumeBuild, runReviewFix } from "./pipeline.js";
import { runRole } from "./agents/roleAgent.js";
import { parseAuditProposals } from "./auditparse.js";
import {
  recordIssueState,
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
} from "./store.js";
import { parseRateLimit, nextWindowReset } from "./ratelimit.js";
import { startPreviewSweeper, killAllApps } from "./apprun.js";
import { setActive, clearActive, getActive } from "./activity.js";
import { stopRuns } from "./abort.js";
import { dispatch, drain, stop as stopPool, poolStatus, inFlightKeys } from "./pool.js";
import { loadBudget, overBudget, UNLIMITED_LABEL } from "./budget.js";
import { maybeSelfImprove } from "./reflect.js";
import {
  handleControlCommands,
  handleMergeCommands,
  effectiveRepos,
  ensureAllRepoAccess,
  recoverOrphans,
} from "./commands.js";

const IN_PROGRESS = "agency:in-progress";
const READY = "agency:ready";
const NEEDS_ATTENTION = "agency:needs-attention";
const RATE_LIMITED = "agency:rate-limited";
const MAX_AUTOFIX = 2;

// ---- usage-limit handling (pure script — works with zero tokens) ----

/** Pause all NEW agent dispatch until this ms-epoch (persisted so it survives restarts). */
function pausedUntil(): number {
  const t = Date.parse(getSetting("agents_paused_until") ?? "");
  return Number.isFinite(t) ? t : 0;
}
function agentsArePaused(): boolean {
  return Date.now() < pausedUntil();
}
function pauseAgents(untilMs: number): void {
  setSetting("agents_paused_until", new Date(Math.max(pausedUntil(), untilMs)).toISOString());
}
/** Next usage-window reset, honoring a manually-set/just-set anchor. */
function nextResetMs(): number {
  const hours = Number(getSetting("window_hours")) || Number(process.env.SESSION_WINDOW_HOURS?.trim()) || 5;
  return nextWindowReset(Date.now(), hours, getSetting("window_anchor"));
}

/**
 * If `msg` is a usage-limit wall, park the issue to auto-resume after the reset and pause new
 * agent work until then. Returns true if it was handled as a rate-limit (caller skips its
 * normal failure path). No tokens used.
 */
async function maybeParkRateLimited(repo: string, number: number, msg: string, isPr = false): Promise<boolean> {
  const rl = parseRateLimit(msg);
  if (!rl.limited) return false;
  const resetAt = rl.resetAt && rl.resetAt > Date.now() ? rl.resetAt : nextResetMs();
  pauseAgents(resetAt);
  const when = new Date(resetAt).toLocaleString();
  if (isPr) {
    await commentOnPr(repo, number, `⏳ Hit the Claude usage limit — I'll retry automatically after the window resets (~${when}).`).catch(() => {});
  } else {
    setRateLimited(repo, number, new Date(resetAt).toISOString());
    recordIssueState(repo, number, { state: RATE_LIMITED });
    await removeLabel(repo, number, IN_PROGRESS).catch(() => {});
    await addLabel(repo, number, RATE_LIMITED).catch(() => {});
    await commentOnIssue(repo, number, `⏳ Hit the Claude usage limit. I'll **auto-resume** this after the window resets (~${when}) — no action needed.`).catch(() => {});
  }
  console.log(`[agency] rate-limited ${repo} #${number}; auto-resume after ${new Date(resetAt).toISOString()}`);
  return true;
}
/** Don't re-engage closed threads older than this (keeps the scan cheap). DB-first → env → 21. */
const followupWindowDays = (): number => sNum("followup_window_days", "FOLLOWUP_WINDOW_DAYS", 21);
/** An in-progress issue with no live run, idle this long, is treated as an orphan. */
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
async function processIssue(cfg: Config, repo: string, issue: Issue): Promise<void> {
  const resuming = issue.labels.some((l) => AWAITING_LABELS.includes(l));
  const role: RoleName = resuming
    ? ((getIssueRole(repo, issue.number) as RoleName) ?? "developer")
    : roleForText(`${issue.title}\n${issue.body}`, loadHandleRoleMap()) ?? "developer";
  console.log(`[agency] ${repo} #${issue.number}: ${issue.title} -> role:${role}${resuming ? " (resume)" : ""}`);

  // Budget gate: park runaway issues instead of silently burning more.
  if (!issue.labels.includes(UNLIMITED_LABEL)) {
    const reason = overBudget(issueSpend(repo, issue.number), loadBudget());
    if (reason) {
      await addLabel(repo, issue.number, "agency:needs-attention");
      await commentOnIssue(
        repo,
        issue.number,
        `⛔ **Budget exceeded** — this issue has ${reason} across all agent runs. ` +
          `To continue anyway, add the \`${UNLIMITED_LABEL}\` label and remove \`agency:needs-attention\`, then re-pin. ` +
          `Or split the work into smaller issues.`,
      );
      recordIssueState(repo, issue.number, { state: "agency:needs-attention" });
      console.log(`[agency] ${repo} #${issue.number}: over budget (${reason}) — parked.`);
      return;
    }
  }

  await addLabel(repo, issue.number, IN_PROGRESS);
  await removeLabel(repo, issue.number, cfg.queueLabel);
  for (const l of AWAITING_LABELS) await removeLabel(repo, issue.number, l);
  recordIssueState(repo, issue.number, { title: issue.title, role, state: IN_PROGRESS });
  await acknowledge(repo, issue.number); // 👀 on your last comment (or the issue)
  if (!resuming) {
    await commentOnIssue(repo, issue.number, `🏗️ On it (role: **${role}**) — branch \`agency/issue-${issue.number}\`.`);
  }

  const thread = await commentThread(repo, issue.number);
  const workdir = workdirFor(repo, `${issue.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(workdir, ".."), { recursive: true });
  await cloneRepo(repo, workdir);
  await indexRepo(workdir, repo, (s) => pushActivity(repo, issue.number, role, "tool", s));

  setActive(repo, issue.number, "issue", role, issue.title);
  try {
    await runPipeline(cfg, repo, issue, role, workdir, thread);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] pipeline error ${repo} #${issue.number}:`, msg);
    if (await maybeParkRateLimited(repo, issue.number, msg)) return;
    await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
    await addLabel(repo, issue.number, NEEDS_ATTENTION).catch(() => {});
    await addLabel(repo, issue.number, "🚧 blocked").catch(() => {});
    recordIssueState(repo, issue.number, { state: NEEDS_ATTENTION });
    await commentOnIssue(repo, issue.number, `❌ Run failed: ${msg.slice(0, 300)} — fix and re-pin.`).catch(() => {});
  } finally {
    clearActive(repo, issue.number);
  }
}

/** Apply review feedback (@dev/@fix) left on a PR. */
async function processPrFeedbackOne(
  repo: string,
  pr: { number: number; title: string; branch: string; issueNumber: number },
  thread: string,
): Promise<void> {
  await acknowledge(repo, pr.number);
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
    if (await maybeParkRateLimited(repo, pr.number, msg, true)) return;
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

  const instruction =
    health.status === "conflict"
      ? `[system] This PR has merge conflicts. Check out the branch, merge the latest base branch (origin/main), resolve ALL conflicts, run the project's checks, commit, and push.`
      : `[system] The PR's CI checks are failing. Run the project's checks locally, find and fix the failures (and anything blocking the tests), commit, and push.`;

  console.log(`[agency] auto-heal ${repo} PR#${pr.number}: ${health.detail} (attempt ${attempts + 1})`);
  await acknowledge(repo, pr.number);
  const workdir = workdirFor(repo, `pr-${pr.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(workdir, ".."), { recursive: true });
  await cloneRepo(repo, workdir);
  await indexRepo(workdir, repo, (s) => pushActivity(repo, pr.number, "developer", "tool", s));
  setActive(repo, pr.number, "pr", "developer", pr.title);
  try {
    await runPrFix(repo, pr.issueNumber, pr.number, pr.branch, workdir, instruction);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] auto-heal error ${repo} PR#${pr.number}:`, msg);
    if (await maybeParkRateLimited(repo, pr.number, msg, true)) return;
    await commentOnPr(repo, pr.number, `❌ Auto-heal failed: ${msg.slice(0, 300)}`).catch(() => {});
  } finally {
    clearActive(repo, pr.number);
  }
}

/** Re-engage a thread the agency already delivered (often after a merge): build a fix PR. */
async function processFollowUp(cfg: Config, repo: string, issue: Issue): Promise<void> {
  console.log(`[agency] ${repo} #${issue.number}: follow-up on a new comment`);
  await reopenIssue(repo, issue.number); // no-op if already open
  await addLabel(repo, issue.number, IN_PROGRESS);
  for (const l of [READY, NEEDS_ATTENTION, "🚧 blocked", ...AWAITING_LABELS]) {
    await removeLabel(repo, issue.number, l);
  }
  recordIssueState(repo, issue.number, { title: issue.title, role: "developer", state: IN_PROGRESS });
  await acknowledge(repo, issue.number);

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
    if (await maybeParkRateLimited(repo, issue.number, msg)) return;
    await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
    await addLabel(repo, issue.number, NEEDS_ATTENTION).catch(() => {});
    await addLabel(repo, issue.number, "🚧 blocked").catch(() => {});
    recordIssueState(repo, issue.number, { state: NEEDS_ATTENTION });
    await commentOnIssue(repo, issue.number, `❌ Follow-up failed: ${msg.slice(0, 300)} — comment again to retry.`).catch(() => {});
  } finally {
    clearActive(repo, issue.number);
  }
}

/**
 * Manual "Resume" from the dashboard: unstick an issue no matter what state it's in (orphaned
 * in-progress, parked needs-attention, blocked, or just quiet) and re-run it. Clears the agency
 * labels + any zombie active entry, then re-dispatches the pipeline.
 */
export async function forceResume(cfg: Config, repo: string, number: number, addressComment = false): Promise<void> {
  const issue = await getIssue(repo, number);
  if (!issue) return;
  // Don't let a manual Resume hammer the usage wall — it'll auto-resume after the reset.
  if (agentsArePaused()) {
    const until = new Date(pausedUntil()).toLocaleString();
    setRateLimited(repo, number, new Date(pausedUntil()).toISOString());
    recordIssueState(repo, number, { state: RATE_LIMITED });
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
  // When the human left a steering comment (addressComment), DON'T short-circuit — re-engage so the
  // agent addresses it, even if a PR exists. Only the plain Resume button / auto-resume short-circuits.
  const prBranch = `agency/issue-${number}`;
  const existingPr = addressComment ? null : await findPrForBranch(repo, prBranch).catch(() => null);
  if (existingPr) {
    recordPr(repo, number, existingPr.number, existingPr.url);
    const review = getReview(repo, number);
    for (const l of [IN_PROGRESS, NEEDS_ATTENTION, "🚧 blocked", ...AWAITING_LABELS]) await removeLabel(repo, number, l).catch(() => {});
    clearActive(repo, number);
    if (review?.verdict === "changes") {
      await commentOnIssue(repo, number, `🔧 PR ${existingPr.url} is already open with requested changes — addressing the review on the existing branch (not rebuilding).`).catch(() => {});
      console.log(`[agency] resume → existing PR ${existingPr.url}, has changes → fix`);
      return forceFix(cfg, repo, number);
    }
    await addLabel(repo, number, READY).catch(() => {});
    recordIssueState(repo, number, { state: READY });
    await commentOnIssue(repo, number, `✅ PR ${existingPr.url} is already open${review?.verdict === "approved" ? " and approved" : ""} — nothing to rebuild. Press **Merge** on the dashboard.`).catch(() => {});
    console.log(`[agency] resume → existing PR ${existingPr.url}; routed to READY (no rerun)`);
    return;
  }
  await reopenIssue(repo, number).catch(() => {});
  for (const l of [IN_PROGRESS, NEEDS_ATTENTION, "🚧 blocked", ...AWAITING_LABELS]) {
    await removeLabel(repo, number, l).catch(() => {});
  }
  setThreadCursor(repo, number, 0); // let any prior comment count again
  clearActive(repo, number); // drop a zombie "working" entry if a run died
  const fresh: Issue = { ...issue, labels: issue.labels.filter((l) => !l.startsWith("agency:")) };
  // If a plan already exists, skip the (Opus) planner and resume the build from the branch —
  // otherwise run the full pipeline (the planner resumes its own session if it was interrupted).
  if (lastPlan(repo, number)) {
    console.log(`[agency] resume (build) ${repo} #${number}`);
    dispatch(`${repo}#${number}`, () => processResume(cfg, repo, fresh));
  } else {
    console.log(`[agency] resume (full) ${repo} #${number}`);
    dispatch(`${repo}#${number}`, () => processIssue(cfg, repo, fresh));
  }
}

/** Worker: resume a build (plan already exists) — continue the branch, don't redo finished work. */
async function processResume(cfg: Config, repo: string, issue: Issue): Promise<void> {
  void cfg;
  await addLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
  recordIssueState(repo, issue.number, { title: issue.title, role: "developer", state: IN_PROGRESS });
  await acknowledge(repo, issue.number);
  const thread = await commentThread(repo, issue.number);
  const workdir = workdirFor(repo, `${issue.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(workdir, ".."), { recursive: true });
  await cloneRepo(repo, workdir);
  await indexRepo(workdir, repo, (s) => pushActivity(repo, issue.number, "developer", "tool", s));
  setActive(repo, issue.number, "issue", "developer", issue.title);
  try {
    await runResumeBuild(repo, issue, workdir, thread);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] resume error ${repo} #${issue.number}:`, msg);
    if (await maybeParkRateLimited(repo, issue.number, msg)) return;
    await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
    await addLabel(repo, issue.number, NEEDS_ATTENTION).catch(() => {});
    recordIssueState(repo, issue.number, { state: NEEDS_ATTENTION });
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
    setRateLimited(repo, number, new Date(pausedUntil()).toISOString());
    recordIssueState(repo, number, { state: RATE_LIMITED });
    await addLabel(repo, number, RATE_LIMITED).catch(() => {});
    await commentOnIssue(repo, number, `⏳ Rate-limited — I'll run the fix automatically after the usage window resets (~${new Date(pausedUntil()).toLocaleString()}).`).catch(() => {});
    return;
  }
  const branch = `agency/issue-${number}`;
  const ms = await prMergeStatus(repo, branch).catch(() => null);
  const conflict = ms?.mergeable === "conflict";
  for (const l of [READY, NEEDS_ATTENTION, "🚧 blocked", ...AWAITING_LABELS]) await removeLabel(repo, number, l).catch(() => {});
  await addLabel(repo, number, IN_PROGRESS).catch(() => {});
  recordIssueState(repo, number, { state: IN_PROGRESS });
  console.log(`[agency] fix ${repo} #${number} (conflict=${conflict})`);
  dispatch(`${repo}#${number}`, () => processFix(cfg, repo, issue, conflict));
}

/** Worker: run the review-fix pipeline on the PR's existing branch. */
async function processFix(cfg: Config, repo: string, issue: Issue, conflict: boolean): Promise<void> {
  void cfg;
  await addLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
  recordIssueState(repo, issue.number, { title: issue.title, role: "developer", state: IN_PROGRESS });
  await acknowledge(repo, issue.number).catch(() => {});
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
    if (await maybeParkRateLimited(repo, issue.number, msg)) return;
    await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
    await addLabel(repo, issue.number, NEEDS_ATTENTION).catch(() => {});
    recordIssueState(repo, issue.number, { state: NEEDS_ATTENTION });
    await commentOnIssue(repo, issue.number, `❌ Fix run failed: ${msg.slice(0, 300)} — press Fix again.`).catch(() => {});
  } finally {
    clearActive(repo, issue.number);
  }
}

/**
 * Play button: start a Planned issue now. Drops the planned hold, then runs the full pipeline
 * (planner → … ). If we're inside the usage-limit window, queue it to auto-resume after the reset.
 */
export async function forceStart(cfg: Config, repo: string, number: number): Promise<void> {
  const issue = await getIssue(repo, number);
  if (!issue) return;
  await removeLabel(repo, number, "agency:planned").catch(() => {});
  if (agentsArePaused()) {
    setRateLimited(repo, number, new Date(pausedUntil()).toISOString());
    recordIssueState(repo, number, { state: RATE_LIMITED });
    await addLabel(repo, number, RATE_LIMITED).catch(() => {});
    await commentOnIssue(repo, number, `⏳ Rate-limited — I'll start this automatically after the usage window resets (~${new Date(pausedUntil()).toLocaleString()}).`).catch(() => {});
    return;
  }
  await addLabel(repo, number, IN_PROGRESS).catch(() => {});
  recordIssueState(repo, number, { title: issue.title, state: IN_PROGRESS });
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
  await approveLastProposal(repo, number).catch(() => {});
  for (const l of AWAITING_LABELS) await removeLabel(repo, number, l).catch(() => {});
  // Approving during the usage-limit window: queue the build for auto-resume after the reset
  // (so you can approve anytime, even rate-limited).
  if (agentsArePaused()) {
    setRateLimited(repo, number, new Date(pausedUntil()).toISOString());
    recordIssueState(repo, number, { state: RATE_LIMITED });
    await addLabel(repo, number, RATE_LIMITED).catch(() => {});
    await commentOnIssue(
      repo,
      number,
      `👍 Approved — I'll build it automatically after the usage window resets (~${new Date(pausedUntil()).toLocaleString()}).`,
    ).catch(() => {});
    console.log(`[agency] approve queued (rate-limited) ${repo} #${number}`);
    return;
  }
  // Instant UI: show it as working even if the pool is at capacity (it'll be queued).
  await addLabel(repo, number, IN_PROGRESS).catch(() => {});
  recordIssueState(repo, number, { state: IN_PROGRESS });
  console.log(`[agency] approve+build ${repo} #${number}`);
  dispatch(`${repo}#${number}`, () => processIssue(cfg, repo, issue));
}

/**
 * Dashboard "Stop": abort any in-flight agent runs for the issue, turn off its auto-resume/merge,
 * and park it back in Planned. The sweeper skips Planned, so nothing restarts it — no further AI
 * interaction until the user presses ▶ again.
 */
export async function forceStop(_cfg: Config, repo: string, number: number): Promise<void> {
  const aborted = stopRuns(repo, number); // abort the live SDK subprocess(es)
  clearActive(repo, number);
  if (number === 0) {
    // The codebase Auditor runs under the sentinel #0 — there's no GitHub issue/labels to touch.
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
    for (const l of [IN_PROGRESS, NEEDS_ATTENTION, RATE_LIMITED, "🚧 blocked", ...AWAITING_LABELS]) await removeLabel(repo, number, l).catch(() => {});
    await addLabel(repo, number, READY).catch(() => {});
    recordIssueState(repo, number, { state: READY });
    clearRateLimited(repo, number);
    await commentOnIssue(repo, number, `⏹ Stopped${abortedNote}. PR ${existingPr.url} is open — press **Merge** when you're ready.`).catch(() => {});
    console.log(`[agency] stop ${repo} #${number} → kept PR ${existingPr.url} (Review)`);
    return;
  }
  setAuto("resume", "off", repo, number);
  setAuto("merge", "off", repo, number);
  for (const l of [IN_PROGRESS, READY, NEEDS_ATTENTION, RATE_LIMITED, "🚧 blocked", ...AWAITING_LABELS]) {
    await removeLabel(repo, number, l).catch(() => {});
  }
  await addLabel(repo, number, "agency:planned").catch(() => {});
  recordIssueState(repo, number, { state: "planned" });
  clearRateLimited(repo, number);
  await commentOnIssue(
    repo,
    number,
    `⏹ Stopped${abortedNote} — moved back to **Planned**. Press ▶ to start it again.`,
  ).catch(() => {});
  console.log(`[agency] stop ${repo} #${number} (${aborted} aborted)`);
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
  for (const l of [IN_PROGRESS, NEEDS_ATTENTION, "🚧 blocked", ...AWAITING_LABELS]) await removeLabel(repo, number, l).catch(() => {});
  await addLabel(repo, number, READY).catch(() => {});
  recordIssueState(repo, number, { state: READY });
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

/**
 * Manual "Audit now": the independent codebase Auditor. Clones the repo, runs Graphify + the auditor
 * agent (whole-codebase health review), and opens up to 5 scoped refactor/cleanup issues in Planned —
 * authored as YOU (owner token). Advisory only: never changes code, opens PRs, or blocks anything.
 */
export async function forceAudit(_cfg: Config, repo: string): Promise<void> {
  dispatch(`${repo}#audit`, async () => {
    const workdir = workdirFor(repo, "audit");
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
    setActive(repo, 0, "issue", "auditor", `Audit ${repo}`);
    pushActivity(repo, 0, "auditor", "start", `🔎 auditing ${repo} — building the codebase graph…`);
    try {
      await cloneRepo(repo, workdir);
      const res = await runRole("auditor", { task: AUDIT_TASK, workdir, repo, issueNumber: 0 });
      const proposals = parseAuditProposals(res.text).slice(0, 5);
      if (!proposals.length) {
        pushActivity(repo, 0, "auditor", "done", "✅ audit complete — no issues proposed (codebase looks healthy).");
        return;
      }
      const owner = ghUserToken() || ghBotToken();
      const created: string[] = [];
      for (const p of proposals) {
        const issue = await createIssue(
          repo,
          p.title.slice(0, 250),
          `${p.body}\n\n— _opened by the Dev Agency **Auditor** (codebase health review). Review, then ▶ Start to build it._`,
          owner,
        ).catch(() => null);
        if (!issue || !issue.number) continue;
        await addLabel(repo, issue.number, "agency:planned").catch(() => {});
        await addLabel(repo, issue.number, "agency:audit").catch(() => {});
        recordIssueState(repo, issue.number, { title: p.title, state: "planned" });
        created.push(`#${issue.number}`);
      }
      pushActivity(repo, 0, "auditor", "done", `✅ audit complete — opened ${created.length} issue(s) in Planned: ${created.join(", ")}`);
      console.log(`[agency] audit ${repo}: opened ${created.length} issue(s): ${created.join(", ")}`);
    } catch (err) {
      pushActivity(repo, 0, "auditor", "done", `❌ audit failed: ${(err as Error).message.slice(0, 200)}`);
      console.error(`[agency] audit ${repo} failed:`, (err as Error).message);
    } finally {
      clearActive(repo, 0);
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
  // re-engages it (open or closed, no re-tag); untouched issues need the configured trigger.
  const LIVE_LABELS = [IN_PROGRESS, READY, NEEDS_ATTENTION, ...AWAITING_LABELS];
  const threads = await listRecentThreads(repo);
  const threadMap = new Map(threads.map((t) => [t.number, t]));
  for (const t of threads) {
    if (t.labels.includes(cfg.ignoreLabel)) continue;
    if (t.labels.includes("agency:planned")) continue; // parked in Planned — waits for the play button

    // Backstop for PRs merged/closed on GitHub directly: a closed thread that still carries a
    // live agency label is finished — record it terminal and strip the labels (once).
    if (t.closed) {
      const had = t.labels.filter((l) => LIVE_LABELS.includes(l));
      if (had.length) {
        recordIssueState(repo, t.number, { title: t.title, state: "merged" });
        for (const l of had) await removeLabel(repo, t.number, l).catch(() => {});
        t.labels = t.labels.filter((l) => !LIVE_LABELS.includes(l));
      }
    }

    if (t.labels.includes(IN_PROGRESS)) continue; // being handled (or swept below if stale)
    if (t.closed && !recentEnough(t.updatedAt)) continue; // ignore stale closed threads

    const ownedByLabel = t.labels.some((l) => l.startsWith("agency:"));
    const awaiting = t.labels.some((l) => AWAITING_LABELS.includes(l));
    const triggerMatch =
      cfg.triggerMode === "label"
        ? t.labels.includes(cfg.queueLabel)
        : cfg.triggerMode === "any"
          ? !t.closed
          : mentionsHandle(`${t.title}\n${t.body}`, cfg.handles);

    // Only inspect comments when it can matter (owned, has comments, or paused).
    let owned = ownedByLabel;
    let newHumanComment = false;
    let approvedReaction = false;
    let lastCommentId = 0;
    if (ownedByLabel || awaiting || t.comments > 0) {
      const sig = await threadSignals(repo, t.number);
      owned = owned || sig.agencyEverCommented;
      lastCommentId = sig.lastCommentId;
      newHumanComment = sig.lastIsHuman && sig.lastCommentId > getThreadCursor(repo, t.number);
      if (awaiting && !newHumanComment) approvedReaction = await approvedByReaction(repo, t.number);
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
      ready: t.labels.includes(READY),
      needsAttention: t.labels.includes(NEEDS_ATTENTION),
      awaiting,
      owned,
      newHumanComment,
      approvedReaction,
      hasOpenPr: Boolean(openPr),
      triggerMatch,
    });
    if (action === "skip") {
      // Surface untouched, still-open issues on the board as "Planned" (a play button starts them);
      // never auto-start them. Touched/owned threads keep their real state.
      if (!owned && !t.closed && recentEnough(t.updatedAt)) {
        recordIssueState(repo, t.number, { title: t.title, state: "planned" });
      }
      continue;
    }
    if (paused) continue; // usage-limit wall — leave it; it resumes after the reset

    const issue: Issue = { number: t.number, title: t.title, body: t.body, labels: t.labels };
    // Mark this comment handled now so re-polls during the run don't double-fire.
    if (newHumanComment) setThreadCursor(repo, t.number, lastCommentId);

    if (action === "prfix" && openPr) {
      const thread = await commentThread(repo, t.number);
      const pr = { number: openPr.number, title: t.title, branch: `agency/issue-${t.number}`, issueNumber: t.number };
      dispatch(`${repo}#pr-${pr.number}`, () => processPrFeedbackOne(repo, pr, thread));
    } else if (action === "followup") {
      dispatch(`${repo}#${t.number}`, () => processFollowUp(cfg, repo, issue));
    } else {
      // fresh or resume — processIssue picks the role and sorts approve/answer/change.
      dispatch(`${repo}#${t.number}`, () => processIssue(cfg, repo, issue));
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
 * working on, idle past the grace window, is parked to needs-attention (in the DB *and* on
 * GitHub). This is what stops a card sitting in "Working" forever after an interrupted run —
 * the dashboard reads stored state, so the stored state must reflect reality.
 */
async function sweepStuck(): Promise<void> {
  for (const i of recentIssues(100)) {
    if (i.state !== "agency:in-progress") continue;
    const running = getActive().some((a) => a.repo === i.repo && a.number === i.number);
    const idleMs = i.updated_at ? Date.now() - new Date(i.updated_at).getTime() : Infinity;
    if (running || idleMs <= ORPHAN_GRACE_MS) continue;
    recordIssueState(i.repo, i.number, { state: NEEDS_ATTENTION });
    await removeLabel(i.repo, i.number, IN_PROGRESS).catch(() => {});
    await addLabel(i.repo, i.number, NEEDS_ATTENTION).catch(() => {});
    await commentOnIssue(
      i.repo,
      i.number,
      "⏸ This looked stuck — a run was interrupted with nothing now working on it. Moved to needs-attention. Press **Resume** on the dashboard (or re-pin) to retry.",
    ).catch(() => {});
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
        if (!issue.labels.includes(NEEDS_ATTENTION)) continue;
        if (issue.labels.includes(RATE_LIMITED)) continue;
        const comments = await listComments(repo, issue.number).catch(() => [] as Array<{ body: string }>);
        // Only trust an agency-authored failure note as the rate-limit signal.
        const hit = comments
          .slice(-6)
          .reverse()
          .find((c) => c.body.includes(AGENCY_MARKER) && parseRateLimit(c.body).limited);
        if (!hit) continue;
        const rl = parseRateLimit(hit.body);
        const at = rl.resetAt && rl.resetAt > Date.now() ? rl.resetAt : nextResetMs();
        setRateLimited(repo, issue.number, new Date(at).toISOString());
        recordIssueState(repo, issue.number, { state: RATE_LIMITED });
        await removeLabel(repo, issue.number, NEEDS_ATTENTION).catch(() => {});
        await removeLabel(repo, issue.number, "🚧 blocked").catch(() => {});
        await addLabel(repo, issue.number, RATE_LIMITED).catch(() => {});
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
 * Pure-script auto-resume: every minute, re-run any issue whose usage-limit reset time has
 * passed, and lift the global pause once it's over. No agent/AI calls — works with zero tokens.
 */
function startAutoResume(cfg: Config): void {
  setInterval(() => {
    if (shuttingDown) return;
    try {
      const due = dueRateLimited(new Date().toISOString());
      for (const r of due) {
        clearRateLimited(r.repo, r.number);
        console.log(`[agency] auto-resume after usage reset: ${r.repo} #${r.number}`);
        void forceResume(cfg, r.repo, r.number);
      }
      if (pausedUntil() && Date.now() >= pausedUntil()) {
        setSetting("agents_paused_until", ""); // window reset — accept new work again
        console.log("[agency] usage window reset — resuming normal operation.");
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
              await closeIssue(repo, n, `🤖 **Auto-merged** ${r.msg} — review approved, no conflicts, checks green.`).catch(() => {});
              recordIssueState(repo, n, { state: "merged" });
              clearReview(repo, n);
              resetAutoAttempts(repo, n);
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
          if (!i.labels.includes(NEEDS_ATTENTION) || i.labels.includes(RATE_LIMITED)) continue;
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
