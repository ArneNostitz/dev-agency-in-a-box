/**
 * Thin wrappers around the GitHub CLI (`gh`). We shell out rather than use a
 * REST client because `gh` handles auth, pagination, and is the same tool the
 * agents themselves use inside their working copies.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, unlinkSync, appendFileSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sBool } from "./settings.js";
import { ghBotToken, ghUserToken } from "./creds.js";
import { recordOutgoingComment, setCommentGhId } from "./store.js";

const execFileAsync = promisify(execFile);

/** Run gh as the human owner ("acts as you"); empty token falls back to the stored owner/bot token. */
async function ghAs(token: string, args: string[]): Promise<string> {
  const t = token || ghUserToken() || ghBotToken();
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
    env: t ? { ...process.env, GH_TOKEN: t, GITHUB_TOKEN: t } : process.env,
  });
  return stdout.trim();
}

/** Run gh as the agency bot, using the dashboard-stored bot token (or GITHUB_TOKEN env). */
async function gh(args: string[]): Promise<string> {
  const token = ghBotToken();
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 10 * 1024 * 1024,
    env: token ? { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token } : process.env,
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
  // DB-first: record the agency comment immediately so the dashboard renders it without waiting on
  // GitHub. Then mirror to GitHub and link the returned comment id back to the local row.
  const localId = recordOutgoingComment({ repo, number: issue, author: "dev-agency", body, source: "agency" });
  if (issue <= 0) return; // dashboard-only issue (no GitHub number yet) — DB is enough
  const out = await gh(["api", "-X", "POST", `repos/${repo}/issues/${issue}/comments`, "-f", `body=${body}\n\n${AGENCY_MARKER}`]);
  try {
    const j = JSON.parse(out);
    if (j?.id) setCommentGhId(localId, j.id, j.created_at);
  } catch { /* the comment is on GitHub; reconcile will link it on the next thread read */ }
}

export async function listComments(repo: string, issue: number): Promise<Array<{ body: string }>> {
  const out = await gh([
    "issue", "view", String(issue), "--repo", repo, "--json", "comments",
  ]).catch(() => '{"comments":[]}');
  const data = JSON.parse(out) as { comments?: Array<{ body: string }> };
  return data.comments ?? [];
}

/**
 * Read the latest reviewer verdict straight from the thread — so PRs created before the verdict
 * was recorded in the DB still light up the Fix button. Returns the verdict + the review notes.
 */
export async function detectReviewVerdict(
  repo: string,
  issue: number,
): Promise<{ verdict: "approved" | "changes"; summary: string } | null> {
  const comments = await listComments(repo, issue).catch(() => [] as Array<{ body: string }>);
  // Walk newest→oldest for the most recent agency "Review" comment.
  for (let i = comments.length - 1; i >= 0; i--) {
    const b = comments[i].body || "";
    if (!b.includes(AGENCY_MARKER) || !/\*\*Review/i.test(b)) continue;
    const verdict = /request\s+changes/i.test(b) ? "changes" : "approved";
    const summary = b.replace(AGENCY_MARKER, "").trim().slice(0, 4000);
    return { verdict, summary };
  }
  return null;
}

/** True if the most recent comment was written by a human (not the agency). */
export async function humanRepliedLast(repo: string, issue: number): Promise<boolean> {
  const comments = await listComments(repo, issue);
  if (comments.length === 0) return false;
  return !comments[comments.length - 1].body.includes(AGENCY_MARKER);
}

export interface ThreadInspect {
  /** the agency has commented on this thread at least once. */
  agencyEverCommented: boolean;
  /** the latest comment is from a human (not the agency). */
  lastIsHuman: boolean;
  /** id of the latest comment (0 if none) — used as a per-thread cursor. */
  lastCommentId: number;
  /** body of the latest comment if it's a human's, else "". */
  lastHumanBody: string;
  /** GitHub author_association of the latest comment (OWNER/MEMBER/COLLABORATOR/…). */
  lastAuthorAssoc: string;
}

/** GitHub author_association values that may DRIVE the agency (a workspace member of the repo). */
const TRIGGER_ASSOC = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
/** True if an issue/comment author (by their GitHub author_association) is allowed to trigger runs. */
export function canTrigger(assoc: string): boolean {
  return TRIGGER_ASSOC.has((assoc || "").trim().toUpperCase());
}

