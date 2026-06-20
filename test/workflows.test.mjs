// Workflow data model: CRUD + seeded built-in templates.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "wf-")), "agency.db");
const { seedWorkflows, listWorkflows, getWorkflow, getWorkflowByTrigger, upsertWorkflow, deleteWorkflow } = await import("../dist/db/workflows.js");

test("seedWorkflows installs the built-in templates once", () => {
  seedWorkflows(); seedWorkflows(); // idempotent
  const all = listWorkflows();
  const ids = all.map((w) => w.id);
  for (const id of ["full-build", "quick-fix", "plan-only", "review-only"]) assert.ok(ids.includes(id), id);
  const fb = getWorkflow("full-build");
  assert.equal(fb.name, "Full build");
  assert.ok(fb.steps.length >= 3 && fb.steps[0].agent === "@plan");
  assert.ok(fb.gates.some((g) => g.condition === "review:changes" && g.route === "loop:1"));
  assert.ok(fb.builtin);
});

test("getWorkflowByTrigger resolves the handle", () => {
  assert.equal(getWorkflowByTrigger("@build").id, "full-build");
  assert.equal(getWorkflowByTrigger("@dev"), null); // @dev now = solo developer, not the Full build workflow
  assert.equal(getWorkflowByTrigger("@QUICKFIX").id, "quick-fix");
  assert.equal(getWorkflowByTrigger("@nope"), null);
});

test("custom workflow upsert + delete; built-ins can't be deleted", () => {
  upsertWorkflow({ id: "mine", name: "Mine", trigger: "@mine", steps: [{ agent: "@dev", instruction: "go", skills: [], hooks: [] }], gates: [] });
  assert.equal(getWorkflow("mine").name, "Mine");
  deleteWorkflow("mine");
  assert.equal(getWorkflow("mine"), null);
  deleteWorkflow("full-build"); // builtin guard
  assert.ok(getWorkflow("full-build"), "built-in survives delete");
});
