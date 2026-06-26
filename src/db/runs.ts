import { getDb, now } from "./connection.js";

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

type RoleRuns = Record<string, Record<string, number>>;
let _rrCache: RoleRuns | null = null, _rrAt = 0;
/** Per-issue per-role run counts (e.g. {"o/r#5":{developer:3,tester:2}}) — a role running >1 time
 * means the workflow looped back to it. Memoized ~8s (hit on every /data poll). */
export function roleRunsByIssue(): RoleRuns {
  if (_rrCache && Date.now() - _rrAt < 8000) return _rrCache;
  const d = getDb();
  const m: RoleRuns = {};
  if (d) try {
    const rows = d.prepare("SELECT repo, number, role, COUNT(*) AS c FROM runs WHERE repo IS NOT NULL AND number IS NOT NULL AND role IS NOT NULL AND role NOT IN ('-','decomposer','orchestrator') GROUP BY repo, number, role").all() as Array<{ repo: string; number: number; role: string; c: number }>;
    for (const r of rows) { (m[r.repo + "#" + r.number] ??= {})[r.role] = r.c; }
  } catch { /* noop */ }
  _rrCache = m; _rrAt = Date.now();
  return m;
}

/** How many workflow-engine STEP runs (kind='workflow') have completed for an issue. The step engine
 * has no persisted cursor, so on resume it uses this count to continue at the next step instead of
 * re-running from step 0. Matches the frontend's wfStep computation. */
export function workflowStepRunCount(repo: string, number: number): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const r = d.prepare("SELECT COUNT(*) AS c FROM runs WHERE repo = ? AND number = ? AND kind = 'workflow'").get(repo, number) as { c?: number } | undefined;
    return r?.c ?? 0;
  } catch { return 0; }
}

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
