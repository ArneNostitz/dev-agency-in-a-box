/**
 * Structured memory — a SQLite ledger of what the agency has done. Uses Node's built-in
 * node:sqlite (no native build, works in the container). It records issue lifecycle, every
 * agent run (role/model/turns) for audit + cost, and the plans produced. This is the
 * "what's the exact state / what did we do" layer; semantic (vector) recall comes next.
 *
 * All writes are best-effort: a memory failure must never break the pipeline.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encryptSecret, tryDecrypt } from "./crypto.js";
import { parseLegacyStatus, stateColumnFor, STATUS_NOT_PLANNED, type IssueStatus, type BlockedReason } from "./state.js";
import { getDb, now } from "./db/connection.js";

// Re-export the connection-layer symbols the rest of the app imports from store.ts (back-compat).
export { getDb, now, migrateIssueStates } from "./db/connection.js";
// Re-export the users aggregate (Candidate 3, #70).
export {
  countUsers, getUserByName, getUserByNameOrEmail, createPasswordReset, consumePasswordReset,
  getUserById, listUsers, createUser, setUserPassword, authenticate, createSession, getSessionUser,
  revokeSession, createInvite, getInvite, acceptInvite, listInvites,
  setUserSecret, getUserSecret, getUserSecretStatus, listUserSecretKeys,
} from "./db/users.js";
export type { User, UserRow } from "./db/users.js";
// Re-export the reviews aggregate (Candidate 3, #70).
export { recordReview, getReview, clearReview, listReviews } from "./db/reviews.js";
export type { ReviewVerdict } from "./db/reviews.js";
export { recordConflict, getConflict, clearConflict, listConflicts } from "./db/conflicts.js";
export { setRateLimited, clearRateLimited, listRateLimited, dueRateLimited } from "./db/ratelimit.js";


export function addWatchedRepo(repo: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT OR IGNORE INTO watched_repos (repo, added_at) VALUES (?, ?)`).run(repo, now());
  } catch (err) {
    console.warn("[agency] memory write (watched_repo) failed:", (err as Error).message);
  }
}

export function removeWatchedRepo(repo: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM watched_repos WHERE repo = ?`).run(repo);
  } catch {
    /* best effort */
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

/** Record the files an issue's work will touch (from the planner) — drives the file-lock scheduler. */
export function recordIssueFiles(repo: string, number: number, files: string[]): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`INSERT INTO issue_files (repo, number, files, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET files = excluded.files, updated_at = excluded.updated_at`)
      .run(repo, number, JSON.stringify(files || []), now());
  } catch { /* best effort */ }
}

