// analyzerIssueTitle: the analyzer service (deployed separately) has sent the same boilerplate
// title on every advisory report for months — a repo's issue list fills with identical,
// indistinguishable entries. Derive a specific title from the report body instead.
import test from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { analyzerIssueTitle } = await import("../dist/webhook.js");

const REAL_BODY = `🔬 **Process Analyzer — self-improvement proposals** (advisory; approve what you like)

## Process Analysis Report — 2026-06-25

---

### 🚨 Critical Finding: GitHub API Rate-Limit Hammering (5,759 failures)

The single operational issue is severe.

---

## Proposals (highest impact first)

---

### 1. 🔧 Hook — Circuit-Breaker on \`gh api\`
`;

test("generic title + a critical finding -> date + critical headline", () => {
  const t = analyzerIssueTitle("Process Analyzer: improvement proposals", REAL_BODY);
  assert.equal(t, "Process Analyzer: GitHub API Rate-Limit Hammering (5,759 failures) (2026-06-25)");
});

test("generic title, no critical finding -> falls back to the first proposal headline", () => {
  const body = `## Process Analysis Report — 2026-07-01\n\n## Proposals\n\n### 1. 🔧 Cache repeated \`git log\` calls\n`;
  const t = analyzerIssueTitle("Process Analyzer: proposals", body);
  assert.equal(t, "Process Analyzer: Cache repeated git log calls (2026-07-01)");
});

test("no parseable structure -> generic fallback, still dated if a date is present", () => {
  const t = analyzerIssueTitle("", "no structured sections here");
  assert.equal(t, "Process Analyzer: improvement proposals");
});

test("a non-generic supplied title is left untouched", () => {
  const t = analyzerIssueTitle("Fix the flaky deploy pipeline", REAL_BODY);
  assert.equal(t, "Fix the flaky deploy pipeline");
});

test("title is capped at 200 chars", () => {
  const longBody = `## Process Analysis Report — 2026-01-01\n\n### 🚨 Critical Finding: ${"x".repeat(300)}\n`;
  const t = analyzerIssueTitle("Process Analyzer: proposals", longBody);
  assert.ok(t.length <= 200);
});
