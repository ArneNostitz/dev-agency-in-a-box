/**
 * Thin wrappers around the GitHub CLI (`gh`). We shell out rather than use a
 * REST client because `gh` handles auth, pagination, and is the same tool the
 * agents themselves use inside their working copies.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/** Run gh with a specific token (for actions that need a different identity than the default). */
async function ghAs(token: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
  });
  return stdout.trim();
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  return stdout.trim();
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

/** Returns open issues in `repo` carrying `label`, oldest first. */
export async function listQueuedIssues(repo: string, label: string): Promise<Issue[]> {
  const out = await gh([
    "issue", "list",
    "--repo", repo,
    "--label", label,
    "--state", "open",
    "--json", "number,title,body,labels",
    "--limit", "20",
  ]);
  const raw = JSON.parse(out) as Array<{
    number: number;
    title: string;
    body: string | null;
    labels: Array<{ name: string }>;
  }>;
  return raw
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? "",
      labels: i.labels.map((l) => l.name),
    }))
    .sort((a, b) => a.number - b.number);
}

/** Labels that mean "already being handled / handled / parked" — skip these. */
const STATE_LABELS = ["agency:in-progress", "agency:ready", "agency:needs-attention"];
export const AWAITING_LABEL = "agency:awaiting-answer";
export const APPROVAL_LABEL = "agency:awaiting-approval";
/** Any state where the agency is paused waiting on the human. */
export const AWAITING_LABELS = [AWAITING_LABEL, APPROVAL_LABEL];

export interface ActionableOptions {
  triggerMode: "mention" | "label" | "any";
  handles: string[];
  queueLabel: string;
  ignoreLabel: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `text` mentions any of `handles` as a whole token (e.g. "@dev" but not "@developer"). */
export function mentionsHandle(text: string, handles: string[]): boolean {
  return handles.some((h) => new RegExp(escapeRegex(h) + "(?![a-z0-9_-])", "i").test(text));
}

/**
 * Open issues the agency should act on, after excluding ones already in an agency
 * state or opted out via ignoreLabel. The trigger decides the rest:
 *   "mention" - the issue title/body mentions one of `handles` (pin to start)
 *   "label"   - the issue carries `queueLabel`
 *   "any"     - every remaining open issue
 */
export async function listActionableIssues(repo: string, opts: ActionableOptions): Promise<Issue[]> {
  const out = await gh([
    "issue", "list",
    "--repo", repo,
    "--state", "open",
    "--json", "number,title,body,labels",
    "--limit", "50",
  ]).catch(() => "[]");
  const raw = JSON.parse(out) as Array<{
    number: number;
    title: string;
    body: string | null;
    labels: Array<{ name: string }>;
  }>;
  const mapped = raw.map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    labels: i.labels.map((l) => l.name),
  }));

  const result: Issue[] = [];
  for (const i of mapped) {
    if (i.labels.includes(opts.ignoreLabel)) continue;

    // Paused waiting on the human: re-engage once they reply OR 👍 the proposal.
    if (i.labels.some((l) => AWAITING_LABELS.includes(l))) {
      if ((await humanRepliedLast(repo, i.number)) || (await approvedByReaction(repo, i.number))) {
        result.push(i);
      }
      continue;
    }
    // Already being handled / done / parked.
    if (i.labels.some((l) => STATE_LABELS.includes(l))) continue;

    if (opts.triggerMode === "label") {
      if (i.labels.includes(opts.queueLabel)) result.push(i);
    } else if (opts.triggerMode === "mention") {
      if (mentionsHandle(`${i.title}\n${i.body}`, opts.handles)) result.push(i);
    } else {
      result.push(i); // "any"
    }
  }
  return result.sort((a, b) => a.number - b.number);
}

export async function addLabel(repo: string, issue: number, label: string): Promise<void> {
  // Create the label if it does not exist yet (ignore failure if it already does).
  await gh(["label", "create", label, "--repo", repo, "--force", "--color", "5319e7"]).catch(() => {});
  await gh(["issue", "edit", String(issue), "--repo", repo, "--add-label", label]);
}