/** The opening author's association for an issue — used to gate auto-start to repo members. */
export async function issueAuthorAssoc(repo: string, number: number): Promise<string> {
  const out = await gh(["api", `repos/${repo}/issues/${number}`, "--jq", ".author_association"]).catch(() => "");
  return (out || "").trim();
}

/** One API call that tells us everything the router needs about a thread's comments. */
export async function threadSignals(repo: string, number: number): Promise<ThreadInspect> {
  const out = await gh([
    "api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--jq", "[.[]|{id,body,assoc:.author_association}]",
  ]).catch(() => "[]");
  let arr: Array<{ id: number; body: string; assoc?: string }> = [];
  try {
    arr = JSON.parse(out);
  } catch {
    /* ignore */
  }
  const agencyEverCommented = arr.some((c) => c.body.includes(AGENCY_MARKER));
  const last = arr[arr.length - 1];
  const lastIsHuman = Boolean(last) && !last.body.includes(AGENCY_MARKER);
  return {
    agencyEverCommented,
    lastIsHuman,
    lastCommentId: last?.id ?? 0,
    lastHumanBody: lastIsHuman ? last.body : "",
    lastAuthorAssoc: last?.assoc ?? "",
  };
}

/** A short "thanks/looks good" style comment that should NOT trigger a code change. */
const NO_OP_RE =
  /^\s*(thanks?|thank you|ty|nice|great|good( job)?|perfect|cool|awesome|love it|looks good|lgtm|done|ok|okay|👍|👌|🎉|🙏|❤️|💯)[.! ]*$/i;
export function isNoOpComment(body: string): boolean {
  return NO_OP_RE.test((body || "").trim());
}

export interface RecentThread {
  number: number;
  title: string;
  body: string;
  labels: string[];
  closed: boolean;
  comments: number;
  updatedAt: string;
}

/** Issues updated recently, ANY state, with the bits the router needs. */
export async function listRecentThreads(repo: string, limit = 60): Promise<RecentThread[]> {
  const out = await gh([
    "issue", "list", "--repo", repo, "--state", "all",
    "--json", "number,title,body,labels,state,comments,updatedAt", "--limit", String(limit),
  ]).catch(() => "[]");
  let raw: Array<{
    number: number;
    title: string;
    body: string | null;
    labels: Array<{ name: string }>;
    state: string;
    comments: number | unknown[];
    updatedAt: string;
  }> = [];
  try {
    raw = JSON.parse(out);
  } catch {
    /* ignore */
  }
  return raw.map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    labels: i.labels.map((l) => l.name),
    closed: (i.state ?? "").toUpperCase() === "CLOSED",
    // gh returns `comments` as a count (number) on most versions, an array on some.
    comments: Array.isArray(i.comments) ? i.comments.length : Number(i.comments) || 0,
    updatedAt: i.updatedAt ?? "",
  }));
}

export async function reopenIssue(repo: string, number: number): Promise<void> {
  await gh(["issue", "reopen", String(number), "--repo", repo]).catch(() => {});
}

/** Marker on the single epic tracking comment so we update it in place instead of spamming. */
export const EPIC_MARKER = "<!-- epic-tracker -->";

