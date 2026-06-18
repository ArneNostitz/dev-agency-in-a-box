// Tests for the one-time legacy → canonical IssueState migration (#66).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-mig-")), "test.db");

const s = await import("../dist/store.js");
const state = await import("../dist/state.js");
const REPO = "octocat/Hello-World";

// Seed a spread of LEGACY rows the way the old code wrote them (via the legacy writer,
// which does not touch `blocked`), so we can prove the migration recovers the blocked reason.
function seedLegacy(num, legacyState) {
  s.recordIssueState(REPO, num, { state: legacyState });
}

test("the migration converts every legacy composite to canonical state + blocked", () => {
  seedLegacy(1, "agency:in-progress");
  seedLegacy(2, "agency:ready");
  seedLegacy(3, "agency:awaiting-answer");
  seedLegacy(4, "agency:awaiting-approval");
  seedLegacy(5, "agency:needs-attention");
  seedLegacy(6, "agency:rate-limited");
  seedLegacy(7, "agency:planned");
  seedLegacy(8, "merged");
  seedLegacy(9, "closed");

  const r = s.migrateIssueStates();
  assert.equal(r.migrated, 9);

  assert.deepEqual(s.getIssueStatus(REPO, 1), { state: "working", blocked: null });
  assert.deepEqual(s.getIssueStatus(REPO, 2), { state: "review", blocked: null });
  assert.deepEqual(s.getIssueStatus(REPO, 3), { state: "working", blocked: "awaitingAnswer" }); // blocked RECOVERED
  assert.deepEqual(s.getIssueStatus(REPO, 4), { state: "planned", blocked: "awaitingApproval" }); // blocked RECOVERED
  assert.deepEqual(s.getIssueStatus(REPO, 5), { state: "working", blocked: "needsAttention" });
  assert.deepEqual(s.getIssueStatus(REPO, 6), { state: "working", blocked: "rateLimited" });
  assert.deepEqual(s.getIssueStatus(REPO, 7), { state: "planned", blocked: null });
  assert.deepEqual(s.getIssueStatus(REPO, 8), { state: "done", blocked: null });
  assert.deepEqual(s.getIssueStatus(REPO, 9), { state: "done", blocked: null });
});

test("the migration leaves kind labels (agency:epic) untouched", () => {
  seedLegacy(20, "agency:epic");
  const r = s.migrateIssueStates();
  assert.equal(r.skipped >= 1, true);
  assert.equal(s.getIssueRow(REPO, 20).state, "agency:epic"); // not converted to a lifecycle enum
});

test("the migration is idempotent — a second run migrates nothing", () => {
  // everything from the tests above is already canonical now
  const r = s.migrateIssueStates();
  assert.equal(r.migrated, 0, `expected 0 migrated, got ${r.migrated}`);
});

test("a row already in canonical form (written by the new code) is not touched", () => {
  s.recordIssueStatus(REPO, 30, state.setBlocked(state.withStatus("working"), "conflict"));
  const before = s.getIssueRow(REPO, 30);
  const r = s.migrateIssueStates();
  const after = s.getIssueRow(REPO, 30);
  assert.equal(after.state, before.state);
  assert.equal(after.blocked, before.blocked);
  assert.ok(r.skipped >= 1);
});

test("an unknown legacy value falls back to notPlanned (safe)", () => {
  seedLegacy(40, "agency:queue"); // a kind/flag, not lifecycle
  s.migrateIssueStates();
  assert.deepEqual(s.getIssueStatus(REPO, 40), state.STATUS_NOT_PLANNED);
});
