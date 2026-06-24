// Per-issue workflow override: set → persists, honored over text resolution; clear → null.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "iwf-")), "agency.db");
const { setIssueWorkflow, getIssueWorkflow, clearIssueWorkflow } = await import("../dist/db/providers.js");

test("per-issue workflow override round-trips and clears", () => {
  const repo = "acme/app", num = 42;
  assert.equal(getIssueWorkflow(repo, num), null, "no override by default");
  setIssueWorkflow(repo, num, "quick-fix");
  assert.equal(getIssueWorkflow(repo, num), "quick-fix", "override persisted");
  // scoped per issue
  assert.equal(getIssueWorkflow(repo, 43), null, "other issue unaffected");
  clearIssueWorkflow(repo, num);
  assert.equal(getIssueWorkflow(repo, num), null, "override cleared");
});
