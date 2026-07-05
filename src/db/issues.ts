import { getDb, now } from "./connection.js";
import { parseLegacyStatus, stateColumnFor, STATUS_NOT_PLANNED, type IssueStatus, type BlockedReason } from "../state.js";

/**
 * FULL per-issue wipe (the dashboard "Reset" action): every interaction and run artifact for
 * repo#number goes — conversation (local_comment), run history, plans, tool telemetry, review
 * verdicts, conflicts, autofix counters, file footprints, thread cursor, resume sessions, activity,
 * lessons, attachments. Global tables (token_usage accounting, change_journal, archived) stay.
 * If the issue is an epic PARENT its child links + epic state are dropped; as a CHILD its row in
 * the parent's checklist resets to open.
 */
export function resetIssueData(repo: string, number: number): void {
  const d = getDb();
  if (!d) return;
  const byIssue = [
    "local_comment", "runs", "plans", "run_step", "activity", "lessons",
    "issue_files", "thread_cursor", "agent_sessions", "pr_review", "pr_conflict", "attachments",
  ];
  for (const t of byIssue) {
    try { d.prepare(`DELETE FROM ${t} WHERE repo = ? AND number = ?`).run(repo, number); } catch { /* best effort */ }
  }
  try { d.prepare(`DELETE FROM pr_autofix WHERE repo = ? AND pr = ?`).run(repo, number); } catch { /* best effort */ }
  try { d.prepare(`DELETE FROM epics WHERE repo = ? AND parent = ?`).run(repo, number); } catch { /* best effort */ }
  try { d.prepare(`DELETE FROM epic_state WHERE repo = ? AND parent = ?`).run(repo, number); } catch { /* best effort */ }
  try { d.prepare(`UPDATE epics SET state = 'open', closed = 0 WHERE repo = ? AND child = ?`).run(repo, number); } catch { /* best effort */ }
}

export function recordIssueFiles(repo: string, number: number, files: string[]): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT INTO issue_files (repo, number, files, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET files = excluded.files, updated_at = excluded.updated_at`)
      .run(repo, number, JSON.stringify(files || []), now());
  } catch { /* best effort */ }
}

export function addIssueFiles(repo: string, number: number, files: string[]): void {
  const cur = filesFor(repo, number);
  const merged = [...new Set([...cur, ...(files || []).map((f) => f.trim().replace(/^\.?\/+/, "")).filter(Boolean)])];
  if (merged.length !== cur.length) recordIssueFiles(repo, number, merged);
}

export function filesFor(repo: string, number: number): string[] {
  const d = getDb();
  if (!d) return [];
  try {
    const r = d.prepare(`SELECT files FROM issue_files WHERE repo = ? AND number = ?`).get(repo, number) as { files?: string } | undefined;
    return r?.files ? (JSON.parse(r.files) as string[]) : [];
  } catch { return []; }
}

export function recordIssueState(
  repo: string,
  number: number,
  fields: { title?: string; role?: string; state?: string },
): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO issues (repo, number, title, role, state, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET
         title = COALESCE(excluded.title, issues.title),
         role  = COALESCE(excluded.role,  issues.role),
         state = COALESCE(excluded.state, issues.state),
         created_at = COALESCE(issues.created_at, excluded.created_at),
         -- Only bump updated_at on a REAL change. The scan re-records every issue each pass; bumping
         -- it on a no-op made the board (sorted by updated_at) reshuffle constantly.
         updated_at = CASE WHEN
              COALESCE(excluded.title, issues.title) IS NOT issues.title
           OR COALESCE(excluded.role,  issues.role)  IS NOT issues.role
           OR COALESCE(excluded.state, issues.state) IS NOT issues.state
           THEN excluded.updated_at ELSE issues.updated_at END`,
    ).run(repo, number, fields.title ?? null, fields.role ?? null, fields.state ?? null, now(), now());
  } catch (err) {
    console.warn("[agency] memory write (issue) failed:", (err as Error).message);
  }
}

