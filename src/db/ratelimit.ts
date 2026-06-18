import { getDb, now } from "./connection.js";

export function setRateLimited(repo: string, number: number, resumeAtIso: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO rate_limited (repo, number, resume_at) VALUES (?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET resume_at = excluded.resume_at`,
    ).run(repo, number, resumeAtIso);
  } catch {
    /* best effort */
  }
}

export function clearRateLimited(repo: string, number: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM rate_limited WHERE repo = ? AND number = ?`).run(repo, number);
  } catch {
    /* best effort */
  }
}

export function listRateLimited(): Array<{ repo: string; number: number; resumeAt: string }> {
  const d = getDb();
  if (!d) return [];
  try {
    return d.prepare(`SELECT repo, number, resume_at AS resumeAt FROM rate_limited`).all() as unknown as Array<{
      repo: string;
      number: number;
      resumeAt: string;
    }>;
  } catch {
    return [];
  }
}

export function dueRateLimited(nowIso: string): Array<{ repo: string; number: number }> {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(`SELECT repo, number FROM rate_limited WHERE resume_at <= ? ORDER BY resume_at`)
      .all(nowIso) as unknown as Array<{ repo: string; number: number }>;
  } catch {
    return [];
  }
}