export async function removeLabel(repo: string, issue: number, label: string): Promise<void> {
  await gh(["issue", "edit", String(issue), "--repo", repo, "--remove-label", label]).catch(() => {});
}

/** Hidden marker appended to every agency comment so we can tell our messages from a human's. */
export const AGENCY_MARKER = "<!-- dev-agency -->";

export async function commentOnIssue(repo: string, issue: number, body: string): Promise<void> {
  await gh(["issue", "comment", String(issue), "--repo", repo, "--body", `${body}\n\n${AGENCY_MARKER}`]);
}

export async function listComments(repo: string, issue: number): Promise<Array<{ body: string }>> {
  const out = await gh([
    "issue", "view", String(issue), "--repo", repo, "--json", "comments",
  ]).catch(() => '{"comments":[]}');
  const data = JSON.parse(out) as { comments?: Array<{ body: string }> };
  return data.comments ?? [];
}

/** True if the most recent comment was written by a human (not the agency). */
export async function humanRepliedLast(repo: string, issue: number): Promise<boolean> {
  const comments = await listComments(repo, issue);
  if (comments.length === 0) return false;
  return !comments[comments.length - 1].body.includes(AGENCY_MARKER);
}

/** The full thread as readable text, each comment tagged [human] or [agency]. */
export async function commentThread(repo: string, issue: number): Promise<string> {
  const comments = await listComments(repo, issue);
  return comments
    .map((c) => {
      const who = c.body.includes(AGENCY_MARKER) ? "[agency]" : "[human]";
      return `${who} ${c.body.replace(AGENCY_MARKER, "").trim()}`;
    })
    .join("\n\n---\n\n");
}

/** Configure git to authenticate through gh, then clone `repo` to `dest`. */
export async function cloneRepo(repo: string, dest: string): Promise<void> {
  await gh(["auth", "setup-git"]);
  await gh(["repo", "clone", repo, dest, "--", "--depth", "50"]);
}

/** Add a reaction to an issue (allowed: +1,-1,laugh,hooray,confused,heart,rocket,eyes). */
export async function reactToIssue(repo: string, issue: number, content: string): Promise<void> {
  await gh(["api", "-X", "POST", `repos/${repo}/issues/${issue}/reactions`, "-f", `content=${content}`]).catch(
    () => {},
  );
}

/** True if the latest agency comment on the issue has a 👍 reaction (approval by emoji). */
export async function approvedByReaction(repo: string, issue: number): Promise<boolean> {
  const out = await gh([
    "api", `repos/${repo}/issues/${issue}/comments`, "--paginate",
    "--jq", '[.[] | {body: .body, plus: .reactions["+1"]}]',
  ]).catch(() => "[]");
  try {
    const arr = JSON.parse(out) as Array<{ body: string; plus: number }>;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].body.includes(AGENCY_MARKER)) return (arr[i].plus ?? 0) > 0;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Mark the issue's PR ready (if draft) and squash-merge it. */
export async function mergePrForBranch(
  repo: string,
  branch: string,
): Promise<{ ok: boolean; msg: string }> {
  const pr = await findPrForBranch(repo, branch);
  if (!pr) return { ok: false, msg: "no open PR for this issue" };
  try {
    if (pr.isDraft) await gh(["pr", "ready", String(pr.number), "--repo", repo]).catch(() => {});
    await gh(["pr", "merge", String(pr.number), "--repo", repo, "--squash", "--delete-branch"]);
    return { ok: true, msg: pr.url };
  } catch (err) {
    return { ok: false, msg: (err as Error).message };
  }
}

/** Create a new issue (used by the planner to decompose work into sub-issues). */
export async function createIssue(
  repo: string,
  title: string,
  body: string,
): Promise<{ number: number; url: string }> {
  const out = await gh(["issue", "create", "--repo", repo, "--title", title, "--body", body]);
  const url = out.trim().split("\n").pop() ?? "";
  const m = /\/issues\/(\d+)/.exec(url);
  return { number: m ? Number(m[1]) : 0, url };
}

