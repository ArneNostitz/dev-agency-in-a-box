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
  /** A structural-change barrier: holds the WHOLE repo exclusively (renames/moves/deletes). */
  barrier?: boolean;
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
  // A structural barrier (another issue's refactor) blocks ALL other editing — even unknown
  // footprints — until it merges. Everyone else then rebases onto the refactored main.
  for (const c of claims.values()) {
    if (c.repo === repo && c.number !== number && c.barrier) return { ok: false, blockedBy: c.number, file: "(structural change in progress)" };
  }
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

/**
 * Claim a repo-wide EXCLUSIVE barrier for a structural change (refactor/rename/move/delete). Succeeds
 * only when NO other run is active for the repo — i.e. it DRAINS in-flight work first. While held, no
 * other editing run can start (`claimFiles` fails). Released like any claim. This makes a refactor a
 * checkpoint everyone rebases through, instead of fighting it file-by-file.
 */
export function claimBarrier(repo: string, number: number): ClaimResult {
  purge();
  for (const c of claims.values()) {
    if (c.repo === repo && c.number !== number) return { ok: false, blockedBy: c.number, file: c.barrier ? "(another structural change)" : (c.files[0] || "(active run)") };
  }
  claims.set(key(repo, number), { repo, number, files: [], at: Date.now(), barrier: true });
  return { ok: true };
}

/**
 * Merge files an in-flight run ACTUALLY touched into its own claim (live footprint). If a newly
 * touched file is already held by ANOTHER active run, returns that overlap so the caller can warn —
 * this is the undeclared-edit collision the declared-footprint gate can't catch up front.
 */
export function addClaimFiles(repo: string, number: number, files: string[]): { overlap?: { number: number; file: string } } {
  purge();
  const add = (files || []).map(norm).filter(Boolean);
  if (!add.length) return {};
  let overlap: { number: number; file: string } | undefined;
  for (const c of claims.values()) {
    if (c.repo !== repo || c.number === number) continue;
    const ov = fileOverlap(add, c.files);
    if (ov.length) { overlap = { number: c.number, file: ov[0] }; break; }
  }
  const existing = claims.get(key(repo, number));
  if (existing) existing.files = [...new Set([...existing.files, ...add])];
  else claims.set(key(repo, number), { repo, number, files: add, at: Date.now() });
  return overlap ? { overlap } : {};
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
