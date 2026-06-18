// Tests for the IssueStatus DB round-trip (state + blocked column) — #66.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-status-")), "test.db");

const s = await import("../dist/store.js");
const state = await import("../dist/state.js");

const REPO = "octocat/Hello-World";

test("recordIssueStatus → getIssueStatus round-trips every lifecycle state", () => {
  for (const st of ["notPlanned", "planned", "working", "review", "done"]) {
    s.recordIssueStatus(REPO, 1, state.withStatus(st), { title: `t-${st}` });
    const got = s.getIssueStatus(REPO, 1);
    assert.equal(got.state, st);
    assert.equal(got.blocked, null);
  }
});

test("recordIssueStatus stores the blocked reason in its own column", () => {
  s.recordIssueStatus(REPO, 2, state.withStatus("working", "awaitingAnswer"));
  const got = s.getIssueStatus(REPO, 2);
  assert.deepEqual(got, { state: "working", blocked: "awaitingAnswer" });
});

test("blocked is orthogonal: each reason pairs with its natural lifecycle", () => {
  // awaitingApproval lives on `planned` (plan posted, not yet building); the rest are mid-work → `working`.
  const cases = [
    ["planned", "awaitingApproval"],
    ["working", "awaitingAnswer"],
    ["working", "needsAttention"],
    ["working", "conflict"],
    ["working", "rateLimited"],
    ["working", "budgetExceeded"],
  ];
  for (const [st, reason] of cases) {
    s.recordIssueStatus(REPO, 3, state.setBlocked(state.withStatus(st), reason));
    const got = s.getIssueStatus(REPO, 3);
    assert.equal(got.state, st);
    assert.equal(got.blocked, reason);
  }
});

test("clearBlocked writes null back to the column", () => {
  s.recordIssueStatus(REPO, 4, state.withStatus("working", "conflict"));
  assert.equal(s.getIssueStatus(REPO, 4).blocked, "conflict");
  s.recordIssueStatus(REPO, 4, state.clearBlocked(s.getIssueStatus(REPO, 4)));
  assert.equal(s.getIssueStatus(REPO, 4).blocked, null);
  assert.equal(s.getIssueStatus(REPO, 4).state, "working");
});

test("getIssueStatus on an unknown issue returns notPlanned", () => {
  assert.deepEqual(s.getIssueStatus(REPO, 9999), state.STATUS_NOT_PLANNED);
});

// ---- frontend back-compat: the `state` column must hold a value web/core.js classify() understands ----
// The UI reads `issue.state` directly from /data and string-matches agency:* values. Until the
// frontend migrates to read `blocked`, recordIssueStatus must keep emitting the legacy composite.
test("the state column always holds a frontend-recognised agency:* composite (back-compat)", () => {
  const recognised = new Set([
    "", "planned", "agency:planned", "agency:in-progress", "agency:ready",
    "agency:awaiting-answer", "agency:awaiting-approval", "agency:needs-attention",
    "agency:rate-limited", "merged", "closed", "done",
  ]);
  const cases = [
    state.withStatus("notPlanned"),
    state.withStatus("planned"),
    state.withStatus("working"),
    state.withStatus("review"),
    state.withStatus("done"),
    state.setBlocked(state.withStatus("planned"), "awaitingApproval"),
    state.setBlocked(state.withStatus("working"), "awaitingAnswer"),
    state.setBlocked(state.withStatus("working"), "needsAttention"),
    state.setBlocked(state.withStatus("working"), "rateLimited"),
    state.setBlocked(state.withStatus("working"), "conflict"),
    state.setBlocked(state.withStatus("working"), "budgetExceeded"),
  ];
  for (const status of cases) {
    s.recordIssueStatus(REPO, 30, status);
    const row = s.getIssueRow(REPO, 30);
    assert.ok(recognised.has(row.state || ""), `unrecognised column value for ${JSON.stringify(status)}: ${row.state}`);
  }
});

// ---- back-compat: rows written the OLD way (legacy label string, blocked column NULL) ----

test("legacy row (recordIssueState with 'agency:awaiting-answer', no blocked column) is derived loss-free", () => {
  // Simulate an old row: write via the legacy function, which does not touch `blocked`.
  s.recordIssueState(REPO, 10, { state: "agency:awaiting-answer" });
  const got = s.getIssueStatus(REPO, 10);
  // blocked column is NULL → parseLegacyStatus derives it from the legacy state string.
  assert.equal(got.state, "working");
  assert.equal(got.blocked, "awaitingAnswer");
});

test("legacy row 'agency:ready' derives to review + no block", () => {
  s.recordIssueState(REPO, 11, { state: "agency:ready" });
  assert.deepEqual(s.getIssueStatus(REPO, 11), { state: "review", blocked: null });
});

test("a full lifecycle with a mid-work block round-trips through the DB", () => {
  let status = state.withStatus("notPlanned");
  s.recordIssueStatus(REPO, 20, status);
  status = state.withStatus(state.transition(status.state, "planned"));
  s.recordIssueStatus(REPO, 20, status);
  status = state.setBlocked(status, "awaitingApproval"); // plan posted, waiting on 👍
  s.recordIssueStatus(REPO, 20, status);
  assert.equal(state.isWaitingOnHuman(s.getIssueStatus(REPO, 20)), true);
  status = state.clearBlocked(status); // approved
  s.recordIssueStatus(REPO, 20, status);
  status = state.withStatus(state.transition(status.state, "working"));
  s.recordIssueStatus(REPO, 20, status);
  status = state.setBlocked(status, "conflict"); // merge conflict
  s.recordIssueStatus(REPO, 20, status);
  assert.equal(s.getIssueStatus(REPO, 20).blocked, "conflict");
  status = state.clearBlocked(status);
  s.recordIssueStatus(REPO, 20, status);
  status = state.withStatus(state.transition(status.state, "review"));
  s.recordIssueStatus(REPO, 20, status);
  status = state.withStatus(state.transition(status.state, "done"));
  s.recordIssueStatus(REPO, 20, status);
  assert.equal(state.isTerminal(s.getIssueStatus(REPO, 20)), true);
});
