/**
 * The database connection — owns the SQLite handle, the schema, and the migrations.
 * Extracted from store.ts (Candidate 3, #70) so the connection concern is its own small
 * module and the per-aggregate modules can import getDb()/now() from one place.
 *
 * The one-time legacy → canonical IssueState data migration runs here during first init,
 * guarded by a settings flag. It is self-contained SQL (no cross-aggregate function
 * calls), so it lives with the connection rather than in the issues module.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseLegacyStatus, isIssueState, type BlockedReason } from "../state.js";

let db: DatabaseSync | null = null;

/** The ISO timestamp used across every aggregate write. */
export const now = (): string => new Date().toISOString();

/**
 * One-time data migration: convert legacy `agency:*` composite state values in the issues
 * table to the canonical lifecycle enum, lifting the blocked reason into its own column.
 * Idempotent — rows already canonical (or carrying a kind label like agency:epic) are skipped.
 * Reuses parseLegacyStatus as the single source of truth for the mapping.
 */
export function migrateIssueStates(): { migrated: number; skipped: number } {
  const d = getDb();
  if (!d) return { migrated: 0, skipped: 0 };
  let migrated = 0;
  let skipped = 0;
  try {
    const rows = d.prepare("SELECT repo, number, state, blocked FROM issues").all() as Array<{
      repo: string;
      number: number;
      state: string;
      blocked: string | null;
    }>;
    for (const r of rows) {
      if (r.state === "agency:epic") {
        skipped++;
        continue;
      } // kind label — leave for the IssueKind module
      if (isIssueState(r.state)) {
        skipped++;
        continue;
      } // already canonical
      const status = parseLegacyStatus(r.state);
      const newBlocked = status.blocked ?? (r.blocked as BlockedReason | null);
      d.prepare("UPDATE issues SET state = ?, blocked = ? WHERE repo = ? AND number = ?")
        .run(status.state, newBlocked, r.repo, r.number);
      migrated++;
    }
  } catch (err) {
    console.warn("[agency] issue-state migration failed:", (err as Error).message);
  }
  return { migrated, skipped };
}

