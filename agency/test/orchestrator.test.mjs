// Tests for the orchestrator decision core (Phase 3) — pure next-move logic.
import test from "node:test";
import assert from "node:assert/strict";
import { decideNext } from "../dist/orchestrator.js";

const base = { devChanged: true, round: 0, maxRounds: 1 };

test("developed → test", () => {
  assert.equal(decideNext({ ...base, phase: "developed" }).action, "test");
});

test("tested: pass → review, fail → revise (rounds left), fail → park (no rounds)", () => {
  assert.equal(decideNext({ ...base, phase: "tested", testPass: true }).action, "review");
  assert.equal(decideNext({ ...base, phase: "tested", testPass: false, round: 0, maxRounds: 1 }).action, "revise");
  const out = decideNext({ ...base, phase: "tested", testPass: false, round: 1, maxRounds: 1 });
  assert.equal(out.action, "finalize");
  assert.equal(out.stillChanges, true);
});

test("reviewed: approved → finalize, changes → revise / park", () => {
  assert.equal(decideNext({ ...base, phase: "reviewed", reviewVerdict: "approved" }).action, "finalize");
  assert.equal(decideNext({ ...base, phase: "reviewed", reviewVerdict: "changes", round: 0, maxRounds: 1 }).action, "revise");
  const out = decideNext({ ...base, phase: "reviewed", reviewVerdict: "changes", round: 1, maxRounds: 1 });
  assert.equal(out.action, "finalize");
  assert.equal(out.stillChanges, true);
});

test("revised: no change → stop (no token bleed); changed → re-test", () => {
  assert.equal(decideNext({ ...base, phase: "revised", devChanged: false }).action, "stop");
  assert.equal(decideNext({ ...base, phase: "revised", devChanged: true }).action, "test");
});

test("a clean run walks developed→test→review→finalize without revising", () => {
  let s = { phase: "developed", devChanged: true, round: 0, maxRounds: 1 };
  assert.equal(decideNext(s).action, "test");
  s = { ...s, phase: "tested", testPass: true };
  assert.equal(decideNext(s).action, "review");
  s = { ...s, phase: "reviewed", reviewVerdict: "approved" };
  assert.equal(decideNext(s).action, "finalize");
});