/** The declared file footprint for an issue (empty = unknown → don't lock, fall back to merge check). */
export function filesFor(repo: string, number: number): string[] {
  const d = getDb();
  if (!d) return [];
  try {
    const r = d.prepare(`SELECT files FROM issue_files WHERE repo = ? AND number = ?`).get(repo, number) as { files?: string } | undefined;
    return r?.files ? (JSON.parse(r.files) as string[]) : [];
  } catch { return []; }
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
         -- Only bump updated_at on a REAL change. The scan re-records every issue each pass; bumping
         -- it on a no-op made the board (sorted by updated_at) reshuffle constantly.
         updated_at = CASE WHEN
              COALESCE(excluded.title, issues.title) IS NOT issues.title
           OR COALESCE(excluded.role,  issues.role)  IS NOT issues.role
           OR COALESCE(excluded.state, issues.state) IS NOT issues.state
           THEN excluded.updated_at ELSE issues.updated_at END`,
    ).run(repo, number, fields.title ?? null, fields.role ?? null, fields.state ?? null, now());
  } catch (err) {
    console.warn("[agency] memory write (issue) failed:", (err as Error).message);
  }
}

/**
 * Write a full IssueStatus (state + blocked) via the state module — the two-field model.
 * The canonical lifecycle enum goes to `state` (e.g. "working"); the BlockedReason goes
 * to its own `blocked` column. Best-effort, like every memory write.
 */
export function recordIssueStatus(repo: string, number: number, status: IssueStatus, extra: { title?: string; role?: string } = {}): void {
  const d = getDb();
  if (!d) return;
  try {
    const stateCol = stateColumnFor(status);
    const blockedCol = status.blocked;
    d.prepare(
      `INSERT INTO issues (repo, number, title, role, state, blocked, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET
         title   = COALESCE(excluded.title, issues.title),
         role    = COALESCE(excluded.role,  issues.role),
         state   = excluded.state,
         blocked = excluded.blocked,
         updated_at = CASE WHEN
              COALESCE(excluded.title, issues.title) IS NOT issues.title
           OR COALESCE(excluded.role,  issues.role)  IS NOT issues.role
           OR excluded.state IS NOT issues.state
           OR excluded.blocked IS NOT issues.blocked
           THEN excluded.updated_at ELSE issues.updated_at END`,
    ).run(repo, number, extra.title ?? null, extra.role ?? null, stateCol, blockedCol, now());
  } catch (err) {
    console.warn("[agency] memory write (issue status) failed:", (err as Error).message);
  }
}

/**
 * Read the two-field IssueStatus. `state` holds the canonical enum; `blocked` the reason.
 * parseLegacyStatus is a safety net for rare pre-flush rows; a flushed DB has clean enum
 * values and the parser is a pass-through. Pure DB read + the state module — no GitHub.
 */
export function getIssueStatus(repo: string, number: number): IssueStatus {
  const row = getIssueRow(repo, number);
  if (!row) return STATUS_NOT_PLANNED;
  // The state column holds the canonical enum directly (ADR-0001). parseLegacyStatus is
  // only a safety net for the rare pre-flush row; valid enum values pass through it as-is.
  return { state: parseLegacyStatus(row.state).state, blocked: (row.blocked as BlockedReason | null) ?? null };
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

/** Per-role token + cost totals since an ISO timestamp. */
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

/** Per-day token + cost totals since an ISO timestamp (UTC day buckets), oldest first. */
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

/** The most token-expensive issues since an ISO timestamp (only rows that have a repo/number). */
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

/** Lifetime tokens/cost per issue, keyed "repo#number", with the dominant model. Cheap single scan
 *  used to decorate board cards + the detail view so each issue shows what it has cost so far. */
export function tokensByIssueAll(): Record<string, { tokens: number; costUsd: number; model: string | null; runs: number }> {
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
/** All rate-limited (auto-resume) issues with their reset time, for the dashboard. */

/** Parked issues whose resume time has passed — ready to re-run, no tokens needed to find them. */

// ---- review verdict (so the dashboard knows a PR still has requested changes) ----
/** verdict per issue for the board, keyed "repo#number" — cheap DB read for the card badge. */

// ---- PR merge-conflict tracking (so the UI + conversation can surface which files conflict) ----

/** Remember the conflicting files for a PR at a given head SHA (so we don't recompute/renotify). */
/** Conflicting-file map for the board, keyed "repo#number" — cheap read so cards/detail can flag. */

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

let _modelsPresetCache: Record<string, string[]> | null = null;
export function getModelsPresets(): Record<string, string[]> {
  if (_modelsPresetCache) return _modelsPresetCache;
  try {
    const filePath = join(dirname(fileURLToPath(import.meta.url)), "../web/models.json");
    if (existsSync(filePath)) {
      _modelsPresetCache = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string[]>;
      return _modelsPresetCache;
    }
  } catch {
    /* ignore */
  }
  return {
    "Gemini": ["gemini-3.5-flash", "gemini-3.5-pro", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro", "gemini-1.5-flash"],
    "GLM (Zhipu)": ["glm-5.2", "glm-5.1", "glm-4.6", "glm-4.5"],
    "DeepSeek": ["deepseek-chat", "deepseek-reasoner"],
    "Kimi (Moonshot)": ["kimi-k2-0905-preview"]
  };
}

export function getProviders(): Provider[] {
  try {
    const list = JSON.parse(getSetting("providers") ?? "[]") as Provider[];
    const presets = getModelsPresets();
    for (const p of list) {
      const presetModels = presets[p.name];
      if (presetModels && presetModels.length) {
        const missing = presetModels.filter((m) => !p.models.includes(m));
        if (missing.length > 0) {
          p.models = [...missing, ...p.models];
        }
      }
    }
    return list;
  } catch {
    return [];
  }
}
export function setProviders(list: Provider[]): void {
  setSetting("providers", JSON.stringify(list ?? []));
}

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

export function getGlobalModel(): { providerId: string; model: string } | null {
  try {
    const v = getSetting("global_model");
    return v ? (JSON.parse(v) as { providerId: string; model: string }) : null;
  } catch {
    return null;
  }
}
export function setGlobalModel(model: { providerId: string; model: string } | null): void {
  if (model) {
    setSetting("global_model", JSON.stringify(model));
  } else {
    // delete it
    const d = getDb();
    if (d) {
      try {
        d.prepare(`DELETE FROM settings WHERE key = ?`).run("global_model");
      } catch {}
    }
  }
}


// ---- in-memory session-level fallback (not persisted; cleared after each auto-switch run) ----
// When Claude hits a usage limit and auto-switch is on, this is set for the duration of the
// retry, then cleared in the finally block — so user's permanent role assignments are untouched.
// NOTE: not concurrent-safe — if two issues auto-switch simultaneously the second
// clearSessionFallback() call in finally will reset the first issue's fallback mid-retry.
// Self-healing: the affected issue will re-park and retry on the next run.
let _sessionFallback: { providerId: string; model: string } | null = null;
export function setSessionFallback(f: { providerId: string; model: string }): void {
  _sessionFallback = f;
}
export function clearSessionFallback(): void {
  _sessionFallback = null;
}
/** Returns the active session-level fallback, or null if none is set. */
export function getSessionFallback(): { providerId: string; model: string } | null {
  return _sessionFallback;
}

/**
 * Ordered fallback chain: when the primary model (Claude) hits a usage limit, the agency
 * tries providers in this list in order. Each entry references a configured provider + model.
 */
export function getFallbackChain(): Array<{ providerId: string; model: string }> {
  try {
    return JSON.parse(getSetting("fallback_chain") ?? "[]") as Array<{ providerId: string; model: string }>;
  } catch {
    return [];
  }
}
export function setFallbackChain(chain: Array<{ providerId: string; model: string }>): void {
  setSetting("fallback_chain", JSON.stringify(chain ?? []));
}

/** true → when Claude hits a usage limit, automatically switch all unassigned roles to the fallback chain */
export function getAutoSwitchOnLimit(): boolean {
  return getSetting("auto_switch_on_limit") === "on";
}

/**
 * Per-issue model override: when the human picks a model in the chatbox, it's stored here
 * and used for the next run on this issue (cleared after the pipeline finishes).
 */
export function setIssueModelOverride(repo: string, number: number, providerId: string, model: string): void {
  setSetting(`issue_model.${repo}#${number}`, JSON.stringify({ providerId, model }));
}
export function getIssueModelOverride(repo: string, number: number): { providerId: string; model: string } | null {
  try {
    const v = getSetting(`issue_model.${repo}#${number}`);
    return v ? (JSON.parse(v) as { providerId: string; model: string }) : null;
  } catch {
    return null;
  }
}
export function clearIssueModelOverride(repo: string, number: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM settings WHERE key = ?`).run(`issue_model.${repo}#${number}`);
  } catch {
    /* best effort */
  }
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

// ---- global encrypted secrets (admin-managed, e.g. the GitHub webhook secret) ----
/** Store a global secret encrypted at rest (needs MASTER_KEY). Empty clears it. */
export function setSecretSetting(key: string, plaintext: string): void {
  if (!plaintext) {
    setSetting(`secret.${key}`, "");
    return;
  }
  try {
    setSetting(`secret.${key}`, encryptSecret(plaintext));
  } catch {
    /* no MASTER_KEY — can't store securely; ignore */
  }
}
/** Decrypt a global secret, or null if unset/undecryptable. */
export function getSecretSetting(key: string): string | null {
  const v = getSetting(`secret.${key}`);
  return v ? tryDecrypt(v) : null;
}

// ---- auto-mode (auto-resume / auto-merge), resolved issue → repo → global ----
export type AutoKind = "resume" | "merge";
export type AutoValue = "on" | "off" | ""; // "" = inherit (or, at global level, default off)
function autoKey(kind: AutoKind, repo?: string, number?: number): string {
  if (repo && number) return `auto.${kind}.${repo}#${number}`;
  if (repo) return `auto.${kind}.${repo}`;
  return `auto.${kind}`;
}
/** The raw on/off/inherit value set at one scope (for rendering the toggle's current state). */
export function getAutoRaw(kind: AutoKind, repo?: string, number?: number): AutoValue {
  const v = getSetting(autoKey(kind, repo, number));
  return v === "on" || v === "off" ? v : "";
}
/** Set (or clear, with "") the auto value at a scope. */
export function setAuto(kind: AutoKind, value: AutoValue, repo?: string, number?: number): void {
  setSetting(autoKey(kind, repo, number), value === "on" || value === "off" ? value : "");
}
/** Effective on/off for an issue: issue override → repo override → global default (off). */
export function autoEnabled(kind: AutoKind, repo: string, number: number): boolean {
  const i = getAutoRaw(kind, repo, number);
  if (i) return i === "on";
  const r = getAutoRaw(kind, repo);
  if (r) return r === "on";
  return getAutoRaw(kind) === "on";
}
/** Bounded auto-retries so auto-resume can't loop forever on a broken issue. */
export function autoAttempts(repo: string, number: number): number {
  return Number(getSetting(`auto.attempts.${repo}#${number}`)) || 0;
}
export function bumpAutoAttempts(repo: string, number: number): number {
  const n = autoAttempts(repo, number) + 1;
  setSetting(`auto.attempts.${repo}#${number}`, String(n));
  return n;
}
export function resetAutoAttempts(repo: string, number: number): void {
  setSetting(`auto.attempts.${repo}#${number}`, "0");
}

// ---- users / sessions / invites / per-user secrets (multi-user mode) ----

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

// ---- pluggable agent registry (v3) ----

export interface AgentDef {
  name: string;
  handle: string; // "@spec-creator"
  persona: string; // markdown
  model: string; // "" = default
  tools: string[];
  mode: "repo" | "chat";
  pushesGithub: boolean;
  skills: string[];
  builtin: boolean;
  updatedAt: string;
}

function rowToAgentDef(r: { name: string; handle: string | null; persona: string | null; model: string | null; tools: string | null; mode: string | null; pushes_github: number; skills: string | null; builtin: number; updated_at: string | null }): AgentDef {
  const parse = (s: string | null): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  return {
    name: r.name,
    handle: r.handle ?? `@${r.name}`,
    persona: r.persona ?? "",
    model: r.model ?? "",
    tools: parse(r.tools),
    mode: r.mode === "chat" ? "chat" : "repo",
    pushesGithub: !!r.pushes_github,
    skills: parse(r.skills),
    builtin: !!r.builtin,
    updatedAt: r.updated_at ?? "",
  };
}

export function upsertAgentDef(a: Partial<AgentDef> & { name: string }): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO agent_def (name, handle, persona, model, tools, mode, pushes_github, skills, builtin, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         handle=excluded.handle, persona=excluded.persona, model=excluded.model, tools=excluded.tools,
         mode=excluded.mode, pushes_github=excluded.pushes_github, skills=excluded.skills, updated_at=excluded.updated_at`,
    ).run(
      a.name, a.handle ?? `@${a.name}`, a.persona ?? "", a.model ?? "",
      JSON.stringify(a.tools ?? []), a.mode ?? "chat", a.pushesGithub === false ? 0 : 1,
      JSON.stringify(a.skills ?? []), a.builtin ? 1 : 0, now(),
    );
  } catch { /* best effort */ }
}

export function getAgentDef(name: string): AgentDef | null {
  const d = getDb();
  if (!d) return null;
  try {
    const r = d.prepare(`SELECT * FROM agent_def WHERE name = ?`).get(name) as Parameters<typeof rowToAgentDef>[0] | undefined;
    return r ? rowToAgentDef(r) : null;
  } catch { return null; }
}

export function listAgentDefs(): AgentDef[] {
  const d = getDb();
  if (!d) return [];
  try {
    return (d.prepare(`SELECT * FROM agent_def ORDER BY name`).all() as Array<Parameters<typeof rowToAgentDef>[0]>).map(rowToAgentDef);
  } catch { return []; }
}

export function deleteAgentDef(name: string): void {
  const d = getDb();
  if (!d) return;
  try { d.prepare(`DELETE FROM agent_def WHERE name = ? AND builtin = 0`).run(name); } catch { /* best effort */ }
}

/** Find a chat agent whose @handle is mentioned in `text` (first match). */
export function chatAgentForText(text: string): AgentDef | null {
  const t = (text || "").toLowerCase();
  for (const a of listAgentDefs()) {
    if (a.mode !== "chat") continue;
    const h = (a.handle || `@${a.name}`).toLowerCase();
    if (new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-z0-9_-])").test(t)) return a;
  }
  return null;
}

/** Seed the two starter chat agents once (idempotent). */
export function seedChatAgents(): void {
  if (getAgentDef("spec-creator") && getAgentDef("grill-me")) return;
  if (!getAgentDef("spec-creator")) {
    upsertAgentDef({
      name: "spec-creator", handle: "@spec", mode: "chat", pushesGithub: true,
      tools: ["Read", "Glob", "Grep"],
      persona: "You are **Spec Creator**. Through focused back-and-forth, help the human turn a rough idea into a crisp, buildable spec: goal, scope, constraints, acceptance criteria, and explicit non-goals. Ask one sharp question at a time when something is ambiguous. Keep the conversation tight. When the spec is solid, post a clean final spec + a 3-line summary.",
    });
  }
  if (!getAgentDef("grill-me")) {
    upsertAgentDef({
      name: "grill-me", handle: "@grill", mode: "chat", pushesGithub: true,
      tools: ["Read", "Glob", "Grep"],
      persona: "You are **Grill Me** — an adversarial reviewer of specs/plans. Stress-test the proposal: find unstated assumptions, edge cases, failure modes, scope creep, and missing acceptance criteria. Be direct and specific. End with a prioritized list of the holes that must be closed before building, plus a short verdict.",
    });
  }
}

// ---- skills (Claude Code Agent Skill schema) + hooks (v3) ----

export interface Skill { name: string; description: string; body: string; updatedAt: string }
export function upsertSkill(s: { name: string; description?: string; body?: string }): void {
  const d = getDb(); if (!d) return;
  try { d.prepare(`INSERT INTO skill (name, description, body, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description=excluded.description, body=excluded.body, updated_at=excluded.updated_at`).run(s.name, s.description ?? "", s.body ?? "", now()); } catch { /* best effort */ }
}
export function getSkill(name: string): Skill | null {
  const d = getDb(); if (!d) return null;
  try { const r = d.prepare(`SELECT * FROM skill WHERE name = ?`).get(name) as { name: string; description: string | null; body: string | null; updated_at: string | null } | undefined; return r ? { name: r.name, description: r.description ?? "", body: r.body ?? "", updatedAt: r.updated_at ?? "" } : null; } catch { return null; }
}
export function listSkills(): Skill[] {
  const d = getDb(); if (!d) return [];
  try { return (d.prepare(`SELECT * FROM skill ORDER BY name`).all() as Array<{ name: string; description: string | null; body: string | null; updated_at: string | null }>).map((r) => ({ name: r.name, description: r.description ?? "", body: r.body ?? "", updatedAt: r.updated_at ?? "" })); } catch { return []; }
}
export function deleteSkill(name: string): void { const d = getDb(); if (!d) return; try { d.prepare(`DELETE FROM skill WHERE name = ?`).run(name); } catch { /* best effort */ } }

/** Render attached skills as SKILL.md blocks for injection into an agent's context. */
export function skillsPrompt(names: string[]): string {
  if (!names?.length) return "";
  const blocks = names.map((n) => getSkill(n)).filter((s): s is Skill => !!s)
    .map((s) => `--- SKILL: ${s.name} ---\n${s.description ? s.description + "\n\n" : ""}${s.body}`);
  if (!blocks.length) return "";
  return `=== SKILLS (apply when relevant) ===\n${blocks.join("\n\n")}`;
}

export interface Hook { id: number; target: string; phase: "pre" | "post"; command: string; enabled: boolean; updatedAt: string }
export function upsertHook(h: { id?: number; target: string; phase: "pre" | "post"; command: string; enabled?: boolean }): void {
  const d = getDb(); if (!d) return;
  try {
    if (h.id) d.prepare(`UPDATE hook SET target=?, phase=?, command=?, enabled=?, updated_at=? WHERE id=?`).run(h.target, h.phase, h.command, h.enabled === false ? 0 : 1, now(), h.id);
    else d.prepare(`INSERT INTO hook (target, phase, command, enabled, updated_at) VALUES (?, ?, ?, ?, ?)`).run(h.target, h.phase, h.command, h.enabled === false ? 0 : 1, now());
  } catch { /* best effort */ }
}
export function listHooks(target?: string, phase?: "pre" | "post"): Hook[] {
  const d = getDb(); if (!d) return [];
  try {
    let sql = `SELECT * FROM hook WHERE enabled = 1`; const args: string[] = [];
    if (target) { sql += ` AND target = ?`; args.push(target); }
    if (phase) { sql += ` AND phase = ?`; args.push(phase); }
    sql += ` ORDER BY id`;
    return (d.prepare(sql).all(...args) as Array<{ id: number; target: string; phase: string; command: string; enabled: number; updated_at: string | null }>).map((r) => ({ id: r.id, target: r.target, phase: r.phase === "post" ? "post" : "pre", command: r.command, enabled: !!r.enabled, updatedAt: r.updated_at ?? "" }));
  } catch { return []; }
}
export function deleteHook(id: number): void { const d = getDb(); if (!d) return; try { d.prepare(`DELETE FROM hook WHERE id = ?`).run(id); } catch { /* best effort */ } }

// ---- run_step telemetry (v3): tool-call log for the Process Analyzer ----

/** Record one tool call from an agent run. Best-effort; never breaks a run. */
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

/** Log an OPERATIONAL incident (e.g. a GitHub rate limit) so the Process Analyzer can see it and
 *  propose a fix. Stored as a run_step with role "system" + ok=0 so it shows up in failure stats. */
export function recordIncident(kind: string, detail: string): void {
  recordRunStep("", 0, "system", kind, detail, false);
}

export interface FailureStat { role: string; tool: string; count: number; sample: string }
/** Recent FAILURES (ok=0) grouped by role+tool with a sample message — the operational problems the
 *  Analyzer should propose fixes for (rate limits, failing commands, repeated agent tool errors). */
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

/** Count of run_step rows since an ISO time — the "enough new data?" gate for the analyzer. */
export function runStepCountSince(sinceIso: string): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const r = d.prepare(`SELECT COUNT(*) AS n FROM run_step WHERE ts >= ?`).get(sinceIso) as { n?: number } | undefined;
    return r?.n ?? 0;
  } catch { return 0; }
}

export interface MemoryHit { kind: "lesson" | "plan" | "review" | "issue"; repo: string; number: number; text: string; at: string }

/**
 * Search the agency's OWN memory (past lessons, plans, code-review notes, prior issue titles) for
 * relevant prior work — the retrieval backend for the `recall` agent tool. Keyword-scored over
 * recent rows (no FTS dependency): an agent that's stuck can pull "how did we do X before" instead
 * of re-reading files or re-asking the human.
 */
export function searchMemory(query: string, opts: { repo?: string; limit?: number } = {}): MemoryHit[] {
  const d = getDb();
  if (!d) return [];
  const repo = opts.repo;
  const limit = opts.limit ?? 8;
  const terms = String(query || "").toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 2).slice(0, 8);
  if (!terms.length) return [];
  const rows: MemoryHit[] = [];
  try {
    const grab = (kind: MemoryHit["kind"], sql: string) => {
      for (const r of d.prepare(sql).all() as unknown as Array<{ repo: string; number: number; text: string | null; at: string | null }>) {
        if (r.text) rows.push({ kind, repo: r.repo, number: r.number, text: r.text, at: r.at ?? "" });
      }
    };
    grab("lesson", `SELECT repo, number, lesson AS text, created_at AS at FROM lessons ORDER BY id DESC LIMIT 300`);
    grab("plan", `SELECT repo, number, plan AS text, created_at AS at FROM plans ORDER BY id DESC LIMIT 200`);
    grab("review", `SELECT repo, number, summary AS text, updated_at AS at FROM pr_review WHERE summary IS NOT NULL ORDER BY updated_at DESC LIMIT 200`);
    grab("issue", `SELECT repo, number, title AS text, updated_at AS at FROM issues WHERE title IS NOT NULL ORDER BY updated_at DESC LIMIT 300`);
  } catch {
    return [];
  }
  const scored = rows
    .map((r) => {
      const t = r.text.toLowerCase();
      let s = 0;
      for (const term of terms) if (t.includes(term)) s++;
      if (repo && r.repo === repo) s += 0.5; // prefer this repo's memory
      return { r, s };
    })
    .filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || (new Date(b.r.at || 0).getTime() - new Date(a.r.at || 0).getTime()));
  return scored.slice(0, limit).map((x) => ({ ...x.r, text: x.r.text.slice(0, 800) }));
}

// ---- local-first tracking (Phase 4): DB as source of truth, GitHub as a synced adapter ----

export interface LocalIssue { repo: string; number: number; title: string; body: string; labels: string[]; state: string; origin: string; closed: boolean; updated_at: string }
export interface LocalComment { id: number; repo: string; number: number; author: string; body: string; source: string; gh_id: number | null; created_at: string }

/** Insert/update a local issue (the authoritative record once an issue is adopted into the DB). */
export function upsertLocalIssue(i: { repo: string; number: number; title?: string; body?: string; labels?: string[]; state?: string; origin?: string; closed?: boolean }): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO local_issue (repo, number, title, body, labels, state, origin, closed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET
         title = COALESCE(excluded.title, local_issue.title),
         body  = COALESCE(excluded.body,  local_issue.body),
         labels = COALESCE(excluded.labels, local_issue.labels),
         state = COALESCE(excluded.state, local_issue.state),
         origin = COALESCE(excluded.origin, local_issue.origin),
         closed = excluded.closed,
         updated_at = excluded.updated_at`,
    ).run(i.repo, i.number, i.title ?? null, i.body ?? null, i.labels ? JSON.stringify(i.labels) : null, i.state ?? null, i.origin ?? null, i.closed ? 1 : 0, now());
  } catch { /* best effort */ }
}

