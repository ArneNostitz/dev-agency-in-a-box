/**
 * Skills (Claude Code Agent Skill schema) + deterministic pre/post hooks. Extracted from
 * store.ts (Candidate 3, #70). Self-contained: depends on the connection only.
 * The Process Analyzer authors skills/hooks; agents read skillsPrompt() into their context.
 */
import { getDb, now } from "./connection.js";

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
export function deleteHook(id: number): void { const d = getDb(); if (!d) return; try { d.prepare(`DELETE FROM hook WHERE id = ?`).run(id); } catch { /* best effort */ }
}
