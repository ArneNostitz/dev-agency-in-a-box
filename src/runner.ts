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
  listQueuedIssues,
  addLabel,
  removeLabel,
  commentOnIssue,
  cloneRepo,
  findPrForBranch,
} from "./github.js";
import { loadConstitution, loadPlaybook } from "./memory.js";
import { runDevAgent } from "./agents/dev.js";

const IN_PROGRESS = "agency:in-progress";
const READY = "agency:ready";
const NEEDS_ATTENTION = "agency:needs-attention";
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
 * Process at most one queued issue end to end.
 * @returns true if an issue was picked up, false if the queue was empty.
 */
async function processOneIssue(cfg: Config): Promise<boolean> {
  const queued = await listQueuedIssues(cfg.targetRepo, cfg.queueLabel);
  if (queued.length === 0) return false;

  const issue = queued[0];
  console.log(`[agency] picked issue #${issue.number}: ${issue.title}`);

  // Move it into the in-progress state and announce on the thread.
  await addLabel(cfg.targetRepo, issue.number, IN_PROGRESS);
  await removeLabel(cfg.targetRepo, issue.number, cfg.queueLabel);
  await commentOnIssue(
    cfg.targetRepo,
    issue.number,
    `🤖 The dev agency picked up this issue and started working on branch \`agency/issue-${issue.number}\`.`,
  );

  // Fresh working copy.
  const workdir = join(process.cwd(), ".work", `${issue.number}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(join(process.cwd(), ".work"), { recursive: true });
  console.log(`[agency] cloning ${cfg.targetRepo} into ${workdir}...`);
  await cloneRepo(cfg.targetRepo, workdir);

  const [constitution, gitPlaybook] = await Promise.all([
    loadConstitution(),
    loadPlaybook("git-workflow"),
  ]);

  console.log(`[agency] handing issue #${issue.number} to the Developer agent...`);
  const result = await runDevAgent({
    issue,
    repo: cfg.targetRepo,
    workdir,
    constitution,
    gitPlaybook,
    model: cfg.model,
  });
  console.log(`[agency] developer finished after ${result.turns} turns.`);

  // The runner owns the terminal state authoritatively, regardless of whether the
  // agent remembered to update labels/comments itself.
  const branch = `agency/issue-${issue.number}`;
  const pr = await findPrForBranch(cfg.targetRepo, branch);
  await removeLabel(cfg.targetRepo, issue.number, IN_PROGRESS);

  if (pr) {
    await addLabel(cfg.targetRepo, issue.number, READY);
    await commentOnIssue(
      cfg.targetRepo,
      issue.number,
      [
        `✅ Work complete. Opened ${pr.isDraft ? "draft " : ""}PR ${pr.url}`,
        "",
        "Test it locally:",
        "```bash",
        `git fetch origin && git checkout ${branch}`,
        "```",
      ].join("\n"),
    );
    console.log(`[agency] issue #${issue.number} -> ${READY}. PR: ${pr.url}`);
  } else {
    await addLabel(cfg.targetRepo, issue.number, NEEDS_ATTENTION);
    await commentOnIssue(
      cfg.targetRepo,
      issue.number,
      "⚠️ The agency finished without opening a pull request. It may need clarification or hit a blocker — see the notes above. Re-add the queue label to retry.",
    );
    console.log(`[agency] issue #${issue.number} -> ${NEEDS_ATTENTION} (no PR found).`);
  }
  return true;
}

async function runOnce(cfg: Config): Promise<void> {
  if (!acquireLock()) {
    console.log("[agency] another run is already in progress; exiting.");
    return;
  }
  try {
    console.log(`[agency] target repo: ${cfg.targetRepo} (mode: once)`);
    const did = await processOneIssue(cfg);
    if (!did) {
      console.log(`[agency] nothing to do. Add the "${cfg.queueLabel}" label to an issue.`);
    }
  } finally {
    await unlink(LOCK_PATH).catch(() => {});
  }
}

async function runWatch(cfg: Config): Promise<void> {
  console.log(
    `[agency] target repo: ${cfg.targetRepo} (mode: watch, every ${cfg.pollIntervalSeconds}s)`,
  );
  // Single long-running process => sequential loop, no lock needed.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const did = await processOneIssue(cfg);
      if (!did) {
        console.log(`[agency] queue empty; sleeping ${cfg.pollIntervalSeconds}s...`);
        await sleep(cfg.pollIntervalSeconds * 1000);
      }
      // If work was done, loop immediately to drain any remaining queued issues.
    } catch (err) {
      console.error("[agency] error during cycle (continuing):", (err as Error).message);
      await sleep(cfg.pollIntervalSeconds * 1000);
    }
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.runMode === "watch") {
    await runWatch(cfg);
  } else {
    await runOnce(cfg);
  }
}

main().catch((err) => {
  console.error("[agency] fatal error:", err);
  process.exitCode = 1;
});