export function getLocalIssue(repo: string, number: number): LocalIssue | null {
  const d = getDb();
  if (!d) return null;
  try {
    const r = d.prepare(`SELECT * FROM local_issue WHERE repo = ? AND number = ?`).get(repo, number) as
      | { repo: string; number: number; title: string | null; body: string | null; labels: string | null; state: string | null; origin: string | null; closed: number; updated_at: string }
      | undefined;
    if (!r) return null;
    let labels: string[] = [];
    try { labels = r.labels ? JSON.parse(r.labels) : []; } catch { labels = []; }
    return { repo: r.repo, number: r.number, title: r.title ?? "", body: r.body ?? "", labels, state: r.state ?? "", origin: r.origin ?? "", closed: !!r.closed, updated_at: r.updated_at };
  } catch { return null; }
}

export function listLocalOpenIssues(repo: string): LocalIssue[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d.prepare(`SELECT * FROM local_issue WHERE repo = ? AND closed = 0 ORDER BY number`).all(repo) as Array<{ repo: string; number: number; title: string | null; body: string | null; labels: string | null; state: string | null; origin: string | null; closed: number; updated_at: string }>;
    return rows.map((r) => { let labels: string[] = []; try { labels = r.labels ? JSON.parse(r.labels) : []; } catch { labels = []; } return { repo: r.repo, number: r.number, title: r.title ?? "", body: r.body ?? "", labels, state: r.state ?? "", origin: r.origin ?? "", closed: !!r.closed, updated_at: r.updated_at }; });
  } catch { return []; }
}

