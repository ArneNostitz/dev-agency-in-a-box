// Shape test for the Tracker port (#69). Local-first is the default (ADR-0001); the GitHub
// adapter is available when tracker=github. Doesn't hit GitHub — asserts the seam is stable.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-trk-")), "test.db");

const t = await import("../dist/tracker.js");
const s = await import("../dist/store.js");

test("the default tracker is local (DB-authoritative, ADR-0001)", () => {
  const tr = t.getTracker();
  assert.equal(tr.kind, "local");
  for (const m of ["listOpenIssues", "getThread", "postComment", "setState", "createIssue"]) {
    assert.equal(typeof tr[m], "function", `Tracker.${m} exists`);
  }
});

test("tracker=github selects the GitHub adapter", () => {
  s.setSetting("tracker", "github");
  assert.equal(t.getTracker().kind, "github");
  s.setSetting("tracker", ""); // restore default for any later tests
});

test("trackerMode() defaults to local, honours the setting, ignores garbage", () => {
  s.setSetting("tracker", "");
  assert.equal(t.trackerMode(), "local");
  s.setSetting("tracker", "GITHUB");
  assert.equal(t.trackerMode(), "github");
  s.setSetting("tracker", "nonsense");
  assert.equal(t.trackerMode(), "local");
  s.setSetting("tracker", "");
});
