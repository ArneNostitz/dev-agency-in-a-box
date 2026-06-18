import { getDb, now } from "./connection.js";

export interface AgentDef {
  name: string;
  handle: string; // "@spec-creator"
  persona: string; // markdown
  model: string; // "" = default
  tools: string[];
  mode: "repo" | "chat";
  pushesGithub: boolean;
  skills: string[];
  builtin: boolean;
  updatedAt: string;
}

function rowToAgentDef(r: { name: string; handle: string | null; persona: string | null; model: string | null; tools: string | null; mode: string | null; pushes_github: number; skills: string | null; builtin: number; updated_at: string | null }): AgentDef {
  const parse = (s: string | null): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  return {
    name: r.name,
    handle: r.handle ?? `@${r.name}`,
    persona: r.persona ?? "",
    model: r.model ?? "",
    tools: parse(r.tools),
    mode: r.mode === "chat" ? "chat" : "repo",
    pushesGithub: !!r.pushes_github,
    skills: parse(r.skills),
    builtin: !!r.builtin,
    updatedAt: r.updated_at ?? "",
  };
}

export function upsertAgentDef(a: Partial<AgentDef> & { name: string }): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(
      `INSERT INTO agent_def (name, handle, persona, model, tools, mode, pushes_github, skills, builtin, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         handle=excluded.handle, persona=excluded.persona, model=excluded.model, tools=excluded.tools,
         mode=excluded.mode, pushes_github=excluded.pushes_github, skills=excluded.skills, updated_at=excluded.updated_at`,
    ).run(
      a.name, a.handle ?? `@${a.name}`, a.persona ?? "", a.model ?? "",
      JSON.stringify(a.tools ?? []), a.mode ?? "chat", a.pushesGithub === false ? 0 : 1,
      JSON.stringify(a.skills ?? []), a.builtin ? 1 : 0, now(),
    );
  } catch { /* best effort */ }
}

export function getAgentDef(name: string): AgentDef | null {
  const d = getDb();
  if (!d) return null;
  try {
    const r = d.prepare(`SELECT * FROM agent_def WHERE name = ?`).get(name) as Parameters<typeof rowToAgentDef>[0] | undefined;
    return r ? rowToAgentDef(r) : null;
  } catch { return null; }
}

export function listAgentDefs(): AgentDef[] {
  const d = getDb();
  if (!d) return [];
  try {
    return (d.prepare(`SELECT * FROM agent_def ORDER BY name`).all() as Array<Parameters<typeof rowToAgentDef>[0]>).map(rowToAgentDef);
  } catch { return []; }
}

export function deleteAgentDef(name: string): void {
  const d = getDb();
  if (!d) return;
  try { d.prepare(`DELETE FROM agent_def WHERE name = ? AND builtin = 0`).run(name); } catch { /* best effort */ }
}

export function chatAgentForText(text: string): AgentDef | null {
  const t = (text || "").toLowerCase();
  for (const a of listAgentDefs()) {
    if (a.mode !== "chat") continue;
    const h = (a.handle || `@${a.name}`).toLowerCase();
    if (new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-z0-9_-])").test(t)) return a;
  }
  return null;
}

export function seedChatAgents(): void {
  if (getAgentDef("spec-creator") && getAgentDef("grill-me")) return;
  if (!getAgentDef("spec-creator")) {
    upsertAgentDef({
      name: "spec-creator", handle: "@spec", mode: "chat", pushesGithub: true,
      tools: ["Read", "Glob", "Grep"],
      persona: "You are **Spec Creator**. Through focused back-and-forth, help the human turn a rough idea into a crisp, buildable spec: goal, scope, constraints, acceptance criteria, and explicit non-goals. Ask one sharp question at a time when something is ambiguous. Keep the conversation tight. When the spec is solid, post a clean final spec + a 3-line summary.",
    });
  }
  if (!getAgentDef("grill-me")) {
    upsertAgentDef({
      name: "grill-me", handle: "@grill", mode: "chat", pushesGithub: true,
      tools: ["Read", "Glob", "Grep"],
      persona: "You are **Grill Me** — an adversarial reviewer of specs/plans. Stress-test the proposal: find unstated assumptions, edge cases, failure modes, scope creep, and missing acceptance criteria. Be direct and specific. End with a prioritized list of the holes that must be closed before building, plus a short verdict.",
    });
  }
}
