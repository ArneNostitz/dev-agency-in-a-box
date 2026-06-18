import { getDb, now } from "./connection.js";

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
