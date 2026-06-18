import { getDb, now } from "./connection.js";
import { parseLegacyStatus, stateColumnFor, STATUS_NOT_PLANNED, type IssueStatus, type BlockedReason } from "../state.js";

export function recordIssueFiles(repo: string, number: number, files: string[]): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT INTO issue_files (repo, number, files, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET files = excluded.files, updated_at = excluded.updated_at`)
      .run(repo, number, JSON.stringify(files || []), now());
  } catch { /* best effort */ }
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
      `INSERT INTO issues (repo, number, title, role, state, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET
         title = COALESCE(excluded.title, issues.title),
         role  = COALESCE(excluded.role,  issues.role),
         state = COALESCE(excluded.state, issues.state),
         -- Only bump updated_at on a REAL change. The scan re-records every issue each pass; bumping
         -- it on a no-op made the board (sorted by updated_at) reshuffle constantly.
         updated_at = CASE WHEN
              COALESCE(excluded.title, issues.title) IS NOT issues.title
           OR COALESCE(excluded.role,  issues.role)  IS NOT issues.role
           OR COALESCE(excluded.state, issues.state) IS NOT issues.state
           THEN excluded.updated_at ELSE issues.updated_at END`,
    ).run(repo, number, fields.title ?? null, fields.role ?? null, fields.state ?? null, now());
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
      `INSERT INTO issues (repo, number, title, role, state, blocked, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET
         title   = COALESCE(excluded.title, issues.title),
         role    = COALESCE(excluded.role,  issues.role),
         state   = excluded.state,
         blocked = excluded.blocked,
         updated_at = CASE WHEN
              COALESCE(excluded.title, issues.title) IS NOT issues.title
           OR COALESCE(excluded.role,  issues.role)  IS NOT issues.role
           OR excluded.state IS NOT issues.state
           OR excluded.blocked IS NOT issues.blocked
           THEN excluded.updated_at ELSE issues.updated_at END`,
    ).run(repo, number, extra.title ?? null, extra.role ?? null, stateCol, blockedCol, now());
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
  pr_number: number | null;
  pr_url: string | null;
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

export function getIssueRow(repo: string, number: number): IssueRow | null {
  const d = getDb();
  if (!d) return null;
  try {
    return (d
      .prepare(`SELECT repo, number, title, role, state, blocked, updated_at, pr_number, pr_url FROM issues WHERE repo = ? AND number = ?`)
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
        `SELECT i.repo, i.number, i.title, i.role, i.state, i.blocked, i.updated_at, i.pr_number, i.pr_url FROM issues i
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
