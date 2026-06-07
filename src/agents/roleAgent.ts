/**
 * Runs any role as a Claude Agent SDK query, assembling its system prompt from the
 * editable vault (persona + constitution + the role's playbooks) and using the role's
 * configured tools and model. This is the single entry point every specialist uses.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ROLES, modelFor, type RoleName } from "./roles.js";
import { loadConstitution, loadPersona, loadPlaybooks } from "../memory.js";
import { pushActivity } from "../activity.js";

/** A short, meaningful one-liner for a tool call (the command/file, not just the tool name). */
function summarizeTool(name: string, input: Record<string, unknown> = {}): string {
  const s = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  switch (name) {
    case "Bash":
      return `$ ${s(input.command)}`;
    case "Write":
      return `✏️ write ${s(input.file_path)}`;
    case "Edit":
      return `✏️ edit ${s(input.file_path)}`;
    case "Read":
      return `📖 read ${s(input.file_path)}`;
    case "Grep":
      return `🔎 grep ${s(input.pattern)}`;
    case "Glob":
      return `🔎 glob ${s(input.pattern)}`;
    case "WebSearch":
      return `🌐 search ${s(input.query)}`;
    case "WebFetch":
      return `🌐 fetch ${s(input.url)}`;
    default:
      return `🔧 ${name}${input.description ? `: ${s(input.description)}` : ""}`;
  }
}

/** Pull readable text + tool summaries out of an assistant message's content blocks. */
function emitAssistant(repo: string, number: number, role: RoleName, message: unknown): void {
  const content = (message as { message?: { content?: unknown[] } }).message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content as Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }>) {
    if (block.type === "text" && block.text?.trim()) {
      pushActivity(repo, number, role, "text", block.text.trim().slice(0, 1200));
    } else if (block.type === "tool_use" && block.name) {
      pushActivity(repo, number, role, "tool", summarizeTool(block.name, block.input));
    }
  }
}

export interface RoleRunInput {
  /** The concrete task instruction for this invocation. */
  task: string;
  /** Working directory (a cloned repo) the agent operates in. */
  workdir: string;
  /** Issue/PR context for the live activity stream (concurrency-safe). */
  repo: string;
  issueNumber: number;
  /** Optional model override (else role default / env). */
  model?: string;
}

export interface RoleRunResult {
  text: string;
  turns: number;
  model: string;
}

async function buildSystemPrompt(role: RoleName): Promise<string> {
  const def = ROLES[role];
  const [persona, constitution, playbooks] = await Promise.all([
    loadPersona(def.personaFile),
    loadConstitution(),
    loadPlaybooks(def.playbooks),
  ]);
  return [
    "=== OUTPUT STYLE (strict) ===",
    "Be maximally terse — spend the fewest tokens that fully do the job. No preamble, no",
    "restating the task, no pleasantries, no 'I will now…', no summaries of what you did.",
    "Use fragments, lists, or code. Process/inter-agent notes may be shorthand or code.",
    "EXCEPTION — only when your output is addressed to the human (a clarifying QUESTION, the",
    "PROPOSAL awaiting approval, or the final hand-off summary): write clear, concise plain",
    "English. Everything else: caveman-terse.",
    "",
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
  let stderrBuf = "";
  const { repo, issueNumber } = input;
  console.log(`[agency] role:${role} ${repo}#${issueNumber} (model ${model})`);
  pushActivity(repo, issueNumber, role, "start", `started (${model})`);

  try {
    for await (const message of query({
      prompt: input.task,
      options: {
        cwd: input.workdir,
        systemPrompt,
        model,
        allowedTools: def.tools,
        // Fully autonomous. Requires the container to run as a NON-root user (Claude Code
        // refuses --dangerously-skip-permissions as root) — see Dockerfile `USER node`.
        permissionMode: "bypassPermissions",
        stderr: (data: string) => {
          stderrBuf += data;
        },
        settingSources: [],
      },
    })) {
      if (message.type === "assistant") {
        turns += 1;
        emitAssistant(repo, issueNumber, role, message);
      }
      if ("result" in message && typeof (message as { result?: unknown }).result === "string") {
        text = (message as { result: string }).result;
      }
    }
  } catch (err) {
    const detail = stderrBuf.trim().split("\n").slice(-3).join(" ").slice(-400);
    const msg = `${(err as Error).message ?? String(err)}${detail ? ` | ${detail}` : ""}`;
    console.error(`[agency] role:${role} failed:`, msg);
    pushActivity(repo, issueNumber, role, "done", `❌ ERROR: ${msg.slice(0, 400)}`);
    throw new Error(msg);
  }
  pushActivity(repo, issueNumber, role, "done", `finished (${turns} turns)`);
  return { text, turns, model };
}
