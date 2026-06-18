import { getDb, now } from "./connection.js";

export function recordConflict(repo: string, number: number, sha: string, files: string[]): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO pr_conflict (repo, number, sha, files, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET sha = excluded.sha, files = excluded.files, updated_at = excluded.updated_at`,
    ).run(repo, number, sha, JSON.stringify(files), now());
  } catch {
    /* best effort */
  }
}

export function getConflict(repo: string, number: number): { sha: string; files: string[] } | null {
  const d = getDb();
  if (!d) return null;
  try {
    const r = d.prepare(`SELECT sha, files FROM pr_conflict WHERE repo = ? AND number = ?`).get(repo, number) as
      | { sha: string; files: string }
      | undefined;
    if (!r) return null;
    let files: string[] = [];
    try { files = JSON.parse(r.files || "[]"); } catch { files = []; }
    return { sha: r.sha, files };
  } catch {
    return null;
  }
}

export function clearConflict(repo: string, number: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM pr_conflict WHERE repo = ? AND number = ?`).run(repo, number);
  } catch {
    /* best effort */
  }
}

export function listConflicts(): Record<string, string[]> {
  const d = getDb();
  if (!d) return {};
  try {
    const rows = d.prepare(`SELECT repo, number, files FROM pr_conflict`).all() as Array<{ repo: string; number: number; files: string }>;
    const out: Record<string, string[]> = {};
    for (const r of rows) {
      try { out[`${r.repo}#${r.number}`] = JSON.parse(r.files || "[]"); } catch { out[`${r.repo}#${r.number}`] = []; }
    }
    return out;
  } catch {
    return {};
  }
}
