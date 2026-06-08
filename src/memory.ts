/**
 * Loads the markdown memory that bounds and guides the agents.
 * Phase 1 loads the always-on Constitution plus the git workflow playbook.
 * Later phases add on-demand playbook selection and vector retrieval.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

/** The small, always-injected core: the Constitution. */
export async function loadConstitution(): Promise<string> {
  return readIfExists(join(memoryRoot, "central", "CONSTITUTION.md"));
}

/** Load a named playbook from memory/central/playbooks. */
export async function loadPlaybook(name: string): Promise<string> {
  return readIfExists(join(memoryRoot, "central", "playbooks", `${name}.md`));
}

/** Load a role persona from memory/central/agents/<role>.md. */
export async function loadPersona(role: string): Promise<string> {
  return readIfExists(join(memoryRoot, "central", "agents", `${role}.md`));
}

// ---- editable agent memory (for the dashboard editor) ----

export interface AgentFile {
  path: string; // relative under memory/, e.g. "central/agents/developer.md"
  label: string;
  group: "core" | "persona" | "playbook";
}

/** List the markdown files that define how the agents behave. */
export async function listAgentFiles(): Promise<AgentFile[]> {
  const out: AgentFile[] = [{ path: "central/CONSTITUTION.md", label: "Constitution", group: "core" }];
  const dirs: Array<[string, AgentFile["group"]]> = [
    ["agents", "persona"],
    ["playbooks", "playbook"],
  ];
  for (const [dir, group] of dirs) {
    try {
      const files = await readdir(join(memoryRoot, "central", dir));
      for (const f of files.filter((x) => x.endsWith(".md")).sort()) {
        out.push({ path: `central/${dir}/${f}`, label: f.replace(/\.md$/, ""), group });
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Only allow markdown files under memory/central (no path traversal). */
export function isSafeAgentPath(rel: string): boolean {
  return /^central\/[\w./-]+\.md$/.test(rel) && !rel.includes("..");
}

export async function readAgentFile(rel: string): Promise<string | null> {
  if (!isSafeAgentPath(rel)) return null;
  return readIfExists(join(memoryRoot, rel));
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
