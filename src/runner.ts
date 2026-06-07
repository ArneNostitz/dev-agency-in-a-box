/**
 * Runner: pick up queued GitHub issues and drive each to a linked PR using a
 * single Developer agent. This proves the issue -> branch -> PR -> comment loop
 * before we add the orchestrator and the rest of the roster in later phases.
 *
 * Two modes (set via RUN_MODE):
 *   once   - process at most one queued issue, then exit (good for cron/launchd)
 *   watch  - loop forever, polling every POLL_INTERVAL_SECONDS (good for a
 *            long-running container, e.g. on Coolify)
 *
 * Local: npm run dev      Container: node dist/runner.js  (RUN_MODE=watch)
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
  reactToIssue,
  listAgencyPrs,
  commentThreadByNumber,
  mentionsHandle,
  AWAITING_LABELS,
} from "./github.js";
import { loadHandleRoleMap, roleForText, type RoleName } from "./agents/roles.js";
import { runPipeline, runPrFix } from "./pipeline.js";
import { recordIssueState, getIssueRole } from "./store.js";
import {
  handleControlCommands,
  handleMergeCommands,
  effectiveRepos,
  ensureAllRepoAccess,
  recoverOrphans,
} from "./commands.js";

const IN_PROGRESS = "agency:in-progress";
const LOCK_PATH = join(process.cwd(), ".agency.lock");

/** Prevent overlapping `once` runs (e.g. when a scheduler fires before we finish). */
function acquireLock(): boolean {
  if (existsSync(LOCK_PATH)) {
    const pid = Number(readFileSync(LOCK_PATH, "utf8").trim());
    try {
      process.kill(pid, 0);
      return false; // still running
    } catch {
      /* stale lock, fall through */
    }
  }
  writeFileSync(LOCK_PATH, String(process.pid));
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Process at most one actionable issue in `repo` end to end.
 * @returns true if an issue was picked up, false if there was nothing to do.
 */
async function processOneIssue(cfg: Config, repo: string): Promise<boolean> {
  const actionable = await listActionableIssues(repo, {
    triggerMode: cfg.triggerMode,
    handles: cfg.handles,
    queueLabel: cfg.queueLabel,
    ignoreLabel: cfg.ignoreLabel,
  });
  if (actionable.length === 0) return false;

  const issue = actionable[0];

  // Resuming an issue that was paused waiting on the human? Use its original role.
  const resuming = issue.labels.some((l) => AWAITING_LABELS.includes(l));
  const role: RoleName = resuming
    ? ((getIssueRole(repo, issue.number) as RoleName) ?? "developer")
    : roleForText(`${issue.title}\n${issue.body}`, loadHandleRoleMap()) ?? "developer";
  console.log(
    `[agency] ${repo} #${issue.number}: ${issue.title}  ->  role:${role}${resuming ? " (resume)" : ""}`,
  );

  // Move it into the in-progress state. (The pipeline reads issue.labels — the local
  // snapshot still reflects the prior awaiting state — to decide propose vs build.)
  await addLabel(repo, issue.number, IN_PROGRESS);
  await removeLabel(repo, issue.number, cfg.queueLabel);
  for (const l of AWAITING_LABELS) await removeLabel(repo, issue.number, l);
  recordIssueState(repo, issue.number, { title: issue.title, role, state: IN_PROGRESS });
  // Instant visual "I'm on it" (👀 — GitHub has no 🏗️ reaction; the dashboard shows live build).
  await reactToIssue(repo, issue.number, "eyes");
  if (!resuming) {
    await commentOnIssue(
      repo,
      issue.number,
      `🏗️ On it (role: **${role}**) — working on branch \`agency/issue-${issue.number}\`.`,
    );
  }

  // The whole conversation so far (the human's request + any Q&A) feeds the Planner.
  const thread = await commentThread(repo, issue.number);

  // Fresh working copy (namespaced per repo to avoid collisions).
  const safeRepo = repo.replace("/", "__");
  const workdir = join(process.cwd(), ".work", safeRepo, `${issue.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(process.cwd(), ".work", safeRepo), { recursive: true });
  console.log(`[agency] cloning ${repo} into ${workdir}...`);
  await cloneRepo(repo, workdir);

  // The orchestrator runs the right specialists and finalizes the issue.
  try {
    await runPipeline(cfg, repo, issue, role, workdir, thread);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[agency] pipeline error ${repo} #${issue.number}:`, msg);
    await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
    await addLabel(repo, issue.number, "agency:needs-attention").catch(() => {});
    await addLabel(repo, issue.number, "🚧 blocked").catch(() => {});
    await commentOnIssue(repo, issue.number, `❌ Run failed: ${msg.slice(0, 300)} — fix and re-pin.`).catch(
      () => {},
    );
  }
  return true;
}

