/**
 * Loads the markdown memory that bounds and guides the agents.
 * Phase 1 loads the always-on Constitution plus the git workflow playbook.
 * Later phases add on-demand playbook selection and vector retrieval.
 */
import { readFile } from "node:fs/promises";
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
