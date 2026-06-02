/**
 * Thin wrappers around the GitHub CLI (`gh`). We shell out rather than use a
 * REST client because `gh` handles auth, pagination, and is the same tool the
 * agents themselves use inside their working copies.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  return raw
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? "",
      labels: i.labels.map((l) => l.name),
    }))
    .filter((i) => {
      if (i.labels.includes(opts.ignoreLabel)) return false;
      if (i.labels.some((l) => STATE_LABELS.includes(l))) return false;
      if (opts.triggerMode === "label") return i.labels.includes(opts.queueLabel);
      if (opts.triggerMode === "mention") {
        return mentionsHandle(`${i.title}\n${i.body}`, opts.handles);
      }
      return true; // "any"
    })
    .sort((a, b) => a.number - b.number);
}

export async function addLabel(repo: string, issue: number, label: string): Promise<void> {
  // Create the label if it does not exist yet (ignore failure if it already does).
  await gh(["label", "create", label, "--repo", repo, "--force", "--color", "5319e7"]).catch(() => {});
  await gh(["issue", "edit", String(issue), "--repo", repo, "--add-label", label]);
}

export async function removeLabel(repo: string, issue: number, label: string): Promise<void> {
  await gh(["issue", "edit", String(issue), "--repo", repo, "--remove-label", label]).catch(() => {});
}

export async function commentOnIssue(repo: string, issue: number, body: string): Promise<void> {
  await gh(["issue", "comment", String(issue), "--repo", repo, "--body", body]);
}

/** Configure git to authenticate through gh, then clone `repo` to `dest`. */
export async function cloneRepo(repo: string, dest: string): Promise<void> {
  await gh(["auth", "setup-git"]);
  await gh(["repo", "clone", repo, dest, "--", "--depth", "50"]);
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
