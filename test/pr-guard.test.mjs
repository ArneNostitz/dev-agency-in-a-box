// PR-adoption guard (#150): GitHub's API treats PRs as issues — `issues` and `issue_comment`
// webhook deliveries fire for PRs too, carrying issue.pull_request. Those must never adopt a
// board card (the agency once ingested its own epic full-build PR and ran the planner on it).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-prguard-")), "test.db");
delete process.env.TRACKER; // default = local (DB-authoritative), the mode that adopts issues

const s = await import("../dist/store.js");
const { syncInEvent } = await import("../dist/tracker.js");

const REPO = "o/r";
// Shape of a webhook `issues`/`issue_comment` payload whose "issue" is actually a PR.
const PR = {
  number: 315,
  title: "Epic: Document/claim detail redesign",
  body: "Closes #289",
  pull_request: { url: "https://api.github.com/repos/o/r/pulls/315" },
};

test("issues opened/edited for a PR never adopt a card", () => {
  syncInEvent(REPO, "issues", { action: "opened", issue: PR });
  syncInEvent(REPO, "issues", { action: "edited", issue: PR });
  assert.ok(!s.getLocalIssue(REPO, 315), "no local issue adopted");
  assert.equal(s.getIssueRow(REPO, 315), null, "no board card row");
});

test("issues closed/reopened/deleted for a PR do not create lifecycle state", () => {
  syncInEvent(REPO, "issues", { action: "closed", issue: { ...PR, state_reason: "completed" } });
  syncInEvent(REPO, "issues", { action: "reopened", issue: PR });
  syncInEvent(REPO, "issues", { action: "deleted", issue: PR });
  assert.equal(s.getIssueRow(REPO, 315), null, "still no board card row");
  assert.ok(!s.getLocalIssue(REPO, 315), "still no local issue");
});

test("issue_comment on a PR is not folded into a conversation", () => {
  syncInEvent(REPO, "issue_comment", {
    action: "created",
    issue: PR,
    comment: { id: 42, body: "looks good", user: { login: "u" }, created_at: "2026-01-01T00:00:00Z" },
  });
  assert.equal(s.getConversation(REPO, 315).length, 0, "PR comment not adopted");
});

test("a real issue still adopts (guard does not over-block)", () => {
  const issue = { number: 7, title: "Real bug", body: "fix me" };
  syncInEvent(REPO, "issues", { action: "opened", issue });
  assert.equal(s.getLocalIssue(REPO, 7)?.title, "Real bug", "opened adopts local issue");
  syncInEvent(REPO, "issues", { action: "edited", issue: { ...issue, title: "Renamed" } });
  assert.equal(s.getIssueRow(REPO, 7)?.title, "Renamed", "edited refreshes the card title");
  syncInEvent(REPO, "issue_comment", {
    action: "created",
    issue,
    comment: { id: 9, body: "hello", user: { login: "u" }, created_at: "2026-01-01T00:00:00Z" },
  });
  assert.equal(s.getConversation(REPO, 7).length, 1, "issue comment folds in");
});
