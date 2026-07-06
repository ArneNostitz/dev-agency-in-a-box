import { getDb, now } from "./connection.js";

export interface AgentDef {
  name: string;
  handle: string; // "@spec-creator"
  persona: string; // markdown
  model: string; // "" = default
  tools: string[];
  mode: "repo" | "chat";
  interactive: boolean;
  /** true = full repo write (Read/Glob/Grep/Write/Edit/Bash). false = docs only: reads anywhere,
   *  writes only into the issue's _plan/ folder. Replaces the old repo/chat `mode` gate. */
  canWriteCode: boolean;
  pushesGithub: boolean;
  skills: string[];
  defaultTask: string; // pre-fills a workflow step's instruction for this agent
  avatar: string; // custom avatar URL (/attach/<id>) — '' uses the role's built-in art
  builtin: boolean;
  updatedAt: string;
}

function rowToAgentDef(r: { name: string; handle: string | null; persona: string | null; model: string | null; tools: string | null; mode: string | null; interactive: number; can_write_code: number | null; pushes_github: number; skills: string | null; default_task: string | null; avatar: string | null; builtin: number; updated_at: string | null }): AgentDef {
  const parse = (s: string | null): string[] => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
  return {
    name: r.name,
    handle: r.handle ?? `@${r.name}`,
    persona: r.persona ?? "",
    model: r.model ?? "",
    tools: parse(r.tools),
    mode: r.mode === "chat" ? "chat" : "repo",
    interactive: !!r.interactive,
    // Back-compat: pre-canWriteCode agents infer it from the old signals (mode=repo, or write/exec tools).
    canWriteCode: r.can_write_code == null
      ? (r.mode !== "chat" || /\b(Write|Edit|Bash)\b/.test(r.tools ?? ""))
      : !!r.can_write_code,
    pushesGithub: !!r.pushes_github,
    skills: parse(r.skills),
    defaultTask: r.default_task ?? "",
    avatar: r.avatar ?? "",
    builtin: !!r.builtin,
    updatedAt: r.updated_at ?? "",
  };
}

/** The tool set an agent actually gets, derived from canWriteCode (the single user-facing control).
 *  code → full repo write; docs → read anywhere + Write (the runner scopes Write to _plan/). */
export function toolsFor(def: { canWriteCode?: boolean }): string[] {
  return def.canWriteCode
    ? ["Read", "Glob", "Grep", "Write", "Edit", "Bash"]
    : ["Read", "Glob", "Grep", "Write"];
}

/** Per-issue scratch/plan folder a docs-only agent may write into (kept in the repo, committed to the
 *  agency branch). Files land as _plan/issue-<n>_<YYYY-MM-DD>_<kind>.md. */
export const PLAN_DIR = "_plan";
export function planFilePath(issueNumber: number, kind = "notes", d = new Date()): string {
  const date = d.toISOString().slice(0, 10);
  const safe = (kind || "notes").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "notes";
  return `${PLAN_DIR}/issue-${issueNumber}_${date}_${safe}.md`;
}

