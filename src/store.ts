/**
 * Structured memory — a SQLite ledger of what the agency has done. Uses Node's built-in
 * node:sqlite (no native build, works in the container). It records issue lifecycle, every
 * agent run (role/model/turns) for audit + cost, and the plans produced. This is the
 * "what's the exact state / what did we do" layer; semantic (vector) recall comes next.
 *
 * All writes are best-effort: a memory failure must never break the pipeline.
 */
import { encryptSecret, tryDecrypt } from "./crypto.js";
import { parseLegacyStatus, stateColumnFor, STATUS_NOT_PLANNED, type IssueStatus, type BlockedReason } from "./state.js";
import { getDb, now } from "./db/connection.js";
import { getSetting, setSetting, setSecretSetting, getSecretSetting } from "./db/settings.js";

// Re-export the connection-layer symbols the rest of the app imports from store.ts (back-compat).
export { getDb, now, migrateIssueStates } from "./db/connection.js";
export { getSetting, setSetting, setSecretSetting, getSecretSetting } from "./db/settings.js";
export { getAutoRaw, setAuto, autoEnabled, autoAttempts, bumpAutoAttempts, resetAutoAttempts } from "./db/auto.js";
export type { AutoKind, AutoValue } from "./db/auto.js";
export { upsertSkill, getSkill, listSkills, deleteSkill, skillsPrompt, upsertHook, listHooks, deleteHook } from "./db/skills_hooks.js";
export type { Skill, Hook } from "./db/skills_hooks.js";
export {
  getModelsPresets, getProviders, setProviders, getRoleModels, setRoleModels,
  getGlobalModel, setGlobalModel, setSessionFallback, clearSessionFallback, getSessionFallback,
  getFallbackChain, setFallbackChain, getAutoSwitchOnLimit,
  setIssueModelOverride, getIssueModelOverride, clearIssueModelOverride,
} from "./db/providers.js";
export type { Provider } from "./db/providers.js";
export { upsertAgentDef, getAgentDef, listAgentDefs, deleteAgentDef, chatAgentForText, seedChatAgents } from "./db/agent_def.js";
export type { AgentDef } from "./db/agent_def.js";
export { searchMemory } from "./db/memory.js";
export type { MemoryHit } from "./db/memory.js";
export { getAgentOverride, setAgentOverride, listAgentRevisions, getAgentRevision, deleteAgentOverride, listAgentOverridePaths } from "./db/agent_overrides.js";
export type { AgentRevision } from "./db/agent_overrides.js";
export { addWatchedRepo, removeWatchedRepo, listWatchedRepos } from "./db/watched.js";
// Re-export the users aggregate (Candidate 3, #70).
export {
  countUsers, getUserByName, getUserByNameOrEmail, createPasswordReset, consumePasswordReset,
  getUserById, listUsers, createUser, setUserPassword, authenticate, createSession, getSessionUser,
  revokeSession, createInvite, getInvite, acceptInvite, listInvites,
  setUserSecret, getUserSecret, getUserSecretStatus, listUserSecretKeys,
} from "./db/users.js";
export type { User, UserRow } from "./db/users.js";
// Re-export the reviews aggregate (Candidate 3, #70).
export { recordReview, getReview, clearReview, listReviews } from "./db/reviews.js";
export type { ReviewVerdict } from "./db/reviews.js";
export { recordConflict, getConflict, clearConflict, listConflicts } from "./db/conflicts.js";
export { setRateLimited, clearRateLimited, listRateLimited, dueRateLimited } from "./db/ratelimit.js";
export {
  recordRun, issueSpend, recordTokens, tokensByRoleSince, tokensByDaySince,
  topIssuesByTokensSince, tokensByIssueAll, tokensSince, tokensByModelSince, spendSince,
} from "./db/tokens.js";
export { recordPlan, lastPlan } from "./db/plans.js";
export { recordRunStep, toolStatsSince, recordIncident, recentFailuresSince, runStepCountSince } from "./db/telemetry.js";
export type { ToolStat, FailureStat } from "./db/telemetry.js";
export {
  recordIssueFiles, filesFor, recordIssueState, recordIssueStatus, getIssueStatus,
  recordPr, getIssueRow, recentIssues, archiveIssue,
} from "./db/issues.js";
export type { IssueRow } from "./db/issues.js";
export { recordLesson, recentLessons, unprocessedLessons, markLessonsProcessed } from "./db/lessons.js";
export type { LessonRow } from "./db/lessons.js";
export { recordActivity, recentActivity, issueActivity } from "./db/activity.js";
export type { ActivityRow } from "./db/activity.js";




