import { getDb, now } from "./connection.js";

export interface MemoryHit { kind: "lesson" | "plan" | "review" | "issue"; repo: string; number: number; text: string; at: string }


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
