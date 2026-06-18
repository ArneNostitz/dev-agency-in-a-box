import { getDb, now } from "./connection.js";

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