export function recordIssueStatus(repo: string, number: number, status: IssueStatus, extra: { title?: string; role?: string } = {}): void {
  const d = getDb();
  if (!d) return;
  try {
    const stateCol = stateColumnFor(status);
    const blockedCol = status.blocked;
    d.prepare(
      `INSERT INTO issues (repo, number, title, role, state, blocked, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET
         title   = COALESCE(excluded.title, issues.title),
         role    = COALESCE(excluded.role,  issues.role),
         state   = excluded.state,
         blocked = excluded.blocked,
         created_at = COALESCE(issues.created_at, excluded.created_at),
         updated_at = CASE WHEN
              COALESCE(excluded.title, issues.title) IS NOT issues.title
           OR COALESCE(excluded.role,  issues.role)  IS NOT issues.role
           OR excluded.state IS NOT issues.state
           OR excluded.blocked IS NOT issues.blocked
           THEN excluded.updated_at ELSE issues.updated_at END`,
    ).run(repo, number, extra.title ?? null, extra.role ?? null, stateCol, blockedCol, now(), now());
  } catch (err) {
    console.warn("[agency] memory write (issue status) failed:", (err as Error).message);
  }
}

export function getIssueStatus(repo: string, number: number): IssueStatus {
  const row = getIssueRow(repo, number);
  if (!row) return STATUS_NOT_PLANNED;
  // The state column holds the canonical enum directly (ADR-0001). parseLegacyStatus is
  // only a safety net for the rare pre-flush row; valid enum values pass through it as-is.
  return { state: parseLegacyStatus(row.state).state, blocked: (row.blocked as BlockedReason | null) ?? null };
}

export interface IssueRow {
  repo: string;
  number: number;
  title: string;
  role: string;
  state: string;
  blocked: string | null;
  updated_at: string;
  created_at?: string | null;
  pr_number: number | null;
  pr_url: string | null;
  by_agent?: number;
}

export function recordPr(repo: string, number: number, prNumber: number, prUrl: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`UPDATE issues SET pr_number = ?, pr_url = ? WHERE repo = ? AND number = ?`).run(
      prNumber,
      prUrl,
      repo,
      number,
    );
  } catch {
    /* best effort */
  }
}

/** DB-first 'created by an agent' flag (so the dashboard can show it without a GitHub label). */
export function setByAgent(repo: string, number: number, on = true): void {
  const d = getDb(); if (!d) return;
  try { d.prepare(`UPDATE issues SET by_agent = ? WHERE repo = ? AND number = ?`).run(on ? 1 : 0, repo, number); } catch { /* best effort */ }
}

export function getIssueRow(repo: string, number: number): IssueRow | null {
  const d = getDb();
  if (!d) return null;
  try {
    return (d
      .prepare(`SELECT repo, number, title, role, state, blocked, updated_at, created_at, pr_number, pr_url, by_agent FROM issues WHERE repo = ? AND number = ?`)
      .get(repo, number) as unknown as IssueRow | null) ?? null;
  } catch {
    return null;
  }
}

export function recentIssues(limit = 40): IssueRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(
        `SELECT i.repo, i.number, i.title, i.role, i.state, i.blocked, i.updated_at, i.created_at, i.pr_number, i.pr_url, i.by_agent FROM issues i
         WHERE NOT EXISTS (SELECT 1 FROM archived a WHERE a.repo = i.repo AND a.number = i.number)
         ORDER BY i.updated_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as IssueRow[];
  } catch {
    return [];
  }
}

export function archiveIssue(repo: string, number: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT OR IGNORE INTO archived (repo, number) VALUES (?, ?)`).run(repo, number);
  } catch {
    /* best effort */
  }
}

/** Put an archived issue back on the board (e.g. reopened on GitHub after a not-planned close). */
export function unarchiveIssue(repo: string, number: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM archived WHERE repo = ? AND number = ?`).run(repo, number);
  } catch {
    /* best effort */
  }
}

/** The role last assigned to an issue (read from the issues row). */
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
