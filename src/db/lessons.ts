import { getDb, now } from "./connection.js";

export interface LessonRow {
  id: number;
  repo: string;
  number: number;
  lesson: string;
  created_at: string;
}

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
