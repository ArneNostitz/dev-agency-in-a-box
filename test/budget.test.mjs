// Tests for per-issue budget overrides + effectiveLimits (#67).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-budget-")), "test.db");
// force deterministic global limits
process.env.MAX_ISSUE_COST_USD = "10";
process.env.MAX_ISSUE_TURNS = "100";

const b = await import("../dist/budget.js");
const s = await import("../dist/store.js");
const REPO = "octocat/Hello-World";

test("global loadBudget reads env defaults", () => {
  const g = b.loadBudget();
  assert.equal(g.maxIssueCostUsd, 10);
  assert.equal(g.maxIssueTurns, 100);
});

test("effectiveLimits falls back to global when no override is set", () => {
  const e = b.effectiveLimits(REPO, 1);
  assert.equal(e.maxIssueCostUsd, 10);
  assert.equal(e.unlimited, false);
});

test("a per-issue override tightens the cost cap and leaves the rest global", () => {
  b.setIssueBudget(REPO, 2, { maxCostUsd: 3 });
  const e = b.effectiveLimits(REPO, 2);
  assert.equal(e.maxIssueCostUsd, 3); // overridden
  assert.equal(e.maxIssueTurns, 100); // inherited
  assert.equal(e.unlimited, false);
});

test("the unlimited flag exempts the issue from every check", () => {
  b.setIssueUnlimited(REPO, 3, true);
  const e = b.effectiveLimits(REPO, 3);
  assert.equal(e.unlimited, true);
});

test("clearing an override returns to global", () => {
  b.setIssueBudget(REPO, 2, { maxCostUsd: 3 });
  assert.equal(b.effectiveLimits(REPO, 2).maxIssueCostUsd, 3);
  b.setIssueBudget(REPO, 2, null);
  assert.equal(b.effectiveLimits(REPO, 2).maxIssueCostUsd, 10);
});

test("overBudget reports the binding constraint (cost first, then turns)", () => {
  const limits = { maxIssueCostUsd: 5, maxIssueTurns: 50, maxTurnsPerRun: 10, maxTokensPerRun: 1000 };
  assert.equal(b.overBudget({ costUsd: 6, turns: 1 }, limits), "spent $6.00 (limit $5)");
  assert.equal(b.overBudget({ costUsd: 1, turns: 60 }, limits), "used 60 agent turns (limit 50)");
  assert.equal(b.overBudget({ costUsd: 1, turns: 1 }, limits), null);
});

test("a limit of 0 disables that check (e.g. subscription auth has no cost ceiling)", () => {
  const limits = { maxIssueCostUsd: 0, maxIssueTurns: 50, maxTurnsPerRun: 10, maxTokensPerRun: 1000 };
  assert.equal(b.overBudget({ costUsd: 9999, turns: 1 }, limits), null); // cost disabled
  assert.equal(b.overBudget({ costUsd: 0, turns: 60 }, limits), "used 60 agent turns (limit 50)");
});

test("a malformed stored budget is ignored (falls back to global)", () => {
  // write garbage directly via the settings key
  s.setSetting(`issue_budget.${REPO}#9`, "not-json{");
  assert.equal(b.getIssueBudget(REPO, 9), null);
  assert.equal(b.effectiveLimits(REPO, 9).maxIssueCostUsd, 10); // global, no crash
});