/** Repos added at runtime via issue commands (unioned with config/repos.txt). */

/** Record the files an issue's work will touch (from the planner) — drives the file-lock scheduler. */

/** The declared file footprint for an issue (empty = unknown → don't lock, fall back to merge check). */


/**
 * Write a full IssueStatus (state + blocked) via the state module — the two-field model.
 * The canonical lifecycle enum goes to `state` (e.g. "working"); the BlockedReason goes
 * to its own `blocked` column. Best-effort, like every memory write.
 */

/**
 * Read the two-field IssueStatus. `state` holds the canonical enum; `blocked` the reason.
 * parseLegacyStatus is a safety net for rare pre-flush rows; a flushed DB has clean enum
 * values and the parser is a pass-through. Pure DB read + the state module — no GitHub.
 */


/** Total spend + turns for one issue (the per-issue budget gate). */

/** Record token usage for one agent run (drives the session-allowance gauge). */

/** Per-role token + cost totals since an ISO timestamp. */

/** Per-day token + cost totals since an ISO timestamp (UTC day buckets), oldest first. */

/** The most token-expensive issues since an ISO timestamp (only rows that have a repo/number). */

/** Lifetime tokens/cost per issue, keyed "repo#number", with the dominant model. Cheap single scan
 *  used to decorate board cards + the detail view so each issue shows what it has cost so far. */

/** Tokens + cost used since an ISO timestamp (for the rolling session window). */

/** Per-model token + cost totals since an ISO timestamp. */

// ---- rate-limit parking (auto-resume after the usage window resets) ----
/** All rate-limited (auto-resume) issues with their reset time, for the dashboard. */

/** Parked issues whose resume time has passed — ready to re-run, no tokens needed to find them. */

// ---- review verdict (so the dashboard knows a PR still has requested changes) ----
/** verdict per issue for the board, keyed "repo#number" — cheap DB read for the card badge. */

// ---- PR merge-conflict tracking (so the UI + conversation can surface which files conflict) ----

/** Remember the conflicting files for a PR at a given head SHA (so we don't recompute/renotify). */
/** Conflicting-file map for the board, keyed "repo#number" — cheap read so cards/detail can flag. */

// ---- live agent overrides (dashboard edits, applied without a redeploy) ----

/** The edited content for an agent file, or null if it uses the on-disk default. */


/** Revision history for one agent file (metadata only — newest first). */

/** The content of a specific revision (for viewing/reverting). */
/** Remove an override so the file reverts to its on-disk default. */


// ---- settings (editable from the dashboard, no redeploy) ----

// ---- global encrypted secrets (admin-managed, e.g. the GitHub webhook secret) ----
/** Store a global secret encrypted at rest (needs MASTER_KEY). Empty clears it. */
/** Decrypt a global secret, or null if unset/undecryptable. */

// ---- auto-mode (auto-resume / auto-merge), resolved issue → repo → global ----
/** The raw on/off/inherit value set at one scope (for rendering the toggle's current state). */
/** Set (or clear, with "") the auto value at a scope. */
/** Effective on/off for an issue: issue override → repo override → global default (off). */
/** Bounded auto-retries so auto-resume can't loop forever on a broken issue. */

// ---- users / sessions / invites / per-user secrets (multi-user mode) ----

/** Spend since an ISO timestamp (for the dashboard's "today" figure). */

// ---- lessons (the reflection / self-improvement memory) ----


/** Store one distilled lesson from a finished run. */

/** Latest lessons (any state) — injected into every agent's prompt as learned memory. */

// ---- pluggable agent registry (v3) ----







/** Find a chat agent whose @handle is mentioned in `text` (first match). */

