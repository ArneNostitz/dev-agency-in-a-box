/**
 * Runs any role as a Claude Agent SDK query, assembling its system prompt from the
 * editable vault (persona + constitution + the role's playbooks) and using the role's
 * configured tools and model. This is the single entry point every specialist uses.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ROLES, modelFor, type RoleName } from "./roles.js";
import { loadConstitution, loadPersona, loadPlaybooks, loadLearned } from "../memory.js";
import { pushActivity } from "../activity.js";
import { recentLessons, recordTokens, getProviders, getRoleModels, getSessionFallback, setSession, getIssueModelOverride } from "../store.js";
import { loadBudget } from "../budget.js";
import { gitnexusWiring, GITNEXUS_PROMPT } from "../gitnexus.js";
import { claudeToken, anthropicApiKey, ghBotToken } from "../creds.js";
import { registerRun } from "../abort.js";

/**
 * Per-role model routing. Checks (in order):
 *   1. Per-issue override (chatbox model picker — one-shot, cleared after the run)
 *   2. Per-role assignment (dashboard "Models" panel)
 *   3. Session-level fallback (temporary auto-switch on rate limit — cleared after the retry)
 * Returns the model + an env that points this run at the provider's Anthropic-compatible
 * endpoint — leaving every other role (and the default) on your Claude subscription untouched.
 */