/** Next number for a dashboard-originated issue (negative space avoids colliding with GitHub numbers
 *  until it's pushed out and assigned a real one). */
export function nextLocalIssueNumber(repo: string): number {
  const d = getDb();
  if (!d) return -1;
  try {
    const r = d.prepare(`SELECT MIN(number) AS m FROM local_issue WHERE repo = ?`).get(repo) as { m: number | null } | undefined;
    const min = r?.m ?? 0;
    return Math.min(min, 0) - 1;
  } catch { return -1; }
}

/** Append a comment. `source` = "github" | "dashboard" | "agency"; gh_id dedupes synced GitHub rows. */
export function addLocalComment(c: { repo: string; number: number; author: string; body: string; source: string; gh_id?: number }): void {
  const d = getDb();
  if (!d) return;
  try {
    if (c.gh_id) {
      const dup = d.prepare(`SELECT 1 FROM local_comment WHERE repo = ? AND number = ? AND gh_id = ?`).get(c.repo, c.number, c.gh_id);
      if (dup) return; // already synced this GitHub comment
    }
    d.prepare(`INSERT INTO local_comment (repo, number, author, body, source, gh_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(c.repo, c.number, c.author, c.body, c.source, c.gh_id ?? null, now());
  } catch { /* best effort */ }
}

export function getLocalComments(repo: string, number: number): LocalComment[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d.prepare(`SELECT id, repo, number, author, body, source, gh_id, created_at FROM local_comment WHERE repo = ? AND number = ? ORDER BY id`).all(repo, number) as unknown as LocalComment[];
  } catch { return []; }
}

// ---- DB-first conversation (the dashboard is the source of truth; GitHub is mirrored) ----

/**
 * Record a comment authored locally (by the agency or a dashboard reply) the instant it's created,
 * BEFORE it's mirrored to GitHub — so the dashboard shows it immediately. Returns the row id so the
 * caller can attach the GitHub id once the mirror succeeds. `source`: "agency" | "human".
 */
export function recordOutgoingComment(c: { repo: string; number: number; author: string; body: string; source: string }): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const r = d.prepare(`INSERT INTO local_comment (repo, number, author, body, source, gh_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`)
      .run(c.repo, c.number, c.author, c.body.trim(), c.source, now());
    return Number(r.lastInsertRowid) || 0;
  } catch { return 0; }
}

/** Attach a GitHub comment id (and its authoritative timestamp) to a locally-recorded comment. */
export function setCommentGhId(id: number, ghId: number, createdAt?: string): void {
  const d = getDb();
  if (!d || !id || !ghId) return;
  try {
    if (createdAt) d.prepare(`UPDATE local_comment SET gh_id = ?, created_at = ? WHERE id = ?`).run(ghId, createdAt, id);
    else d.prepare(`UPDATE local_comment SET gh_id = ? WHERE id = ?`).run(ghId, id);
  } catch { /* best effort */ }
}

/**
 * Fold a comment observed on GitHub into the DB. Deduped by GitHub id; if it's the echo of a comment
 * we just posted locally (same body, gh_id not yet linked), it adopts that row instead of inserting a
 * duplicate. `body` must already have the agency marker stripped. New external comments are stored
 * with source "github" so the UI can flag them as incoming.
 */
export function foldInGitHubComment(c: { repo: string; number: number; gh_id: number; author: string; body: string; created_at: string; isAgency: boolean }): void {
  const d = getDb();
  if (!d || !c.gh_id) return;
  const body = (c.body || "").trim();
  try {
    if (d.prepare(`SELECT 1 FROM local_comment WHERE repo = ? AND number = ? AND gh_id = ?`).get(c.repo, c.number, c.gh_id)) return;
    const echo = d.prepare(`SELECT id FROM local_comment WHERE repo = ? AND number = ? AND gh_id IS NULL AND body = ? ORDER BY id LIMIT 1`).get(c.repo, c.number, body) as { id?: number } | undefined;
    if (echo?.id) {
      d.prepare(`UPDATE local_comment SET gh_id = ?, created_at = ? WHERE id = ?`).run(c.gh_id, c.created_at || now(), echo.id);
      return;
    }
    d.prepare(`INSERT INTO local_comment (repo, number, author, body, source, gh_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(c.repo, c.number, c.author || "?", body, c.isAgency ? "agency" : "github", c.gh_id, c.created_at || now());
  } catch { /* best effort */ }
}

/** Update a comment body by its GitHub id (after an edit). */
export function updateCommentBody(ghId: number, body: string): void {
  const d = getDb();
  if (!d || !ghId) return;
  try { d.prepare(`UPDATE local_comment SET body = ? WHERE gh_id = ?`).run(body.trim(), ghId); } catch { /* best effort */ }
}

export interface ConversationComment { id: number; localId: number; author: string; body: string; createdAt: string; isAgency: boolean; incoming: boolean }

/** The conversation for an issue, sorted by time (then insertion order) — the dashboard's truth. */
export function getConversation(repo: string, number: number): ConversationComment[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d.prepare(`SELECT id, author, body, source, gh_id, created_at FROM local_comment WHERE repo = ? AND number = ? ORDER BY created_at, id`).all(repo, number) as Array<{ id: number; author: string; body: string; source: string; gh_id: number | null; created_at: string }>;
    return rows.map((r) => ({
      id: r.gh_id ?? 0,
      localId: r.id,
      author: r.author || "?",
      body: r.body || "",
      createdAt: r.created_at || "",
      isAgency: r.source === "agency",
      incoming: r.source === "github",
    }));
  } catch { return []; }
}

/** How many cached comments we already have for an issue (decides sync vs. background reconcile). */
export function conversationCount(repo: string, number: number): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const r = d.prepare(`SELECT COUNT(*) AS n FROM local_comment WHERE repo = ? AND number = ?`).get(repo, number) as { n: number } | undefined;
    return r?.n ?? 0;
  } catch { return 0; }
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
  blocked: string | null;
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
export function getIssueRow(repo: string, number: number): IssueRow | null {
  const d = getDb();
  if (!d) return null;
  try {
    return (d
      .prepare(`SELECT repo, number, title, role, state, blocked, updated_at, pr_number, pr_url FROM issues WHERE repo = ? AND number = ?`)
      .get(repo, number) as unknown as IssueRow | null) ?? null;
  } catch {
    return null;
  }
}

export function recentIssues(limit = 40): IssueRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(
        `SELECT i.repo, i.number, i.title, i.role, i.state, i.blocked, i.updated_at, i.pr_number, i.pr_url FROM issues i
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

// ---- agent sessions (for SDK resume) + per-issue activity (for the resume digest) ----

export function setSession(repo: string, number: number, role: string, sessionId: string): void {
  const d = getDb();
  if (!d || !sessionId) return;
  try {
    d.prepare(
      `INSERT INTO agent_sessions (repo, number, role, session_id, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(repo, number, role) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`,
    ).run(repo, number, role, sessionId, now());
  } catch {
    /* best effort */
  }
}
export function getSession(repo: string, number: number, role: string): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare(`SELECT session_id FROM agent_sessions WHERE repo = ? AND number = ? AND role = ?`).get(repo, number, role) as
      | { session_id?: string }
      | undefined;
    return row?.session_id ?? null;
  } catch {
    return null;
  }
}

/** Recent activity for one issue (oldest-first), for building a resume digest. */
export function issueActivity(repo: string, number: number, limit = 40): ActivityRow[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d
      .prepare(`SELECT repo, number, role, kind, text, created_at FROM activity WHERE repo = ? AND number = ? ORDER BY id DESC LIMIT ?`)
      .all(repo, number, limit) as unknown as ActivityRow[];
    return rows.reverse();
  } catch {
    return [];
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
