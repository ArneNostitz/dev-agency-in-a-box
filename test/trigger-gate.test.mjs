// canTrigger gates comment-driven re-engagement to repo members (docs/adr/0003 — @mention-based
// intake and the label trigger-mode are gone; the dashboard is the only place work begins).
import test from "node:test";
import assert from "node:assert/strict";
import { canTrigger } from "../dist/github.js";

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
