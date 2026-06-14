// Tests for searchMemory — the backend of the `recall` agent tool (Phase 1).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-recall-")), "test.db");
const s = await import("../dist/store.js");

test("searchMemory: empty query / no data → []", () => {
  assert.deepEqual(s.searchMemory(""), []);
  assert.deepEqual(s.searchMemory("anything"), []);
});

test("searchMemory: finds and ranks across lessons, plans, reviews, issues", () => {
  s.recordLesson("acme/app", 1, "Resolve merge conflicts by merging origin/main, never rebasing the shared branch.");
  s.recordPlan("acme/app", 2, "Plan: add rate limit handling with exponential backoff to the API client.");
  s.recordReview("acme/app", 3, "approved", "Rate limit retry looks correct; backoff capped at 30s.");
  s.recordIssueState("acme/app", 4, { title: "Fix flaky rate limit test", state: "planned" });

  const hits = s.searchMemory("rate limit");
  assert.ok(hits.length >= 2, "matches multiple sources");
  assert.ok(hits.every((h) => h.text.toLowerCase().includes("rate limit") || h.text.toLowerCase().includes("rate")), "hits are relevant");
  assert.ok(hits.some((h) => h.kind === "plan"), "includes the plan");

  const conflict = s.searchMemory("merge conflict");
  assert.ok(conflict.some((h) => h.kind === "lesson"), "finds the conflict lesson");

  assert.deepEqual(s.searchMemory("zzz-nonexistent-term"), [], "no false matches");
});

test("searchMemory: respects limit and truncates long text", () => {
  for (let i = 10; i < 30; i++) s.recordLesson("acme/app", i, "caching strategy note number " + i);
  const hits = s.searchMemory("caching", { limit: 5 });
  assert.equal(hits.length, 5, "limit honored");
  assert.ok(hits[0].text.length <= 800, "text capped");
});
