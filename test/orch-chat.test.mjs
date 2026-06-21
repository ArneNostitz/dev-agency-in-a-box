// Tests for the Orchestrator handoff parser (v4) — pure parsing of the agent's ```handoff block.
import test from "node:test";
import assert from "node:assert/strict";
import { parseHandoff } from "../dist/agents/orchestrator-chat.js";

test("no block → null", () => {
  assert.equal(parseHandoff("just chatting, no proposal here"), null);
});

test("full-build single issue", () => {
  const p = parseHandoff("Here's what I'd build:\n\n```handoff\nworkflow: full-build\n- [Add password reset] email-link reset using the mailer; routes + UI + tests\n```");
  assert.equal(p.workflow, "full-build");
  assert.equal(p.issues.length, 1);
  assert.equal(p.issues[0].title, "Add password reset");
  assert.match(p.issues[0].scope, /email-link reset/);
});

test("split into ordered epics", () => {
  const p = parseHandoff("```handoff\nworkflow: split\n- [Epic 1: data model] schema + migration\n- [Epic 2: API] endpoints\n- [Epic 3: UI] dashboard\n```");
  assert.equal(p.workflow, "split");
  assert.equal(p.issues.length, 3);
  assert.equal(p.issues[2].title, "Epic 3: UI");
});

test("invalid workflow falls back by issue count", () => {
  assert.equal(parseHandoff("```handoff\nworkflow: nonsense\n- [One] a\n```").workflow, "full-build");
  assert.equal(parseHandoff("```handoff\nworkflow: nonsense\n- [One] a\n- [Two] b\n```").workflow, "split");
});

test("block with no issues → null", () => {
  assert.equal(parseHandoff("```handoff\nworkflow: full-build\n```"), null);
});
