// Tests for availableActions — the bulletproof button rules (Candidate 5).
import test from "node:test";
import assert from "node:assert/strict";
import { availableActions, offersAction } from "../dist/actions.js";
import { withStatus, setBlocked } from "../dist/state.js";

const ids = (a) => a.map((x) => x.id);
const F = (o = {}) => ({
  running: false, hasPr: false, review: undefined, conflict: false,
  isEpic: false, approvedNoPr: false, needsFix: false, ...o,
});

test("a running issue offers ONLY stop", () => {
  assert.deepEqual(ids(availableActions(withStatus("working"), F({ running: true }))), ["stop"]);
  assert.deepEqual(ids(availableActions(withStatus("review"), F({ running: true, hasPr: true }))), ["stop"]);
});

test("a done issue offers nothing", () => {
  assert.deepEqual(availableActions(withStatus("done"), F()), []);
});

test("parked (notPlanned / planned) offers Start", () => {
  assert.deepEqual(ids(availableActions(withStatus("notPlanned"), F())), ["start"]);
  assert.deepEqual(ids(availableActions(withStatus("planned"), F())), ["start"]);
});

test("awaiting-approval offers Approve + To Planned (not Start)", () => {
  const a = ids(availableActions(setBlocked(withStatus("planned"), "awaitingApproval"), F()));
  assert.deepEqual(a, ["approve", "toPlanned"]);
});

test("hasPr + clean review offers Merge (confirm) + Resume + Cancel", () => {
  const a = availableActions(withStatus("review"), F({ hasPr: true, review: "approved" }));
  assert.deepEqual(ids(a), ["merge", "resume", "cancel"]);
  assert.equal(a[0].confirm, true);
});

test("hasPr + review requested changes offers Fix + Merge-Anyway(confirm) + Resume + Cancel", () => {
  const a = availableActions(withStatus("review"), F({ hasPr: true, review: "changes", needsFix: true }));
  assert.deepEqual(ids(a), ["fix", "mergeAnyway", "resume", "cancel"]);
  assert.equal(a[1].confirm, true);
});

test("hasPr + conflict offers Fix (resolve) + Resume + Cancel", () => {
  assert.deepEqual(
    ids(availableActions(setBlocked(withStatus("working"), "conflict"), F({ hasPr: true, conflict: true }))),
    ["fix", "resume", "cancel"],
  );
});

test("approved but no PR yet offers Create PR + Resume + Cancel", () => {
  assert.deepEqual(ids(availableActions(withStatus("review"), F({ approvedNoPr: true }))), ["createPr", "resume", "cancel"]);
});

test("an epic offers Close(confirm) + Resume + Cancel", () => {
  const a = availableActions(withStatus("working"), F({ isEpic: true }));
  assert.deepEqual(ids(a), ["close", "resume", "cancel"]);
  assert.equal(a[0].confirm, true);
});

test("working / needs-attention / answered (no PR, not epic) offers Resume + Close + Cancel", () => {
  assert.deepEqual(ids(availableActions(withStatus("working"), F())), ["resume", "close", "cancel"]);
  assert.deepEqual(
    ids(availableActions(setBlocked(withStatus("working"), "needsAttention"), F())),
    ["resume", "close", "cancel"],
  );
});

test("offersAction is a clean membership check", () => {
  const s = withStatus("review"), f = F({ hasPr: true, review: "approved" });
  assert.equal(offersAction(s, f, "merge"), true);
  assert.equal(offersAction(s, f, "start"), false);
});

test("destructive actions (merge / close) are confirm-armed", () => {
  const merge = availableActions(withStatus("review"), F({ hasPr: true, review: "approved" })).find((a) => a.id === "merge");
  const close = availableActions(withStatus("working"), F()).find((a) => a.id === "close");
  assert.equal(merge?.confirm, true);
  assert.equal(close?.confirm, true);
});

test("cancel is offered when work is in flight, not when parked cleanly", () => {
  assert.equal(offersAction(withStatus("review"), F({ hasPr: true }), "cancel"), true);
  assert.equal(offersAction(withStatus("planned"), F(), "cancel"), false);
});