/** Seed the two starter chat agents once (idempotent). */
// ---- run_step telemetry (v3): tool-call log for the Process Analyzer ----


/**
 * Search the agency's OWN memory (past lessons, plans, code-review notes, prior issue titles) for
 * relevant prior work — the retrieval backend for the `recall` agent tool. Keyword-scored over
 * recent rows (no FTS dependency): an agent that's stuck can pull "how did we do X before" instead
 * of re-reading files or re-asking the human.
 */

// ---- local-first tracking (Phase 4): DB as source of truth, GitHub as a synced adapter ----

export interface LocalIssue { repo: string; number: number; title: string; body: string; labels: string[]; state: string; origin: string; closed: boolean; updated_at: string }
export interface LocalComment { id: number; repo: string; number: number; author: string; body: string; source: string; gh_id: number | null; created_at: string }

/** Insert/update a local issue (the authoritative record once an issue is adopted into the DB). */
export function upsertLocalIssue(i: { repo: string; number: number; title?: string; body?: string; labels?: string[]; state?: string; origin?: string; closed?: boolean }): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO local_issue (repo, number, title, body, labels, state, origin, closed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET
         title = COALESCE(excluded.title, local_issue.title),
         body  = COALESCE(excluded.body,  local_issue.body),
         labels = COALESCE(excluded.labels, local_issue.labels),
         state = COALESCE(excluded.state, local_issue.state),
         origin = COALESCE(excluded.origin, local_issue.origin),
         closed = excluded.closed,
         updated_at = excluded.updated_at`,
    ).run(i.repo, i.number, i.title ?? null, i.body ?? null, i.labels ? JSON.stringify(i.labels) : null, i.state ?? null, i.origin ?? null, i.closed ? 1 : 0, now());
  } catch { /* best effort */ }
}

export function getLocalIssue(repo: string, number: number): LocalIssue | null {
  const d = getDb();
  if (!d) return null;
  try {
    const r = d.prepare(`SELECT * FROM local_issue WHERE repo = ? AND number = ?`).get(repo, number) as
      | { repo: string; number: number; title: string | null; body: string | null; labels: string | null; state: string | null; origin: string | null; closed: number; updated_at: string }
      | undefined;
    if (!r) return null;
    let labels: string[] = [];
    try { labels = r.labels ? JSON.parse(r.labels) : []; } catch { labels = []; }
    return { repo: r.repo, number: r.number, title: r.title ?? "", body: r.body ?? "", labels, state: r.state ?? "", origin: r.origin ?? "", closed: !!r.closed, updated_at: r.updated_at };
  } catch { return null; }
}

export function listLocalOpenIssues(repo: string): LocalIssue[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d.prepare(`SELECT * FROM local_issue WHERE repo = ? AND closed = 0 ORDER BY number`).all(repo) as Array<{ repo: string; number: number; title: string | null; body: string | null; labels: string | null; state: string | null; origin: string | null; closed: number; updated_at: string }>;
    return rows.map((r) => { let labels: string[] = []; try { labels = r.labels ? JSON.parse(r.labels) : []; } catch { labels = []; } return { repo: r.repo, number: r.number, title: r.title ?? "", body: r.body ?? "", labels, state: r.state ?? "", origin: r.origin ?? "", closed: !!r.closed, updated_at: r.updated_at }; });
  } catch { return []; }
}

/** Next number for a dashboard-originated issue (negative space avoids colliding with GitHub numbers
 *  until it's pushed out and assigned a real one). */
export function nextLocalIssueNumber(repo: string): number {
  const d = getDb();
  if (!d) return -1;
  try {
    const r = d.prepare(`SELECT MIN(number) AS m FROM local_issue WHERE repo = ?`).get(repo) as { m: number | null } | undefined;
    const min = r?.m ?? 0;
    return Math.min(min, 0) - 1;
  } catch { return -1; }
}

/** Append a comment. `source` = "github" | "dashboard" | "agency"; gh_id dedupes synced GitHub rows. */
export function addLocalComment(c: { repo: string; number: number; author: string; body: string; source: string; gh_id?: number }): void {
  const d = getDb();
  if (!d) return;
  try {
    if (c.gh_id) {
      const dup = d.prepare(`SELECT 1 FROM local_comment WHERE repo = ? AND number = ? AND gh_id = ?`).get(c.repo, c.number, c.gh_id);
      if (dup) return; // already synced this GitHub comment
    }
    d.prepare(`INSERT INTO local_comment (repo, number, author, body, source, gh_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(c.repo, c.number, c.author, c.body, c.source, c.gh_id ?? null, now());
  } catch { /* best effort */ }
}

