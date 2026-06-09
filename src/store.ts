/**
 * Structured memory — a SQLite ledger of what the agency has done. Uses Node's built-in
 * node:sqlite (no native build, works in the container). It records issue lifecycle, every
 * agent run (role/model/turns) for audit + cost, and the plans produced. This is the
 * "what's the exact state / what did we do" layer; semantic (vector) recall comes next.
 *
 * All writes are best-effort: a memory failure must never break the pipeline.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync | null {
  if (db) return db;
  try {
    const path = process.env.DB_PATH?.trim() || "data/agency.db";
    mkdirSync(dirname(path), { recursive: true });
    const d = new DatabaseSync(path);
    d.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        repo TEXT NOT NULL,
        number INTEGER NOT NULL,
        title TEXT,
        role TEXT,
        state TEXT,
        updated_at TEXT,
        PRIMARY KEY (repo, number)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT, number INTEGER, role TEXT, model TEXT,
        turns INTEGER, kind TEXT, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT, number INTEGER, plan TEXT, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS watched_repos (
        repo TEXT PRIMARY KEY,
        added_at TEXT
      );
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT, number INTEGER, role TEXT, kind TEXT, text TEXT, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS archived (
        repo TEXT NOT NULL, number INTEGER NOT NULL,
        PRIMARY KEY (repo, number)
      );
      CREATE TABLE IF NOT EXISTS pr_autofix (
        repo TEXT NOT NULL, pr INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (repo, pr)
      );
      CREATE TABLE IF NOT EXISTS lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT, number INTEGER, lesson TEXT NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS thread_cursor (
        repo TEXT NOT NULL, number INTEGER NOT NULL,
        last_comment_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (repo, number)
      );
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0, model TEXT
      );
      CREATE TABLE IF NOT EXISTS epics (
        repo TEXT NOT NULL, parent INTEGER NOT NULL, child INTEGER NOT NULL,
        title TEXT, state TEXT, closed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (repo, parent, child)
      );
      CREATE TABLE IF NOT EXISTS epic_state (
        repo TEXT NOT NULL, parent INTEGER NOT NULL,
        tracker_hash TEXT, reviewed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (repo, parent)
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS rate_limited (repo TEXT NOT NULL, number INTEGER NOT NULL, resume_at TEXT, PRIMARY KEY (repo, number));
      CREATE TABLE IF NOT EXISTS agent_overrides (path TEXT PRIMARY KEY, content TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS agent_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL, content TEXT, source TEXT, note TEXT, created_at TEXT
      );
    `);
    // Migrations for older databases (ALTER fails harmlessly if the column already exists).
    for (const sql of [
      `ALTER TABLE runs ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE issues ADD COLUMN pr_number INTEGER`,
      `ALTER TABLE issues ADD COLUMN pr_url TEXT`,
    ]) {
      try {
        d.exec(sql);
      } catch {
        /* column already there */
      }
    }
    db = d;
    console.log(`[agency] memory: SQLite at ${path}`);
    return db;
  } catch (err) {
    console.warn("[agency] memory disabled:", (err as Error).message);
    return null;
  }
}

const now = () => new Date().toISOString();

/** Add a repo to the dynamic watch list (used by the /add-repo issue command). */
export function addWatchedRepo(repo: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT OR IGNORE INTO watched_repos (repo, added_at) VALUES (?, ?)`).run(repo, now());
  } catch (err) {
    console.warn("[agency] memory write (watched_repo) failed:", (err as Error).message);
  }
}

/** Repos added at runtime via issue commands (unioned with config/repos.txt). */
export function listWatchedRepos(): string[] {
  const d = getDb();
  if (!d) return [];
  try {
    return (d.prepare(`SELECT repo FROM watched_repos ORDER BY repo`).all() as Array<{ repo: string }>).map(
      (r) => r.repo,
    );
  } catch {
    return [];
  }
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
         updated_at = excluded.updated_at`,
    ).run(repo, number, fields.title ?? null, fields.role ?? null, fields.state ?? null, now());
  } catch (err) {
    console.warn("[agency] memory write (issue) failed:", (err as Error).message);
  }
}

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

/** Total spend + turns for one issue (the per-issue budget gate). */
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

