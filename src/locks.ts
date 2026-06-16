/**
 * File-level lock registry — the agency's overwrite protection. Any two concurrent agent runs that
 * would touch the SAME file are not allowed to run at once: the first claims the files, the second
 * is deferred until they're released. Runs that touch disjoint files run in parallel. This applies
 * to EVERY pair of issues (issue↔issue and epic sub-issue↔sub-issue), repo-wide.
 *
 * In-memory by design: a claim only matters while a run is actually executing, and a process restart
 * clears any in-flight runs anyway. A TTL guards against a crashed run holding a lock forever.
 */
export interface FileClaim {
  repo: string;
  number: number;
  files: string[];
  at: number;
}

const claims = new Map<string, FileClaim>(); // key: `${repo}#${number}`
const TTL_MS = 45 * 60_000; // a stale claim (crashed/hung run) auto-expires after 45 min

const key = (repo: string, number: number): string => `${repo}#${number}`;
const norm = (f: string): string => f.trim().replace(/^\.?\/+/, "").replace(/\\/g, "/");

function purge(): void {
  const now = Date.now();
  for (const [k, c] of claims) if (now - c.at > TTL_MS) claims.delete(k);
}

/** Files in common between two claim lists (normalized). */
export function fileOverlap(a: string[], b: string[]): string[] {
  const bs = new Set(b.map(norm));
  return [...new Set(a.map(norm))].filter((f) => bs.has(f));
}

export interface ClaimResult {
  ok: boolean;
  blockedBy?: number; // the issue number already holding an overlapping file
  file?: string; // the first conflicting file
}

/**
 * Try to claim `files` for repo#number. Succeeds (and records the claim) when no OTHER active run
 * holds any of those files. An empty file list never blocks and claims nothing (unknown footprint →
 * fall back to the controlled merge instead of blocking everything).
 */
export function claimFiles(repo: string, number: number, files: string[]): ClaimResult {
  purge();
  const want = (files || []).map(norm).filter(Boolean);
  if (!want.length) return { ok: true };
  for (const c of claims.values()) {
    if (c.repo !== repo || c.number === number) continue;
    const ov = fileOverlap(want, c.files);
    if (ov.length) return { ok: false, blockedBy: c.number, file: ov[0] };
  }
  claims.set(key(repo, number), { repo, number, files: want, at: Date.now() });
  return { ok: true };
}

/** Release a run's file claim (call in a finally when the run ends). */
export function releaseFiles(repo: string, number: number): void {
  claims.delete(key(repo, number));
}

/** Active claims for a repo (for diagnostics / the dashboard). */
export function activeClaims(repo?: string): FileClaim[] {
  purge();
  return [...claims.values()].filter((c) => !repo || c.repo === repo);
}

/** Test helper: wipe all claims. */
export function _resetLocks(): void {
  claims.clear();
}
