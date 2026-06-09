// Unit tests for the agency's pure logic. Run with: npm test
// They import the compiled output in dist/, so run `npm run build` first (npm test does).
import { test } from "node:test";
import assert from "node:assert/strict";

import { mentionsHandle, AGENCY_MARKER } from "../dist/github.js";
import { roleForText, loadHandleRoleMap, modelFor, ROLES, MODELS } from "../dist/agents/roles.js";
import { parsePlannerDecision, isApproval, parseSubIssues } from "../dist/pipeline.js";
import { parseControlCommand } from "../dist/commands.js";
import { dispatch, drain } from "../dist/pool.js";
import { overBudget, loadBudget, UNLIMITED_LABEL } from "../dist/budget.js";
import { parseLessons } from "../dist/reflect.js";
import { decideThreadAction } from "../dist/route.js";
import { isNoOpComment } from "../dist/github.js";
import { renderEpicTracker, childStatus } from "../dist/epics.js";
import { parseRateLimit, nextWindowReset } from "../dist/ratelimit.js";

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
  // AUTO marker for small tasks -> build without approval.
  assert.equal(parsePlannerDecision("PLAN AUTO\nadd a field").auto, true);
  assert.equal(parsePlannerDecision("PLAN\nbig thing").auto, false);
});

test("agency comments carry a hidden marker (to detect human replies)", () => {
  assert.ok(AGENCY_MARKER.includes("dev-agency"));
});

test("isApproval only fires on a short ok-style last human reply", () => {
  const sep = "\n\n---\n\n";
  assert.equal(isApproval(`[agency] **Proposed approach** ...${sep}[human] ok`), true);
  assert.equal(isApproval(`[agency] proposal${sep}[human] go ahead`), true);
  assert.equal(isApproval(`[agency] proposal${sep}[human] lgtm!`), true);
  // feedback, not approval
  assert.equal(isApproval(`[agency] proposal${sep}[human] ok but use a modal instead`), false);
  assert.equal(isApproval(`[agency] proposal${sep}[human] can you also add tests?`), false);
  // last message is the agency's, not the human's
  assert.equal(isApproval(`[human] ok${sep}[agency] building...`), false);
});

test("parseSubIssues reads a SUB-ISSUES breakdown", () => {
  const plan = "PLAN\nGoal: refactor\n\n### SUB-ISSUES\n- [ScheduleEditor atoms] @dev replace className arrays\n- [Weekday names] @dev source from common.weekdaysLong\n";
  const subs = parseSubIssues(plan);
  assert.equal(subs.length, 2);
  assert.equal(subs[0].title, "ScheduleEditor atoms");
  assert.ok(subs[0].body.includes("@dev"));
  assert.deepEqual(parseSubIssues("PLAN\njust build it, one issue"), []);
});

test("pool dedups by key and runs each unit once", async () => {
  let runs = 0;
  dispatch("k1", async () => { runs++; await new Promise((r) => setTimeout(r, 10)); });
  dispatch("k1", async () => { runs++; }); // ignored: k1 already in flight
  dispatch("k2", async () => { runs++; });
  await drain();
  assert.equal(runs, 2);
});

test("overBudget enforces cost + turn limits; 0 disables", () => {
  const limits = { maxIssueCostUsd: 10, maxIssueTurns: 100, maxTurnsPerRun: 50 };
  assert.equal(overBudget({ costUsd: 2, turns: 30 }, limits), null);
  assert.ok(overBudget({ costUsd: 12, turns: 30 }, limits)); // over cost
  assert.ok(overBudget({ costUsd: 2, turns: 150 }, limits)); // over turns
  assert.equal(overBudget({ costUsd: 999, turns: 9999 }, { ...limits, maxIssueCostUsd: 0, maxIssueTurns: 0 }), null);
  assert.equal(UNLIMITED_LABEL, "agency:unlimited");
  // defaults load and are sane
  const b = loadBudget();
  assert.ok(b.maxTurnsPerRun > 0);
});

test("parseLessons reads the librarian's LESSONS/NOTHING reply", () => {
  assert.deepEqual(parseLessons("NOTHING"), []);
  assert.deepEqual(parseLessons("  nothing\n"), []);
  const out = parseLessons("LESSONS:\n- repo uses pnpm, corepack enable first\n- tests need DATABASE_URL set");
  assert.equal(out.length, 2);
  assert.ok(out[0].includes("pnpm"));
  // caps at 3
  assert.equal(parseLessons("LESSONS:\n- a\n- b\n- c\n- d").length, 3);
  // no marker -> nothing stored (be conservative)
  assert.deepEqual(parseLessons("here are some thoughts..."), []);
});

test("librarian role exists: cheap model, read-only tools", () => {
  assert.equal(ROLES.librarian.defaultModel, MODELS.haiku);
  assert.ok(!ROLES.librarian.tools.includes("Bash"));
  assert.ok(!ROLES.librarian.tools.includes("Write"));
});

