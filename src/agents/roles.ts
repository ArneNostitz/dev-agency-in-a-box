/**
 * The agency roster: each role's persona, playbooks, allowed tools, and model.
 *
 * Model policy = "cheapest model that can do the job":
 *   - Haiku for mechanical work (running tests).
 *   - Sonnet for work needing judgment or code quality (architect, developer, reviewer).
 *   - Opus is available for genuinely hard tasks via per-role *_MODEL overrides.
 * Every role's model can be overridden with an env var (e.g. DEVELOPER_MODEL).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
} as const;

/**
 * Normalize a Claude model id to a string the API actually accepts. People (and pickers) commonly
 * type the family/version in the wrong order ("claude-4-6-sonnet"), use dots ("claude-sonnet-4.6"),
 * drop Haiku's date suffix, or just write "sonnet". All of those should run, not 404. Third-party
 * ids (glm-…, gemini-…, deepseek-…, kimi-…) are left untouched.
 */
export function canonicalModel(m: string): string {
  if (!m) return m;
  let s = m.trim();
  const low = s.toLowerCase();
  if (!/sonnet|opus|haiku|claude/.test(low)) return s; // not a Claude id → leave it alone
  // Bare family name (optionally "claude-…") → current canonical id.
  if (/^(claude[-\s]*)?(sonnet|opus|haiku)$/.test(low)) {
    const fam = /opus/.test(low) ? "opus" : /haiku/.test(low) ? "haiku" : "sonnet";
    return MODELS[fam];
  }
  // Reorder "claude-<ver>-<family>" → "claude-<family>-<ver>" (e.g. claude-4-6-sonnet).
  const re = low.match(/^claude-(\d+(?:[-.]\d+)*)-(sonnet|opus|haiku)(.*)$/);
  if (re) s = `claude-${re[2]}-${re[1].replace(/\./g, "-")}${re[3]}`;
  // Dots → dashes in the canonical "claude-<family>-4.6" form.
  s = s.replace(/^(claude-(?:sonnet|opus|haiku))-(\d+)\.(\d+)/i, "$1-$2-$3");
  // Haiku needs its dated id on the subscription/API (and there is no Haiku 4-6 — map any 4-x).
  if (/^claude-haiku-4(-\d+)?$/i.test(s)) s = MODELS.haiku;
  return s;
}

export type RoleName = "planner" | "decomposer" | "architect" | "developer" | "reviewer" | "tester" | "librarian" | "auditor";

export interface RoleDef {
  name: RoleName;
  /** Markdown persona file under memory/central/agents/. */
  personaFile: string;
  /** Playbooks (by basename) to load into this role's context. */
  playbooks: string[];
  /** Default model if no env override. */
  defaultModel: string;
  /** Env var that overrides the model for this role. */
  modelEnv: string;
  /** Tools this role may use. */
  tools: string[];
  /**
   * Backstop on agent turns (= assistant LLM round-trips, NOT tool calls — one turn can fire many
   * tools). This is ONLY a catch for a pathological infinite loop; it must NOT cap a valid run.
   * The real cost/runaway guard is the per-run TOKEN kill-switch (budget.maxTokensPerRun): each turn
   * re-sends the growing context, so a thrashing agent blows the token cap and stops GRACEFULLY long
   * before a sane turn count — whereas hitting maxTurns surfaces as a hard "max turns" ERROR. So keep
   * these generous (mirrors Claude Code native, which runs to completion with no tight turn cap).
   */
  maxTurns: number;
}

const READ_TOOLS = ["Read", "Glob", "Grep"];
const SHARED_PLAYBOOKS = ["engineering-principles", "reuse-first"];