export function getLocalComments(repo: string, number: number): LocalComment[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d.prepare(`SELECT id, repo, number, author, body, source, gh_id, created_at FROM local_comment WHERE repo = ? AND number = ? ORDER BY id`).all(repo, number) as unknown as LocalComment[];
  } catch { return []; }
}

// ---- DB-first conversation (the dashboard is the source of truth; GitHub is mirrored) ----

/**
 * Record a comment authored locally (by the agency or a dashboard reply) the instant it's created,
 * BEFORE it's mirrored to GitHub — so the dashboard shows it immediately. Returns the row id so the
 * caller can attach the GitHub id once the mirror succeeds. `source`: "agency" | "human".
 */
export function recordOutgoingComment(c: { repo: string; number: number; author: string; body: string; source: string }): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const r = d.prepare(`INSERT INTO local_comment (repo, number, author, body, source, gh_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`)
      .run(c.repo, c.number, c.author, c.body.trim(), c.source, now());
    return Number(r.lastInsertRowid) || 0;
  } catch { return 0; }
}

/** Attach a GitHub comment id (and its authoritative timestamp) to a locally-recorded comment. */
export function setCommentGhId(id: number, ghId: number, createdAt?: string): void {
  const d = getDb();
  if (!d || !id || !ghId) return;
  try {
    if (createdAt) d.prepare(`UPDATE local_comment SET gh_id = ?, created_at = ? WHERE id = ?`).run(ghId, createdAt, id);
    else d.prepare(`UPDATE local_comment SET gh_id = ? WHERE id = ?`).run(ghId, id);
  } catch { /* best effort */ }
}

/**
 * Fold a comment observed on GitHub into the DB. Deduped by GitHub id; if it's the echo of a comment
 * we just posted locally (same body, gh_id not yet linked), it adopts that row instead of inserting a
 * duplicate. `body` must already have the agency marker stripped. New external comments are stored
 * with source "github" so the UI can flag them as incoming.
 */
