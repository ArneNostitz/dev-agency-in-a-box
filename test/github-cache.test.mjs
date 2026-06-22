// threadSignals updatedAt cache (perf): same updatedAt reuses the result (skips the gh fetch);
// a changed updatedAt recomputes. Also asserts the folded-in approval-reaction field exists.
import test from "node:test";
import assert from "node:assert/strict";
import { threadSignals } from "../dist/github.js";

test("threadSignals memoizes by updatedAt and recomputes when it changes", async () => {
  const a = await threadSignals("acme/app", 1, "2026-01-01T00:00:00Z");
  const b = await threadSignals("acme/app", 1, "2026-01-01T00:00:00Z");
  assert.equal(a === b, true, "same updatedAt returns the cached object (no second fetch)");
  const c = await threadSignals("acme/app", 1, "2026-02-02T00:00:00Z");
  assert.equal(a === c, false, "advanced updatedAt recomputes");
  assert.equal(typeof a.approvedByReaction, "boolean", "approval-reaction folded into the same result");
});

test("threadSignals without updatedAt does not cache (always a fresh result)", async () => {
  const a = await threadSignals("acme/app", 2);
  const b = await threadSignals("acme/app", 2);
  assert.equal(a === b, false, "no updatedAt -> no caching (Pass-2 PR path keeps fetching)");
});