/** Create-or-update the one epic tracking comment on a parent issue. */
export async function upsertTrackerComment(repo: string, parent: number, body: string): Promise<void> {
  const full = `${body}\n\n${EPIC_MARKER}\n${AGENCY_MARKER}`;
  const out = await gh([
    "api", `repos/${repo}/issues/${parent}/comments`, "--paginate", "--jq", "[.[]|{id,body}]",
  ]).catch(() => "[]");
  let id = 0;
  try {
    for (const c of JSON.parse(out) as Array<{ id: number; body: string }>) {
      if (c.body.includes(EPIC_MARKER)) id = c.id;
    }
  } catch {
    /* ignore */
  }
  if (id) {
    await gh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${id}`, "-f", `body=${full}`]).catch(() => {});
  } else {
    await gh(["api", "-X", "POST", `repos/${repo}/issues/${parent}/comments`, "-f", `body=${full}`]).catch(() => {});
  }
}

export interface ThreadComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  isAgency: boolean;
}
export interface ThreadFull {
  title: string;
  body: string;
  author: string;
  createdAt: string;
  state: string;
  comments: ThreadComment[];
}

/**
 * Normalize `gh api --paginate` output into a flat array of raw comment objects. With --paginate,
 * gh concatenates each page's JSON array as "[...][...]" (invalid as a whole), so we join them.
 * Tolerant of empty output and of an NDJSON stream (one object/array per line) as a fallback.
 */
export function parseGhCommentsJson(
  out: string,
): Array<{ id?: number; user?: { login?: string }; body?: string; created_at?: string }> {
  const s = (out || "").trim();
  if (!s) return [];
  try {
    return JSON.parse(s.replace(/\]\s*\[/g, ","));
  } catch {
    const acc: Array<{ id?: number; user?: { login?: string }; body?: string; created_at?: string }> = [];
    for (const line of s.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      try {
        const v = JSON.parse(l);
        if (Array.isArray(v)) acc.push(...v);
        else acc.push(v);
      } catch {
        /* skip malformed line */
      }
    }
    return acc;
  }
}

/** The full structured conversation for the dashboard side panel (issue or PR). */
export async function getThreadFull(repo: string, number: number): Promise<ThreadFull> {
  const head = await gh([
    "api", `repos/${repo}/issues/${number}`,
    "--jq", "{title:.title, body:.body, author:.user.login, createdAt:.created_at, state:.state}",
  ]).catch(() => "{}");
  let h: { title?: string; body?: string; author?: string; createdAt?: string; state?: string } = {};
  try {
    h = JSON.parse(head);
  } catch {
    /* ignore */
  }
  // Fetch the raw comment objects (no server-side jq — that combo with --paginate proved fragile
  // and silently dropped the agency's comments). Up to 100/page, paginated, parsed robustly.
  const out = await gh([
    "api", `repos/${repo}/issues/${number}/comments`, "--paginate", "-f", "per_page=100",
  ]).catch(() => "");
  const raw = parseGhCommentsJson(out);
  const comments: ThreadComment[] = raw.map((c) => {
    const body = c.body ?? "";
    return {
      id: c.id ?? 0,
      author: c.user?.login ?? "?",
      body: body.replace(AGENCY_MARKER, "").trim(),
      createdAt: c.created_at ?? "",
      isAgency: body.includes(AGENCY_MARKER),
    };
  });
  return {
    title: h.title ?? `#${number}`,
    body: h.body ?? "",
    author: h.author ?? "?",
    createdAt: h.createdAt ?? "",
    state: h.state ?? "open",
    comments,
  };
}

/**
 * Post a comment that counts as the HUMAN speaking (no agency marker), used by the dashboard's
 * inline reply. It therefore re-engages the agency exactly like a comment typed in GitHub.
 * Works on both issues and PRs (PRs share the issues comment endpoint).
 *
 * If `asToken` is given (the owner's token), the comment is authored by THAT account — so
 * dashboard replies appear under your own name, not the bot's. Falls back to the bot token.
 */
export async function commentAsHuman(repo: string, number: number, body: string, asToken?: string): Promise<{ id?: number; created_at?: string }> {
  const args = ["api", "-X", "POST", `repos/${repo}/issues/${number}/comments`, "-f", `body=${body}`];
  const out = asToken ? await ghAs(asToken, args) : await gh(args);
  try {
    const j = JSON.parse(out);
    return { id: j?.id, created_at: j?.created_at };
  } catch {
    return {};
  }
}

/**
 * Edit an existing issue comment. Uses the owner's token first (so edits appear under your name),
 * falls back to the bot token. Pass the comment's numeric id (from getThreadFull).
 */
export async function editCommentAsHuman(repo: string, commentId: number, body: string, asToken?: string): Promise<void> {
  const args = ["api", "-X", "PATCH", `repos/${repo}/issues/comments/${commentId}`, "-f", `body=${body}`];
  if (asToken) await ghAs(asToken, args);
  else await gh(args);
}

/** 👍 the latest agency comment so approvedByReaction() passes — a direct, reliable approval. */
export async function approveLastProposal(repo: string, number: number): Promise<void> {
  const out = await gh([
    "api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--jq", "[.[]|{id,body}]",
  ]).catch(() => "[]");
  try {
    const arr = JSON.parse(out) as Array<{ id: number; body: string }>;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].body.includes(AGENCY_MARKER)) {
        await gh(["api", "-X", "POST", `repos/${repo}/issues/comments/${arr[i].id}/reactions`, "-f", "content=+1"]).catch(() => {});
        return;
      }
    }
  } catch {
    /* ignore */
  }
}