export function upsertAgentDef(a: Partial<AgentDef> & { name: string }): void {
  const d = getDb();
  if (!d) return;
  // canWriteCode is the source of truth for the tool set; keep the legacy `tools` column in sync.
  const tools = a.tools ?? (a.canWriteCode != null ? toolsFor({ canWriteCode: a.canWriteCode }) : []);
  try {
    d.prepare(
      `INSERT INTO agent_def (name, handle, persona, model, tools, mode, interactive, can_write_code, pushes_github, skills, default_task, avatar, builtin, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         handle=excluded.handle, persona=excluded.persona, model=excluded.model, tools=excluded.tools,
         mode=excluded.mode, interactive=excluded.interactive, can_write_code=excluded.can_write_code, pushes_github=excluded.pushes_github, skills=excluded.skills, default_task=excluded.default_task, avatar=excluded.avatar, updated_at=excluded.updated_at`,
    ).run(
      a.name, a.handle ?? `@${a.name}`, a.persona ?? "", a.model ?? "",
      JSON.stringify(tools), a.mode ?? "chat", a.interactive ? 1 : 0, a.canWriteCode ? 1 : 0, a.pushesGithub === false ? 0 : 1,
      JSON.stringify(a.skills ?? []), a.defaultTask ?? "", a.avatar ?? "", a.builtin ? 1 : 0, now(),
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


// The 6 base roles a workflow step or single-role pin can reference (STEP_ROLE in pipeline.ts /
// HANDLE_ROLE in workflow.ts) — every one of these handles must resolve to something visible on
// the Agents page, or a step referencing it silently misroutes (or, before the pipeline.ts guard,
// crashed deep in model resolution instead of failing with a clear message). On a fresh install
// none of these existed as agent_def rows at all — only spec-creator/grill-me were seeded — so
// "developer" (used by the default Full-build workflow) was invisible/uneditable on the Agents page.
const BASE_ROLES: Array<{ name: string; handle: string; canWriteCode: boolean; defaultTask: string }> = [
  { name: "planner", handle: "@plan", canWriteCode: false, defaultTask: "Produce a concrete build plan for this issue." },
  { name: "architect", handle: "@arch", canWriteCode: false, defaultTask: "Turn the plan into a concrete technical design (no code)." },
  { name: "developer", handle: "@dev", canWriteCode: true, defaultTask: "Implement the plan; commit and open a PR." },
  { name: "reviewer", handle: "@review", canWriteCode: false, defaultTask: "Review the PR against the plan and the codebase." },
  { name: "tester", handle: "@test", canWriteCode: false, defaultTask: "Run the project's checks and fix any failures." },
  { name: "decomposer", handle: "@split", canWriteCode: false, defaultTask: "Split this issue into well-scoped, parallelizable sub-issues." },
];

/** Seed the base roles as real agent_def rows — idempotent (only inserts a row that doesn't already
 *  exist), so any edits a user makes to these afterward (persona/model/defaultTask) survive every
 *  restart. persona/model are left blank on seed: execution for these built-in handles is governed
 *  by roles.ts + memory/central/agents/<role>.md, not this row — the row exists so the role is
 *  DISCOVERABLE and editable on the Agents page, matching every custom agent's presentation there. */
export function seedBaseAgents(): void {
  for (const r of BASE_ROLES) {
    if (getAgentDef(r.name)) continue;
    upsertAgentDef({
      name: r.name, handle: r.handle, mode: "repo", canWriteCode: r.canWriteCode, pushesGithub: true,
      defaultTask: r.defaultTask, builtin: true, persona: "", model: "", skills: [], interactive: false, avatar: "",
    });
  }
}

export function seedChatAgents(): void {
  if (getAgentDef("spec-creator") && getAgentDef("grill-me")) return;
  if (!getAgentDef("spec-creator")) {
    upsertAgentDef({
      name: "spec-creator", handle: "@spec", mode: "chat", pushesGithub: true,
      canWriteCode: false, interactive: true, tools: ["Read", "Glob", "Grep", "Write"],
      persona: "You are **Spec Creator**. Through focused back-and-forth, help the human turn a rough idea into a crisp, buildable spec: goal, scope, constraints, acceptance criteria, and explicit non-goals. Ask one sharp question at a time when something is ambiguous. Keep the conversation tight. When the spec is solid, post a clean final spec + a 3-line summary.",
    });
  }
  if (!getAgentDef("grill-me")) {
    upsertAgentDef({
      name: "grill-me", handle: "@grill", mode: "chat", pushesGithub: true,
      canWriteCode: false, interactive: true, tools: ["Read", "Glob", "Grep"],
      persona: "You are **Grill Me** — an adversarial reviewer of specs/plans. Stress-test the proposal: find unstated assumptions, edge cases, failure modes, scope creep, and missing acceptance criteria. Be direct and specific. End with a prioritized list of the holes that must be closed before building, plus a short verdict.",
    });
  }
}
