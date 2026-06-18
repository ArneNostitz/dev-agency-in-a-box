import { getDb, now } from "./connection.js";

export interface ActivityRow {
  repo: string;
  number: number;
  role: string;
  kind: string;
  text: string;
  created_at: string;
}

export function recordActivity(
  repo: string,
  number: number,
  role: string,
  kind: string,
  text: string,
): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT INTO activity (repo, number, role, kind, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      repo,
      number,
      role,
      kind,
      text.slice(0, 4000),
      now(),
    );
  } catch {
    /* best effort */
  }
}

export function recentActivity(limit = 80): ActivityRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d
      .prepare(`SELECT repo, number, role, kind, text, created_at FROM activity ORDER BY id DESC LIMIT ?`)
      .all(limit) as unknown as ActivityRow[];
    return rows.reverse();
  } catch {
    return [];
  }
}

/** Recent activity for one issue (oldest-first), for building a resume digest. */
export function issueActivity(repo: string, number: number, limit = 40): ActivityRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d
      .prepare(`SELECT repo, number, role, kind, text, created_at FROM activity WHERE repo = ? AND number = ? ORDER BY id DESC LIMIT ?`)
      .all(repo, number, limit) as unknown as ActivityRow[];
    return rows.reverse();
  } catch {
    return [];
  }
}
