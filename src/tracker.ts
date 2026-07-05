/**
 * Tracker port (Phase 4 groundwork) — the seam that lets the issue-tracking layer be swapped.
 *
 * The v2 inversion (ADR-0001): the local DB is the source of truth, GitHub is a mirror/adapter
 * with two-way webhook sync — see `LocalTracker`. `GitHubTracker` is a thin legacy delegation
 * wrapper kept for the `Tracker` interface's sake; nothing currently consumes either at runtime.
 * Git (clone/branch/PR/merge) is a SEPARATE concern — see the `CodeHost` port (Phase 5), not this one.
 */
import {
  getThreadFull,
  commentOnIssue,
  createIssue,
  listAllOpenIssues,
  AGENCY_MARKER,
} from "./github.js";
import {
  recordIssueState,
  recordIssueStatus,
  archiveIssue,
  unarchiveIssue,
  getSetting,
  setSetting,
  listLocalOpenIssues,
  getLocalIssue,
  upsertLocalIssue,
  foldInGitHubComment,
  updateCommentBody,
  deleteLocalCommentByGhId,
  getLocalComments,
} from "./store.js";
import { withStatus } from "./state.js";

export interface TrackerIssue {
  repo: string;
  number: number;
  title: string;
  body: string;
}

export interface TrackerComment {
  author: "human" | "agency";
  body: string;
  createdAt?: string;
}

/** A pluggable issue-tracking backend. Implementations: GitHub (now), Local DB (next). */
export interface Tracker {
  readonly kind: string;
  /** Open issues the agency could act on. */
  listOpenIssues(repo: string): Promise<TrackerIssue[]>;
  /** The conversation for an issue, oldest→newest, classified human vs agency. */
  getThread(repo: string, number: number): Promise<TrackerComment[]>;
  /** Post an agency comment. */
  postComment(repo: string, number: number, body: string): Promise<void>;
  /** Move an issue's state (a column in the DB — GitHub carries no state of its own). */
  setState(repo: string, number: number, state: string): Promise<void>;
  /** Open a new issue; returns its number. */
  createIssue(repo: string, title: string, body: string): Promise<{ number: number }>;
}

/** GitHub-backed Tracker — a thin delegation wrapper over github.ts (no behaviour change). */
export class GitHubTracker implements Tracker {
  readonly kind = "github";

  async listOpenIssues(repo: string): Promise<TrackerIssue[]> {
    const issues = await listAllOpenIssues(repo);
    return issues.map((i) => ({ repo, number: i.number, title: i.title, body: i.body }));
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
    recordIssueState(repo, number, { state });
  }

  async createIssue(repo: string, title: string, body: string): Promise<{ number: number }> {
    const r = await createIssue(repo, title, body);
    return { number: r.number };
  }
}

/**
 * DB-authoritative Tracker (the v2 inversion). Reads come from the local DB (fast, no rate limits);
 * writes update the DB AND push to GitHub immediately so the two stay in step (no conflict window).
 * Inbound GitHub changes are folded in by `syncInComment` (called from the webhook handler).
 */
export class LocalTracker implements Tracker {
  readonly kind = "local";

  async listOpenIssues(repo: string): Promise<TrackerIssue[]> {
    return listLocalOpenIssues(repo).map((i) => ({ repo: i.repo, number: i.number, title: i.title, body: i.body }));
  }

  async getThread(repo: string, number: number): Promise<TrackerComment[]> {
    const issue = getLocalIssue(repo, number);
    const head: TrackerComment[] = issue?.body ? [{ author: "human", body: issue.body }] : [];
    const comments = getLocalComments(repo, number).map((c) => ({
      author: (c.author === "agency" ? "agency" : "human") as "agency" | "human",
      body: c.body,
      ...(c.created_at ? { createdAt: c.created_at } : {}),
    }));
    return [...head, ...comments];
  }

  async postComment(repo: string, number: number, body: string): Promise<void> {
    // commentOnIssue is DB-first (records locally, then mirrors to GitHub when number > 0).
    await commentOnIssue(repo, number, body).catch(() => {});
  }

  async setState(repo: string, number: number, state: string): Promise<void> {
    upsertLocalIssue({ repo, number, state });
    recordIssueState(repo, number, { state });
  }

  async createIssue(repo: string, title: string, body: string): Promise<{ number: number }> {
    // Dashboard-originated: create on GitHub to get a real number, then mirror as authoritative.
    const r = await createIssue(repo, title, body);
    upsertLocalIssue({ repo, number: r.number, title, body, state: "planned", origin: "dashboard" });
    return { number: r.number };
  }
}

/** The webhook payload fields the inbound sync consumes (subset of GitHub's issues/issue_comment events). */
export interface InboundEvent {
  action?: string;
  issue?: { number?: number; title?: string; body?: string; state_reason?: string | null; pull_request?: unknown };
  comment?: { id?: number; body?: string; created_at?: string; user?: { login?: string } };
}

/**
 * Inbound sync for one GitHub webhook delivery (issue_comment / issues): fold GitHub activity into
 * the DB so the dashboard's local source of truth stays current. No-op for other events.
 *
 * GitHub's API treats every PR as an issue: `issues` and `issue_comment` events fire for PRs too,
 * carrying `issue.pull_request`. Those deliveries must NEVER adopt a card — unguarded, the agency
 * ingested its own epic full-build PR as an issue and ran the planner on it (#150).
 */
