// full-build step order (#152): the pipeline (build() in pipeline.ts) always runs the tester, then
// the reviewer — but the seeded workflow metadata (used only to LABEL the dashboard timeline; the
// pipeline never reads it) originally listed @review before @test, so cards showed Review and Test
// swapped. seedWorkflows must both seed the correct order for fresh installs and migrate any
// already-seeded row still carrying the old order.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-fbso-")), "test.db");

const { seedWorkflows, getWorkflow, upsertWorkflow } = await import("../dist/store.js");

test("fresh seed: full-build lists test before review", () => {
  seedWorkflows();
  const wf = getWorkflow("full-build");
  assert.deepEqual(wf.steps.map((s) => s.agent), ["@plan", "@dev", "@test", "@review"]);
  assert.deepEqual(wf.gates.map((g) => [g.after, g.condition]), [[2, "tests:fail"], [3, "review:changes"]]);
});

test("migration: an existing row with the old review-before-test order is reordered in place", () => {
  // Simulate a pre-fix install: the old seed shape, written directly (bypassing seedWorkflows).
  upsertWorkflow({
    id: "full-build", name: "Full build", trigger: "@build", builtin: true,
    steps: [
      { agent: "@plan", instruction: "p", skills: [], hooks: [] },
      { agent: "@dev", instruction: "d", skills: [], hooks: [] },
      { agent: "@review", instruction: "r", skills: [], hooks: [] },
      { agent: "@test", instruction: "t", skills: [], hooks: [] },
    ],
    gates: [
      { after: 2, condition: "review:changes", route: "loop:1", maxLoops: 2 },
      { after: 3, condition: "tests:fail", route: "loop:1", maxLoops: 2 },
    ],
  });
  seedWorkflows();
  const wf = getWorkflow("full-build");
  assert.deepEqual(wf.steps.map((s) => s.agent), ["@plan", "@dev", "@test", "@review"], "steps reordered");
  assert.deepEqual(
    wf.gates.map((g) => [g.after, g.condition]),
    [[3, "review:changes"], [2, "tests:fail"]],
    "gate indices swapped to track their (now-moved) steps",
  );
});

test("migration is idempotent — a second seedWorkflows call leaves the corrected row untouched", () => {
  const before = getWorkflow("full-build");
  seedWorkflows();
  const after = getWorkflow("full-build");
  assert.deepEqual(after.steps, before.steps);
  assert.deepEqual(after.gates, before.gates);
});
