import { getDb, now } from "./connection.js";

export interface LocalIssue { repo: string; number: number; title: string; body: string; state: string; origin: string; closed: boolean; updated_at: string }
export interface LocalComment { id: number; repo: string; number: number; author: string; body: string; source: string; gh_id: number | null; created_at: string }

export function upsertLocalIssue(i: { repo: string; number: number; title?: string; body?: string; state?: string; origin?: string; closed?: boolean }): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO local_issue (repo, number, title, body, state, origin, closed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET
         title = COALESCE(excluded.title, local_issue.title),
         body  = COALESCE(excluded.body,  local_issue.body),
         state = COALESCE(excluded.state, local_issue.state),
         origin = COALESCE(excluded.origin, local_issue.origin),
         closed = excluded.closed,
         updated_at = excluded.updated_at`,
    ).run(i.repo, i.number, i.title ?? null, i.body ?? null, i.state ?? null, i.origin ?? null, i.closed ? 1 : 0, now());
  } catch { /* best effort */ }
}

export function getLocalIssue(repo: string, number: number): LocalIssue | null {
  const d = getDb();
  if (!d) return null;
  try {
    const r = d.prepare(`SELECT * FROM local_issue WHERE repo = ? AND number = ?`).get(repo, number) as
      | { repo: string; number: number; title: string | null; body: string | null; state: string | null; origin: string | null; closed: number; updated_at: string }
      | undefined;
    if (!r) return null;
    return { repo: r.repo, number: r.number, title: r.title ?? "", body: r.body ?? "", state: r.state ?? "", origin: r.origin ?? "", closed: !!r.closed, updated_at: r.updated_at };
  } catch { return null; }
}

export function listLocalOpenIssues(repo: string): LocalIssue[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d.prepare(`SELECT * FROM local_issue WHERE repo = ? AND closed = 0 ORDER BY number`).all(repo) as Array<{ repo: string; number: number; title: string | null; body: string | null; state: string | null; origin: string | null; closed: number; updated_at: string }>;
    return rows.map((r) => ({ repo: r.repo, number: r.number, title: r.title ?? "", body: r.body ?? "", state: r.state ?? "", origin: r.origin ?? "", closed: !!r.closed, updated_at: r.updated_at }));
  } catch { return []; }
}

export function nextLocalIssueNumber(repo: string): number {
  const d = getDb();
  if (!d) return -1;
  try {
    const r = d.prepare(`SELECT MIN(number) AS m FROM local_issue WHERE repo = ?`).get(repo) as { m: number | null } | undefined;
    const min = r?.m ?? 0;
    return Math.min(min, 0) - 1;
  } catch { return -1; }
}

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

export function recordOutgoingComment(c: { repo: string; number: number; author: string; body: string; source: string }): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const r = d.prepare(`INSERT INTO local_comment (repo, number, author, body, source, gh_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)`)
      .run(c.repo, c.number, c.author, c.body.trim(), c.source, now());
    return Number(r.lastInsertRowid) || 0;
  } catch { return 0; }
}

export function setCommentGhId(id: number, ghId: number, createdAt?: string): void {
  const d = getDb();
  if (!d || !id || !ghId) return;
  try {
    if (createdAt) d.prepare(`UPDATE local_comment SET gh_id = ?, created_at = ? WHERE id = ?`).run(ghId, createdAt, id);
    else d.prepare(`UPDATE local_comment SET gh_id = ? WHERE id = ?`).run(ghId, id);
  } catch { /* best effort */ }
}

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

export function updateCommentBody(ghId: number, body: string): void {
  const d = getDb();
  if (!d || !ghId) return;
  try { d.prepare(`UPDATE local_comment SET body = ? WHERE gh_id = ?`).run(body.trim(), ghId); } catch { /* best effort */ }
}

export interface ConversationComment { id: number; localId: number; author: string; body: string; createdAt: string; isAgency: boolean; incoming: boolean }


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

export function conversationCount(repo: string, number: number): number {
  const d = getDb();
  if (!d) return 0;
  try {
    const r = d.prepare(`SELECT COUNT(*) AS n FROM local_comment WHERE repo = ? AND number = ?`).get(repo, number) as { n: number } | undefined;
    return r?.n ?? 0;
  } catch { return 0; }
}