/** Record token usage for one agent run (drives the session-allowance gauge). */
export function recordTokens(tokens: number, costUsd: number, model: string): void {
  const d = getDb();
  if (!d || (!tokens && !costUsd)) return;
  try {
    d.prepare(`INSERT INTO token_usage (ts, tokens, cost_usd, model) VALUES (?, ?, ?, ?)`).run(
      now(),
      Math.round(tokens),
      costUsd,
      model,
    );
  } catch {
    /* best effort */
  }
}

/** Tokens + cost used since an ISO timestamp (for the rolling session window). */
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

/** Per-model token + cost totals since an ISO timestamp. */
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

// ---- rate-limit parking (auto-resume after the usage window resets) ----
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
/** Parked issues whose resume time has passed — ready to re-run, no tokens needed to find them. */
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

// ---- live agent overrides (dashboard edits, applied without a redeploy) ----

/** The edited content for an agent file, or null if it uses the on-disk default. */
export function getAgentOverride(path: string): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare(`SELECT content FROM agent_overrides WHERE path = ?`).get(path) as { content?: string } | undefined;
    return row?.content ?? null;
  } catch {
    return null;
  }
}
export function setAgentOverride(path: string, content: string, source = "dashboard", note = ""): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO agent_overrides (path, content, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    ).run(path, content, now());
    // Keep a full history so every change (dashboard or self-improvement) is auditable/revertible.
    d.prepare(`INSERT INTO agent_revisions (path, content, source, note, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      path,
      content,
      source,
      note,
      now(),
    );
  } catch {
    /* best effort */
  }
}

export interface AgentRevision {
  id: number;
  path: string;
  source: string;
  note: string;
  created_at: string;
}

/** Revision history for one agent file (metadata only — newest first). */
export function listAgentRevisions(path: string, limit = 20): AgentRevision[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(`SELECT id, path, source, note, created_at FROM agent_revisions WHERE path = ? ORDER BY id DESC LIMIT ?`)
      .all(path, limit) as unknown as AgentRevision[];
  } catch {
    return [];
  }
}

/** The content of a specific revision (for viewing/reverting). */
export function getAgentRevision(id: number): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare(`SELECT content FROM agent_revisions WHERE id = ?`).get(id) as { content?: string } | undefined;
    return row?.content ?? null;
  } catch {
    return null;
  }
}
/** Remove an override so the file reverts to its on-disk default. */
export function deleteAgentOverride(path: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM agent_overrides WHERE path = ?`).run(path);
  } catch {
    /* best effort */
  }
}
export function listAgentOverridePaths(): string[] {
  const d = getDb();
  if (!d) return [];
  try {
    return (d.prepare(`SELECT path FROM agent_overrides`).all() as Array<{ path: string }>).map((r) => r.path);
  } catch {
    return [];
  }
}

// ---- model providers + per-role assignment (dashboard "Models" panel) ----

export interface Provider {
  id: string;
  name: string;
  baseUrl: string; // Anthropic-compatible endpoint (e.g. GLM/DeepSeek/Kimi or a gateway)
  apiKey: string;
  models: string[];
}

export function getProviders(): Provider[] {
  try {
    return JSON.parse(getSetting("providers") ?? "[]") as Provider[];
  } catch {
    return [];
  }
}
export function setProviders(list: Provider[]): void {
  setSetting("providers", JSON.stringify(list ?? []));
}

/** role -> { providerId, model } ; absent/empty = default Claude on your subscription. */
export function getRoleModels(): Record<string, { providerId: string; model: string }> {
  try {
    return JSON.parse(getSetting("role_models") ?? "{}") as Record<string, { providerId: string; model: string }>;
  } catch {
    return {};
  }
}
export function setRoleModels(map: Record<string, { providerId: string; model: string }>): void {
  setSetting("role_models", JSON.stringify(map ?? {}));
}

// ---- settings (editable from the dashboard, no redeploy) ----
export function getSetting(key: string): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}
export function setSetting(key: string, value: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      key,
      value,
    );
  } catch {
    /* best effort */
  }
}

/** Spend since an ISO timestamp (for the dashboard's "today" figure). */
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

// ---- lessons (the reflection / self-improvement memory) ----

export interface LessonRow {
  id: number;
  repo: string;
  number: number;
  lesson: string;
  created_at: string;
}

