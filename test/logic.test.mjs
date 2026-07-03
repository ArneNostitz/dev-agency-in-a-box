// Unit tests for the agency's pure logic. Run with: npm test
// They import the compiled output in dist/, so run `npm run build` first (npm test does).
import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENCY_MARKER, buildNativeSubIssueData } from "../dist/github.js";
import { roleForText, loadHandleRoleMap, modelFor, ROLES, MODELS } from "../dist/agents/roles.js";
import { parsePlannerDecision, isApproval, parseSubIssues } from "../dist/pipeline.js";
import { parseControlCommand } from "../dist/commands.js";
import { dispatch, drain } from "../dist/pool.js";
import { overBudget, loadBudget, effectiveLimits, setIssueBudget } from "../dist/budget.js";
import { parseLessons } from "../dist/reflect.js";
import { decideThreadAction } from "../dist/route.js";
import { isNoOpComment } from "../dist/github.js";
import { renderEpicTracker, childStatus } from "../dist/epics.js";
import { recordIssueStatus } from "../dist/store.js";
import { withStatus, setBlocked } from "../dist/state.js";
import { parseRateLimit, nextWindowReset, parseResetClock } from "../dist/ratelimit.js";
import { pickWebDevScript, isTauriPackage, parseDevPort, parseTunnelUrl, buildLocalCommand } from "../dist/apprun.js";
import { registerRun, stopRuns, hasActiveRun } from "../dist/abort.js";
import { parseAuditProposals } from "../dist/auditparse.js";
import { preparePiConfig, PI_TEMPLATE } from "../dist/runners/sdk-pi.js";
import { runnerKindFor } from "../dist/runners/exec.js";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

test("parseAuditProposals: fenced json, bare array, prose-wrapped, empty, malformed", () => {
  const fenced = 'Here are my findings:\n```json\n[{"title":"Split god object","body":"evidence…"}]\n```\nDone.';
  assert.deepEqual(parseAuditProposals(fenced), [{ title: "Split god object", body: "evidence…" }]);

  const bare = 'prose before [{"title":"A","body":"b"},{"title":"C","body":"d"}] prose after';
  assert.equal(parseAuditProposals(bare).length, 2);

  assert.deepEqual(parseAuditProposals("[]"), [], "empty array → no proposals");
  assert.deepEqual(parseAuditProposals("the codebase is healthy, no issues"), [], "no JSON → []");
  // items missing required string fields are dropped
  assert.deepEqual(parseAuditProposals('[{"title":"ok","body":"b"},{"title":123},{"nope":1}]'), [{ title: "ok", body: "b" }]);
});

test("abort registry: registerRun tracks, stopRuns aborts + clears, release cleans up", () => {
  const repo = "o/r", n = 42;
  assert.equal(hasActiveRun(repo, n), false);
  const a = registerRun(repo, n);
  const b = registerRun(repo, n); // two concurrent role runs on the same issue
  assert.equal(hasActiveRun(repo, n), true);
  assert.equal(a.controller.signal.aborted, false);
  const stopped = stopRuns(repo, n);
  assert.equal(stopped, 2, "both runs aborted");
  assert.equal(a.controller.signal.aborted, true);
  assert.equal(b.controller.signal.aborted, true);
  assert.equal(hasActiveRun(repo, n), false, "registry cleared after stop");
  a.release(); b.release(); // releasing after stop is safe (no throw)
  assert.equal(stopRuns(repo, n), 0, "nothing left to stop");
});

