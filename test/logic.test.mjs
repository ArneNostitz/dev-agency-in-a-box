// Unit tests for the agency's pure logic. Run with: npm test
// They import the compiled output in dist/, so run `npm run build` first (npm test does).
import { test } from "node:test";
import assert from "node:assert/strict";

import { mentionsHandle, AGENCY_MARKER } from "../dist/github.js";
import { roleForText, loadHandleRoleMap, modelFor, ROLES, MODELS } from "../dist/agents/roles.js";
import { parsePlannerDecision } from "../dist/pipeline.js";

test("mentionsHandle matches whole handles only", () => {
  const H = ["@dev", "@agency"];
  assert.equal(mentionsHandle("@dev please fix", H), true);
  assert.equal(mentionsHandle("ping @agency now", H), true);
  assert.equal(mentionsHandle("contact foo@developer about it", H), false); // not @dev
  assert.equal(mentionsHandle("no mention here", H), false);
  assert.equal(mentionsHandle("DEV without at-sign", H), false);
});

test("roleForText picks the first mentioned handle's role", () => {
  const map = { "@dev": "developer", "@arch": "architect", "@review": "reviewer" };
  assert.equal(roleForText("please @arch plan this", map), "architect");
  assert.equal(roleForText("@dev then maybe @arch", map), "developer"); // first by position
  assert.equal(roleForText("nobody pinged", map), null);
});

test("loadHandleRoleMap reads config/team.txt", () => {
  const map = loadHandleRoleMap();
  assert.equal(map["@dev"], "developer");
  assert.equal(map["@arch"], "architect");
  assert.equal(map["@review"], "reviewer");
  assert.equal(map["@test"], "tester");
});

test("modelFor honors per-role env override, else default", () => {
  delete process.env.AGENT_MODEL;
  delete process.env.DEVELOPER_MODEL;
  assert.equal(modelFor(ROLES.developer), ROLES.developer.defaultModel);

  process.env.DEVELOPER_MODEL = "custom-model-x";
  assert.equal(modelFor(ROLES.developer), "custom-model-x");
  delete process.env.DEVELOPER_MODEL;

  // Tester defaults to the cheap (haiku) model.
  assert.equal(ROLES.tester.defaultModel, MODELS.haiku);
});

test("each role declares tools and a model", () => {
  for (const role of Object.values(ROLES)) {
    assert.ok(role.tools.length > 0, `${role.name} has tools`);
    assert.ok(role.defaultModel, `${role.name} has a default model`);
  }
});

test("planner is the Opus 4.8 role, mapped to @plan", () => {
  assert.equal(ROLES.planner.defaultModel, MODELS.opus);
  assert.equal(MODELS.opus, "claude-opus-4-8");
  assert.equal(loadHandleRoleMap()["@plan"], "planner");
});

test("parsePlannerDecision reads the leading QUESTIONS/PLAN signal", () => {
  assert.equal(parsePlannerDecision("QUESTIONS\n1. Which DB?").kind, "questions");
  assert.equal(parsePlannerDecision("PLAN\nGoal: ...").kind, "plan");
  assert.equal(parsePlannerDecision("PLAN: do the thing").body, "do the thing");
  // No marker -> treat as a plan and proceed.
  assert.equal(parsePlannerDecision("Here is what I'd do...").kind, "plan");
});

test("agency comments carry a hidden marker (to detect human replies)", () => {
  assert.ok(AGENCY_MARKER.includes("dev-agency"));
});
