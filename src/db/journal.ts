/**
 * Change journal (v4 coordination). The DURABLE, real-state record of what each issue changed and
 * WHY — written at MERGE, never at edit time, so it only ever reflects work that actually landed on
 * main. This is the substrate the Orchestrator, the recall memory, and the (upcoming) reconcile
 * agent read so agents build on real history instead of coupling to unmerged branches.
 */
import { getDb, now } from "./connection.js";

export interface ChangedFile { path: string; additions?: number; deletions?: number }
export interface ChangeEntry {
  id: number;
  repo: string;
  number: number;
  title: string;
  files: ChangedFile[];
  summary: string;
  mergedAt: string;
}

function parseFiles(s: string | null): ChangedFile[] {
  try { return s ? (JSON.parse(s) as ChangedFile[]) : []; } catch { return []; }
}
function rowTo(r: { id: number; repo: string; number: number; title: string | null; files: string | null; summary: string | null; merged_at: string }): ChangeEntry {
  return { id: r.id, repo: r.repo, number: r.number, title: r.title ?? "", files: parseFiles(r.files), summary: r.summary ?? "", mergedAt: r.merged_at };
}

/** Record a merged issue's change set (best-effort; never throws). */
export function recordChange(repo: string, number: number, entry: { title?: string; files?: ChangedFile[]; summary?: string }): void {
  const d = getDb(); if (!d) return;
  try {
    d.prepare(`INSERT INTO change_journal (repo, number, title, files, summary, merged_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(repo, number, entry.title ?? "", JSON.stringify(entry.files ?? []), entry.summary ?? "", now());
  } catch { /* best effort */ }
}

/** Most recent merged changes for a repo, newest-first. */
export function recentChanges(repo: string, limit = 15): ChangeEntry[] {
  const d = getDb(); if (!d) return [];
  try {
    return (d.prepare(`SELECT * FROM change_journal WHERE repo = ? ORDER BY id DESC LIMIT ?`).all(repo, limit) as Array<Parameters<typeof rowTo>[0]>).map(rowTo);
  } catch { return []; }
}

/** Prior merged changes that touched any of `paths` — what the reconcile/next agent must respect. */
export function changesTouchingFiles(repo: string, paths: string[], limit = 12): ChangeEntry[] {
  const want = new Set((paths || []).map((p) => p.trim().replace(/^\.?\/+/, "")));
  if (!want.size) return [];
  return recentChanges(repo, 200).filter((c) => c.files.some((f) => want.has(f.path.trim().replace(/^\.?\/+/, "")))).slice(0, limit);
}