export const ROLES: Record<RoleName, RoleDef> = {
  planner: {
    name: "planner",
    personaFile: "planner",
    playbooks: [...SHARED_PLAYBOOKS, "frontend-atomic-design", "logic-separation", "backend", "database"],
    // The premium thinker: Opus 4.8, high effort. Override with PLANNER_MODEL.
    defaultModel: MODELS.sonnet, // opus opt-in via PLANNER_MODEL for hard issues
    modelEnv: "PLANNER_MODEL",
    tools: READ_TOOLS,
    maxTurns: 80,
  },
  decomposer: {
    name: "decomposer",
    personaFile: "decomposer",
    playbooks: [...SHARED_PLAYBOOKS],
    // Splitting a plan into well-scoped epics is judgement work — use the strong planner-tier model.
    defaultModel: MODELS.sonnet, // splitting is parse-checked; sonnet is enough (DECOMPOSER_MODEL to override)
    modelEnv: "DECOMPOSER_MODEL",
    tools: READ_TOOLS,
    maxTurns: 50,
  },
  architect: {
    name: "architect",
    personaFile: "architect",
    playbooks: [...SHARED_PLAYBOOKS, "frontend-atomic-design", "logic-separation", "backend", "database"],
    defaultModel: MODELS.sonnet,
    modelEnv: "ARCHITECT_MODEL",
    tools: READ_TOOLS,
    maxTurns: 60,
  },
  developer: {
    name: "developer",
    personaFile: "developer",
    playbooks: [
      ...SHARED_PLAYBOOKS,
      "frontend-atomic-design",
      "theming",
      "logic-separation",
      "backend",
      "database",
      "how-to-write-tests",
      "git-workflow",
    ],
    defaultModel: MODELS.sonnet,
    modelEnv: "DEVELOPER_MODEL",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    // A real change (read → edit several files → run tests → fix → commit) legitimately spans many
    // turns; 35 was choking valid work with a hard "max turns" error. Generous backstop; the token
    // kill-switch is what actually stops a thrashing developer (and stops it gracefully).
    maxTurns: 120,
  },
  reviewer: {
    name: "reviewer",
    personaFile: "reviewer",
    playbooks: [...SHARED_PLAYBOOKS, "how-to-review", "frontend-atomic-design", "theming", "logic-separation"],
    defaultModel: MODELS.sonnet,
    modelEnv: "REVIEWER_MODEL",
    tools: [...READ_TOOLS, "Bash"],
    maxTurns: 50,
  },
  tester: {
    name: "tester",
    personaFile: "tester",
    playbooks: ["how-to-write-tests"],
    defaultModel: MODELS.haiku,
    modelEnv: "TESTER_MODEL",
    tools: [...READ_TOOLS, "Bash"],
    maxTurns: 60,
  },
  librarian: {
    name: "librarian",
    personaFile: "librarian",
    playbooks: [],
    // Cheap reflection after each finished build: distill reusable lessons.
    defaultModel: MODELS.haiku,
    modelEnv: "LIBRARIAN_MODEL",
    tools: READ_TOOLS,
    maxTurns: 30,
  },
  auditor: {
    name: "auditor",
    personaFile: "auditor",
    playbooks: [...SHARED_PLAYBOOKS, "logic-separation", "backend"],
    // Whole-codebase architectural judgment — Sonnet is the sweet spot. Override with AUDITOR_MODEL.
    defaultModel: MODELS.sonnet,
    modelEnv: "AUDITOR_MODEL",
    // Needs Bash to run graphify + git, and read tools to inspect the code it flags.
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 80,
  },
};

/** All role names, derived from the canonical ROLES map — single source of truth. */
export const ALL_ROLES = Object.keys(ROLES) as RoleName[];

/** Resolve the model for a role: per-role env override, else global AGENT_MODEL, else default. */
export function modelFor(role: RoleDef): string {
  return (
    process.env[role.modelEnv]?.trim() ||
    process.env.AGENT_MODEL?.trim() ||
    role.defaultModel
  );
}

// ---- handle -> role mapping (from config/team.txt: "@handle: role") ----

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, ".."); // src/agents -> src ; one more to root below
const teamFile = join(projectRoot, "..", "config", "team.txt");

function isRole(s: string): s is RoleName {
  // Single source of truth: every key of ROLES (previously hand-listed here, which silently omitted
  // auditor + decomposer and downgraded their handles to "developer").
  return Object.prototype.hasOwnProperty.call(ROLES, s);
}

/** Map of "@handle" (lowercased) -> RoleName, read from config/team.txt. */
export function loadHandleRoleMap(): Record<string, RoleName> {
  const map: Record<string, RoleName> = {};
  if (existsSync(teamFile)) {
    for (const line of readFileSync(teamFile, "utf8").split("\n")) {
      const s = line.split("#")[0].trim();
      if (!s) continue;
      const [rawHandle, rawRole] = s.split(":").map((x) => x.trim());
      if (!rawHandle) continue;
      const handle = (rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`).toLowerCase();
      const role = (rawRole ?? "").toLowerCase();
      map[handle] = isRole(role) ? role : "developer";
    }
  }
  if (Object.keys(map).length === 0) map["@dev"] = "developer";
  return map;
}

/**
 * Resolve an explicit agent handle (a dashboard pick or the dealer's choice — NEVER scanned from
 * issue/comment text; issue #140 removed @-mention triggering) to its role. Built-ins first, then
 * the team.txt map, else null (caller falls back to the default workflow).
 */
export function roleForHandle(handle: string): RoleName | null {
  const h = (handle || "").trim().toLowerCase();
  if (!h) return null;
  const builtins: Record<string, RoleName> = { "@dev": "developer", "@plan": "planner", "@split": "decomposer", "@arch": "architect", "@review": "reviewer", "@test": "tester" };
  if (builtins[h]) return builtins[h];
  const mapped = loadHandleRoleMap()[h];
  return mapped ?? null;
}
