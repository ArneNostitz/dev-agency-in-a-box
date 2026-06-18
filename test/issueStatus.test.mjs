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

test("the state column holds the canonical lifecycle enum directly (no back-compat)", () => {
  // ADR-0001: no legacy agency:* composite. The column is single-axis (lifecycle only).
  const cases = [
    [state.withStatus("notPlanned"), "notPlanned"],
    [state.withStatus("planned"), "planned"],
    [state.withStatus("working"), "working"],
    [state.withStatus("review"), "review"],
    [state.withStatus("done"), "done"],
    // blocked never leaks into the state column — it lives in its own column
    [state.setBlocked(state.withStatus("planned"), "awaitingApproval"), "planned"],
    [state.setBlocked(state.withStatus("working"), "awaitingAnswer"), "working"],
    [state.setBlocked(state.withStatus("working"), "needsAttention"), "working"],
    [state.setBlocked(state.withStatus("working"), "rateLimited"), "working"],
    [state.setBlocked(state.withStatus("working"), "conflict"), "working"],
    [state.setBlocked(state.withStatus("working"), "budgetExceeded"), "working"],
  ];
  for (const [status, expectedCol] of cases) {
    s.recordIssueStatus(REPO, 30, status);
    const row = s.getIssueRow(REPO, 30);
    assert.equal(row.state, expectedCol, `column for ${JSON.stringify(status)}: got ${row.state}`);
  }
});

// ---- import-time fallback only: parseLegacyStatus re-derives a pre-flush row, one-way ----
// ADR-0001: no live back-compat. The canonical path writes enum values; parseLegacyStatus
// exists solely for importing existing GitHub labels / pre-flush rows during adoption.

test("getIssueStatus round-trips the canonical enum (the normal path)", () => {
  s.recordIssueStatus(REPO, 11, state.withStatus("review"));
  assert.deepEqual(s.getIssueStatus(REPO, 11), { state: "review", blocked: null });
  s.recordIssueStatus(REPO, 12, state.setBlocked(state.withStatus("working"), "awaitingAnswer"));
  assert.deepEqual(s.getIssueStatus(REPO, 12), { state: "working", blocked: "awaitingAnswer" });
});

test("parseLegacyStatus re-derives a pre-flush row at import time (one-way, not live)", () => {
  // Simulate a stale row that somehow holds a legacy composite: the parser recovers it.
  assert.deepEqual(state.parseLegacyStatus("agency:awaiting-answer"), { state: "working", blocked: "awaitingAnswer" });
  assert.deepEqual(state.parseLegacyStatus("agency:ready"), { state: "review", blocked: null });
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
