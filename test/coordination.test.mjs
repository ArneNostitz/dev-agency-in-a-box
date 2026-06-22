// v4 live cross-issue coordination: live footprint (addClaimFiles/addIssueFiles) + coordinationContext.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "coord-")), "agency.db");
const { getDb } = await import("../dist/db/connection.js"); getDb();
const { claimFiles, addClaimFiles, _resetLocks } = await import("../dist/locks.js");
const { addIssueFiles, filesFor, recordIssueStatus, recordPlan } = await import("../dist/store.js");
const { withStatus } = await import("../dist/state.js");
const { coordinationContext } = await import("../dist/coordination.js");

test("addClaimFiles unions into own claim and flags cross-issue overlap", () => {
  _resetLocks();
  assert.equal(claimFiles("acme/app", 1, ["src/a.ts"]).ok, true);
  // #1 also starts editing b.ts (undeclared) — unions, no overlap.
  assert.deepEqual(addClaimFiles("acme/app", 1, ["src/b.ts"]), {});
  // #2 is running on c.ts, then touches b.ts which #1 now holds → overlap reported.
  assert.equal(claimFiles("acme/app", 2, ["src/c.ts"]).ok, true);
  const r = addClaimFiles("acme/app", 2, ["src/b.ts"]);
  assert.ok(r.overlap && r.overlap.number === 1 && r.overlap.file === "src/b.ts");
});

test("addIssueFiles accumulates the real (declared + edited) footprint", () => {
  recordIssueStatus("acme/app", 10, withStatus("working"), { title: "X" });
  addIssueFiles("acme/app", 10, ["src/x.ts"]);
  addIssueFiles("acme/app", 10, ["src/x.ts", "src/y.ts"]); // x dedups, y added
  assert.deepEqual(filesFor("acme/app", 10).sort(), ["src/x.ts", "src/y.ts"]);
});

test("coordinationContext surfaces overlapping open issues + their intent; empty when disjoint", () => {
  _resetLocks();
  recordIssueStatus("acme/app", 21, withStatus("working"), { title: "Auth refactor" });
  recordIssueStatus("acme/app", 22, withStatus("planned"), { title: "Login UI" });
  addIssueFiles("acme/app", 21, ["src/auth.ts"]);
  addIssueFiles("acme/app", 22, ["src/auth.ts", "web/login.js"]);
  recordPlan("acme/app", 21, "Rework token resolution in src/auth.ts");
  // From #22's perspective (developer), it shares src/auth.ts with #21.
  const ctx = coordinationContext("acme/app", 22, "developer");
  assert.match(ctx, /#21 Auth refactor/);
  assert.match(ctx, /src\/auth\.ts/);
  assert.match(ctx, /token resolution/);
  // Non-editing role → no coordination noise.
  assert.equal(coordinationContext("acme/app", 22, "reviewer"), "");
  // An issue with a disjoint footprint gets nothing.
  recordIssueStatus("acme/app", 23, withStatus("working"), { title: "Docs" });
  addIssueFiles("acme/app", 23, ["README.md"]);
  assert.equal(coordinationContext("acme/app", 23, "developer"), "");
});
