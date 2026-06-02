/**
 * Phase 1 runner: pick up one queued GitHub issue and drive it to a linked PR
 * using a single Developer agent. This proves the issue -> branch -> PR ->
 * comment loop end to end before we add the orchestrator and the rest of the
 * roster in later phases.
 *
 * Run:  npm run dev        (uses .env)
 */
import { rm, mkdir, writeFile, unlink } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
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

/** Prevent overlapping runs (e.g. when launchd fires again before we finish). */
function acquireLock(): boolean {
  if (existsSync(LOCK_PATH)) {
    const pid = Number(readFileSync(LOCK_PATH, "utf8").trim());
    // If the recorded process is gone, the lock is stale — take it over.
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

async function main(): Promise<void> {
  const cfg = loadConfig();

  if (!acquireLock()) {
    console.log("[agency] another run is already in progress; exiting.");
    return;
  }

  console.log(`[agency] target repo: ${cfg.targetRepo}`);
  console.log(`[agency] looking for issues labeled "${cfg.queueLabel}"...`);

  const queued = await listQueuedIssues(cfg.targetRepo, cfg.queueLabel);
  if (queued.length === 0) {
    console.log(`[agency] nothing to do. Open an issue and add the "${cfg.queueLabel}" label.`);
    return;
  }

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
        `Test it locally:`,
        "```bash",
        `git fetch origin && git checkout ${branch}`,
        "```",
      ].join("\n"),
    );
    console.log(`[agency] issue #${issue.number} -> ${READY}. PR: ${pr.url}`);
  } else {
    // No PR means the agent stopped early (e.g. asked a question or hit a blocker).
    await addLabel(cfg.targetRepo, issue.number, NEEDS_ATTENTION);
    await commentOnIssue(
      cfg.targetRepo,
      issue.number,
      "⚠️ The agency finished without opening a pull request. It may need clarification or hit a blocker — see the notes above. Re-add the queue label to retry.",
    );
    console.log(`[agency] issue #${issue.number} -> ${NEEDS_ATTENTION} (no PR found).`);
  }
}

main()
  .catch((err) => {
    console.error("[agency] fatal error:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Always release the lock.
    void unlink(LOCK_PATH).catch(() => {});
  });
