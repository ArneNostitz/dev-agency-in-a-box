// v3 P2: run_step telemetry store.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-runstep-")), "test.db");
const s = await import("../dist/store.js");

test("recordRunStep + toolStatsSince aggregates by role/tool", () => {
  const t0 = new Date(Date.now() - 1000).toISOString();
  s.recordRunStep("acme/app", 1, "developer", "Bash", "$ npm test", true);
  s.recordRunStep("acme/app", 1, "developer", "Bash", "$ npm run build", true);
  s.recordRunStep("acme/app", 1, "developer", "Edit", "edit foo.ts", false);
  s.recordRunStep("acme/app", 2, "tester", "Bash", "$ npm test", true);

  const stats = s.toolStatsSince(t0);
  const devBash = stats.find((x) => x.role === "developer" && x.tool === "Bash");
  assert.equal(devBash.uses, 2, "developer Bash counted twice");
  const devEdit = stats.find((x) => x.role === "developer" && x.tool === "Edit");
  assert.equal(devEdit.fails, 1, "failure counted");
  assert.ok(stats[0].uses >= stats[stats.length - 1].uses, "ordered by uses desc");
});

test("runStepCountSince gates the analyzer", () => {
  assert.ok(s.runStepCountSince(new Date(Date.now() - 5000).toISOString()) >= 4);
  assert.equal(s.runStepCountSince(new Date(Date.now() + 5000).toISOString()), 0);
});
