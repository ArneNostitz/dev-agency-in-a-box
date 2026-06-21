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

/**
 * Seed a widely-useful baseline library of skills + hooks the first time (idempotent — only seeds
 * when the tables are empty, so the user's own edits/imports are never clobbered). Users extend it,
 * but get a good starting set out of the box.
 */
export function seedLibrary(): void {
  const d = getDb(); if (!d) return;
  try {
    if (listSkills().length === 0) {
      const skills: Array<{ name: string; description: string; body: string }> = [
        { name: "conventional-commits", description: "Write commits in Conventional Commits style.", body: "Write every commit as `type(scope): summary` (feat, fix, docs, refactor, test, chore). Imperative mood, ≤72-char subject, body explains the why. One logical change per commit." },
        { name: "clear-pr", description: "Open PRs with a clear, reviewable description.", body: "Open the PR with: a one-line summary, **What** changed, **Why**, and **How to test**. Keep the diff focused; call out anything risky or out of scope." },
        { name: "test-coverage", description: "Add or extend tests for every change.", body: "For each behavioural change, add or extend a test that fails before and passes after. Prefer the project's existing test framework and conventions. Don't lower coverage." },
        { name: "security-review", description: "Check changes for common security issues.", body: "Before finishing, scan the diff for: injection (SQL/shell/HTML), missing authz checks, secrets committed to the repo, unsafe deserialization, and unvalidated input. Flag anything suspicious." },
        { name: "accessibility", description: "Keep UI changes accessible.", body: "For UI changes: ensure semantic HTML, labels/alt text, keyboard focus, sufficient colour contrast, and ARIA only where needed. Never rely on colour alone to convey state." },
        { name: "update-docs", description: "Keep docs in sync with behaviour.", body: "When public behaviour, flags, env vars, or commands change, update the README/docs in the same PR. Add a short note to the changelog if the repo keeps one." },
        { name: "small-diffs", description: "Prefer the smallest correct change.", body: "Make the smallest change that correctly solves the issue. Reuse existing code and patterns, avoid drive-by refactors, and don't introduce new dependencies without need." },
      ];
      for (const s of skills) upsertSkill(s);
    }
    if (listHooks().length === 0) {
      const hooks: Array<{ target: string; phase: "pre" | "post"; command: string }> = [
        { target: "install deps", phase: "pre", command: "npm ci 2>/dev/null || npm install 2>/dev/null || pip install -r requirements.txt --break-system-packages 2>/dev/null || true" },
        { target: "format (prettier)", phase: "post", command: "npx --no-install prettier --write . 2>/dev/null || true" },
        { target: "lint --fix (eslint)", phase: "post", command: "npx --no-install eslint . --fix 2>/dev/null || true" },
        { target: "typecheck (tsc)", phase: "post", command: "npx --no-install tsc --noEmit 2>/dev/null || true" },
        { target: "run tests", phase: "post", command: "npm test 2>/dev/null || pytest -q 2>/dev/null || true" },
        { target: "format (black)", phase: "post", command: "python3 -m black . 2>/dev/null || true" },
        { target: "secret scan", phase: "post", command: "git diff --cached | grep -nEi '(api[_-]?key|secret|password|token)[\"'\"'\"']?\\s*[:=]' && echo '⚠ possible secret in diff' || true" },
      ];
      for (const h of hooks) upsertHook(h);
    }
    // Agency-native hooks — wired to our own tooling (GitNexus index, analyzer, lessons).
    // Idempotent by name, so existing installs pick them up on the next boot.
    {
      const have = new Set(listHooks().map((h) => h.target));
      const agency: Array<{ target: string; phase: "pre" | "post"; command: string }> = [
        { target: "gitnexus: re-analyze", phase: "post", command: "gitnexus analyze . 2>/dev/null || npx --no-install gitnexus analyze . 2>/dev/null || true" },
        { target: "trigger analyzer run", phase: "post", command: "[ -n \"$AGENCY_URL\" ] && curl -fsS -X POST \"$AGENCY_URL/analyzer-run\" >/dev/null 2>&1 || true" },
        { target: "summarize changes", phase: "post", command: "git --no-pager log --oneline -5 2>/dev/null; echo '---'; git --no-pager diff --stat 2>/dev/null || true" },
        { target: "record learnings", phase: "post", command: "mkdir -p .devagency && { echo \"## $(date -u +%FT%TZ)\"; git --no-pager log -1 --pretty='%s' 2>/dev/null; } >> .devagency/LEARNINGS.md 2>/dev/null || true" },
      ];
      for (const h of agency) if (!have.has(h.target)) upsertHook(h);
    }
  } catch { /* best effort */ }
}