/** Open PRs whose head is an agency branch (agency/issue-N). */
export async function listAgencyPrs(
  repo: string,
): Promise<Array<{ number: number; branch: string; issueNumber: number }>> {
  const out = await gh([
    "pr", "list", "--repo", repo, "--state", "open", "--json", "number,headRefName", "--limit", "50",
  ]).catch(() => "[]");
  const arr = JSON.parse(out) as Array<{ number: number; headRefName: string }>;
  return arr
    .filter((p) => /^agency\/issue-\d+$/.test(p.headRefName))
    .map((p) => ({ number: p.number, branch: p.headRefName, issueNumber: Number(p.headRefName.split("-").pop()) }));
}

/** Health of an agency PR: merge conflicts and CI checks. */
export async function prHealth(
  repo: string,
  pr: number,
): Promise<{ status: "ok" | "pending" | "failing" | "conflict"; detail: string }> {
  const out = await gh([
    "pr", "view", String(pr), "--repo", repo, "--json", "mergeable,statusCheckRollup",
  ]).catch(() => "");
  if (!out) return { status: "ok", detail: "" };
  let d: { mergeable?: string; statusCheckRollup?: Array<{ status?: string; conclusion?: string; state?: string }> } = {};
  try {
    d = JSON.parse(out);
  } catch {
    return { status: "ok", detail: "" };
  }
  if (d.mergeable === "CONFLICTING") return { status: "conflict", detail: "merge conflicts with the base branch" };

  const checks = d.statusCheckRollup ?? [];
  if (checks.length > 0) {
    const pending = checks.some((c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING");
    if (pending) return { status: "pending", detail: "checks running" };
    const failing = checks.some(
      (c) =>
        ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(c.conclusion ?? "") ||
        c.state === "FAILURE" ||
        c.state === "ERROR",
    );
    if (failing) return { status: "failing", detail: "CI checks failing" };
  }
  return { status: "ok", detail: "" };
}

/** Comments on an issue OR PR (REST works for both), tagged [human]/[agency]. */
export async function commentThreadByNumber(repo: string, number: number): Promise<{ thread: string; lastHumanBody: string }> {
  const out = await gh([
    "api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--jq", "[.[]|{body:.body}]",
  ]).catch(() => "[]");
  let comments: Array<{ body: string }> = [];
  try {
    comments = JSON.parse(out);
  } catch {
    /* ignore */
  }
  const thread = comments
    .map((c) => `${c.body.includes(AGENCY_MARKER) ? "[agency]" : "[human]"} ${c.body.replace(AGENCY_MARKER, "").trim()}`)
    .join("\n\n---\n\n");
  const last = comments[comments.length - 1];
  const lastHumanBody = last && !last.body.includes(AGENCY_MARKER) ? last.body : "";
  return { thread, lastHumanBody };
}

/** Comment on a PR (issue-comment endpoint works, but gh pr comment is clearer). */
export async function commentOnPr(repo: string, pr: number, body: string): Promise<void> {
  await gh(["pr", "comment", String(pr), "--repo", repo, "--body", `${body}\n\n${AGENCY_MARKER}`]).catch(() => {});
}

export async function closeIssue(repo: string, issue: number, comment?: string): Promise<void> {
  if (comment) await commentOnIssue(repo, issue, comment);
  await gh(["issue", "close", String(issue), "--repo", repo]).catch(() => {});
}

/** All open issues in a repo (used to scan for control commands). */
export async function listAllOpenIssues(repo: string): Promise<Issue[]> {
  const out = await gh([
    "issue", "list", "--repo", repo, "--state", "open",
    "--json", "number,title,body,labels", "--limit", "50",
  ]).catch(() => "[]");
  const raw = JSON.parse(out) as Array<{
    number: number; title: string; body: string | null; labels: Array<{ name: string }>;
  }>;
  return raw.map((i) => ({
    number: i.number, title: i.title, body: i.body ?? "", labels: i.labels.map((l) => l.name),
  }));
}

export async function repoExists(repo: string, token?: string): Promise<boolean> {
  try {
    const args = ["repo", "view", repo, "--json", "name"];
    if (token) await ghAs(token, args);
    else await gh(args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a GitHub "issues" webhook pointing at `url` exists on `repo` (idempotent).
 * Lets the agency register its own hooks so webhook mode needs no manual GitHub setup.
 */
export async function ensureWebhook(
  repo: string,
  url: string,
  secret: string,
  token?: string,
): Promise<"created" | "exists" | "failed"> {
  // Registering webhooks needs repo admin, so use the owner/admin token when provided.
  const run = (args: string[]) => (token ? ghAs(token, args) : gh(args));
  // issues/comments for pins+replies; check_suite/workflow_run for CI results; pull_request +
  // push so PR updates and base-branch changes (conflicts) are reacted to instantly.
  const wantEvents = ["issues", "issue_comment", "check_suite", "workflow_run", "pull_request", "push"];
  try {
    const json = await run(["api", `repos/${repo}/hooks`]).catch(() => "[]");
    const hooks = JSON.parse(json) as Array<{ id: number; config?: { url?: string }; events?: string[] }>;
    const existing = hooks.find((h) => h.config?.url === url);

    if (existing) {
      // Make sure it listens for the events we need (older hooks only had "issues").
      if (wantEvents.some((e) => !existing.events?.includes(e))) {
        const tmp = join(tmpdir(), `agency-hook-${Date.now()}.json`);
        writeFileSync(tmp, JSON.stringify({ events: wantEvents }));
        await run(["api", `repos/${repo}/hooks/${existing.id}`, "-X", "PATCH", "--input", tmp]).catch(() => {});
      }
      return "exists";
    }

    const tmp = join(tmpdir(), `agency-hook-${Date.now()}.json`);
    writeFileSync(
      tmp,
      JSON.stringify({
        name: "web",
        active: true,
        events: wantEvents,
        config: { url, content_type: "json", secret, insecure_ssl: "0" },
      }),
    );
    await run(["api", `repos/${repo}/hooks`, "-X", "POST", "--input", tmp]);
    return "created";
  } catch {
    return "failed";
  }
}

/**
 * Ensure the bot account (owner of `botToken`) is a collaborator on `repo`. The `adminToken`
 * (repo owner) sends the invite; the bot token accepts it. Idempotent.
 */
export async function ensureCollaborator(
  repo: string,
  adminToken: string,
  botToken: string,
): Promise<"added" | "already" | "failed"> {
  try {
    const botLogin = (await ghAs(botToken, ["api", "user", "--jq", ".login"])).trim();
    if (!botLogin) return "failed";

    // Owner invites the bot (201 = invited, 204 = already a collaborator).
    await ghAs(adminToken, [
      "api", "-X", "PUT", `repos/${repo}/collaborators/${botLogin}`, "-f", "permission=push",
    ]);

    // Bot accepts any pending invitation for this repo.
    const ids = (
      await ghAs(botToken, [
        "api", "/user/repository_invitations",
        "--jq", `.[] | select(.repository.full_name=="${repo}") | .id`,
      ]).catch(() => "")
    )
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of ids) {
      await ghAs(botToken, ["api", "-X", "PATCH", `/user/repository_invitations/${id}`]).catch(() => {});
    }
    return ids.length > 0 ? "added" : "already";
  } catch {
    return "failed";
  }
}

export interface PullRequest {
  number: number;
  url: string;
  isDraft: boolean;
}

/** Find an open PR whose head branch matches `branch`, if any. */
export async function findPrForBranch(repo: string, branch: string): Promise<PullRequest | null> {
  const out = await gh([
    "pr", "list",
    "--repo", repo,
    "--head", branch,
    "--state", "open",
    "--json", "number,url,isDraft",
    "--limit", "1",
  ]).catch(() => "[]");
  const raw = JSON.parse(out) as Array<{ number: number; url: string; isDraft: boolean }>;
  return raw.length > 0 ? raw[0] : null;
}
