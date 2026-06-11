/**
 * Runs any role as a Claude Agent SDK query, assembling its system prompt from the
 * editable vault (persona + constitution + the role's playbooks) and using the role's
 * configured tools and model. This is the single entry point every specialist uses.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ROLES, modelFor, type RoleName } from "./roles.js";
import { loadConstitution, loadPersona, loadPlaybooks, loadLearned } from "../memory.js";
import { pushActivity } from "../activity.js";
import { recentLessons, recordTokens, getProviders, getRoleModels, setSession } from "../store.js";
import { loadBudget } from "../budget.js";
import { gitnexusWiring, GITNEXUS_PROMPT } from "../gitnexus.js";
import { claudeToken, ghBotToken } from "../creds.js";

/**
 * Per-role model routing. If this role is assigned a provider model in the dashboard, return
 * the model + an env that points THIS run at that provider's Anthropic-compatible endpoint —
 * leaving every other role (and the default) on your Claude subscription untouched.
 */
function resolveRoute(role: RoleName): { model: string; env: Record<string, string> } | null {
  const rm = getRoleModels()[role];
  if (!rm?.providerId || !rm.model) return null;
  const p = getProviders().find((x) => x.id === rm.providerId);
  if (!p?.baseUrl || !p.apiKey) return null;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  delete env.CLAUDE_CODE_OAUTH_TOKEN; // don't use the Claude subscription for this provider
  env.ANTHROPIC_BASE_URL = p.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = p.apiKey;
  env.ANTHROPIC_API_KEY = p.apiKey;
  return { model: rm.model, env };
}

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
  /** Resume a prior interrupted run by its SDK session id (falls back to fresh on error). */
  resumeSessionId?: string;
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
  // Keep the self-improving parts bounded so the (cache-written) system prompt stays small.
  const lessons = recentLessons(8);
  const learnedCapped = learned.length > 3500 ? learned.slice(0, 3500) + "\n…(truncated)" : learned;
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
    ...(learnedCapped.trim()
      ? ["", "=== LEARNED (self-improving notes — the agency's evolving experience; apply them) ===", learnedCapped]
      : []),
    ...(lessons.length
      ? ["", "=== RECENT LESSONS (newest takeaways — apply them) ===", ...lessons.map((l) => `- ${l}`)]
      : []),
  ].join("\n");
}

export async function runRole(role: RoleName, input: RoleRunInput): Promise<RoleRunResult> {
  const def = ROLES[role];
  // Hand the agent the GitNexus code-intelligence tools if this clone is indexed (cuts the
  // tokens spent reading files to research the codebase).
  const gn = gitnexusWiring(input.workdir);
  const systemPrompt = (await buildSystemPrompt(role)) + (gn ? `\n\n${GITNEXUS_PROMPT}` : "");
  // Per-role provider routing (keeps Claude roles on your subscription; others go to e.g. GLM).
  const route = input.model ? null : resolveRoute(role);
  const model = input.model ?? route?.model ?? modelFor(def);
  // Build the agent subprocess env: inject the dashboard-stored Claude token (so the SDK
  // authenticates without CLAUDE_CODE_OAUTH_TOKEN in the container env) and the GitHub bot token
  // (so the agent's own `git commit && git push` authenticate via gh's credential helper).
  const ct = claudeToken();
  const bot = ghBotToken();
  let runEnv: Record<string, string> | undefined = route?.env;
  if (!route && (ct || bot)) {
    runEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") runEnv[k] = v;
  }
  if (runEnv) {
    if (ct && !route) runEnv.CLAUDE_CODE_OAUTH_TOKEN = ct;
    if (bot) {
      runEnv.GH_TOKEN = bot;
      runEnv.GITHUB_TOKEN = bot;
    }
  }
  const budget = loadBudget();
  // Per-role cap, never exceeding the global ceiling. Keeps Opus plans from ballooning.
  const maxTurns = Math.min(def.maxTurns || budget.maxTurnsPerRun, budget.maxTurnsPerRun);
  const tokenCap = budget.maxTokensPerRun;

  let sessionId = "";
  const { repo, issueNumber } = input;
  console.log(`[agency] role:${role} ${repo}#${issueNumber} (model ${model}, ≤${maxTurns} turns)`);
  pushActivity(repo, issueNumber, role, "start", `started (${model}${input.resumeSessionId ? ", resuming" : ""})`);

  const sumUsage = (u: Record<string, unknown>): number => {
    const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
    return n("input_tokens") + n("output_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
  };

  /** One attempt; pass a session id to resume an interrupted run, else a fresh run. */
  async function runQuery(resumeId?: string): Promise<{ text: string; turns: number; costUsd: number; tokens: number; stopped: string }> {
    let text = "";
    let turns = 0;
    let costUsd = 0;
    let tokens = 0;
    let stopped = "";
    let stderrBuf = "";
    try {
      for await (const message of query({
        prompt: input.task,
        options: {
          cwd: input.workdir,
          systemPrompt,
          model,
          allowedTools: [...def.tools, ...(gn?.tools ?? [])],
          ...(gn ? { mcpServers: gn.servers } : {}),
          ...(runEnv ? { env: runEnv } : {}),
          ...(resumeId ? { resume: resumeId } : {}),
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
        const sid = (message as { session_id?: string }).session_id;
        if (sid) sessionId = sid;
        if (message.type === "assistant") {
          turns += 1;
          emitAssistant(repo, issueNumber, role, message);
          const au = (message as unknown as { message?: { usage?: Record<string, unknown> } }).message?.usage;
          if (au) tokens += sumUsage(au);
        }
        if ("result" in message && typeof (message as { result?: unknown }).result === "string") {
          text = (message as { result: string }).result;
        }
        const cost = (message as { total_cost_usd?: unknown }).total_cost_usd;
        if (typeof cost === "number" && Number.isFinite(cost)) costUsd = cost;
        if (tokenCap > 0 && tokens > tokenCap) {
          stopped = `token cap (${Math.round(tokens / 1000)}k > ${Math.round(tokenCap / 1000)}k)`;
          break;
        }
      }
    } catch (err) {
      const detail = stderrBuf.trim().split("\n").slice(-3).join(" ").slice(-400);
      throw new Error(`${(err as Error).message ?? String(err)}${detail ? ` | ${detail}` : ""}`);
    }
    return { text, turns, costUsd, tokens, stopped };
  }

  let r: { text: string; turns: number; costUsd: number; tokens: number; stopped: string };
  try {
    r = await runQuery(input.resumeSessionId);
  } catch (err) {
    // Resume failed? fall back to a fresh run so a bad/missing session never wedges the issue.
    if (input.resumeSessionId) {
      console.warn(`[agency] role:${role} ${repo}#${issueNumber} resume failed — fresh: ${(err as Error).message.slice(0, 140)}`);
      pushActivity(repo, issueNumber, role, "tool", "↻ couldn't resume the prior session — starting fresh");
      try {
        r = await runQuery(undefined);
      } catch (err2) {
        console.error(`[agency] role:${role} failed:`, (err2 as Error).message);
        pushActivity(repo, issueNumber, role, "done", `❌ ERROR: ${(err2 as Error).message.slice(0, 400)}`);
        throw err2;
      }
    } else {
      console.error(`[agency] role:${role} failed:`, (err as Error).message);
      pushActivity(repo, issueNumber, role, "done", `❌ ERROR: ${(err as Error).message.slice(0, 400)}`);
      throw err;
    }
  }

  const { text, turns, costUsd, tokens, stopped } = r;
  if (sessionId) setSession(repo, issueNumber, role, sessionId); // for resume after an interruption
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
