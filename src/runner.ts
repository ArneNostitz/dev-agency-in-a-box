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
  listActionableIssues,
  addLabel,
  removeLabel,
  commentOnIssue,
  cloneRepo,
  commentThread,
  acknowledge,
  listAgencyPrs,
  commentThreadByNumber,
  commentOnPr,
  prHealth,
  mentionsHandle,
  AWAITING_LABELS,
  type Issue,
} from "./github.js";
import { loadHandleRoleMap, roleForText, type RoleName } from "./agents/roles.js";
import { runPipeline, runPrFix } from "./pipeline.js";
import { recordIssueState, getIssueRole, getAutofixCount, incAutofix, resetAutofix } from "./store.js";
import { setActive, clearActive } from "./activity.js";
import { dispatch, drain } from "./pool.js";
import {
  handleControlCommands,
  handleMergeCommands,
  effectiveRepos,
  ensureAllRepoAccess,
  recoverOrphans,
} from "./commands.js";

const IN_PROGRESS = "agency:in-progress";
const MAX_AUTOFIX = 2;
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

  setActive(repo, issue.number, "issue", role);
  try {
    await runPipeline(cfg, repo, issue, role, workdir, thread);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] pipeline error ${repo} #${issue.number}:`, msg);
    await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
    await addLabel(repo, issue.number, "agency:needs-attention").catch(() => {});
    await addLabel(repo, issue.number, "🚧 blocked").catch(() => {});
    await commentOnIssue(repo, issue.number, `❌ Run failed: ${msg.slice(0, 300)} — fix and re-pin.`).catch(() => {});
  } finally {
    clearActive(repo, issue.number);
  }
}

/** Apply review feedback (@dev/@fix) left on a PR. */
async function processPrFeedbackOne(repo: string, pr: { number: number; branch: string; issueNumber: number }, thread: string): Promise<void> {
  await acknowledge(repo, pr.number);
  const workdir = workdirFor(repo, `pr-${pr.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(workdir, ".."), { recursive: true });
  await cloneRepo(repo, workdir);
  setActive(repo, pr.number, "pr", "developer");
  try {
    await runPrFix(repo, pr.issueNumber, pr.number, pr.branch, workdir, thread);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] pr-fix error ${repo} PR#${pr.number}:`, msg);
    await commentOnPr(repo, pr.number, `❌ Couldn't apply the fix: ${msg.slice(0, 300)}`).catch(() => {});
  } finally {
    clearActive(repo, pr.number);
  }
}

/** Self-heal one PR (merge conflict / failing CI), bounded by MAX_AUTOFIX. */
async function processHealOne(repo: string, pr: { number: number; branch: string; issueNumber: number }): Promise<void> {
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
  setActive(repo, pr.number, "pr", "developer");
  try {
    await runPrFix(repo, pr.issueNumber, pr.number, pr.branch, workdir, instruction);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] auto-heal error ${repo} PR#${pr.number}:`, msg);
    await commentOnPr(repo, pr.number, `❌ Auto-heal failed: ${msg.slice(0, 300)}`).catch(() => {});
  } finally {
    clearActive(repo, pr.number);
  }
}

// ---- scan + dispatch ----

/** Scan one repo and dispatch all eligible work to the pool (deduped by key). */
async function scanRepo(cfg: Config, repo: string): Promise<void> {
  // Quick management commands first (no agent runs).
  await handleControlCommands(cfg, repo);
  await handleMergeCommands(cfg, repo);

  // Actionable issues.
  const issues = await listActionableIssues(repo, {
    triggerMode: cfg.triggerMode,
    handles: cfg.handles,
    queueLabel: cfg.queueLabel,
    ignoreLabel: cfg.ignoreLabel,
  });
  for (const issue of issues) {
    dispatch(`${repo}#${issue.number}`, () => processIssue(cfg, repo, issue));
  }

  // Agency PRs: review feedback takes priority over auto-heal.
  for (const pr of await listAgencyPrs(repo)) {
    const { thread, lastHumanBody } = await commentThreadByNumber(repo, pr.number);
    if (lastHumanBody && mentionsHandle(lastHumanBody, ["@dev", "@fix"])) {
      dispatch(`${repo}#pr-${pr.number}`, () => processPrFeedbackOne(repo, pr, thread));
      continue;
    }
    if (getAutofixCount(repo, pr.number) > MAX_AUTOFIX) continue; // already gave up
    const health = await prHealth(repo, pr.number);
    if (health.status === "failing" || health.status === "conflict") {
      dispatch(`${repo}#pr-${pr.number}`, () => processHealOne(repo, pr));
    } else if (health.status === "ok") {
      resetAutofix(repo, pr.number);
    }
  }
}

/** Scan every watched repo and dispatch work. Returns immediately; the pool runs it. */
export async function processAllRepos(cfg: Config): Promise<number> {
  for (const repo of effectiveRepos(cfg)) {
    try {
      await scanRepo(cfg, repo);
    } catch (err) {
      console.error(`[agency] scan error on ${repo} (continuing):`, (err as Error).message);
    }
  }
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

async function main(): Promise<void> {
  const cfg = loadConfig();
  await ensureAllRepoAccess(cfg);
  await recoverOrphans(cfg);
  if (cfg.runMode === "webhook") {
    const { runWebhook } = await import("./webhook.js");
    await runWebhook(cfg, processAllRepos);
  } else if (cfg.runMode === "watch") {
    await runWatch(cfg);
  } else {
    await runOnce(cfg);
  }
}

// Resilience: a bad run must never crash the agency (which would restart and loop).
process.on("unhandledRejection", (reason) => console.error("[agency] unhandledRejection:", reason));
process.on("uncaughtException", (err) => console.error("[agency] uncaughtException:", err));

main().catch((err) => {
  console.error("[agency] fatal error during startup:", err);
  process.exitCode = 1;
});