/** Store one distilled lesson from a finished run. */
export function recordLesson(repo: string, number: number, lesson: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT INTO lessons (repo, number, lesson, created_at) VALUES (?, ?, ?, ?)`).run(
      repo,
      number,
      lesson.slice(0, 600),
      now(),
    );
  } catch {
    /* best effort */
  }
}

/** Latest lessons (any state) — injected into every agent's prompt as learned memory. */
export function recentLessons(limit = 12): string[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d
      .prepare(`SELECT lesson FROM lessons ORDER BY id DESC LIMIT ?`)
      .all(limit) as unknown as Array<{ lesson: string }>;
    return rows.map((r) => r.lesson).reverse();
  } catch {
    return [];
  }
}

/** Lessons not yet folded into the playbooks (drives the self-improvement PR). */
export function unprocessedLessons(): LessonRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(`SELECT id, repo, number, lesson, created_at FROM lessons WHERE processed = 0 ORDER BY id`)
      .all() as unknown as LessonRow[];
  } catch {
    return [];
  }
}

export function markLessonsProcessed(ids: number[]): void {
  const d = getDb();
  if (!d || ids.length === 0) return;
  try {
    const stmt = d.prepare(`UPDATE lessons SET processed = 1 WHERE id = ?`);
    for (const id of ids) stmt.run(id);
  } catch {
    /* best effort */
  }
}

export function recordPlan(repo: string, number: number, plan: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT INTO plans (repo, number, plan, created_at) VALUES (?, ?, ?, ?)`).run(
      repo,
      number,
      plan,
      now(),
    );
  } catch (err) {
    console.warn("[agency] memory write (plan) failed:", (err as Error).message);
  }
}

export interface ActivityRow {
  repo: string;
  number: number;
  role: string;
  kind: string;
  text: string;
  created_at: string;
}

/** Append one streamed thought/tool event from an agent. */
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

/** Recent activity, oldest-first within the latest `limit` (for the stream panel). */
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
export interface IssueRow {
  repo: string;
  number: number;
  title: string;
  role: string;
  state: string;
  updated_at: string;
  pr_number: number | null;
  pr_url: string | null;
}

/** Record the PR a delivered issue produced (for the dashboard's links + preview). */
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

/** Recent agent runs, newest first (for the status dashboard). */
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

/** Recent issue states (excluding archived), newest first (for the status dashboard). */
export function recentIssues(limit = 40): IssueRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(
        `SELECT i.repo, i.number, i.title, i.role, i.state, i.updated_at, i.pr_number, i.pr_url FROM issues i
         WHERE NOT EXISTS (SELECT 1 FROM archived a WHERE a.repo = i.repo AND a.number = i.number)
         ORDER BY i.updated_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as IssueRow[];
  } catch {
    return [];
  }
}

/** Auto-fix attempt counter per PR (bounds self-healing so it can't loop). */
export function getAutofixCount(repo: string, pr: number): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const row = d.prepare(`SELECT attempts FROM pr_autofix WHERE repo = ? AND pr = ?`).get(repo, pr) as
      | { attempts?: number }
      | undefined;
    return row?.attempts ?? 0;
  } catch {
    return 0;
  }
}
export function incAutofix(repo: string, pr: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO pr_autofix (repo, pr, attempts) VALUES (?, ?, 1)
       ON CONFLICT(repo, pr) DO UPDATE SET attempts = attempts + 1`,
    ).run(repo, pr);
  } catch {
    /* best effort */
  }
}
export function resetAutofix(repo: string, pr: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM pr_autofix WHERE repo = ? AND pr = ?`).run(repo, pr);
  } catch {
    /* best effort */
  }
}

// ---- comment cursor (handle each human comment exactly once) ----

/** The id of the last human comment we acted on for this thread (0 if none). */
export function getThreadCursor(repo: string, number: number): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const row = d.prepare(`SELECT last_comment_id FROM thread_cursor WHERE repo = ? AND number = ?`).get(repo, number) as
      | { last_comment_id?: number }
      | undefined;
    return row?.last_comment_id ?? 0;
  } catch {
    return 0;
  }
}

export function setThreadCursor(repo: string, number: number, commentId: number): void {
  const d = getDb();
  if (!d || !commentId) return;
  try {
    d.prepare(
      `INSERT INTO thread_cursor (repo, number, last_comment_id) VALUES (?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET last_comment_id = excluded.last_comment_id`,
    ).run(repo, number, commentId);
  } catch {
    /* best effort */
  }
}

// ---- epics (parent issue -> sub-issues) ----

export interface EpicChild {
  child: number;
  title: string;
  state: string;
  closed: number;
}

export function addEpicChild(repo: string, parent: number, child: number, title: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT OR IGNORE INTO epics (repo, parent, child, title, state, closed) VALUES (?, ?, ?, ?, 'open', 0)`).run(
      repo,
      parent,
      child,
      title,
    );
  } catch {
    /* best effort */
  }
}

