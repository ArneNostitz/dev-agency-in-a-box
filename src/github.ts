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
