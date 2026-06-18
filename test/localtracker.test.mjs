// Phase 4: local-first tracking store CRUD + sync-in dedup. (DB-authoritative path, default off.)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-tracker-")), "test.db");
const s = await import("../dist/store.js");
const tk = await import("../dist/tracker.js");

test("local issue + comments round-trip", () => {
  s.upsertLocalIssue({ repo: "acme/app", number: 7, title: "Add search", body: "make it searchable", state: "planned", origin: "dashboard" });
  const i = s.getLocalIssue("acme/app", 7);
  assert.equal(i.title, "Add search");
  assert.equal(i.state, "planned");
  assert.equal(i.closed, false);

  s.addLocalComment({ repo: "acme/app", number: 7, author: "human", body: "please also sort", source: "dashboard" });
  s.addLocalComment({ repo: "acme/app", number: 7, author: "agency", body: "on it", source: "agency" });
  const c = s.getLocalComments("acme/app", 7);
  assert.equal(c.length, 2);
  assert.equal(c[0].author, "human");
});

test("listLocalOpenIssues excludes closed", () => {
  s.upsertLocalIssue({ repo: "acme/app", number: 8, title: "Open one", state: "planned" });
  s.upsertLocalIssue({ repo: "acme/app", number: 9, title: "Closed one", state: "merged", closed: true });
  const open = s.listLocalOpenIssues("acme/app").map((i) => i.number);
  assert.ok(open.includes(7) && open.includes(8));
  assert.ok(!open.includes(9));
});

test("syncInComment dedups by GitHub id", () => {
  tk.syncInComment("acme/app", 7, 555, "arne", "from github", false);
  tk.syncInComment("acme/app", 7, 555, "arne", "from github", false); // duplicate delivery
  const fromGh = s.getLocalComments("acme/app", 7).filter((c) => c.gh_id === 555);
  assert.equal(fromGh.length, 1, "only stored once");
});

test("nextLocalIssueNumber goes negative (avoids GitHub collisions until pushed)", () => {
  const n = s.nextLocalIssueNumber("brand/new");
  assert.ok(n < 0);
});

test("trackerMode defaults to local; tracker=github selects the GitHub adapter", () => {
  // local-first is the default (ADR-0001 / #69)
  s.setSetting("tracker", "");
  assert.equal(tk.trackerMode(), "local");
  assert.equal(tk.getTracker().kind, "local");
  s.setSetting("tracker", "github");
  assert.equal(tk.trackerMode(), "github");
  assert.equal(tk.getTracker().kind, "github");
  s.setSetting("tracker", "");
});