export function syncInEvent(repo: string, event: string, payload: InboundEvent): void {
  if (payload.issue?.pull_request) return; // a PR, not an issue — never adopt into the board
  const action = payload.action ?? "";
  // Comments always fold into the DB conversation cache (dashboard = source of truth), so a
  // comment made/edited/deleted directly on GitHub shows up in the dashboard in real time.
  if (event === "issue_comment" && payload.issue?.number && payload.comment?.id) {
    if (action === "created") {
      const isAgency = (payload.comment.body ?? "").includes(AGENCY_MARKER);
      syncInComment(repo, payload.issue.number, payload.comment.id, payload.comment.user?.login ?? "user", payload.comment.body ?? "", isAgency, payload.comment.created_at ?? "");
    } else if (action === "edited") {
      syncInCommentEdit(payload.comment.id, payload.comment.body ?? "");
    } else if (action === "deleted") {
      syncInCommentDelete(payload.comment.id);
    }
  } else if (event === "issues" && payload.issue?.number) {
    const n = payload.issue.number;
    if (action === "closed") {
      // Closed on GitHub directly → done locally too ("not planned" close also archives).
      syncInIssueState(repo, n, "closed", { stateReason: payload.issue.state_reason ?? "", title: payload.issue.title ?? "" });
    } else if (action === "reopened") {
      syncInIssueState(repo, n, "reopened", { title: payload.issue.title ?? "" });
    } else if (action === "deleted" || action === "transferred") {
      syncInIssueState(repo, n, "deleted");
    } else {
      // opened/edited: keep the board card's title and the thread head cache fresh.
      if (action === "edited") {
        if (payload.issue.title) recordIssueState(repo, n, { title: payload.issue.title });
        const key = `head:${repo}#${n}`;
        const cur = getSetting(key);
        if (cur) {
          try {
            const h = JSON.parse(cur) as Record<string, unknown>;
            h.title = payload.issue.title ?? h.title;
            h.body = payload.issue.body ?? h.body;
            setSetting(key, JSON.stringify(h));
          } catch { /* head cache stays stale; /refresh-issue repairs it */ }
        }
      }
      // Issue body only adopts into the DB when DB-authoritative tracking is enabled.
      if (trackerMode() === "local" && (action === "opened" || action === "edited")) {
        syncInIssue(repo, n, payload.issue.title ?? "", payload.issue.body ?? "");
      }
    }
  }
}

/** Inbound sync: fold a GitHub comment into the DB (dedup by GitHub id, echo-collapse our own posts,
 *  preserve GitHub's timestamp for correct time-sorting). Webhook calls this. */
export function syncInComment(repo: string, number: number, ghId: number, author: string, body: string, isAgency: boolean, createdAt?: string): void {
  const clean = (body || "").replace(AGENCY_MARKER, "").trim();
  foldInGitHubComment({ repo, number, gh_id: ghId, author, body: clean, created_at: createdAt || "", isAgency });
}

/** Inbound sync: fold a GitHub issue (opened/edited) into the DB as the adopted record. */
export function syncInIssue(repo: string, number: number, title: string, body: string): void {
  upsertLocalIssue({ repo, number, title, body, origin: "github" });
}

/**
 * Inbound sync: a GitHub issue's LIFECYCLE changed on the mirror (closed / reopened / deleted
 * directly on GitHub). The DB stays authoritative for the work lifecycle — this only folds the
 * human's terminal/park signal back in, mirroring what the equivalent dashboard action records:
 *  - closed              → done (a "not planned" close also archives, like the dashboard's dismiss)
 *  - reopened            → planned, back on the board (unarchived)
 *  - deleted/transferred → archived (hidden from the board; history is kept)
 */
export function syncInIssueState(repo: string, number: number, change: "closed" | "reopened" | "deleted", opts: { stateReason?: string; title?: string } = {}): void {
  const extra = opts.title ? { title: opts.title } : {};
  if (change === "closed") {
    recordIssueStatus(repo, number, withStatus("done"), extra);
    if ((opts.stateReason || "") === "not_planned") archiveIssue(repo, number);
    upsertLocalIssue({ repo, number, closed: true, ...extra });
  } else if (change === "reopened") {
    recordIssueStatus(repo, number, withStatus("planned"), extra);
    unarchiveIssue(repo, number);
    upsertLocalIssue({ repo, number, closed: false, ...extra });
  } else {
    archiveIssue(repo, number);
    upsertLocalIssue({ repo, number, closed: true });
  }
}

/** Inbound sync: a comment was edited on GitHub — update the local copy (matched by GitHub id). */
export function syncInCommentEdit(ghId: number, body: string): void {
  updateCommentBody(ghId, (body || "").replace(AGENCY_MARKER, "").trim());
}

/** Inbound sync: a comment was deleted on GitHub — drop the local copy. */
export function syncInCommentDelete(ghId: number): void {
  deleteLocalCommentByGhId(ghId);
}

/** Local-first mode is opt-in (default GitHub) so the inversion can be enabled deliberately. */
/** Local-first mode is the default (ADR-0001 / #69): the DB is authoritative; GitHub is a
 *  mirror. Set tracker=github (or TRACKER=github) to fall back to GitHub-authoritative tracking. */
export function trackerMode(): "local" | "github" {
  const s = (getSetting("tracker") || process.env.TRACKER || "").trim().toLowerCase();
  return s === "github" ? "github" : "local";
}

/** The active tracker — GitHub by default; LocalTracker (DB-authoritative) when enabled. */
export function getTracker(): Tracker {
  return trackerMode() === "local" ? new LocalTracker() : new GitHubTracker();
}