/** List the repos the given token can access (owner + collaborator + org), newest first. */
export async function listUserRepos(token: string): Promise<Array<{ full_name: string; private: boolean }>> {
  const out = await ghAs(token, [
    "api", "--paginate",
    "user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    "--jq", ".[]|{full_name,private}",
  ]).catch(() => "");
  const repos: Array<{ full_name: string; private: boolean }> = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      repos.push(JSON.parse(line));
    } catch {
      /* skip a bad line */
    }
  }
  return repos;
}

/** Read a UTF-8 file from a repo via the contents API, or null if missing. */
export async function readRepoFile(repo: string, path: string): Promise<string | null> {
  const out = await gh(["api", `repos/${repo}/contents/${path}`, "--jq", ".content"]).catch(() => "");
  if (!out) return null;
  try {
    return Buffer.from(out.replace(/\s/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** Commit already-base64 content (e.g. a pasted image) and return its download URL. */
export async function putRepoBase64(
  repo: string,
  path: string,
  base64: string,
  message: string,
  token: string,
): Promise<{ ok: boolean; url?: string; msg: string }> {
  // Send the body via a temp file (`gh api --input`) so large files don't blow the arg limit.
  const tmp = join(tmpdir(), `dvagency-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  try {
    const sha = (await ghAs(token, ["api", `repos/${repo}/contents/${path}`, "--jq", ".sha"]).catch(() => "")).trim();
    writeFileSync(tmp, JSON.stringify({ message, content: base64, ...(sha ? { sha } : {}) }));
    const out = await ghAs(token, ["api", "-X", "PUT", `repos/${repo}/contents/${path}`, "--input", tmp]);
    let url: string | undefined;
    try {
      url = (JSON.parse(out) as { content?: { download_url?: string } }).content?.download_url;
    } catch {
      /* ignore */
    }
    return { ok: true, url, msg: "committed" };
  } catch (err) {
    return { ok: false, msg: (err as Error).message };
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/** Commit a file to a repo (create or update) via the contents API, as the given token. */
export async function putRepoFile(
  repo: string,
  path: string,
  content: string,
  message: string,
  token: string,
): Promise<{ ok: boolean; msg: string }> {
  try {
    const sha = (await ghAs(token, ["api", `repos/${repo}/contents/${path}`, "--jq", ".sha"]).catch(() => "")).trim();
    const b64 = Buffer.from(content, "utf8").toString("base64");
    const args = ["api", "-X", "PUT", `repos/${repo}/contents/${path}`, "-f", `message=${message}`, "-f", `content=${b64}`];
    if (sha) args.push("-f", `sha=${sha}`);
    await ghAs(token, args);
    return { ok: true, msg: "committed" };
  } catch (err) {
    return { ok: false, msg: (err as Error).message };
  }
}

/**
 * Permanently delete an issue (owner-only GraphQL mutation, so it needs the admin token).
 * Returns ok=false if no admin token or the API refuses — the caller can fall back to close.
 */
export async function deleteIssueHard(
  repo: string,
  number: number,
  adminToken?: string,
): Promise<{ ok: boolean; msg: string }> {
  if (!adminToken) return { ok: false, msg: "no admin token" };
  try {
    const nodeId = (await gh(["api", `repos/${repo}/issues/${number}`, "--jq", ".node_id"])).trim();
    if (!nodeId) return { ok: false, msg: "issue not found" };
    await ghAs(adminToken, [
      "api", "graphql", "-f",
      `query=mutation{deleteIssue(input:{issueId:"${nodeId}"}){clientMutationId}}`,
    ]);
    return { ok: true, msg: "deleted" };
  } catch (err) {
    return { ok: false, msg: (err as Error).message };
  }
}

/** The full thread as readable text, each comment tagged [human] or [agency]. */
/** Recent comment thread, capped so we don't re-feed a snowballing history to every agent every
 *  run. Older context is intentionally dropped — agents can pull it back via the `recall` tool. */
export async function commentThread(repo: string, issue: number, lastN = 8, perComment = 1500): Promise<string> {
  const comments = await listComments(repo, issue);
  const recent = comments.slice(-lastN);
  const dropped = comments.length - recent.length;
  const body = recent
    .map((c) => {
      const who = c.body.includes(AGENCY_MARKER) ? "[agency]" : "[human]";
      const text = c.body.replace(AGENCY_MARKER, "").trim().slice(0, perComment);
      return `${who} ${text}`;
    })
    .join("\n\n---\n\n");
  return dropped > 0
    ? `_(${dropped} earlier comment(s) omitted — use the recall tool if you need them)_\n\n---\n\n${body}`
    : body;
}

/** Configure git to authenticate through gh, then clone `repo` to `dest`. */
export async function cloneRepo(repo: string, dest: string): Promise<void> {
  await gh(["auth", "setup-git"]);
  await gh(["repo", "clone", repo, dest, "--", "--depth", "50"]);
  // Safety net for the deterministic `git add -A` finalize: never sweep generated dirs even if
  // the repo lacks a .gitignore for them.
  try {
    appendFileSync(
      join(dest, ".git", "info", "exclude"),
      "\nnode_modules/\ndist/\nbuild/\n.next/\nout/\ncoverage/\n.gnhome/\n.gitnexus/\n",
    );
  } catch {
    /* non-fatal */
  }
  // Save GitHub Actions minutes: our tester runs the same checks in-container, so the CI on
  // agency branch commits is redundant. A commit-msg hook appends [skip ci] to every commit
  // the agents make (push + PR runs are skipped); the squash-merge to main still runs CI via
  // the PR title. Opt out with SKIP_CI=false.
  if (sBool("skip_ci", "SKIP_CI", true)) {
    try {
      const hook = join(dest, ".git", "hooks", "commit-msg");
      const script =
        "#!/bin/sh\n" +
        "# dev-agency: skip redundant GitHub Actions CI on agency commits (tester runs in-container).\n" +
        'if ! grep -qiE "\\[(skip ci|ci skip)\\]" "$1"; then printf "\\n[skip ci]\\n" >> "$1"; fi\n';
      writeFileSync(hook, script, { mode: 0o755 });
    } catch {
      /* non-fatal */
    }
  }
}

/** Add a reaction to an issue (allowed: +1,-1,laugh,hooray,confused,heart,rocket,eyes). */
export async function reactToIssue(repo: string, issue: number, content: string): Promise<void> {
  await gh(["api", "-X", "POST", `repos/${repo}/issues/${issue}/reactions`, "-f", `content=${content}`]).catch(
    () => {},
  );
}

/**
 * Acknowledge a request with 👀 — on the latest HUMAN comment if there is one (so it's clear
 * which comment was seen), otherwise on the issue/PR itself.
 */
export async function acknowledge(repo: string, number: number): Promise<void> {
  const out = await gh([
    "api", `repos/${repo}/issues/${number}/comments`, "--paginate", "--jq", "[.[]|{id,body}]",
  ]).catch(() => "[]");
  try {
    const arr = JSON.parse(out) as Array<{ id: number; body: string }>;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (!arr[i].body.includes(AGENCY_MARKER)) {
        await gh([
          "api", "-X", "POST", `repos/${repo}/issues/comments/${arr[i].id}/reactions`, "-f", "content=eyes",
        ]).catch(() => {});
        return;
      }
    }
  } catch {
    /* fall through */
  }
  await reactToIssue(repo, number, "eyes");
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
  asToken?: string,
): Promise<{ number: number; url: string }> {
  const args = ["issue", "create", "--repo", repo, "--title", title, "--body", body];
  // asToken (owner token) makes you the author; else the bot creates it.
  const out = asToken ? await ghAs(asToken, args) : await gh(args);
  const url = out.trim().split("\n").pop() ?? "";
  const m = /\/issues\/(\d+)/.exec(url);
  return { number: m ? Number(m[1]) : 0, url };
}

/** Open PRs whose head is an agency branch (agency/issue-N). */
export async function listAgencyPrs(
  repo: string,
): Promise<Array<{ number: number; title: string; branch: string; issueNumber: number }>> {
  const out = await gh([
    "pr", "list", "--repo", repo, "--state", "open", "--json", "number,title,headRefName", "--limit", "50",
  ]).catch(() => "[]");
  const arr = JSON.parse(out) as Array<{ number: number; title: string; headRefName: string }>;
  return arr
    .filter((p) => /^agency\/issue-\d+$/.test(p.headRefName))
    .map((p) => ({
      number: p.number,
      title: p.title,
      branch: p.headRefName,
      issueNumber: Number(p.headRefName.split("-").pop()),
    }));
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

export async function closeIssue(repo: string, issue: number, comment?: string, reason?: "completed" | "not planned"): Promise<void> {
  if (comment) await commentOnIssue(repo, issue, comment);
  const args = ["issue", "close", String(issue), "--repo", repo];
  if (reason) args.push("--reason", reason);
  await gh(args).catch(() => {});
}

/** Fetch a single issue (any state) as an Issue, or null if it can't be read. */
export async function getIssue(repo: string, number: number): Promise<Issue | null> {
  const out = await gh([
    "issue", "view", String(number), "--repo", repo, "--json", "number,title,body,labels",
  ]).catch(() => "");
  if (!out) return null;
  try {
    const i = JSON.parse(out) as { number: number; title: string; body: string | null; labels: Array<{ name: string }> };
    return { number: i.number, title: i.title, body: i.body ?? "", labels: (i.labels ?? []).map((l) => l.name) };
  } catch {
    return null;
  }
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

async function runGit(cwd: string, args: string[]): Promise<string> {
  // git push/fetch authenticate via gh's credential helper, which reads GH_TOKEN — inject the
  // resolved bot token so pushes work even when it isn't in the container env (dashboard creds).
  const token = ghBotToken();
  const env = token ? { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token } : process.env;
  const { stdout } = await execFileAsync("git", args, { cwd, env, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

/** Like runGit but never throws — returns the exit code + output so we can branch on git failures
 *  (e.g. a `git merge` that exits 1 on conflicts is an expected outcome, not an error). */
async function runGitCode(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const token = ghBotToken();
  const env = token ? { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token } : process.env;
  return new Promise((resolve) => {
    execFile("git", args, { cwd, env, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0,
        stdout: (stdout || "").toString().trim(),
        stderr: (stderr || "").toString().trim(),
      });
    });
  });
}

export interface BaseMergeResult {
  status: "clean" | "conflicts" | "error";
  files: string[];
}

/**
 * Deterministically merge the base branch (default "main") into the PR branch already checked out
 * in `workdir`, to clear merge conflicts before we mark a PR mergeable. We do this in code rather
 * than hoping the agent runs the right git commands: a clean auto-merge needs no agent at all, and
 * only genuine content conflicts get handed off — with the exact file list. The shallow clone is
 * deepened first so a merge base exists (a `--depth 50` clone often can't merge `origin/main`).
 * On conflicts the working tree is LEFT in the conflicted state for the caller's agent to resolve;
 * `ensureBranchPushed` then completes the merge commit and pushes.
 */
export async function mergeBaseInto(workdir: string, base = "main"): Promise<BaseMergeResult> {
  try {
    // Deepen history so a merge base exists.
    await runGitCode(workdir, ["fetch", "--unshallow", "origin"]); // no-op once the clone is complete
    // CRITICAL: force-update the remote-tracking ref. A plain `git fetch origin main` only updates
    // FETCH_HEAD, not refs/remotes/origin/main, so a later `git merge origin/main` can merge a STALE
    // main → reports "Already up to date / clean" while GitHub still sees the PR as conflicting →
    // the Fix flow loops forever, burning tokens. An explicit destination refspec fixes this.
    await runGitCode(workdir, ["fetch", "-f", "origin", `${base}:refs/remotes/origin/${base}`]);
    // Always grab the freshest base into FETCH_HEAD and MERGE THAT — never the (possibly stale)
    // tracking ref. Merging a stale `origin/main` is what made the agent report "clean" while GitHub
    // still saw the PR as conflicting, looping the Fix flow forever.
    const fh = await runGitCode(workdir, ["fetch", "origin", base]);
    const target = fh.code === 0 ? "FETCH_HEAD" : `origin/${base}`;
    await runGitCode(workdir, ["merge", "--abort"]); // clear any half-finished merge from a prior try
    await runGitCode(workdir, ["config", "user.email", "bot@dev-agency.local"]);
    await runGitCode(workdir, ["config", "user.name", "dev-agency-bot"]);
    const m = await runGitCode(workdir, ["merge", target, "--no-edit"]);
    if (m.code === 0) return { status: "clean", files: [] };
    const un = await runGitCode(workdir, ["diff", "--name-only", "--diff-filter=U"]);
    const files = un.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (files.length) return { status: "conflicts", files };
    // merge failed for a non-conflict reason (e.g. unrelated histories / fetch failure)
    return { status: "error", files: [] };
  } catch {
    return { status: "error", files: [] };
  }
}

/**
 * Deterministic "is this branch mergeable into base now?" check — does HEAD already contain the
 * LATEST base? Used instead of GitHub's `mergeable` flag right after a push, which is stale (GitHub
 * recomputes mergeability asynchronously and briefly keeps returning the old CONFLICTING value).
 * If the freshly-fetched base is an ancestor of HEAD, the PR will merge cleanly — guaranteed.
 */
export async function branchContainsBase(workdir: string, base = "main"): Promise<boolean> {
  await runGitCode(workdir, ["fetch", "-f", "origin", `${base}:refs/remotes/origin/${base}`]).catch(() => {});
  const fh = await runGitCode(workdir, ["fetch", "origin", base]).catch(() => ({ code: 1 } as { code: number }));
  const ref = fh.code === 0 ? "FETCH_HEAD" : `origin/${base}`;
  const r = await runGitCode(workdir, ["merge-base", "--is-ancestor", ref, "HEAD"]);
  return r.code === 0;
}

/** Local HEAD sha of a checkout — lets the orchestrator tell whether an agent actually committed. */
export async function localHeadSha(workdir: string): Promise<string> {
  return runGit(workdir, ["rev-parse", "HEAD"]).catch(() => "");
}
/** True if the working tree has staged/unstaged changes (agent edited but didn't commit). */
export async function workdirDirty(workdir: string): Promise<boolean> {
  const s = await runGit(workdir, ["status", "--porcelain"]).catch(() => "");
  return s.trim().length > 0;
}

/** Current head commit SHA of a branch (cheap API read). Used to cache conflict probes per-SHA. */
export async function branchHeadSha(repo: string, branch: string): Promise<string> {
  const out = await gh(["api", `repos/${repo}/commits/${encodeURIComponent(branch)}`, "-q", ".sha"]).catch(() => "");
  return out.trim();
}

// One reusable clone per repo for non-destructive conflict probes (kept warm, just re-fetched).
const conflictProbeDirs = new Map<string, string>();

/**
 * Best-effort list of the files that conflict when merging `base` into a PR `branch`, computed
 * WITHOUT mutating the PR: we merge in a throwaway probe checkout and immediately abort. GitHub's
 * API only exposes a mergeable boolean (not which files), so we derive the file list locally and
 * cache a warm clone per repo. Returns [] if it can't be determined (network/history issues) — the
 * UI still shows the conflict box, just without per-file detail.
 */
export async function conflictFiles(repo: string, branch: string, base = "main"): Promise<string[]> {
  try {
    let dir = conflictProbeDirs.get(repo);
    if (!dir || !existsSync(join(dir, ".git"))) {
      dir = join(tmpdir(), "agency-conflict-" + repo.replace(/[^a-z0-9]+/gi, "_"));
      await rm(dir, { recursive: true, force: true });
      await cloneRepo(repo, dir);
      conflictProbeDirs.set(repo, dir);
    }
    await runGitCode(dir, ["config", "user.email", "bot@dev-agency.local"]);
    await runGitCode(dir, ["config", "user.name", "dev-agency-bot"]);
    await runGitCode(dir, ["merge", "--abort"]); // clear any aborted probe state
    await runGitCode(dir, ["fetch", "--unshallow", "origin"]);
    // Force-update BOTH tracking refs (plain fetch only moves FETCH_HEAD → stale checkout/merge → []).
    await runGitCode(dir, ["fetch", "-f", "origin", `${base}:refs/remotes/origin/${base}`, `${branch}:refs/remotes/origin/${branch}`]);
    const co = await runGitCode(dir, ["checkout", "-f", "-B", "_conflict_probe", `origin/${branch}`]);
    if (co.code !== 0) return [];
    const m = await runGitCode(dir, ["merge", "--no-commit", "--no-ff", `origin/${base}`]);
    let files: string[] = [];
    if (m.code !== 0) {
      const un = await runGitCode(dir, ["diff", "--name-only", "--diff-filter=U"]);
      files = un.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    }
    await runGitCode(dir, ["merge", "--abort"]);
    return files;
  } catch {
    return [];
  }
}

/**
 * Deterministically make sure the agency branch holds ALL the work and is pushed — so a run
 * that did the work but never got to `git push` (looped / was interrupted) still lands its
 * code. Returns true if the branch has commits beyond main.
 */
export async function ensureBranchPushed(workdir: string, branch: string): Promise<boolean> {
  try {
    const cur = await runGit(workdir, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "");
    if (cur !== branch) {
      // CRITICAL: get the EXISTING remote branch first (it may already hold pushed work from a
      // prior run). `checkout -B` alone would reset the branch to the current HEAD (base), throwing
      // that work away and making us report "no commits" → needs-attention even though the fix is
      // already on origin/<branch>. Fetch + checkout the remote branch when it exists.
      await runGit(workdir, ["fetch", "origin", branch]).catch(() => {});
      const got = await runGit(workdir, ["checkout", branch]).then(() => true).catch(() => false);
      if (!got) {
        const fromRemote = await runGit(workdir, ["checkout", "-B", branch, `origin/${branch}`]).then(() => true).catch(() => false);
        if (!fromRemote) await runGit(workdir, ["checkout", "-B", branch]).catch(() => {}); // brand-new branch
      }
    }
    await runGit(workdir, ["add", "-A"]).catch(() => {});
    const staged = await runGit(workdir, ["diff", "--cached", "--name-only"]).catch(() => "");
    if (staged.trim()) {
      await runGit(workdir, ["commit", "-m", "agency: finalize work"]).catch(() => {});
    }
    await runGit(workdir, ["push", "-u", "origin", branch]).catch(() => {});
    const ahead = await runGit(workdir, ["rev-list", "--count", `origin/main..${branch}`]).catch(() => "0");
    return Number(ahead) > 0;
  } catch {
    return false;
  }
}

/** Deterministically put the workdir on an existing remote branch (for Fix/resume on a PR). */
export async function fetchCheckout(workdir: string, branch: string): Promise<void> {
  await runGit(workdir, ["fetch", "origin", branch]).catch(() => {});
  const ok = await runGit(workdir, ["checkout", branch]).then(() => true).catch(() => false);
  if (!ok) await runGit(workdir, ["checkout", "-B", branch, `origin/${branch}`]).catch(() => {});
}

/** Open a draft PR for the branch if none exists; returns the PR (or null). */
export async function ensureDraftPr(repo: string, issue: number, branch: string, title: string): Promise<PullRequest | null> {
  const existing = await findPrForBranch(repo, branch);
  if (existing) return existing;
  await gh([
    "pr", "create", "--repo", repo, "--draft", "--base", "main", "--head", branch,
    "--title", title || `Work for #${issue}`, "--body", `Closes #${issue}`,
  ]).catch(() => {});
  return findPrForBranch(repo, branch);
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

export interface MergeStatus {
  prNumber: number;
  state: string; // OPEN | MERGED | CLOSED
  /** "clean" = no conflicts & can merge; "conflict" = needs a merge/rebase; "unknown" otherwise. */
  mergeable: "clean" | "conflict" | "unknown";
}

/**
 * Ask GitHub whether a branch's PR can merge cleanly (conflict detection). Used by the dashboard
 * to decide between "merge" vs "fix" — no agent/tokens, just one `gh` API read.
 */
export async function prMergeStatus(repo: string, branch: string): Promise<MergeStatus | null> {
  const out = await gh([
    "pr", "list", "--repo", repo, "--head", branch, "--state", "open",
    "--json", "number,state,mergeable", "--limit", "1",
  ]).catch(() => "[]");
  const raw = JSON.parse(out) as Array<{ number: number; state: string; mergeable: string }>;
  if (raw.length === 0) return null;
  const p = raw[0];
  const m = (p.mergeable || "").toUpperCase();
  const mergeable = m === "MERGEABLE" ? "clean" : m === "CONFLICTING" ? "conflict" : "unknown";
  return { prNumber: p.number, state: p.state, mergeable };
}

// ---------------------------------------------------------------------------
// mapIssueDetail — shapes raw GitHub GraphQL/REST issue data for the board UI.
// ---------------------------------------------------------------------------

export interface IssueComment {
  who: "human" | "agency";
  body: string;
  createdAt?: string;
}

export interface IssueDetail {
  labels: string[];
  comments: IssueComment[];
}

/**
 * Normalise a raw issue payload (labels array + comments array) into the
 * typed shape consumed by the board.  Classifies each comment as "human" or
 * "agency" (via AGENCY_MARKER) and strips the marker from agency bodies.
 */
export function mapIssueDetail(raw: {
  labels?: Array<{ name: string } | string>;
  comments?: Array<{ body: string; createdAt?: string }>;
}): IssueDetail {
  const labels = (raw.labels ?? []).map((l) => typeof l === "string" ? l : l.name);
  const comments: IssueComment[] = (raw.comments ?? []).map((c) => {
    const hasMarker = c.body?.includes(AGENCY_MARKER);
    const body = hasMarker
      ? c.body.replace(new RegExp(`\\s*${AGENCY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "")
      : (c.body ?? "");
    return { who: hasMarker ? "agency" : "human", body, createdAt: c.createdAt };
  });
  return { labels, comments };
}
