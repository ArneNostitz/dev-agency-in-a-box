// Shape test for the Tracker port (Phase 4 groundwork). Doesn't hit GitHub — just asserts the
// adapter exposes the interface so the future local-first swap has a stable seam.
import test from "node:test";
import assert from "node:assert/strict";
import { getTracker, GitHubTracker } from "../dist/tracker.js";

test("getTracker returns the GitHub adapter with the Tracker interface", () => {
  const t = getTracker();
  assert.ok(t instanceof GitHubTracker);
  assert.equal(t.kind, "github");
  for (const m of ["listOpenIssues", "getThread", "postComment", "setState", "createIssue"]) {
    assert.equal(typeof t[m], "function", `Tracker.${m} exists`);
  }
});
