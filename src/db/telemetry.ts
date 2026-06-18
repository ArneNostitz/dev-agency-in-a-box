import { getDb, now } from "./connection.js";

export function recordRunStep(repo: string, number: number, role: string, tool: string, detail: string, ok = true): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT INTO run_step (repo, number, role, tool, detail, ok, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(repo, number, role, tool, (detail || "").slice(0, 200), ok ? 1 : 0, now());
  } catch { /* best effort */ }
}

export interface ToolStat { role: string; tool: string; uses: number; fails: number }
/** How often each (role, tool) is used since an ISO time — surfaces repeating mechanical work. */

export function toolStatsSince(sinceIso: string): ToolStat[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d.prepare(
      `SELECT role, tool, COUNT(*) AS uses, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS fails
       FROM run_step WHERE ts >= ? GROUP BY role, tool ORDER BY uses DESC`,
    ).all(sinceIso) as unknown as ToolStat[];
  } catch { return []; }
}

export function recordIncident(kind: string, detail: string): void {
  recordRunStep("", 0, "system", kind, detail, false);
}

export interface FailureStat { role: string; tool: string; count: number; sample: string }

export function recentFailuresSince(sinceIso: string, limit = 15): FailureStat[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d.prepare(
      `SELECT role, tool, COUNT(*) AS count, MAX(detail) AS sample
       FROM run_step WHERE ts >= ? AND ok = 0 GROUP BY role, tool ORDER BY count DESC LIMIT ?`,
    ).all(sinceIso, limit) as unknown as FailureStat[];
  } catch { return []; }
}

export function runStepCountSince(sinceIso: string): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const r = d.prepare(`SELECT COUNT(*) AS n FROM run_step WHERE ts >= ?`).get(sinceIso) as { n?: number } | undefined;
    return r?.n ?? 0;
  } catch { return 0; }
}
