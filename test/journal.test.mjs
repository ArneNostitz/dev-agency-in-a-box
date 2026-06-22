// Tests for the change journal (v4 coordination) — the durable real-state record written at merge.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "journal-")), "agency.db");
const { getDb } = await import("../dist/db/connection.js");
getDb();
const { recordChange, recentChanges, changesTouchingFiles } = await import("../dist/db/journal.js");

test("recordChange + recentChanges newest-first, repo-scoped", () => {
  recordChange("acme/app", 1, { title: "Add auth", files: [{ path: "src/auth.ts", additions: 40 }], summary: "auth" });
  recordChange("acme/app", 2, { title: "Tweak UI", files: [{ path: "web/app.js" }] });
  recordChange("other/repo", 9, { title: "elsewhere", files: [{ path: "x.ts" }] });
  const r = recentChanges("acme/app");
  assert.equal(r.length, 2);
  assert.equal(r[0].number, 2, "newest first");
  assert.equal(recentChanges("other/repo").length, 1, "repo-scoped");
});

test("changesTouchingFiles finds prior merged work on a path (normalized)", () => {
  const hits = changesTouchingFiles("acme/app", ["./src/auth.ts"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].number, 1);
  assert.equal(changesTouchingFiles("acme/app", ["nope.ts"]).length, 0);
});