test("abort registry: a run releasing leaves others intact", () => {
  const repo = "o/r2", n = 7;
  const a = registerRun(repo, n);
  const b = registerRun(repo, n);
  a.release();
  assert.equal(hasActiveRun(repo, n), true, "b still active");
  assert.equal(stopRuns(repo, n), 1, "only b remains to abort");
  assert.equal(b.controller.signal.aborted, true);
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

test("planner defaults to Sonnet (opus opt-in via PLANNER_MODEL), mapped to @plan", () => {
  // Cost optimization (v1.4.x): the planner/decomposer default to Sonnet; Opus stays available via
  // the per-role *_MODEL env override for genuinely hard issues. MODELS.opus is still the 4.8 id.
  assert.equal(ROLES.planner.defaultModel, MODELS.sonnet);
  assert.equal(ROLES.decomposer.defaultModel, MODELS.sonnet);
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
  // per-issue override + unlimited flag (replaces the old agency:unlimited label — #67)
  setIssueBudget("x/y", 1, { unlimited: true });
  assert.equal(effectiveLimits("x/y", 1).unlimited, true);
  setIssueBudget("x/y", 1, { maxCostUsd: 2 });
  assert.equal(effectiveLimits("x/y", 1).maxIssueCostUsd, 2);
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
    hasOpenPr: false,
  };
  // fresh, never-triaged issue: nothing auto-starts it (it sits in Inbox instead — #103)
  assert.equal(decideThreadAction({ ...base }), "skip");
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

test("childStatus maps DB status/closed to a human status", () => {
  const repo = "o/childstatus";
  assert.equal(childStatus(repo, { number: 1, closed: true }), "done");
  recordIssueStatus(repo, 2, withStatus("review"));
  assert.equal(childStatus(repo, { number: 2, closed: false }), "in review");
  recordIssueStatus(repo, 3, withStatus("working"));
  assert.equal(childStatus(repo, { number: 3, closed: false }), "working");
  recordIssueStatus(repo, 4, setBlocked(withStatus("working"), "needsAttention"));
  assert.equal(childStatus(repo, { number: 4, closed: false }), "blocked");
  assert.equal(childStatus(repo, { number: 999, closed: false }), "open");
});

test("parseRateLimit detects usage walls and reads a reset time", () => {
  assert.equal(parseRateLimit("boom: something failed").limited, false);
  assert.equal(parseRateLimit("Claude usage limit reached").limited, true);
  assert.equal(parseRateLimit("API Error: 429 too many requests").limited, true);
  // epoch reset time (seconds)
  const r = parseRateLimit("rate_limit_error; your limit will reset at 1893456000");
  assert.equal(r.limited, true);
  assert.equal(r.resetAt, 1893456000 * 1000);
  // the real Claude subscription message format
  const s = parseRateLimit("Claude Code returned an error result: You've hit your session limit · resets 12:40am (UTC)");
  assert.equal(s.limited, true);
  assert.ok(s.resetAt && s.resetAt > 0);
  // NOT a Claude usage limit — must not pause all agents:
  assert.equal(parseRateLimit("gh: API rate limit exceeded for user ArneNostitz").limited, false, "GitHub API rate limit");
  assert.equal(parseRateLimit("You have exceeded a secondary rate limit").limited, false, "GitHub secondary rate limit");
  assert.equal(parseRateLimit("error: disk quota exceeded").limited, false, "generic quota");
  assert.equal(parseRateLimit("overloaded_error: server is busy").limited, false, "transient overload, not a usage wall");
  assert.equal(parseRateLimit("the cache resets at midnight").limited, false, "incidental 'resets at' text");
});

test("parseResetClock reads 'resets 12:40am (UTC)' to the next occurrence", () => {
  const now = Date.parse("2026-06-09T20:00:00.000Z"); // 8pm UTC
  const t = parseResetClock("You've hit your session limit · resets 12:40am (UTC)", now);
  // 00:40 UTC has passed for today's date relative to 20:00 -> next day 00:40
  assert.equal(t, Date.parse("2026-06-10T00:40:00.000Z"));
  assert.equal(parseResetClock("no time here", now), undefined);
});

test("nextWindowReset rolls forward from an anchor", () => {
  const anchor = "2026-01-01T10:00:00.000Z";
  const now = Date.parse("2026-01-01T12:30:00.000Z"); // 2.5h after a 5h-window anchor
  assert.equal(nextWindowReset(now, 5, anchor), Date.parse("2026-01-01T15:00:00.000Z"));
  // no anchor -> rolling now+window
  assert.equal(nextWindowReset(now, 5, null), now + 5 * 3600000);
});

test("pickWebDevScript prefers the web dev server, never the native one", () => {
  assert.equal(pickWebDevScript({ dev: "vite dev", "tauri:dev": "tauri dev" }), "dev");
  assert.equal(pickWebDevScript({ start: "next start" }), "start");
  // a tauri-only dev script is skipped in favour of a real web one
  assert.equal(pickWebDevScript({ "tauri:dev": "tauri dev", "dev:web": "vite dev" }), "dev:web");
  assert.equal(pickWebDevScript({ build: "vite build" }), null);
});

test("isTauriPackage detects Tauri apps", () => {
  assert.equal(isTauriPackage(JSON.stringify({ dependencies: { "@tauri-apps/api": "^2" } }), false), true);
  assert.equal(isTauriPackage("{}", true), true); // has src-tauri
  assert.equal(isTauriPackage(JSON.stringify({ dependencies: { react: "^18" } }), false), false);
});

test("parseDevPort / parseTunnelUrl read server + tunnel output", () => {
  assert.equal(parseDevPort("  ➜  Local:   http://localhost:5173/"), 5173);
  assert.equal(parseDevPort("started server on 0.0.0.0:3000"), 3000);
  assert.equal(parseDevPort("compiling..."), 0);
  assert.equal(parseTunnelUrl("your url is https://blue-fox-123.trycloudflare.com"), "https://blue-fox-123.trycloudflare.com");
});

test("buildLocalCommand produces a runnable mac script for the branch", () => {
  const s = buildLocalCommand("ArneNostitz", "reimedy-minimal", "agency/issue-94");
  assert.ok(s.startsWith("#!/bin/bash"));
  assert.ok(s.includes("agency/issue-94"));
  assert.ok(s.includes("ArneNostitz/reimedy-minimal"));
  assert.ok(s.includes("tauri:dev") || s.includes("tauri dev"));
});

test("buildNativeSubIssueData: maps parent→children and child→parent", () => {
  const data = buildNativeSubIssueData([
    {
      parent: { number: 5, title: "Big refactor" },
      children: [
        { number: 10, title: "Sub A", state: "open" },
        { number: 11, title: "Sub B", state: "closed" },
      ],
    },
  ]);
  // parent → children
  assert.equal(data.parentToChildren[5].length, 2);
  assert.equal(data.parentToChildren[5][0].number, 10);
  assert.equal(data.parentToChildren[5][0].closed, false);
  assert.equal(data.parentToChildren[5][1].number, 11);
  assert.equal(data.parentToChildren[5][1].closed, true);
  // child → parent
  assert.deepEqual(data.childToParent[10], { number: 5, title: "Big refactor" });
  assert.deepEqual(data.childToParent[11], { number: 5, title: "Big refactor" });
});

test("buildNativeSubIssueData: empty pairs → empty maps", () => {
  const data = buildNativeSubIssueData([]);
  assert.deepEqual(data.parentToChildren, {});
  assert.deepEqual(data.childToParent, {});
});

test("buildNativeSubIssueData: pairs with no children are skipped", () => {
  const data = buildNativeSubIssueData([
    { parent: { number: 1, title: "Empty epic" }, children: [] },
  ]);
  assert.deepEqual(data.parentToChildren, {});
  assert.deepEqual(data.childToParent, {});
});

test("buildNativeSubIssueData: multiple parents handled independently", () => {
  const data = buildNativeSubIssueData([
    { parent: { number: 1, title: "Epic A" }, children: [{ number: 2, title: "Child A1", state: "open" }] },
    { parent: { number: 3, title: "Epic B" }, children: [{ number: 4, title: "Child B1", state: "closed" }] },
  ]);
  assert.equal(Object.keys(data.parentToChildren).length, 2);
  assert.deepEqual(data.childToParent[2], { number: 1, title: "Epic A" });
  assert.deepEqual(data.childToParent[4], { number: 3, title: "Epic B" });
  assert.equal(data.parentToChildren[3][0].closed, true);
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

import { canonicalModel } from "../dist/agents/roles.js";

test("canonicalModel: fixes Claude id ordering/aliases, leaves third-party untouched", () => {
  assert.equal(canonicalModel("claude-4-6-sonnet"), "claude-sonnet-4-6");   // the bug from the screenshots
  assert.equal(canonicalModel("claude-4-8-opus"), "claude-opus-4-8");
  assert.equal(canonicalModel("claude-sonnet-4.6"), "claude-sonnet-4-6");   // dots → dashes
  assert.equal(canonicalModel("sonnet"), "claude-sonnet-4-6");              // bare family
  assert.equal(canonicalModel("opus"), "claude-opus-4-8");
  assert.equal(canonicalModel("claude-haiku-4-5"), "claude-haiku-4-5-20251001"); // haiku gets its date
  assert.equal(canonicalModel("claude-sonnet-4-6"), "claude-sonnet-4-6");   // already canonical
  assert.equal(canonicalModel("glm-5.2"), "glm-5.2");                       // third-party untouched
  assert.equal(canonicalModel("gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(canonicalModel(""), "");
});

import { requestStop, isStopRequested, clearStop } from "../dist/abort.js";

test("stop flag: request → set, clear → unset, isolated per issue", () => {
  clearStop("o/r", 1); clearStop("o/r", 2);
  assert.equal(isStopRequested("o/r", 1), false);
  requestStop("o/r", 1);
  assert.equal(isStopRequested("o/r", 1), true);
  assert.equal(isStopRequested("o/r", 2), false); // other issue unaffected
  clearStop("o/r", 1);
  assert.equal(isStopRequested("o/r", 1), false);
});

test("preparePiConfig: resolves a provider to its pi builtin key (auth lives in pi's real auth.json now, no isolated dir)", () => {
  // piKey on the row is the primary source (set when added via the preset dropdown).
  assert.equal(preparePiConfig({ id: "g1", name: "Gemini", piKey: "google", apiKey: "k", models: [] }).piProvider, "google", "explicit piKey wins");
  // Legacy rows without piKey fall back to baseUrl/name inference (GLM → zai).
  const glm = { id: "glm-1", name: "GLM (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKey: "zhipu-key", models: ["glm-5.2"] };
  assert.equal(preparePiConfig(glm).piProvider, "zai", "GLM/Zhipu resolves to pi's builtin 'zai'");
  // No isolated agent dir is returned anymore — auth is in pi's real ~/.pi/agent/auth.json.
  assert.equal(preparePiConfig(glm).agentDir, undefined, "no isolated agent dir (auth in pi's real store)");
});

test("preparePiConfig: the pi invocation template uses --provider so pi targets the right builtin", () => {
  assert.match(PI_TEMPLATE, /--provider \{piProvider\}/);
  assert.match(PI_TEMPLATE, /--model \{model\}/);
});

test("preparePiConfig: Claude-native / empty providers resolve safely", () => {
  // An Anthropic-host base URL is the default endpoint, not a custom pi provider.
  assert.equal(preparePiConfig({ id: "a", name: "Anthropic", baseUrl: "https://api.anthropic.com", apiKey: "k", models: [] }).piProvider, "anthropic");
  assert.equal(preparePiConfig(null).piProvider, "", "null provider → empty key");
});

test("#108 scenario: a provider whose runner is 'pi-cli' resolves to the pi runner — it does NOT fall back to claude-sdk", () => {
  const glmViaPi = { id: "glm-1", name: "GLM (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKey: "zhipu-key", models: ["glm-5.2"], runner: "pi-cli" };
  assert.equal(runnerKindFor(glmViaPi), "pi-cli", "GLM with runner=pi-cli must route through the pi runner");
  // Without the per-provider runner set, the global default (claude-sdk) is used instead.
  const glmNoRunner = { ...glmViaPi, runner: undefined };
  assert.equal(runnerKindFor(glmNoRunner), "claude-sdk");
});

test("#108 scenario: a Claude-native run (no provider) resolves to claude-sdk", () => {
  assert.equal(runnerKindFor(null), "claude-sdk");
});
