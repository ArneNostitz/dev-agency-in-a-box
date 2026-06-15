// DB-first conversation: outgoing record + GitHub-id linking, inbound fold/dedupe, time sorting.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the store at a throwaway DB before importing it.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "agency-conv-")), "agency.db");
const store = await import("../dist/store.js");
const {
  recordOutgoingComment, setCommentGhId, foldInGitHubComment,
  updateCommentBody, getConversation, conversationCount,
} = store;

const REPO = "acme/app";

test("outgoing comment is recorded immediately, before any GitHub id", () => {
  const id = recordOutgoingComment({ repo: REPO, number: 1, author: "dev-agency", body: "Building now.", source: "agency" });
  assert.ok(id > 0);
  const conv = getConversation(REPO, 1);
  assert.equal(conv.length, 1);
  assert.equal(conv[0].isAgency, true);
  assert.equal(conv[0].incoming, false);
  assert.equal(conv[0].id, 0); // no gh id yet → edit disabled
});

test("the GitHub echo of our own post is collapsed, not duplicated", () => {
  const localId = recordOutgoingComment({ repo: REPO, number: 2, author: "dev-agency", body: "On it.", source: "agency" });
  setCommentGhId(localId, 555, "2026-01-01T00:00:00Z");
  // Reconcile sees the same comment from GitHub — must dedupe by gh id.
  foldInGitHubComment({ repo: REPO, number: 2, gh_id: 555, author: "ama-devagency-bot", body: "On it.", created_at: "2026-01-01T00:00:00Z", isAgency: true });
  assert.equal(conversationCount(REPO, 2), 1);
});

test("echo collapses even when the gh id wasn't linked yet (body match)", () => {
  recordOutgoingComment({ repo: REPO, number: 3, author: "dev-agency", body: "Resuming.", source: "agency" });
  foldInGitHubComment({ repo: REPO, number: 3, gh_id: 777, author: "ama-devagency-bot", body: "Resuming.", created_at: "2026-01-02T00:00:00Z", isAgency: true });
  const conv = getConversation(REPO, 3);
  assert.equal(conv.length, 1);
  assert.equal(conv[0].id, 777); // adopted the gh id
});

test("a comment made on GitHub folds in as incoming", () => {
  foldInGitHubComment({ repo: REPO, number: 4, gh_id: 900, author: "alice", body: "looks good", created_at: "2026-01-03T00:00:00Z", isAgency: false });
  const conv = getConversation(REPO, 4);
  assert.equal(conv.length, 1);
  assert.equal(conv[0].incoming, true);
  assert.equal(conv[0].author, "alice");
});

test("conversation is sorted by time regardless of insertion order", () => {
  foldInGitHubComment({ repo: REPO, number: 5, gh_id: 2, author: "b", body: "second", created_at: "2026-02-02T00:00:00Z", isAgency: false });
  foldInGitHubComment({ repo: REPO, number: 5, gh_id: 1, author: "a", body: "first", created_at: "2026-01-01T00:00:00Z", isAgency: false });
  foldInGitHubComment({ repo: REPO, number: 5, gh_id: 3, author: "c", body: "third", created_at: "2026-03-03T00:00:00Z", isAgency: false });
  const bodies = getConversation(REPO, 5).map((c) => c.body);
  assert.deepEqual(bodies, ["first", "second", "third"]);
});

test("folding the same GitHub id twice is idempotent", () => {
  foldInGitHubComment({ repo: REPO, number: 6, gh_id: 42, author: "x", body: "hi", created_at: "2026-01-01T00:00:00Z", isAgency: false });
  foldInGitHubComment({ repo: REPO, number: 6, gh_id: 42, author: "x", body: "hi", created_at: "2026-01-01T00:00:00Z", isAgency: false });
  assert.equal(conversationCount(REPO, 6), 1);
});

test("edit updates the cached body by GitHub id", () => {
  foldInGitHubComment({ repo: REPO, number: 7, gh_id: 70, author: "x", body: "before", created_at: "2026-01-01T00:00:00Z", isAgency: false });
  updateCommentBody(70, "after");
  assert.equal(getConversation(REPO, 7)[0].body, "after");
});
