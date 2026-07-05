// Inbound GitHub → DB sync (mirror second term): issue closed/reopened/deleted and comment
// edited/deleted on GitHub must update the local source of truth (tracker.ts syncIn* fns).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-ghsync-")), "test.db");
const s = await import("../dist/store.js");
const { syncInIssueState, syncInCommentEdit, syncInCommentDelete } = await import("../dist/tracker.js");
const { withStatus } = await import("../dist/state.js");

const REPO = "o/r";
const onBoard = (n) => s.recentIssues(100).some((i) => i.repo === REPO && i.number === n);

test("issue closed on GitHub → done locally; not_planned close also archives", () => {
  s.recordIssueStatus(REPO, 1, withStatus("planned"), { title: "one" });
  syncInIssueState(REPO, 1, "closed", { stateReason: "completed", title: "one" });
  assert.equal(s.getIssueStatus(REPO, 1).state, "done");
  assert.equal(onBoard(1), true, "completed close stays visible in Done");
  assert.equal(s.getLocalIssue(REPO, 1)?.closed, true, "local_issue mirror closed");

  s.recordIssueStatus(REPO, 2, withStatus("notPlanned"), { title: "two" });
  syncInIssueState(REPO, 2, "closed", { stateReason: "not_planned" });
  assert.equal(s.getIssueStatus(REPO, 2).state, "done");
  assert.equal(onBoard(2), false, "not_planned close is archived off the board");
});

test("issue reopened on GitHub → planned + back on the board", () => {
  syncInIssueState(REPO, 2, "reopened", { title: "two" });
  assert.equal(s.getIssueStatus(REPO, 2).state, "planned");
  assert.equal(onBoard(2), true, "unarchived on reopen");
  assert.equal(s.getLocalIssue(REPO, 2)?.closed, false);
});

test("issue deleted on GitHub → archived, history kept", () => {
  s.recordIssueStatus(REPO, 3, withStatus("working"), { title: "three" });
  syncInIssueState(REPO, 3, "deleted");
  assert.equal(onBoard(3), false, "hidden from the board");
  assert.ok(s.getIssueRow(REPO, 3), "issues row survives (history)");
});

test("comment edited/deleted on GitHub updates the local conversation", () => {
  s.foldInGitHubComment({ repo: REPO, number: 4, gh_id: 900, author: "u", body: "original", created_at: "2026-01-01T00:00:00Z", isAgency: false });
  syncInCommentEdit(900, "edited body <!-- dev-agency -->");
  assert.equal(s.getConversation(REPO, 4)[0].body, "edited body", "body updated, marker stripped");
  syncInCommentDelete(900);
  assert.equal(s.getConversation(REPO, 4).length, 0, "deleted comment dropped");
});

test("upsertLocalIssue preserves closed when the field is omitted", () => {
  s.upsertLocalIssue({ repo: REPO, number: 5, title: "t", body: "b", closed: true });
  s.upsertLocalIssue({ repo: REPO, number: 5, body: "edited on GitHub" }); // e.g. issues.edited sync
  const li = s.getLocalIssue(REPO, 5);
  assert.equal(li?.closed, true, "body edit must not silently reopen the row");
  assert.equal(li?.body, "edited on GitHub");
});
