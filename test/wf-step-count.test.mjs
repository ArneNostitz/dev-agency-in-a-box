// Resume seed: workflowStepRunCount counts completed workflow-engine step runs per issue, so a
// paused interactive workflow resumes at the next step instead of re-running from step 0.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "wfsc-")), "agency.db");
const { recordRun, workflowStepRunCount } = await import("../dist/store.js");

test("workflowStepRunCount counts only kind='workflow' runs for the issue", () => {
  const repo = "acme/app", num = 7;
  assert.equal(workflowStepRunCount(repo, num), 0, "no runs yet");
  recordRun(repo, num, "developer", "m", 1, "workflow", 0);
  recordRun(repo, num, "tester", "m", 1, "workflow", 0);
  recordRun(repo, num, "planner", "m", 1, "plan", 0);   // not a workflow step
  recordRun(repo, 99, "developer", "m", 1, "workflow", 0); // other issue
  assert.equal(workflowStepRunCount(repo, num), 2, "two workflow steps for this issue");
  assert.equal(workflowStepRunCount(repo, 99), 1, "scoped per issue");
});
