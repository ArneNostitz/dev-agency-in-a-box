/**
 * Runs any role as a Claude Agent SDK query, assembling its system prompt from the
 * editable vault (persona + constitution + the role's playbooks) and using the role's
 * configured tools and model. This is the single entry point every specialist uses.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ROLES, modelFor, type RoleName } from "./roles.js";
import { loadConstitution, loadPersona, loadPlaybooks, loadLearned } from "../memory.js";
import { pushActivity } from "../activity.js";
import { recentLessons, recordTokens } from "../store.js";
import { loadBudget } from "../budget.js";

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
  /** USD cost the SDK reported for this run (0 when not reported, e.g. subscription auth). */
  costUsd: number;
}

async function buildSystemPrompt(role: RoleName): Promise<string> {
  const def = ROLES[role];
  const [persona, constitution, playbooks, learned] = await Promise.all([
    loadPersona(def.personaFile),
    loadConstitution(),
    loadPlaybooks(def.playbooks),
    loadLearned(def.personaFile),
  ]);
  const lessons = recentLessons(12);
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
    ...(learned.trim()
      ? ["", "=== LEARNED (self-improving notes — the agency's evolving experience; apply them) ===", learned]
      : []),
    ...(lessons.length
      ? ["", "=== RECENT LESSONS (newest takeaways — apply them) ===", ...lessons.map((l) => `- ${l}`)]
      : []),
  ].join("\n");
}

export async function runRole(role: RoleName, input: RoleRunInput): Promise<RoleRunResult> {
  const def = ROLES[role];
  const systemPrompt = await buildSystemPrompt(role);
  const model = input.model ?? modelFor(def);
  const budget = loadBudget();
  // Per-role cap, never exceeding the global ceiling. Keeps Opus plans from ballooning.
  const maxTurns = Math.min(def.maxTurns || budget.maxTurnsPerRun, budget.maxTurnsPerRun);
  const tokenCap = budget.maxTokensPerRun;

  let text = "";
  let turns = 0;
  let costUsd = 0;
  let tokens = 0;
  let stopped = "";
  let stderrBuf = "";
  const { repo, issueNumber } = input;
  console.log(`[agency] role:${role} ${repo}#${issueNumber} (model ${model}, ≤${maxTurns} turns)`);
  pushActivity(repo, issueNumber, role, "start", `started (${model})`);

  const sumUsage = (u: Record<string, unknown>): number => {
    const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
    return n("input_tokens") + n("output_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
  };

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
        maxTurns,
        stderr: (data: string) => {
          stderrBuf += data;
        },
        settingSources: [],
      },
    })) {
      if (message.type === "assistant") {
        turns += 1;
        emitAssistant(repo, issueNumber, role, message);
        // Accumulate billed tokens per turn (each turn re-bills the whole context).
        const au = (message as unknown as { message?: { usage?: Record<string, unknown> } }).message?.usage;
        if (au) tokens += sumUsage(au);
      }
      if ("result" in message && typeof (message as { result?: unknown }).result === "string") {
        text = (message as { result: string }).result;
      }
      const cost = (message as { total_cost_usd?: unknown }).total_cost_usd;
      if (typeof cost === "number" && Number.isFinite(cost)) costUsd = cost;
      // Hard kill-switch: stop a runaway run before it burns the budget.
      if (tokenCap > 0 && tokens > tokenCap) {
        stopped = `token cap (${Math.round(tokens / 1000)}k > ${Math.round(tokenCap / 1000)}k)`;
        break;
      }
    }
  } catch (err) {
    const detail = stderrBuf.trim().split("\n").slice(-3).join(" ").slice(-400);
    const msg = `${(err as Error).message ?? String(err)}${detail ? ` | ${detail}` : ""}`;
    console.error(`[agency] role:${role} failed:`, msg);
    pushActivity(repo, issueNumber, role, "done", `❌ ERROR: ${msg.slice(0, 400)}`);
    throw new Error(msg);
  }
  recordTokens(tokens, costUsd, model);
  const tok = tokens ? `, ${Math.round(tokens / 1000)}k tok` : "";
  pushActivity(
    repo,
    issueNumber,
    role,
    "done",
    `finished (${turns} turns${tok}${costUsd ? `, $${costUsd.toFixed(2)}` : ""}${stopped ? ` — ⚠ stopped: ${stopped}` : ""})`,
  );
  if (stopped) console.warn(`[agency] role:${role} ${repo}#${issueNumber} stopped — ${stopped}`);
  return { text, turns, model, costUsd };
}