/** The singleton DB handle. Creates the schema + runs migrations on first call. Best-effort. */
export function getDb(): DatabaseSync | null {
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
        cost_usd REAL NOT NULL DEFAULT 0, model TEXT,
        repo TEXT, number INTEGER, role TEXT
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
      CREATE TABLE IF NOT EXISTS pr_review (repo TEXT NOT NULL, number INTEGER NOT NULL, verdict TEXT, summary TEXT, updated_at TEXT, PRIMARY KEY (repo, number));
      CREATE TABLE IF NOT EXISTS pr_conflict (repo TEXT NOT NULL, number INTEGER NOT NULL, sha TEXT, files TEXT, updated_at TEXT, PRIMARY KEY (repo, number));
      -- Per-run tool-call telemetry (v3): the raw material the Process Analyzer mines for repeating
      -- tasks → skills/hooks/deterministic code.
      CREATE TABLE IF NOT EXISTS run_step (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT, number INTEGER, role TEXT, tool TEXT, detail TEXT, ok INTEGER, ts TEXT
      );
      -- Files an issue's work declares it will touch (planner output) — the file-lock scheduler uses
      -- this to run non-overlapping issues in parallel and serialize overlapping ones.
      CREATE TABLE IF NOT EXISTS issue_files (
        repo TEXT NOT NULL, number INTEGER NOT NULL, files TEXT, updated_at TEXT, PRIMARY KEY (repo, number)
      );
      -- Pluggable agent registry (v3): custom agents (incl. interactive chat agents) defined/edited
      -- in the dashboard. Built-in repo roles still live in code; these are additive.
      CREATE TABLE IF NOT EXISTS agent_def (
        name TEXT PRIMARY KEY, handle TEXT, persona TEXT, model TEXT, tools TEXT,
        mode TEXT, pushes_github INTEGER NOT NULL DEFAULT 1, skills TEXT, builtin INTEGER NOT NULL DEFAULT 0,
        default_task TEXT, avatar TEXT, updated_at TEXT
      );
      -- Skills (v3, Claude Code Agent Skill schema): name + description (triggers it) + markdown body.
      CREATE TABLE IF NOT EXISTS skill (name TEXT PRIMARY KEY, description TEXT, body TEXT, updated_at TEXT);
      -- Deterministic pre/post hooks the orchestrator runs around an agent (the analyzer writes these).
      CREATE TABLE IF NOT EXISTS hook (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target TEXT, phase TEXT, command TEXT, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT
      );
      -- Workflows (linear + gates): an ordered arrangement of agent steps with forced skills/hooks.
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger TEXT, steps TEXT, gates TEXT,
        hooks TEXT, builtin INTEGER NOT NULL DEFAULT 0, updated_at TEXT
      );
      -- Local-first tracking (Phase 4): the DB as source of truth, GitHub as a synced adapter.
      CREATE TABLE IF NOT EXISTS local_issue (
        repo TEXT NOT NULL, number INTEGER NOT NULL, title TEXT, body TEXT, labels TEXT,
        state TEXT, origin TEXT, closed INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
        PRIMARY KEY (repo, number)
      );
      CREATE TABLE IF NOT EXISTS local_comment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL, number INTEGER NOT NULL, author TEXT, body TEXT,
        source TEXT, gh_id INTEGER, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS agent_sessions (
        repo TEXT NOT NULL, number INTEGER NOT NULL, role TEXT NOT NULL,
        session_id TEXT, updated_at TEXT, PRIMARY KEY (repo, number, role)
      );
      CREATE TABLE IF NOT EXISTS agent_overrides (path TEXT PRIMARY KEY, content TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS agent_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL, content TEXT, source TEXT, note TEXT, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL, email TEXT, password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member', created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT, expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS invites (
        token TEXT PRIMARY KEY, email TEXT, role TEXT NOT NULL DEFAULT 'member',
        created_by INTEGER, created_at TEXT, accepted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_secrets (
        user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT,
        updated_at TEXT, PRIMARY KEY (user_id, key)
      );
      CREATE TABLE IF NOT EXISTS password_resets (
        token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT, used INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY, repo TEXT, number INTEGER, name TEXT, mime TEXT,
        bytes BLOB NOT NULL, size INTEGER, created_at TEXT
      );
    `);
    // Migrations for older databases (ALTER fails harmlessly if the column already exists).
    for (const sql of [
      `ALTER TABLE runs ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE issues ADD COLUMN pr_number INTEGER`,
      `ALTER TABLE issues ADD COLUMN pr_url TEXT`,
      `ALTER TABLE token_usage ADD COLUMN repo TEXT`,
      `ALTER TABLE token_usage ADD COLUMN number INTEGER`,
      `ALTER TABLE token_usage ADD COLUMN role TEXT`,
      `ALTER TABLE issues ADD COLUMN blocked TEXT`,
      `ALTER TABLE agent_def ADD COLUMN default_task TEXT`,
      `ALTER TABLE agent_def ADD COLUMN avatar TEXT`,
      `ALTER TABLE workflows ADD COLUMN hooks TEXT`,
    ]) {
      try {
        d.exec(sql);
      } catch {
        /* column already there */
      }
    }
    db = d; // set early so the data migration below can use getDb()
    // One-time data migration: legacy agency:* composite state → canonical enum + blocked column.
    // Guarded by a settings flag so it runs exactly once per database. Idempotent regardless.
    try {
      if (!d.prepare("SELECT value FROM settings WHERE key = ?").get("state_migration_v2")) {
        const r = migrateIssueStates();
        if (r.migrated) console.log(`[agency] migrated ${r.migrated} issue row(s) to canonical IssueState (${r.skipped} already canonical)`);
        d.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("state_migration_v2", "1");
      }
    } catch {
      /* best effort — never block startup */
    }
    console.log(`[agency] memory: SQLite at ${path}`);
    return db;
  } catch (err) {
    console.warn("[agency] memory disabled:", (err as Error).message);
    return null;
  }
}
