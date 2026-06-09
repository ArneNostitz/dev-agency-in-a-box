/**
 * Loads the markdown memory that bounds and guides the agents.
 * Phase 1 loads the always-on Constitution plus the git workflow playbook.
 * Later phases add on-demand playbook selection and vector retrieval.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getAgentOverride, listAgentOverridePaths } from "./store.js";

const here = dirname(fileURLToPath(import.meta.url));
// src/ -> project root
const projectRoot = join(here, "..");
const memoryRoot = join(projectRoot, "memory");

async function readIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Read an agent file (by its repo-relative path under memory/) preferring a live dashboard
 * edit stored in the DB, falling back to the on-disk default. This is what makes edits take
 * effect on the next agent run without a redeploy.
 */
async function readWithOverride(rel: string): Promise<string> {
  const ov = getAgentOverride(rel);
  if (ov != null) return ov;
  return readIfExists(join(memoryRoot, rel));
}

/** The small, always-injected core: the Constitution. */
export async function loadConstitution(): Promise<string> {
  return readWithOverride("central/CONSTITUTION.md");
}

/** Load a named playbook from memory/central/playbooks. */
export async function loadPlaybook(name: string): Promise<string> {
  return readWithOverride(`central/playbooks/${name}.md`);
}

/** Load a role persona from memory/central/agents/<role>.md (the FIXED part). */
export async function loadPersona(role: string): Promise<string> {
  return readWithOverride(`central/agents/${role}.md`);
}

/** Paths of the LEARNING (self-improvable) docs: a shared one + a per-role one. */
export const SHARED_LEARNED_PATH = "central/playbooks/_learned.md";
export const roleLearnedPath = (role: string): string => `central/agents/${role}.learned.md`;

/**
 * The LEARNING part of an agent: the shared learned playbook plus this role's own learned notes.
 * These are what the self-improvement loop edits (and you can too); the persona/playbooks are the
 * FIXED part it must never touch.
 */
export async function loadLearned(role: string): Promise<string> {
  const [shared, mine] = await Promise.all([
    readWithOverride(SHARED_LEARNED_PATH),
    readWithOverride(roleLearnedPath(role)),
  ]);
  return [shared, mine].filter((s) => s.trim()).join("\n\n");
}

// ---- editable agent memory (for the dashboard editor) ----

export interface AgentFile {
  path: string; // relative under memory/, e.g. "central/agents/developer.md"
  label: string;
  // "fixed" parts are user-only; "learning" parts the self-improvement loop can also edit.
  group: "core" | "persona" | "playbook" | "learning";
  edited: boolean; // has a live override (vs the on-disk default)
}

/** List the markdown that defines the agents: FIXED parts + LEARNING parts. */
export async function listAgentFiles(): Promise<AgentFile[]> {
  const overridden = new Set(listAgentOverridePaths());
  const mk = (path: string, label: string, group: AgentFile["group"]): AgentFile => ({
    path,
    label,
    group,
    edited: overridden.has(path),
  });
  const out: AgentFile[] = [mk("central/CONSTITUTION.md", "Constitution", "core")];
  // The shared learning doc (self-improving) sits at the top with the core.
  out.push(mk(SHARED_LEARNED_PATH, "Learned (shared)", "learning"));

  try {
    const personas = (await readdir(join(memoryRoot, "central", "agents")))
      .filter((f) => f.endsWith(".md") && !f.endsWith(".learned.md"))
      .sort();
    for (const f of personas) {
      const role = f.replace(/\.md$/, "");
      out.push(mk(`central/agents/${f}`, role, "persona")); // fixed
      out.push(mk(roleLearnedPath(role), `${role} — learned`, "learning")); // self-improvable
    }
  } catch {
    /* ignore */
  }
  try {
    const books = (await readdir(join(memoryRoot, "central", "playbooks")))
      .filter((f) => f.endsWith(".md") && f !== "_learned.md")
      .sort();
    for (const f of books) out.push(mk(`central/playbooks/${f}`, f.replace(/\.md$/, ""), "playbook"));
  } catch {
    /* ignore */
  }
  return out;
}

/** Only allow markdown files under memory/central (no path traversal). */
export function isSafeAgentPath(rel: string): boolean {
  return /^central\/[\w./-]+\.md$/.test(rel) && !rel.includes("..");
}

/** The effective content (live override if any, else the on-disk default). */
export async function readAgentFile(rel: string): Promise<string | null> {
  if (!isSafeAgentPath(rel)) return null;
  return readWithOverride(rel);
}

/** The path of an agent file inside the git repo (for committing edits). */
export function agentFileRepoPath(rel: string): string {
  return `memory/${rel}`;
}

/** Load several playbooks and concatenate them with headers. */
export async function loadPlaybooks(names: string[]): Promise<string> {
  const parts = await Promise.all(
    names.map(async (n) => {
      const body = await loadPlaybook(n);
      return body ? `\n----- playbook: ${n} -----\n${body}` : "";
    }),
  );
  return parts.join("\n");
}
