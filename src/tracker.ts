/**
 * Tracker port (Phase 4 groundwork) — the seam that lets the issue-tracking layer be swapped.
 *
 * Today GitHub is effectively the database (issues = queue, comments = thread, labels = state). The
 * v2 plan inverts this: the local DB becomes the source of truth and GitHub becomes one adapter
 * behind this interface, with two-way webhook sync. This file establishes the boundary safely — a
 * `Tracker` interface plus a `GitHubTracker` that delegates to the existing `github.ts` functions,
 * so behaviour is unchanged. A `LocalTracker` (DB-backed) and the sync layer come next, supervised.
 *
 * NOTE: nothing consumes this yet; it's the additive port so the eventual swap is a small change,
 * not a rewrite of every call site. Git (clone/branch/PR/merge) is a SEPARATE concern — see the
 * `CodeHost` port (Phase 5), not this one.
 */
import {
  listActionableIssues,
  getThreadFull,
  commentOnIssue,
  addLabel,
  createIssue,
  type ActionableOptions,
} from "./github.js";
import { recordIssueState } from "./store.js";

export interface TrackerIssue {
  repo: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface TrackerComment {
  author: "human" | "agency";
  body: string;
  createdAt?: string;
}

/** A pluggable issue-tracking backend. Implementations: GitHub (now), Local DB (next). */
export interface Tracker {
  readonly kind: string;
  /** Open issues the agency could act on, per the trigger config. */
  listOpenIssues(repo: string, opts: ActionableOptions): Promise<TrackerIssue[]>;
  /** The conversation for an issue, oldest→newest, classified human vs agency. */
  getThread(repo: string, number: number): Promise<TrackerComment[]>;
  /** Post an agency comment. */
  postComment(repo: string, number: number, body: string): Promise<void>;
  /** Move an issue's state (a label in the GitHub adapter; a column in the local one). */
  setState(repo: string, number: number, state: string): Promise<void>;
  /** Open a new issue; returns its number. */
  createIssue(repo: string, title: string, body: string): Promise<{ number: number }>;
}

/** GitHub-backed Tracker — a thin delegation wrapper over github.ts (no behaviour change). */
export class GitHubTracker implements Tracker {
  readonly kind = "github";

  async listOpenIssues(repo: string, opts: ActionableOptions): Promise<TrackerIssue[]> {
    const issues = await listActionableIssues(repo, opts);
    return issues.map((i) => ({ repo, number: i.number, title: i.title, body: i.body, labels: i.labels }));
  }

  async getThread(repo: string, number: number): Promise<TrackerComment[]> {
    const t = await getThreadFull(repo, number);
    const head: TrackerComment[] = t.body
      ? [{ author: "human", body: t.body, ...(t.createdAt ? { createdAt: t.createdAt } : {}) }]
      : [];
    const comments: TrackerComment[] = t.comments.map((c) => ({
      author: c.isAgency ? "agency" : "human",
      body: c.body,
      ...(c.createdAt ? { createdAt: c.createdAt } : {}),
    }));
    return [...head, ...comments];
  }

  async postComment(repo: string, number: number, body: string): Promise<void> {
    await commentOnIssue(repo, number, body);
  }

  async setState(repo: string, number: number, state: string): Promise<void> {
    await addLabel(repo, number, state).catch(() => {});
    recordIssueState(repo, number, { state });
  }

  async createIssue(repo: string, title: string, body: string): Promise<{ number: number }> {
    const r = await createIssue(repo, title, body);
    return { number: r.number };
  }
}

/** The active tracker. For now always GitHub; the local-first swap flips this behind a flag. */
export function getTracker(): Tracker {
  return new GitHubTracker();
}