test("decideThreadAction: once owned, a new comment re-engages (no re-tag)", () => {
  const base = {
    ignored: false, inProgress: false, closed: false, ready: false, needsAttention: false,
    awaiting: false, owned: false, newHumanComment: false, approvedReaction: false,
    hasOpenPr: false, triggerMatch: false,
  };
  // fresh untouched issue: needs the trigger
  assert.equal(decideThreadAction({ ...base, triggerMatch: true }), "fresh");
  assert.equal(decideThreadAction({ ...base, triggerMatch: false }), "skip");
  // owned + new comment, no PR, open -> re-run pipeline (no tag needed)
  assert.equal(decideThreadAction({ ...base, owned: true, newHumanComment: true }), "fresh");
  // owned + new comment on a CLOSED/merged thread -> follow-up build
  assert.equal(decideThreadAction({ ...base, owned: true, newHumanComment: true, closed: true }), "followup");
  assert.equal(decideThreadAction({ ...base, owned: true, newHumanComment: true, ready: true }), "followup");
  // a new comment with an OPEN PR -> PR fix
  assert.equal(decideThreadAction({ ...base, owned: true, newHumanComment: true, ready: true, hasOpenPr: true }), "prfix");
  // paused: resume on a reply OR a 👍, skip otherwise
  assert.equal(decideThreadAction({ ...base, awaiting: true, owned: true, newHumanComment: true }), "resume");
  assert.equal(decideThreadAction({ ...base, awaiting: true, owned: true, approvedReaction: true }), "resume");
  assert.equal(decideThreadAction({ ...base, awaiting: true, owned: true }), "skip");
  // never double-dispatch or touch ignored / in-progress
  assert.equal(decideThreadAction({ ...base, inProgress: true, owned: true, newHumanComment: true }), "skip");
  assert.equal(decideThreadAction({ ...base, ignored: true, owned: true, newHumanComment: true }), "skip");
  // untouched closed issue with a stray comment: do nothing
  assert.equal(decideThreadAction({ ...base, closed: true, newHumanComment: true }), "skip");
});

test("isNoOpComment skips praise, lets real requests through", () => {
  assert.equal(isNoOpComment("thanks!"), true);
  assert.equal(isNoOpComment("looks good"), true);
  assert.equal(isNoOpComment("👍"), true);
  assert.equal(isNoOpComment("LGTM"), true);
  assert.equal(isNoOpComment("the header is misaligned, fix it"), false);
  assert.equal(isNoOpComment("also add a logout button"), false);
});

test("epic tracker renders a progress checklist", () => {
  const t = renderEpicTracker([
    { child: 12, title: "Schema", state: "done", closed: 1 },
    { child: 13, title: "API", state: "in review", closed: 0 },
  ]);
  assert.ok(t.includes("1/2 done"));
  assert.ok(t.includes("- [x] #12"));
  assert.ok(t.includes("- [ ] #13"));
});

test("childStatus maps labels/closed to a human status", () => {
  assert.equal(childStatus({ closed: true, labels: [] }), "done");
  assert.equal(childStatus({ closed: false, labels: ["agency:ready"] }), "in review");
  assert.equal(childStatus({ closed: false, labels: ["agency:in-progress"] }), "working");
  assert.equal(childStatus({ closed: false, labels: ["agency:needs-attention"] }), "blocked");
  assert.equal(childStatus({ closed: false, labels: [] }), "open");
});

test("parseRateLimit detects usage walls and reads a reset time", () => {
  assert.equal(parseRateLimit("boom: something failed").limited, false);
  assert.equal(parseRateLimit("Claude usage limit reached").limited, true);
  assert.equal(parseRateLimit("API Error: 429 too many requests").limited, true);
  // epoch reset time (seconds)
  const r = parseRateLimit("rate_limit_error; your limit will reset at 1893456000");
  assert.equal(r.limited, true);
  assert.equal(r.resetAt, 1893456000 * 1000);
});

test("nextWindowReset rolls forward from an anchor", () => {
  const anchor = "2026-01-01T10:00:00.000Z";
  const now = Date.parse("2026-01-01T12:30:00.000Z"); // 2.5h after a 5h-window anchor
  assert.equal(nextWindowReset(now, 5, anchor), Date.parse("2026-01-01T15:00:00.000Z"));
  // no anchor -> rolling now+window
  assert.equal(nextWindowReset(now, 5, null), now + 5 * 3600000);
});

test("parseControlCommand recognizes /add-repo and /list-repos", () => {
  assert.deepEqual(parseControlCommand("/add-repo my-app", ""), { type: "add-repo", repo: "my-app" });
  assert.deepEqual(parseControlCommand("please add it", "/add-repo org/app"), {
    type: "add-repo",
    repo: "org/app",
  });
  assert.deepEqual(parseControlCommand("/list-repos", ""), { type: "list-repos" });
  assert.equal(parseControlCommand("just a normal issue", "do the thing"), null);
});
