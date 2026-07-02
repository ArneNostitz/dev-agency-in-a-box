// Tests for IssueState (architecture review, Candidate 1) — pure lifecycle logic.
import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_NOT_PLANNED,
  ISSUE_STATES,
  canTransition,
  transition,
  withStatus,
  setBlocked,
  clearBlocked,
  isWaitingOnHuman,
  isTerminal,
  parseLegacyStatus,
} from "../dist/state.js";

// ---- vocabulary ----

test("the lifecycle spine is exactly five states", () => {
  assert.deepEqual([...ISSUE_STATES], ["notPlanned", "planned", "working", "review", "done"]);
});

test("withStatus validates both fields", () => {
  assert.deepEqual(withStatus("planned"), { state: "planned", blocked: null });
  assert.deepEqual(withStatus("working", "conflict"), { state: "working", blocked: "conflict" });
  assert.throws(() => withStatus("bogus"), /invalid IssueState/);
  assert.throws(() => withStatus("planned", "bogus"), /invalid BlockedReason/);
});

// ---- transitions: the legal edges ----

test("forward walk: notPlanned → planned → working → review → done", () => {
  const path = ["notPlanned", "planned", "working", "review", "done"];
  for (let i = 0; i < path.length - 1; i++) {
    assert.equal(canTransition(path[i], path[i + 1]), true, `${path[i]} → ${path[i + 1]}`);
  }
});

test("reopens are allowed: done → working, done → planned", () => {
  assert.equal(canTransition("done", "working"), true);
  assert.equal(canTransition("done", "planned"), true);
});

test("nonsense jumps are rejected", () => {
  assert.equal(canTransition("notPlanned", "review"), false);
  assert.equal(canTransition("planned", "review"), false); // must go via working
  assert.equal(canTransition("review", "notPlanned"), false);
});

test("notPlanned (Inbox) can jump straight to working — the Start action skips Planned", () => {
  assert.equal(canTransition("notPlanned", "working"), true);
});

test("every state transitions to itself (no-op)", () => {
  for (const s of ISSUE_STATES) assert.equal(canTransition(s, s), true);
});

test("transition() returns the target on a legal edge", () => {
  assert.equal(transition("planned", "working"), "working");
});

test("transition() throws on an illegal edge so the bug surfaces at the call site", () => {
  assert.throws(() => transition("notPlanned", "review"), /illegal IssueState transition/);
});

// ---- blocked reason is orthogonal to the lifecycle ----

test("setBlocked / clearBlocked never touch the lifecycle state", () => {
  const working = withStatus("working");
  assert.deepEqual(setBlocked(working, "awaitingAnswer"), { state: "working", blocked: "awaitingAnswer" });
  assert.deepEqual(clearBlocked(setBlocked(working, "conflict")), working);
  assert.equal(clearBlocked(working), working); // no-op when already clear
});

test("isWaitingOnHuman is true only for the human-pause reasons", () => {
  assert.equal(isWaitingOnHuman(withStatus("planned", "awaitingApproval")), true);
  assert.equal(isWaitingOnHuman(withStatus("working", "awaitingAnswer")), true);
  assert.equal(isWaitingOnHuman(withStatus("working", "conflict")), false); // blocked, but not on the human
  assert.equal(isWaitingOnHuman(withStatus("working")), false);
});

test("isTerminal recognises done regardless of blocked", () => {
  assert.equal(isTerminal(withStatus("done")), true);
  assert.equal(isTerminal(withStatus("done", "needsAttention")), true);
  assert.equal(isTerminal(withStatus("review")), false);
});

// ---- the migration bridge (no data migration needed) ----

test("parseLegacyStatus splits the old single-value representation into state + blocked, loss-free", () => {
  assert.deepEqual(parseLegacyStatus("agency:awaiting-approval"), { state: "planned", blocked: "awaitingApproval" });
  assert.deepEqual(parseLegacyStatus("agency:awaiting-answer"), { state: "working", blocked: "awaitingAnswer" });
  assert.deepEqual(parseLegacyStatus("agency:rate-limited"), { state: "working", blocked: "rateLimited" });
  assert.deepEqual(parseLegacyStatus("agency:needs-attention"), { state: "working", blocked: "needsAttention" });
});

test("parseLegacyStatus maps the bare un-blocked lifecycle values", () => {
  assert.deepEqual(parseLegacyStatus("planned"), { state: "planned", blocked: null });
  assert.deepEqual(parseLegacyStatus("agency:planned"), { state: "planned", blocked: null });
  assert.deepEqual(parseLegacyStatus("agency:in-progress"), { state: "working", blocked: null });
  assert.deepEqual(parseLegacyStatus("agency:ready"), { state: "review", blocked: null });
  assert.deepEqual(parseLegacyStatus("done"), { state: "done", blocked: null });
  assert.deepEqual(parseLegacyStatus("merged"), { state: "done", blocked: null });
  assert.deepEqual(parseLegacyStatus("closed"), { state: "done", blocked: null });
});

test("parseLegacyStatus tolerates null / empty / unknown / kind-and-flag labels", () => {
  assert.deepEqual(parseLegacyStatus(null), STATUS_NOT_PLANNED);
  assert.deepEqual(parseLegacyStatus(""), STATUS_NOT_PLANNED);
  assert.deepEqual(parseLegacyStatus(undefined), STATUS_NOT_PLANNED);
  assert.deepEqual(parseLegacyStatus("agency:epic"), STATUS_NOT_PLANNED); // kind, not lifecycle
  assert.deepEqual(parseLegacyStatus("agency:unlimited"), STATUS_NOT_PLANNED); // flag, not lifecycle
  assert.deepEqual(parseLegacyStatus("  agency:ready  "), { state: "review", blocked: null }); // trimmed
});

// ---- a full lifecycle + reopen round-trip ----

test("a full lifecycle with a mid-work pause and a reopen is representable", () => {
  let s = withStatus("notPlanned");
  s = withStatus(transition(s.state, "planned")); // intake
  s = setBlocked(s, "awaitingApproval"); // plan posted, waiting on 👍
  assert.equal(isWaitingOnHuman(s), true);
  s = clearBlocked(s); // approved
  s = withStatus(transition(s.state, "working")); // build
  s = setBlocked(s, "conflict"); // merge conflict
  assert.equal(isWaitingOnHuman(s), false); // not on the human
  s = clearBlocked(s);
  s = withStatus(transition(s.state, "review"));
  s = withStatus(transition(s.state, "done"));
  assert.equal(isTerminal(s), true);
  s = withStatus(transition(s.state, "working")); // follow-up reopens it
  assert.equal(s.state, "working");
});
