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
  AWAITING_LABEL,
} from "./github.js";
import { loadHandleRoleMap, roleForText, type RoleName } from "./agents/roles.js";
import { runPipeline } from "./pipeline.js";
import { recordIssueState, getIssueRole } from "./store.js";

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

  // Resuming an issue that was awaiting a human answer? Use its original role.
  const resuming = issue.labels.includes(AWAITING_LABEL);
  const role: RoleName = resuming
    ? ((getIssueRole(repo, issue.number) as RoleName) ?? "developer")
    : roleForText(`${issue.title}\n${issue.body}`, loadHandleRoleMap()) ?? "developer";
  console.log(
    `[agency] ${repo} #${issue.number}: ${issue.title}  ->  role:${role}${resuming ? " (resume)" : ""}`,
  );

  // Move it into the in-progress state.
  await addLabel(repo, issue.number, IN_PROGRESS);
  await removeLabel(repo, issue.number, cfg.queueLabel);
  await removeLabel(repo, issue.number, AWAITING_LABEL);
  recordIssueState(repo, issue.number, { title: issue.title, role, state: IN_PROGRESS });
  if (!resuming) {
    await commentOnIssue(
      repo,
      issue.number,
      `🤖 Picked up (role: **${role}**) on branch \`agency/issue-${issue.number}\`.`,
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
  await runPipeline(cfg, repo, issue, role, workdir, thread);
  return true;
}

/** Process one actionable issue per repo across all watched repos. @returns count handled. */
export async function processAllRepos(cfg: Config): Promise<number> {
  let handled = 0;
  for (const repo of cfg.targetRepos) {
    try {
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
  if (cfg.runMode === "webhook") {
    const { runWebhook } = await import("./webhook.js");
    await runWebhook(cfg, processAllRepos);
  } else if (cfg.runMode === "watch") {
    await runWatch(cfg);
  } else {
    await runOnce(cfg);
  }
}

main().catch((err) => {
  console.error("[agency] fatal error:", err);
  process.exitCode = 1;
});
