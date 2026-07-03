/**
 * Per-provider rate-limit state. A rate limit is scoped to ONE provider (its piKey / id) — a Claude
 * 429 never blocks a GLM run. Rows are transient: set when a provider hits a wall, cleared when its
 * window resets (the auto-resume tick) or when the issue is re-run successfully.
 *
 * PK is (repo, number, provider_id) so the same issue can track limits on multiple providers.
 */
import { getDb } from "./connection.js";

/** Mark a provider rate-limited for an issue until resumeAtIso. */
export function setRateLimited(repo: string, number: number, providerId: string, resumeAtIso: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO rate_limited (repo, number, provider_id, resume_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(repo, number, provider_id) DO UPDATE SET resume_at = excluded.resume_at`,
    ).run(repo, number, providerId || "", resumeAtIso);
  } catch {
    /* best effort */
  }
}

/** Clear a provider's rate-limit for an issue. Omit providerId to clear ALL providers for that issue. */
export function clearRateLimited(repo: string, number: number, providerId?: string): void {
  const d = getDb();
  if (!d) return;
  try {
    if (providerId === undefined) d.prepare(`DELETE FROM rate_limited WHERE repo = ? AND number = ?`).run(repo, number);
    else d.prepare(`DELETE FROM rate_limited WHERE repo = ? AND number = ? AND provider_id = ?`).run(repo, number, providerId);
  } catch {
    /* best effort */
  }
}

/** Clear every rate-limit row for a provider (e.g. when the provider is removed). */
export function clearProviderRateLimited(providerId: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM rate_limited WHERE provider_id = ?`).run(providerId || "");
  } catch {
    /* best effort */
  }
}

/** Is this provider currently rate-limited (any issue, resume_at in the future)? */
export function isProviderRateLimited(providerId: string, nowMs = Date.now()): boolean {
  const d = getDb();
  if (!d) return false;
  try {
    const row = d
      .prepare(`SELECT resume_at AS resumeAt FROM rate_limited WHERE provider_id = ? ORDER BY resume_at DESC LIMIT 1`)
      .get(providerId || "") as { resumeAt?: string } | undefined;
    if (!row || !row.resumeAt) return false;
    return Date.parse(row.resumeAt) > nowMs;
  } catch {
    return false;
  }
}

/** All rate-limited rows (for the dashboard's rateLimited indicator). */
export function listRateLimited(): Array<{ repo: string; number: number; providerId: string; resumeAt: string }> {
  const d = getDb();
  if (!d) return [];
  try {
    return d.prepare(`SELECT repo, number, provider_id AS providerId, resume_at AS resumeAt FROM rate_limited`).all() as unknown as Array<{
      repo: string;
      number: number;
      providerId: string;
      resumeAt: string;
    }>;
  } catch {
    return [];
  }
}

/** Rate-limited rows whose resume time has passed (the auto-resume tick re-runs these). */
export function dueRateLimited(nowIso: string): Array<{ repo: string; number: number; providerId: string }> {
  const d = getDb();
  if (!d) return [];
  try {
    return d
      .prepare(`SELECT repo, number, provider_id AS providerId FROM rate_limited WHERE resume_at <= ? ORDER BY resume_at`)
      .all(nowIso) as unknown as Array<{ repo: string; number: number; providerId: string }>;
  } catch {
    return [];
  }
}
