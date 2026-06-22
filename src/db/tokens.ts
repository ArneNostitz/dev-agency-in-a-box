import { getDb, now } from "./connection.js";

export function recordRun(
  repo: string,
  number: number,
  role: string,
  model: string,
  turns: number,
  kind: string,
  costUsd = 0,
): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO runs (repo, number, role, model, turns, kind, created_at, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(repo, number, role, model, turns, kind, now(), costUsd);
  } catch (err) {
    console.warn("[agency] memory write (run) failed:", (err as Error).message);
  }
}

export function issueSpend(repo: string, number: number): { costUsd: number; turns: number } {
  const d = getDb();
  if (!d) return { costUsd: 0, turns: 0 };
  try {
    const row = d
      .prepare(
        `SELECT COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(turns),0) AS turns
         FROM runs WHERE repo = ? AND number = ?`,
      )
      .get(repo, number) as { cost?: number; turns?: number } | undefined;
    return { costUsd: row?.cost ?? 0, turns: row?.turns ?? 0 };
  } catch {
    return { costUsd: 0, turns: 0 };
  }
}

export function recordTokens(
  tokens: number,
  costUsd: number,
  model: string,
  repo?: string,
  number?: number,
  role?: string,
): void {
  const d = getDb();
  if (!d || (!tokens && !costUsd)) return;
  try {
    d.prepare(`INSERT INTO token_usage (ts, tokens, cost_usd, model, repo, number, role) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      now(),
      Math.round(tokens),
      costUsd,
      model,
      repo ?? null,
      number ?? null,
      role ?? null,
    );
  } catch {
    /* best effort */
  }
}

export function tokensByRoleSince(sinceIso: string): Array<{ role: string; tokens: number; costUsd: number; runs: number }> {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(
        `SELECT COALESCE(role,'?') AS role, COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(cost_usd),0) AS costUsd, COUNT(*) AS runs
         FROM token_usage WHERE ts >= ? GROUP BY role ORDER BY tokens DESC`,
      )
      .all(sinceIso) as unknown as Array<{ role: string; tokens: number; costUsd: number; runs: number }>;
  } catch {
    return [];
  }
}

export function tokensByDaySince(sinceIso: string): Array<{ day: string; tokens: number; costUsd: number }> {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(
        `SELECT substr(ts,1,10) AS day, COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(cost_usd),0) AS costUsd
         FROM token_usage WHERE ts >= ? GROUP BY day ORDER BY day ASC`,
      )
      .all(sinceIso) as unknown as Array<{ day: string; tokens: number; costUsd: number }>;
  } catch {
    return [];
  }
}

export function topIssuesByTokensSince(sinceIso: string, limit = 12): Array<{ repo: string; number: number; tokens: number; costUsd: number; runs: number }> {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(
        `SELECT repo, number, COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(cost_usd),0) AS costUsd, COUNT(*) AS runs
         FROM token_usage WHERE ts >= ? AND repo IS NOT NULL AND number IS NOT NULL
         GROUP BY repo, number ORDER BY tokens DESC LIMIT ?`,
      )
      .all(sinceIso, limit) as unknown as Array<{ repo: string; number: number; tokens: number; costUsd: number; runs: number }>;
  } catch {
    return [];
  }
}

let _tbiaCache: Record<string, { tokens: number; costUsd: number; model: string | null; runs: number }> | null = null;
let _tbiaAt = 0;
export function tokensByIssueAll(): Record<string, { tokens: number; costUsd: number; model: string | null; runs: number }> {
  // Hot path: called on every /data poll over the full (unbounded) token_usage table. A ~8s memo
  // collapses repeated polls into one scan; staleness on a cost badge is harmless.
  if (_tbiaCache && Date.now() - _tbiaAt < 8000) return _tbiaCache;
  _tbiaCache = tokensByIssueAllUncached();
  _tbiaAt = Date.now();
  return _tbiaCache;
}
function tokensByIssueAllUncached(): Record<string, { tokens: number; costUsd: number; model: string | null; runs: number }> {
  const d = getDb();
  if (!d) return {};
  try {
    const rows = d
      .prepare(
        `SELECT repo, number, model, COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(cost_usd),0) AS costUsd, COUNT(*) AS runs
         FROM token_usage WHERE repo IS NOT NULL AND number IS NOT NULL
         GROUP BY repo, number, model`,
      )
      .all() as unknown as Array<{ repo: string; number: number; model: string | null; tokens: number; costUsd: number; runs: number }>;
    const acc: Record<string, { tokens: number; costUsd: number; model: string | null; runs: number; _best: number }> = {};
    for (const r of rows) {
      const k = `${r.repo}#${r.number}`;
      const e = (acc[k] ??= { tokens: 0, costUsd: 0, model: null, runs: 0, _best: 0 });
      e.tokens += r.tokens || 0;
      e.costUsd += r.costUsd || 0;
      e.runs += r.runs || 0;
      if ((r.tokens || 0) > e._best) { e._best = r.tokens || 0; e.model = r.model; }
    }
    const out: Record<string, { tokens: number; costUsd: number; model: string | null; runs: number }> = {};
    for (const k of Object.keys(acc)) {
      const { tokens, costUsd, model, runs } = acc[k];
      out[k] = { tokens, costUsd, model, runs };
    }
    return out;
  } catch {
    return {};
  }
}

export function tokensSince(sinceIso: string): { tokens: number; costUsd: number } {
  const d = getDb();
  if (!d) return { tokens: 0, costUsd: 0 };
  try {
    const row = d
      .prepare(`SELECT COALESCE(SUM(tokens),0) AS t, COALESCE(SUM(cost_usd),0) AS c FROM token_usage WHERE ts >= ?`)
      .get(sinceIso) as { t?: number; c?: number } | undefined;
    return { tokens: row?.t ?? 0, costUsd: row?.c ?? 0 };
  } catch {
    return { tokens: 0, costUsd: 0 };
  }
}

export function tokensByModelSince(sinceIso: string): Array<{ model: string; tokens: number; costUsd: number }> {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(
        `SELECT COALESCE(model,'?') AS model, COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(cost_usd),0) AS costUsd
         FROM token_usage WHERE ts >= ? GROUP BY model ORDER BY tokens DESC`,
      )
      .all(sinceIso) as unknown as Array<{ model: string; tokens: number; costUsd: number }>;
  } catch {
    return [];
  }
}

export function spendSince(sinceIso: string): { costUsd: number; runs: number } {
  const d = getDb();
  if (!d) return { costUsd: 0, runs: 0 };
  try {
    const row = d
      .prepare(`SELECT COALESCE(SUM(cost_usd),0) AS cost, COUNT(*) AS n FROM runs WHERE created_at >= ?`)
      .get(sinceIso) as { cost?: number; n?: number } | undefined;
    return { costUsd: row?.cost ?? 0, runs: row?.n ?? 0 };
  } catch {
    return { costUsd: 0, runs: 0 };
  }
}
