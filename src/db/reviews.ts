import { getDb, now } from "./connection.js";

export type ReviewVerdict = "approved" | "changes";

export function recordReview(repo: string, number: number, verdict: ReviewVerdict, summary: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO pr_review (repo, number, verdict, summary, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET verdict = excluded.verdict, summary = excluded.summary, updated_at = excluded.updated_at`,
    ).run(repo, number, verdict, summary.slice(0, 4000), new Date().toISOString());
  } catch {
    /* best effort */
  }
}

export function getReview(repo: string, number: number): { verdict: ReviewVerdict; summary: string } | null {
  const d = getDb();
  if (!d) return null;
  try {
    const r = d.prepare(`SELECT verdict, summary FROM pr_review WHERE repo = ? AND number = ?`).get(repo, number) as
      | { verdict: ReviewVerdict; summary: string }
      | undefined;
    return r ?? null;
  } catch {
    return null;
  }
}

export function clearReview(repo: string, number: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM pr_review WHERE repo = ? AND number = ?`).run(repo, number);
  } catch {
    /* best effort */
  }
}

export function listReviews(): Record<string, ReviewVerdict> {
  const d = getDb();
  if (!d) return {};
  try {
    const rows = d.prepare(`SELECT repo, number, verdict FROM pr_review`).all() as Array<{
      repo: string;
      number: number;
      verdict: ReviewVerdict;
    }>;
    const out: Record<string, ReviewVerdict> = {};
    for (const r of rows) out[`${r.repo}#${r.number}`] = r.verdict;
    return out;
  } catch {
    return {};
  }
}