export function foldInGitHubComment(c: { repo: string; number: number; gh_id: number; author: string; body: string; created_at: string; isAgency: boolean }): void {
  const d = getDb();
  if (!d || !c.gh_id) return;
  const body = (c.body || "").trim();
  try {
    if (d.prepare(`SELECT 1 FROM local_comment WHERE repo = ? AND number = ? AND gh_id = ?`).get(c.repo, c.number, c.gh_id)) return;
    const echo = d.prepare(`SELECT id FROM local_comment WHERE repo = ? AND number = ? AND gh_id IS NULL AND body = ? ORDER BY id LIMIT 1`).get(c.repo, c.number, body) as { id?: number } | undefined;
    if (echo?.id) {
      d.prepare(`UPDATE local_comment SET gh_id = ?, created_at = ? WHERE id = ?`).run(c.gh_id, c.created_at || now(), echo.id);
      return;
    }
    d.prepare(`INSERT INTO local_comment (repo, number, author, body, source, gh_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(c.repo, c.number, c.author || "?", body, c.isAgency ? "agency" : "github", c.gh_id, c.created_at || now());
  } catch { /* best effort */ }
}

/** Update a comment body by its GitHub id (after an edit). */
export function updateCommentBody(ghId: number, body: string): void {
  const d = getDb();
  if (!d || !ghId) return;
  try { d.prepare(`UPDATE local_comment SET body = ? WHERE gh_id = ?`).run(body.trim(), ghId); } catch { /* best effort */ }
}

export interface ConversationComment { id: number; localId: number; author: string; body: string; createdAt: string; isAgency: boolean; incoming: boolean }

/** The conversation for an issue, sorted by time (then insertion order) — the dashboard's truth. */
export function getConversation(repo: string, number: number): ConversationComment[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d.prepare(`SELECT id, author, body, source, gh_id, created_at FROM local_comment WHERE repo = ? AND number = ? ORDER BY created_at, id`).all(repo, number) as Array<{ id: number; author: string; body: string; source: string; gh_id: number | null; created_at: string }>;
    return rows.map((r) => ({
      id: r.gh_id ?? 0,
      localId: r.id,
      author: r.author || "?",
      body: r.body || "",
      createdAt: r.created_at || "",
      isAgency: r.source === "agency",
      incoming: r.source === "github",
    }));
  } catch { return []; }
}

/** How many cached comments we already have for an issue (decides sync vs. background reconcile). */
export function conversationCount(repo: string, number: number): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const r = d.prepare(`SELECT COUNT(*) AS n FROM local_comment WHERE repo = ? AND number = ?`).get(repo, number) as { n: number } | undefined;
    return r?.n ?? 0;
  } catch { return 0; }
}

/** Lessons not yet folded into the playbooks (drives the self-improvement PR). */


/** Append one streamed thought/tool event from an agent. */

/** Recent activity, oldest-first within the latest `limit` (for the stream panel). */

export interface RunRow {
  repo: string;
  number: number;
  role: string;
  model: string;
  turns: number;
  kind: string;
  cost_usd: number;
  created_at: string;
}

/** Record the PR a delivered issue produced (for the dashboard's links + preview). */

/** Recent agent runs, newest first (for the status dashboard). */
export function recentRuns(limit = 40): RunRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(`SELECT repo, number, role, model, turns, kind, cost_usd, created_at FROM runs ORDER BY id DESC LIMIT ?`)
      .all(limit) as unknown as RunRow[];
  } catch {
    return [];
  }
}

/** Recent issue states (excluding archived), newest first (for the status dashboard). */


/** Auto-fix attempt counter per PR (bounds self-healing so it can't loop). */
export function getAutofixCount(repo: string, pr: number): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const row = d.prepare(`SELECT attempts FROM pr_autofix WHERE repo = ? AND pr = ?`).get(repo, pr) as
      | { attempts?: number }
      | undefined;
    return row?.attempts ?? 0;
  } catch {
    return 0;
  }
}
export function incAutofix(repo: string, pr: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO pr_autofix (repo, pr, attempts) VALUES (?, ?, 1)
       ON CONFLICT(repo, pr) DO UPDATE SET attempts = attempts + 1`,
    ).run(repo, pr);
  } catch {
    /* best effort */
  }
}
export function resetAutofix(repo: string, pr: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM pr_autofix WHERE repo = ? AND pr = ?`).run(repo, pr);
  } catch {
    /* best effort */
  }
}

// ---- agent sessions (for SDK resume) + per-issue activity (for the resume digest) ----

export function setSession(repo: string, number: number, role: string, sessionId: string): void {
  const d = getDb();
  if (!d || !sessionId) return;
  try {
    d.prepare(
      `INSERT INTO agent_sessions (repo, number, role, session_id, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(repo, number, role) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`,
    ).run(repo, number, role, sessionId, now());
  } catch {
    /* best effort */
  }
}
export function getSession(repo: string, number: number, role: string): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare(`SELECT session_id FROM agent_sessions WHERE repo = ? AND number = ? AND role = ?`).get(repo, number, role) as
      | { session_id?: string }
      | undefined;
    return row?.session_id ?? null;
  } catch {
    return null;
  }
}

// ---- comment cursor (handle each human comment exactly once) ----

/** The id of the last human comment we acted on for this thread (0 if none). */
export function getThreadCursor(repo: string, number: number): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const row = d.prepare(`SELECT last_comment_id FROM thread_cursor WHERE repo = ? AND number = ?`).get(repo, number) as
      | { last_comment_id?: number }
      | undefined;
    return row?.last_comment_id ?? 0;
  } catch {
    return 0;
  }
}

export function setThreadCursor(repo: string, number: number, commentId: number): void {
  const d = getDb();
  if (!d || !commentId) return;
  try {
    d.prepare(
      `INSERT INTO thread_cursor (repo, number, last_comment_id) VALUES (?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET last_comment_id = excluded.last_comment_id`,
    ).run(repo, number, commentId);
  } catch {
    /* best effort */
  }
}

// ---- epics (parent issue -> sub-issues) ----

export interface EpicChild {
  child: number;
  title: string;
  state: string;
  closed: number;
}

export function addEpicChild(repo: string, parent: number, child: number, title: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT OR IGNORE INTO epics (repo, parent, child, title, state, closed) VALUES (?, ?, ?, ?, 'open', 0)`).run(
      repo,
      parent,
      child,
      title,
    );
  } catch {
    /* best effort */
  }
}

