// Stop = hard halt: runRole must NOT start an agent if the issue was stopped.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "stop-")), "agency.db");
const { requestStop, clearStop, isStopRequested } = await import("../dist/abort.js");
const { runRole } = await import("../dist/agents/roleAgent.js");

test("runRole returns a no-op (no agent) when the issue is stopped", async () => {
  const repo = "acme/app", number = 7;
  requestStop(repo, number);
  assert.equal(isStopRequested(repo, number), true);
  const r = await runRole("developer", { workdir: "/tmp", repo, issueNumber: number, task: "do x" });
  assert.equal(r.stopped, "user-stop", "run was skipped due to stop");
  assert.equal(r.turns, 0, "no turns ran");
  assert.equal(r.costUsd, 0, "no cost incurred");
  clearStop(repo, number);
});
