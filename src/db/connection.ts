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

/**
 * Prune high-churn, purely-ephemeral telemetry so the hot tables don't grow unbounded. The activity
 * stream is a live UI feed (kept short); run_step is tool-call telemetry. The token_usage + runs
 * cost/audit ledger is intentionally NOT pruned here. Best-effort; called from the hourly sweep.
 */
export function pruneEphemeral(activityDays = 14, runStepDays = 45): { activity: number; runStep: number } {
  const d = getDb(); if (!d) return { activity: 0, runStep: 0 };
  const cut = (days: number): string => new Date(Date.now() - days * 86400_000).toISOString();
  let activity = 0, runStep = 0;
  try { activity = Number(d.prepare("DELETE FROM activity WHERE created_at < ?").run(cut(activityDays)).changes) || 0; } catch { /* noop */ }
  try { runStep = Number(d.prepare("DELETE FROM run_step WHERE ts < ?").run(cut(runStepDays)).changes) || 0; } catch { /* noop */ }
  return { activity, runStep };
}

/** The singleton DB handle. Creates the schema + runs migrations on first call. Best-effort. */
export function getDb(): DatabaseSync | null {
  if (db) return db;
  try {
    const path = process.env.DB_PATH?.trim() || "data/agency.db";
    mkdirSync(dirname(path), { recursive: true });
    const d = new DatabaseSync(path);
    // Concurrency + durability tuning: WAL lets readers and the single writer not block each other;
    // synchronous=NORMAL is safe under WAL; busy_timeout avoids SQLITE_BUSY under the 5s poll + the
    // concurrent run pool; mmap/temp speed reads. Best-effort — ignore if the build lacks a pragma.
    try { d.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA temp_store=MEMORY; PRAGMA mmap_size=134217728;"); } catch { /* noop */ }

    // ── DB ENGINE SEAM ──────────────────────────────────────────────────────────────────────────
    // This is the single place the storage engine is created. Every db/*.ts module gets its handle
    // from getDb(); none import `node:sqlite` directly. To move to another engine (e.g. Postgres for
    // multi-node) you reimplement THIS function to return an object with the same `prepare()` /
    // `exec()` surface — but note Postgres clients are async, so callers would need an async facade
    // (see docs/adr/0002). Until then, SQLite + WAL is the right fit for the single-process design.
    //
    // Transparent prepared-statement cache: node:sqlite re-parses + re-plans SQL on every prepare().
    // Memoizing by SQL string turns the ~140 hot inline `d.prepare("…")` call sites into one Map
    // lookup each, with zero call-site changes. Statements are stateless across run/get/all, so reuse
    // is safe; the cache is bounded by the number of distinct query strings.
    try {
      const realPrepare = d.prepare.bind(d);
      const stmtCache = new Map<string, ReturnType<typeof realPrepare>>();
      (d as { prepare: (sql: string) => ReturnType<typeof realPrepare> }).prepare = (sql: string) => {
        let st = stmtCache.get(sql);
        if (!st) { st = realPrepare(sql); stmtCache.set(sql, st); }
        return st;
      };
    } catch { /* if a runtime forbids reassigning prepare, fall back to uncached — still correct */ }

    d.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        repo TEXT NOT NULL,
        number INTEGER NOT NULL,
        title TEXT,
        role TEXT,
        state TEXT,
        by_agent INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT,
        created_at TEXT,
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
      CREATE TABLE IF NOT EXISTS rate_limited (repo TEXT NOT NULL, number INTEGER NOT NULL, provider_id TEXT NOT NULL DEFAULT '', resume_at TEXT, PRIMARY KEY (repo, number, provider_id));
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
        mode TEXT, interactive INTEGER DEFAULT 0, can_write_code INTEGER, pushes_github INTEGER NOT NULL DEFAULT 1, skills TEXT, builtin INTEGER NOT NULL DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS orch_msg (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
        meta TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS orch_msg_repo ON orch_msg (repo, id);
      CREATE TABLE IF NOT EXISTS change_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL, number INTEGER NOT NULL, title TEXT,
        files TEXT, summary TEXT, merged_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS change_journal_repo ON change_journal (repo, id);
      CREATE INDEX IF NOT EXISTS idx_token_usage_ts ON token_usage (ts);
      CREATE INDEX IF NOT EXISTS idx_token_usage_issue ON token_usage (repo, number);
      CREATE INDEX IF NOT EXISTS idx_runs_created ON runs (created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_issue ON runs (repo, number);
      CREATE INDEX IF NOT EXISTS idx_run_step_ts ON run_step (ts);
      CREATE INDEX IF NOT EXISTS idx_run_step_issue ON run_step (repo, number);
      CREATE INDEX IF NOT EXISTS idx_activity_issue ON activity (repo, number);
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
      `ALTER TABLE agent_def ADD COLUMN interactive INTEGER DEFAULT 0`,
      `ALTER TABLE agent_def ADD COLUMN can_write_code INTEGER`,
      `ALTER TABLE workflows ADD COLUMN hooks TEXT`,
      `ALTER TABLE issues ADD COLUMN by_agent INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE issues ADD COLUMN created_at TEXT`,
    ]) {
      try {
        d.exec(sql);
      } catch {
        /* column already there */
      }
    }
    // Migrate rate_limited to the per-provider schema (provider_id column + 3-col PK). The old table
    // had PK (repo, number) and no provider_id; a stale provider-agnostic row there is exactly the bug
    // where a Claude limit blocked a GLM run, so rebuild the table (rows are transient — re-derived).
    try {
      const cols = d.prepare("PRAGMA table_info(rate_limited)").all() as Array<{ name: string }>;
      if (cols.length && !cols.some((c) => c.name === "provider_id")) {
        d.exec("DROP TABLE rate_limited");
        d.exec("CREATE TABLE rate_limited (repo TEXT NOT NULL, number INTEGER NOT NULL, provider_id TEXT NOT NULL DEFAULT '', resume_at TEXT, PRIMARY KEY (repo, number, provider_id))");
      }
    } catch { /* table absent or fresh — the CREATE above already made the new schema */ }
    // DB-first backfill: existing rows predate the created_at column. Their true creation time is
    // unknown, so use the earliest timestamp the DB itself holds (updated_at) — never GitHub.
    try { d.exec("UPDATE issues SET created_at = updated_at WHERE created_at IS NULL AND updated_at IS NOT NULL"); } catch { /* noop */ }
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