/** Re-engage the developer on any agency PR whose latest comment is @dev/@fix feedback. */
async function processPrFeedback(cfg: Config, repo: string): Promise<void> {
  for (const pr of await listAgencyPrs(repo)) {
    const { thread, lastHumanBody } = await commentThreadByNumber(repo, pr.number);
    if (!lastHumanBody || !mentionsHandle(lastHumanBody, ["@dev", "@fix"])) continue;

    const safeRepo = repo.replace("/", "__");
    const workdir = join(process.cwd(), ".work", safeRepo, `pr-${pr.number}`);
    await rm(workdir, { recursive: true, force: true });
    await mkdir(join(process.cwd(), ".work", safeRepo), { recursive: true });
    console.log(`[agency] PR feedback ${repo} PR#${pr.number} (issue #${pr.issueNumber}) -> developer fix`);
    await reactToIssue(repo, pr.number, "eyes");
    await cloneRepo(repo, workdir);
    try {
      await runPrFix(repo, pr.issueNumber, pr.number, pr.branch, workdir, thread);
    } catch (err) {
      console.error(`[agency] pr-fix error ${repo} PR#${pr.number}:`, (err as Error).message);
    }
  }
}

/** Handle control commands + process actionable issues across all watched repos. */
export async function processAllRepos(cfg: Config): Promise<number> {
  let handled = 0;
  for (const repo of effectiveRepos(cfg)) {
    try {
      // First honor control commands (/add-repo, /list-repos) and /merge requests.
      await handleControlCommands(cfg, repo);
      await handleMergeCommands(cfg, repo);
      // Address any @dev/@fix feedback left on agency PRs.
      await processPrFeedback(cfg, repo);
      // Drain this repo (one issue at a time) until nothing's actionable.
      while (await processOneIssue(cfg, repo)) handled += 1;
    } catch (err) {
      console.error(`[agency] error on ${repo} (continuing):`, (err as Error).message);
    }
  }
  return handled;
}

async function runOnce(cfg: Config): Promise<void> {
  if (!acquireLock()) {
    console.log("[agency] another run is already in progress; exiting.");
    return;
  }
  try {
    const handled = await processAllRepos(cfg);
    if (handled === 0) console.log("[agency] nothing to do.");
  } finally {
    await unlink(LOCK_PATH).catch(() => {});
  }
}

async function runWatch(cfg: Config): Promise<void> {
  console.log(`[agency] mode: watch (every ${cfg.pollIntervalSeconds}s)`);
  // Single long-running process => sequential loop, no lock needed.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const handled = await processAllRepos(cfg);
    if (handled === 0) {
      await sleep(cfg.pollIntervalSeconds * 1000);
    }
    // If work was done, loop immediately to catch anything new.
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  // Make sure the bot can operate everywhere it watches (invite as collaborator,
  // register webhooks) before we start doing work.
  await ensureAllRepoAccess(cfg);
  // Re-queue anything a previous restart left stranded mid-run.
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

// Resilience: one bad agent run must never crash the whole agency (which would otherwise
// restart and re-pick work, looping). Log and keep serving.
process.on("unhandledRejection", (reason) => {
  console.error("[agency] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[agency] uncaughtException:", err);
});

main().catch((err) => {
  console.error("[agency] fatal error during startup:", err);
  process.exitCode = 1;
});
