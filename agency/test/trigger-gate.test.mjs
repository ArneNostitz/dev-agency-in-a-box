// The dashboard is the control plane: GitHub only auto-starts via an @mention from a repo member.
import test from "node:test";
import assert from "node:assert/strict";
import { canTrigger, mentionsHandle } from "../dist/github.js";

test("repo members may trigger", () => {
  for (const a of ["OWNER", "MEMBER", "COLLABORATOR", "owner", "collaborator"]) {
    assert.equal(canTrigger(a), true, a);
  }
});

test("non-members may not trigger", () => {
  for (const a of ["CONTRIBUTOR", "NONE", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN", "", undefined]) {
    assert.equal(canTrigger(a), false, String(a));
  }
});

test("mention detection still matches whole handles only", () => {
  assert.equal(mentionsHandle("hey @dev please build", ["@dev"]), true);
  assert.equal(mentionsHandle("ping @developer", ["@dev"]), false);
  assert.equal(mentionsHandle("no handle here", ["@dev", "@plan"]), false);
  assert.equal(mentionsHandle("let's @plan this", ["@dev", "@plan"]), true);
});

test("auto-start requires BOTH a member author AND a mention", () => {
  // mirrors the runner's gate: triggerMatch = mention && canTrigger(assoc)
  const gate = (text, handles, assoc) => mentionsHandle(text, handles) && canTrigger(assoc);
  assert.equal(gate("@dev go", ["@dev"], "OWNER"), true);
  assert.equal(gate("@dev go", ["@dev"], "NONE"), false); // member gate blocks outsiders
  assert.equal(gate("just an idea", ["@dev"], "OWNER"), false); // no mention → Planned
});
