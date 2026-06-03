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
  opus: "claude-opus-4-6",
} as const;

export type RoleName = "architect" | "developer" | "reviewer" | "tester";

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
}

const READ_TOOLS = ["Read", "Glob", "Grep"];
const SHARED_PLAYBOOKS = ["engineering-principles", "reuse-first"];

export const ROLES: Record<RoleName, RoleDef> = {
  architect: {
    name: "architect",
    personaFile: "architect",
    playbooks: [...SHARED_PLAYBOOKS, "frontend-atomic-design", "logic-separation", "backend", "database"],
    defaultModel: MODELS.sonnet,
    modelEnv: "ARCHITECT_MODEL",
    tools: READ_TOOLS,
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
  },
  reviewer: {
    name: "reviewer",
    personaFile: "reviewer",
    playbooks: [...SHARED_PLAYBOOKS, "how-to-review", "frontend-atomic-design", "theming", "logic-separation"],
    defaultModel: MODELS.sonnet,
    modelEnv: "REVIEWER_MODEL",
    tools: [...READ_TOOLS, "Bash"],
  },
  tester: {
    name: "tester",
    personaFile: "tester",
    playbooks: ["how-to-write-tests"],
    defaultModel: MODELS.haiku,
    modelEnv: "TESTER_MODEL",
    tools: [...READ_TOOLS, "Bash"],
  },
};

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
  return s === "architect" || s === "developer" || s === "reviewer" || s === "tester";
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Decide which role an issue is pinning, by the first handle it mentions.
 * Falls back to "developer" if a handle matched but isn't mapped to a specific role.
 */
export function roleForText(text: string, map: Record<string, RoleName>): RoleName | null {
  let best: { index: number; role: RoleName } | null = null;
  for (const [handle, role] of Object.entries(map)) {
    const m = new RegExp(escapeRegex(handle) + "(?![a-z0-9_-])", "i").exec(text);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, role };
  }
  return best?.role ?? null;
}
