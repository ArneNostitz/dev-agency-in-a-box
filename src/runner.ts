/**
 * Phase 1 runner: pick up one queued GitHub issue and drive it to a linked PR
 * using a single Developer agent. This proves the issue -> branch -> PR ->
 * comment loop end to end before we add the orchestrator and the rest of the
 * roster in later phases.
 *
 * Run:  npm run dev        (uses .env)
 */
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { listQueuedIssues, addLabel, removeLabel, commentOnIssue, cloneRepo } from "./github.js";
import { loadConstitution, loadPlaybook } from "./memory.js";
import { runDevAgent } from "./agents/dev.js";

const IN_PROGRESS = "agency:in-progress";

async function main(): Promise<void> {
  const cfg = loadConfig();
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
  console.log("[agency] ----- agent summary -----");
  console.log(result.finalText || "(no textual summary returned)");
  console.log("[agency] ---------------------------");
  console.log(`[agency] done. Check issue #${issue.number} and its pull request on GitHub.`);
}

main().catch((err) => {
  console.error("[agency] fatal error:", err);
  process.exitCode = 1;
});