function resolveRoute(role: RoleName, repo: string, issueNumber: number): { model: string; env: Record<string, string> } | null {
  // Per-issue override wins (set when the human picks a model in the chatbox).
  const issueOverride = getIssueModelOverride(repo, issueNumber);
  // Per-role permanent assignment; fall back to the temporary session fallback if the role
  // has no explicit provider (session fallback is set only during an auto-switch retry and
  // is cleared in the finally block after the run — it never mutates the DB).
  const explicit = issueOverride ?? getRoleModels()[role];
  const assignment = explicit?.providerId ? explicit : getSessionFallback();
  if (!assignment?.providerId || !assignment.model) return null;
  const p = getProviders().find((x) => x.id === assignment.providerId);
  if (!p?.baseUrl || !p.apiKey) return null;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  delete env.CLAUDE_CODE_OAUTH_TOKEN; // don't use the Claude subscription for this provider
  env.ANTHROPIC_BASE_URL = p.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = p.apiKey;
  env.ANTHROPIC_API_KEY = p.apiKey;
  return { model: assignment.model, env };
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
  const route = input.model ? null : resolveRoute(role, input.repo, input.issueNumber);
  const model = input.model ?? route?.model ?? modelFor(def);
  // Build the agent subprocess env: inject the dashboard-stored Claude token (so the SDK
  // authenticates without CLAUDE_CODE_OAUTH_TOKEN in the container env) and the GitHub bot token
  // (so the agent's own `git commit && git push` authenticate via gh's credential helper).
  const ct = claudeToken();
  const ak = route ? "" : anthropicApiKey();
  const bot = ghBotToken();
  let runEnv: Record<string, string> | undefined = route?.env;
  if (!route && (ct || ak || bot)) {
    runEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") runEnv[k] = v;
  }
  if (runEnv) {
    if (!route) {
      // Clear conflicting auth env so the chosen credential is the only one the SDK sees — a
      // stale/empty ANTHROPIC_API_KEY (or AUTH_TOKEN) in the container otherwise wins and 401s.
      if (ct) {
        runEnv.CLAUDE_CODE_OAUTH_TOKEN = ct;
        delete runEnv.ANTHROPIC_API_KEY;
        delete runEnv.ANTHROPIC_AUTH_TOKEN;
        delete runEnv.ANTHROPIC_BASE_URL;
      } else if (ak) {
        runEnv.ANTHROPIC_API_KEY = ak;
        delete runEnv.CLAUDE_CODE_OAUTH_TOKEN;
        delete runEnv.ANTHROPIC_AUTH_TOKEN;
        delete runEnv.ANTHROPIC_BASE_URL;
      }
    }
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

  // Register this run so the dashboard "Stop" can abort it (and every other role run on the issue).
  const abortRun = registerRun(repo, issueNumber);
  // Heartbeat: a single long command (e.g. a slow `pip install` / venv setup) prints nothing until
  // it returns, so the live stream can look frozen/"stuck". Emit a line each minute so it's clearly
  // still alive (and tells you how long it's been on the current step).
  const runStartedAt = Date.now();
  const heartbeat = setInterval(() => {
    pushActivity(repo, issueNumber, role, "tool", `⏳ still working… (${Math.round((Date.now() - runStartedAt) / 60000)}m on this step)`);
  }, 60_000);
  // For 401s, name the credential actually used + the likely fixes (this is the #1 support issue).
  const credVia = route ? `the provider model (${model})` : claudeToken() ? "your Claude subscription token" : anthropicApiKey() ? "your Anthropic API key" : "the container-env credential";
  const authAdvice = (msg: string): string =>
    /401|authenticat|bearer|x-api-key|invalid[_ ]?(api[_ ]?)?key/i.test(msg)
      ? ` — auth failed using ${credVia}. Re-check it in Settings (no spaces, correct type), and confirm MASTER_KEY hasn't changed since you saved it (a changed key makes stored tokens undecryptable, then it silently falls back to a stale env token).`
      : "";

  const n = (u: Record<string, unknown>, k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  // Full usage incl. cache reads — for accurate cost/recordTokens.
  const sumUsage = (u: Record<string, unknown>): number =>
    n(u, "input_tokens") + n(u, "output_tokens") + n(u, "cache_creation_input_tokens") + n(u, "cache_read_input_tokens");
  // Forward-progress only — drives the runaway kill-switch. EXCLUDES cache_read_input_tokens,
  // which the SDK re-reports every turn (the whole cached prefix is re-read each call) and would
  // otherwise inflate the running total to the cap in ~20 turns and force-kill mid-work, leaving
  // no diff. Cache reads are the cheap 0.1x tier; real spend is input+output+cache_creation.
  const sumBillable = (u: Record<string, unknown>): number =>
    n(u, "input_tokens") + n(u, "output_tokens") + n(u, "cache_creation_input_tokens");

  /** One attempt; pass a session id to resume an interrupted run, else a fresh run. */
  async function runQuery(resumeId?: string): Promise<{ text: string; turns: number; costUsd: number; tokens: number; stopped: string }> {
    let text = "";
    let turns = 0;
    let costUsd = 0;
    let tokens = 0;
    let capTokens = 0; // forward-progress tokens (excl. cache reads) — what the kill-switch checks
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
          abortController: abortRun.controller, // dashboard "Stop" aborts the SDK subprocess
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
          if (au) {
            tokens += sumUsage(au);
            capTokens += sumBillable(au);
          }
        }
        if ("result" in message && typeof (message as { result?: unknown }).result === "string") {
          text = (message as { result: string }).result;
        }
        const cost = (message as { total_cost_usd?: unknown }).total_cost_usd;
        if (typeof cost === "number" && Number.isFinite(cost)) costUsd = cost;
        if (tokenCap > 0 && capTokens > tokenCap) {
          stopped = `token cap (${Math.round(capTokens / 1000)}k > ${Math.round(tokenCap / 1000)}k)`;
          break;
        }
      }
    } catch (err) {
      const detail = stderrBuf.trim().split("\n").slice(-3).join(" ").slice(-400);
      throw new Error(`${(err as Error).message ?? String(err)}${detail ? ` | ${detail}` : ""}`);
    }
    return { text, turns, costUsd, tokens, stopped };
  }

  /** User pressed Stop: the SDK throws an AbortError — return cleanly, never retry. */
  const wasAborted = (): boolean => abortRun.controller.signal.aborted;

  let r: { text: string; turns: number; costUsd: number; tokens: number; stopped: string };
  try {
    try {
      r = await runQuery(input.resumeSessionId);
    } catch (err) {
      if (wasAborted()) {
        pushActivity(repo, issueNumber, role, "done", "⏹ stopped by user");
        return { text: "", turns: 0, model, costUsd: 0 };
      }
      // Resume failed? fall back to a fresh run so a bad/missing session never wedges the issue.
      if (input.resumeSessionId) {
        console.warn(`[agency] role:${role} ${repo}#${issueNumber} resume failed — fresh: ${(err as Error).message.slice(0, 140)}`);
        pushActivity(repo, issueNumber, role, "tool", "↻ couldn't resume the prior session — starting fresh");
        try {
          r = await runQuery(undefined);
        } catch (err2) {
          if (wasAborted()) {
            pushActivity(repo, issueNumber, role, "done", "⏹ stopped by user");
            return { text: "", turns: 0, model, costUsd: 0 };
          }
          console.error(`[agency] role:${role} failed:`, (err2 as Error).message);
          pushActivity(repo, issueNumber, role, "done", `❌ ERROR: ${(err2 as Error).message.slice(0, 400)}${authAdvice((err2 as Error).message)}`);
          throw err2;
        }
      } else {
        console.error(`[agency] role:${role} failed:`, (err as Error).message);
        pushActivity(repo, issueNumber, role, "done", `❌ ERROR: ${(err as Error).message.slice(0, 400)}${authAdvice((err as Error).message)}`);
        throw err;
      }
    }
  } finally {
    clearInterval(heartbeat);
    abortRun.release();
  }

  const { text, turns, costUsd, tokens, stopped } = r;
  if (sessionId) setSession(repo, issueNumber, role, sessionId); // for resume after an interruption
  recordTokens(tokens, costUsd, model, repo, issueNumber, role);
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

