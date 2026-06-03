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
    `);
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
): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO runs (repo, number, role, model, turns, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(repo, number, role, model, turns, kind, now());
  } catch (err) {
    console.warn("[agency] memory write (run) failed:", (err as Error).message);
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
  created_at: string;
}
export interface IssueRow {
  repo: string;
  number: number;
  title: string;
  role: string;
  state: string;
  updated_at: string;
}

/** Recent agent runs, newest first (for the status dashboard). */
export function recentRuns(limit = 40): RunRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(`SELECT repo, number, role, model, turns, kind, created_at FROM runs ORDER BY id DESC LIMIT ?`)
      .all(limit) as unknown as RunRow[];
  } catch {
    return [];
  }
}

/** Recent issue states, newest first (for the status dashboard). */
export function recentIssues(limit = 25): IssueRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(`SELECT repo, number, title, role, state, updated_at FROM issues ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as unknown as IssueRow[];
  } catch {
    return [];
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