export function updateEpicChild(repo: string, parent: number, child: number, state: string, closed: boolean): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`UPDATE epics SET state = ?, closed = ? WHERE repo = ? AND parent = ? AND child = ?`).run(
      state,
      closed ? 1 : 0,
      repo,
      parent,
      child,
    );
  } catch {
    /* best effort */
  }
}

export function listEpicChildren(repo: string, parent: number): EpicChild[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(`SELECT child, title, state, closed FROM epics WHERE repo = ? AND parent = ? ORDER BY child`)
      .all(repo, parent) as unknown as EpicChild[];
  } catch {
    return [];
  }
}

export function listEpicParents(repo: string): number[] {
  const d = getDb();
  if (!d) return [];
  try {
    return (d.prepare(`SELECT DISTINCT parent FROM epics WHERE repo = ?`).all(repo) as Array<{ parent: number }>).map(
      (r) => r.parent,
    );
  } catch {
    return [];
  }
}

/** All epics grouped by parent number, for the dashboard (one query). */
export function epicsByParent(repo: string): Record<number, EpicChild[]> {
  const d = getDb();
  if (!d) return {};
  try {
    const rows = d
      .prepare(`SELECT parent, child, title, state, closed FROM epics WHERE repo = ? ORDER BY parent, child`)
      .all(repo) as unknown as Array<EpicChild & { parent: number }>;
    const out: Record<number, EpicChild[]> = {};
    for (const r of rows) (out[r.parent] = out[r.parent] ?? []).push({ child: r.child, title: r.title, state: r.state, closed: r.closed });
    return out;
  } catch {
    return {};
  }
}

export function getEpicMeta(repo: string, parent: number): { hash: string; reviewed: boolean } {
  const d = getDb();
  if (!d) return { hash: "", reviewed: false };
  try {
    const row = d.prepare(`SELECT tracker_hash, reviewed FROM epic_state WHERE repo = ? AND parent = ?`).get(repo, parent) as
      | { tracker_hash?: string; reviewed?: number }
      | undefined;
    return { hash: row?.tracker_hash ?? "", reviewed: Boolean(row?.reviewed) };
  } catch {
    return { hash: "", reviewed: false };
  }
}

export function setEpicMeta(repo: string, parent: number, fields: { hash?: string; reviewed?: boolean }): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO epic_state (repo, parent, tracker_hash, reviewed) VALUES (?, ?, ?, ?)
       ON CONFLICT(repo, parent) DO UPDATE SET
         tracker_hash = COALESCE(excluded.tracker_hash, epic_state.tracker_hash),
         reviewed = COALESCE(excluded.reviewed, epic_state.reviewed)`,
    ).run(repo, parent, fields.hash ?? null, fields.reviewed === undefined ? null : fields.reviewed ? 1 : 0);
  } catch {
    /* best effort */
  }
}

/** Hide an issue from the dashboard. */

/** The role last assigned to an issue (so we resume an awaiting issue on the right path). */
export function getIssueRole(repo: string, number: number): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare(`SELECT role FROM issues WHERE repo = ? AND number = ?`).get(repo, number) as
      | { role?: string }
      | undefined;
    return row?.role ?? null;
  } catch {
    return null;
  }
}

/** Most recent plan for an issue, if any — lets a re-engaged planner recall its own thinking. */
