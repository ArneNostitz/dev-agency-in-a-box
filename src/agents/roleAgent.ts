/**
 * Runs any role as a Claude Agent SDK query, assembling its system prompt from the
 * editable vault (persona + constitution + the role's playbooks) and using the role's
 * configured tools and model. This is the single entry point every specialist uses.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ROLES, modelFor, type RoleName } from "./roles.js";
import { loadConstitution, loadPersona, loadPlaybooks } from "../memory.js";

export interface RoleRunInput {
  /** The concrete task instruction for this invocation. */
  task: string;
  /** Working directory (a cloned repo) the agent operates in. */
  workdir: string;
  /** Optional model override (else role default / env). */
  model?: string;
}

export interface RoleRunResult {
  text: string;
  turns: number;
}

async function buildSystemPrompt(role: RoleName): Promise<string> {
  const def = ROLES[role];
  const [persona, constitution, playbooks] = await Promise.all([
    loadPersona(def.personaFile),
    loadConstitution(),
    loadPlaybooks(def.playbooks),
  ]);
  return [
    persona,
    "",
    "=== CONSTITUTION (hard rules — always obey) ===",
    constitution,
    "",
    "=== PLAYBOOKS (how we build — binding) ===",
    playbooks,
  ].join("\n");
}

export async function runRole(role: RoleName, input: RoleRunInput): Promise<RoleRunResult> {
  const def = ROLES[role];
  const systemPrompt = await buildSystemPrompt(role);
  const model = input.model ?? modelFor(def);

  let text = "";
  let turns = 0;
  console.log(`[agency] role:${role} (model ${model})`);

  for await (const message of query({
    prompt: input.task,
    options: {
      cwd: input.workdir,
      systemPrompt,
      model,
      permissionMode: "bypassPermissions",
      allowedTools: def.tools,
      settingSources: [],
    },
  })) {
    if (message.type === "assistant") turns += 1;
    if ("result" in message && typeof (message as { result?: unknown }).result === "string") {
      text = (message as { result: string }).result;
    }
  }
  return { text, turns };
}