export function updateEpicChild(repo: string, parent: number, child: number, state: string, closed: boolean): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`UPDATE epics SET state = ?, closed = ? WHERE repo = ? AND parent = ? AND child = ?`).run(
      state,
      closed ? 1 : 0,
      repo,
      parent,
      child,
    );
  } catch {
    /* best effort */
  }
}

export function listEpicChildren(repo: string, parent: number): EpicChild[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(`SELECT child, title, state, closed FROM epics WHERE repo = ? AND parent = ? ORDER BY child`)
      .all(repo, parent) as unknown as EpicChild[];
  } catch {
    return [];
  }
}

export function listEpicParents(repo: string): number[] {
  const d = getDb();
  if (!d) return [];
  try {
    return (d.prepare(`SELECT DISTINCT parent FROM epics WHERE repo = ?`).all(repo) as Array<{ parent: number }>).map(
      (r) => r.parent,
    );
  } catch {
    return [];
  }
}

/** All epics grouped by parent number, for the dashboard (one query). */
export function epicsByParent(repo: string): Record<number, EpicChild[]> {
  const d = getDb();
  if (!d) return {};
  try {
    const rows = d
      .prepare(`SELECT parent, child, title, state, closed FROM epics WHERE repo = ? ORDER BY parent, child`)
      .all(repo) as unknown as Array<EpicChild & { parent: number }>;
    const out: Record<number, EpicChild[]> = {};
    for (const r of rows) (out[r.parent] = out[r.parent] ?? []).push({ child: r.child, title: r.title, state: r.state, closed: r.closed });
    return out;
  } catch {
    return {};
  }
}

export function getEpicMeta(repo: string, parent: number): { hash: string; reviewed: boolean } {
  const d = getDb();
  if (!d) return { hash: "", reviewed: false };
  try {
    const row = d.prepare(`SELECT tracker_hash, reviewed FROM epic_state WHERE repo = ? AND parent = ?`).get(repo, parent) as
      | { tracker_hash?: string; reviewed?: number }
      | undefined;
    return { hash: row?.tracker_hash ?? "", reviewed: Boolean(row?.reviewed) };
  } catch {
    return { hash: "", reviewed: false };
  }
}

export function setEpicMeta(repo: string, parent: number, fields: { hash?: string; reviewed?: boolean }): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO epic_state (repo, parent, tracker_hash, reviewed) VALUES (?, ?, ?, ?)
       ON CONFLICT(repo, parent) DO UPDATE SET
         tracker_hash = COALESCE(excluded.tracker_hash, epic_state.tracker_hash),
         reviewed = COALESCE(excluded.reviewed, epic_state.reviewed)`,
    ).run(repo, parent, fields.hash ?? null, fields.reviewed === undefined ? null : fields.reviewed ? 1 : 0);
  } catch {
    /* best effort */
  }
}

/** Hide an issue from the dashboard. */
export function archiveIssue(repo: string, number: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT OR IGNORE INTO archived (repo, number) VALUES (?, ?)`).run(repo, number);
  } catch {
    /* best effort */
  }
}

/** The role last assigned to an issue (so we resume an awaiting issue on the right path). */
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

/** Most recent plan for an issue, if any — lets a re-engaged planner recall its own thinking. */
export function lastPlan(repo: string, number: number): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d
      .prepare(`SELECT plan FROM plans WHERE repo = ? AND number = ? ORDER BY id DESC LIMIT 1`)
      .get(repo, number) as { plan?: string } | undefined;
    return row?.plan ?? null;
  } catch {
    return null;
  }
}
