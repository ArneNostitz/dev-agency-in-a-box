/**
 * Per-repo Orchestrator chat thread (v4). DB-first: the conversation a user has with the repo
 * Orchestrator lives here, not on GitHub. Each row is one message; `role` is "user" |
 * "orchestrator"; `meta` is optional JSON (e.g. a parsed handoff proposal attached to a reply).
 */
import { getDb, now } from "./connection.js";

export interface OrchMsg {
  id: number;
  repo: string;
  role: "user" | "orchestrator";
  text: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

function rowToMsg(r: { id: number; repo: string; role: string; text: string; meta: string | null; created_at: string }): OrchMsg {
  let meta: Record<string, unknown> | null = null;
  try { meta = r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null; } catch { meta = null; }
  return { id: r.id, repo: r.repo, role: r.role === "user" ? "user" : "orchestrator", text: r.text, meta, createdAt: r.created_at };
}

/** Append one message to a repo's orchestrator thread; returns the new row id (0 on failure). */
export function appendOrchMsg(repo: string, role: "user" | "orchestrator", text: string, meta?: Record<string, unknown> | null): number {
  const d = getDb(); if (!d) return 0;
  try {
    const info = d.prepare(`INSERT INTO orch_msg (repo, role, text, meta, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(repo, role, text, meta ? JSON.stringify(meta) : null, now());
    return Number(info.lastInsertRowid) || 0;
  } catch { return 0; }
}

/** The thread for a repo, oldest-first. `limit` caps to the most recent N (still returned oldest-first). */
export function listOrchThread(repo: string, limit = 200): OrchMsg[] {
  const d = getDb(); if (!d) return [];
  try {
    const rows = d.prepare(`SELECT * FROM orch_msg WHERE repo = ? ORDER BY id DESC LIMIT ?`).all(repo, limit) as Array<{ id: number; repo: string; role: string; text: string; meta: string | null; created_at: string }>;
    return rows.map(rowToMsg).reverse();
  } catch { return []; }
}

/** Wipe a repo's orchestrator thread (the "new conversation" button). */
export function clearOrchThread(repo: string): void {
  const d = getDb(); if (!d) return;
  try { d.prepare(`DELETE FROM orch_msg WHERE repo = ?`).run(repo); } catch { /* best effort */ }
}