/**
 * Make a tiny real Agent SDK call with the resolved default Claude credential, so the dashboard can
 * tell the user immediately whether their token actually authenticates — instead of discovering a
 * 401 only on the first real run. Mirrors runRole's (no-route) env construction exactly.
 */
export async function testClaudeAuth(): Promise<{ ok: boolean; via: string; error?: string }> {
  const ct = claudeToken();
  const ak = ct ? "" : anthropicApiKey();
  const via = ct ? "Claude subscription token" : ak ? "Anthropic API key" : "container-env credential";
  if (!ct && !ak) return { ok: false, via, error: "No Claude credential is set — add a subscription token or API key first." };
  const runEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") runEnv[k] = v;
  if (ct) {
    runEnv.CLAUDE_CODE_OAUTH_TOKEN = ct;
    delete runEnv.ANTHROPIC_API_KEY;
    delete runEnv.ANTHROPIC_AUTH_TOKEN;
    delete runEnv.ANTHROPIC_BASE_URL;
  } else {
    runEnv.ANTHROPIC_API_KEY = ak;
    delete runEnv.CLAUDE_CODE_OAUTH_TOKEN;
    delete runEnv.ANTHROPIC_AUTH_TOKEN;
    delete runEnv.ANTHROPIC_BASE_URL;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let errText = "";
  try {
    for await (const message of query({
      prompt: "Reply with exactly: ok",
      options: {
        model: "claude-haiku-4-5-20251001",
        maxTurns: 1,
        env: runEnv,
        permissionMode: "bypassPermissions",
        allowedTools: [],
        abortController: controller,
        settingSources: [],
        stderr: () => {},
      },
    })) {
      const m = message as { type?: string; is_error?: boolean; subtype?: string; result?: unknown };
      if (m.type === "result" && (m.is_error || (typeof m.subtype === "string" && m.subtype.startsWith("error")))) {
        errText = typeof m.result === "string" ? m.result : m.subtype || "error";
      }
    }
  } catch (err) {
    errText = (err as Error).message || String(err);
  } finally {
    clearTimeout(timer);
  }
  if (errText) return { ok: false, via, error: errText.slice(0, 300) };
  return { ok: true, via };
}
