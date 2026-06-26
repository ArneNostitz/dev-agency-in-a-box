/**
 * Runs any role as a Claude Agent SDK query, assembling its system prompt from the
 * editable vault (persona + constitution + the role's playbooks) and using the role's
 * configured tools and model. This is the single entry point every specialist uses.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getRunner, defaultRunnerKind, summarizeTool, runnerBinary, binaryAvailable } from "../runners/registry.js";
import type { RunRequest } from "../runners/interface.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { ROLES, modelFor, canonicalModel, type RoleName } from "./roles.js";
import { tierModel, getIssueProvider, getIssueAgentModels, parseModelRef, fallbackFor, getIssueUseFallback, type Tier } from "../db/providers.js";
import { loadConstitution, loadPersona, loadPlaybooks, loadLearned } from "../memory.js";
import { pushActivity } from "../activity.js";
import { recentLessons, recordTokens, recordRunStep, getProviders, getRoleModels, getSessionFallback, setSession, getIssueModelOverride, getGlobalModel, addIssueFiles } from "../store.js";
import { addClaimFiles } from "../locks.js";
import { coordinationContext } from "../coordination.js";
import { loadBudget } from "../budget.js";
import { gitnexusWiring, GITNEXUS_PROMPT } from "../gitnexus.js";
import { recallWiring, RECALL_PROMPT } from "./recall.js";
import { claudeToken, anthropicApiKey, ghBotToken, githubIdentity } from "../creds.js";
import { noreplyEmail } from "../github-oauth.js";
import { providerAuth } from "./provider-auth.js";
import { registerRun, isStopRequested, takeSteer } from "../abort.js";
import { runHooks } from "../hooks.js";

/**
 * Per-role model routing. Checks (in order):
 *   1. Per-issue override (chatbox model picker — one-shot, cleared after the run)
 *   2. Per-role assignment (dashboard "Models" panel)
 *   3. Global default setting
 *   4. Session-level fallback (temporary auto-switch on rate limit — cleared after the retry)
 * Returns the model + an env that points this run at the provider's Anthropic-compatible
 * endpoint — leaving every other role (and the default) on your Claude subscription untouched.
 */
// Parse a "providerId/model" string (workflow step.model or an explicit pick) into {providerId, model}.
function parseModelStr(s: string | undefined): { providerId: string; model: string } | null {
  if (!s) return null;
  const i = s.indexOf("/");
  if (i <= 0) return null;
  return { providerId: s.slice(0, i), model: s.slice(i + 1) };
}
// The single source of truth for "which provider+model + which runner + which env" a run uses.
// `explicitModel` (a "providerId/model" string from a workflow step or per-issue pick) wins; else the
// per-issue → per-role → global hierarchy. Crucially this keeps the PROVIDER attached, so the runner
// and env always match the chosen model (the bug: an explicit model used to drop its provider and
// default to the Claude SDK, so GLM/Gemini runs errored).
const TIERS: ReadonlySet<string> = new Set(["high", "medium", "low"]);
function resolveAssignment(role: RoleName, repo: string, issueNumber: number, explicitModel?: string, agentKey?: string): { providerId: string; model: string } | null {
  // 1) PER-AGENT override on the issue wins (set on the timeline). Key by the custom handle or role.
  const agentModels = getIssueAgentModels(repo, issueNumber);
  const ak = (agentKey || role).toLowerCase();
  const perAgent = parseModelRef(agentModels[ak] || agentModels["@" + ak] || agentModels[role]);
  if (perAgent) return perAgent;
  // 2) The step's explicit selection: a TIER keyword resolves against the issue's provider; or a
  //    concrete "providerId/model" ref; otherwise fall through.
  const issueProvider = getIssueProvider(repo, issueNumber);
  if (explicitModel && TIERS.has(explicitModel.toLowerCase())) {
    const pid = issueProvider || getGlobalModel()?.providerId;
    if (pid) { const tm = tierModel(pid, explicitModel.toLowerCase() as Tier); if (tm) return tm; }
  }
  const fromStr = parseModelStr(explicitModel);
  if (fromStr) return fromStr;
  // 3) The issue-wide provider (no explicit tier on the step) → its medium tier as a sane default.
  if (issueProvider) { const tm = tierModel(issueProvider, "medium"); if (tm) return tm; }
  // 4) Existing hierarchy: per-issue model → per-role → global → session fallback.
  const a = getIssueModelOverride(repo, issueNumber) ?? getRoleModels()[role] ?? getGlobalModel();
  if (a?.providerId && a.model) return { providerId: a.providerId, model: a.model };
  const fb = getSessionFallback();
  return fb?.providerId && fb.model ? { providerId: fb.providerId, model: fb.model } : null;
}
function resolveRoute(role: RoleName, repo: string, issueNumber: number, explicitModel?: string, agentKey?: string): { model: string; env: Record<string, string>; providerId: string } | null {
  const assignment = resolveAssignment(role, repo, issueNumber, explicitModel, agentKey);
  if (!assignment?.providerId || !assignment.model) return null;
  const p = getProviders().find((x) => x.id === assignment.providerId);
  const ct = claudeToken();
  const ak = anthropicApiKey();
  const auth = providerAuth(p, Boolean(ct || ak));
  if (auth === "missing") return null; // preflight explains what's wrong
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  if (auth === "subscription") {
    // Claude-native provider (e.g. "Claude (Subscription)"): honor the SELECTED model but auth via
    // the stored Claude OAuth token (or Anthropic API key) on the default endpoint — NOT a key on
    // the provider row (it has none). Clear any conflicting third-party env so the cred is the only
    // one the SDK sees.
    if (ct) {
      env.CLAUDE_CODE_OAUTH_TOKEN = ct;
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.ANTHROPIC_BASE_URL;
    } else {
      env.ANTHROPIC_API_KEY = ak;
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.ANTHROPIC_BASE_URL;
    }
    return { model: assignment.model, env, providerId: assignment.providerId };
  }
  // Third-party Anthropic-compatible provider: its own key + endpoint.
  delete env.CLAUDE_CODE_OAUTH_TOKEN; // don't use the Claude subscription for this provider
  env.ANTHROPIC_BASE_URL = p!.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = p!.apiKey;
  env.ANTHROPIC_API_KEY = p!.apiKey;
  return { model: assignment.model, env, providerId: assignment.providerId };
}

// summarizeTool now lives in src/runners/registry.ts (the one shared copy — issue #61).

/** Pull readable text + tool summaries out of an assistant message's content blocks. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** Repo-relative path for a tool's file_path (strip the temp clone's workdir prefix). */
function relPath(p: string, workdir: string): string {
  let r = String(p || "");
  if (workdir && r.startsWith(workdir)) r = r.slice(workdir.length);
  return r.replace(/^\.?\/+/, "").replace(/\\/g, "/");
}
function emitAssistant(repo: string, number: number, role: RoleName, message: unknown, workdir = ""): void {
  const content = (message as { message?: { content?: unknown[] } }).message?.content;
  if (!Array.isArray(content)) return;
  const edited: string[] = [];
  for (const block of content as Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }>) {
    if (block.type === "text" && block.text?.trim()) {
      pushActivity(repo, number, role, "text", block.text.trim().slice(0, 1200));
    } else if (block.type === "tool_use" && block.name) {
      pushActivity(repo, number, role, "tool", summarizeTool(block.name, block.input));
      recordRunStep(repo, number, role, block.name, summarizeTool(block.name, block.input)); // v3 telemetry
      // LIVE FOOTPRINT: record files actually edited (catches what the planner didn't declare).
      if (WRITE_TOOLS.has(block.name)) {
        const fp = block.input && (block.input.file_path ?? block.input.notebook_path);
        if (typeof fp === "string" && fp.trim()) edited.push(relPath(fp, workdir));
      }
    }
  }
  if (edited.length) {
    try {
      addIssueFiles(repo, number, edited); // persist the real footprint
      const { overlap } = addClaimFiles(repo, number, edited); // extend the live lock
      if (overlap) pushActivity(repo, number, role, "tool", `⚠️ also editing \`${overlap.file}\` which #${overlap.number} is working on — coordinate to avoid clobbering its work`);
    } catch { /* best effort — never break a run on bookkeeping */ }
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
  /** A custom agent definition (a workflow step naming a non-built-in handle like @grill). When set,
   *  its persona drives the system prompt and its handle labels the activity, while `role` only
   *  supplies sensible tool/pipeline defaults. */
  agentDef?: { handle: string; name: string; persona: string; model?: string };
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

async function buildSystemPrompt(role: RoleName, customPersona?: string): Promise<string> {
  const def = ROLES[role];
  const [persona0, constitution, playbooks, learned] = await Promise.all([
    loadPersona(def.personaFile),
    loadConstitution(),
    loadPlaybooks(def.playbooks),
    loadLearned(def.personaFile),
  ]);
  const persona = (customPersona && customPersona.trim()) ? customPersona : persona0;
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
  // HARD STOP: if the user pressed Stop on this issue, NO further agent may start — regardless of
  // which pipeline/workflow path called us. This is the single chokepoint that makes "Stop" mean
  // "cut everything now: no next agent, no next step". The flag is cleared only on an explicit
  // start/resume. (stopRuns() already aborted the in-flight SDK run; this stops the NEXT one.)
  if (isStopRequested(input.repo, input.issueNumber)) {
    pushActivity(input.repo, input.issueNumber, role, "done", "■ Stopped — skipped (issue was stopped by you).");
    return { text: "", turns: 0, model: "", costUsd: 0, tokens: 0, stopped: "user-stop" } as RoleRunResult;
  }
  // Fold any queued chat STEER (user interrupted to nudge/redirect) into this step's task so the
  // agent reads it. Taken once — consumed here so it's applied to exactly the next step that runs.
  const steers = takeSteer(input.repo, input.issueNumber);
  if (steers.length) {
    const NL = "\n";
    input.task = input.task + NL + NL + "[user steer — incorporate this before proceeding]" + NL + steers.join(NL);
    pushActivity(input.repo, input.issueNumber, role, "text", "\u21aa Folding in your steer: " + steers.join(" / ").slice(0, 160));
  }
  const def = ROLES[role];
  // Hand the agent the GitNexus code-intelligence tools if this clone is indexed (cuts the
  // tokens spent reading files to research the codebase).
  const gn = gitnexusWiring(input.workdir);
  // The agency's own memory (past plans/lessons/reviews/issues) as an on-demand tool — so the agent
  // can PULL context when stuck instead of us pushing the whole thread into every prompt.
  const rc = recallWiring(input.repo);
  const systemPrompt = (await buildSystemPrompt(role, input.agentDef?.persona)) + (gn ? `\n\n${GITNEXUS_PROMPT}` : "") + `\n\n${RECALL_PROMPT}`;
  // Per-role provider routing (keeps Claude roles on your subscription; others go to e.g. GLM).
  const agentKey = input.agentDef?.handle?.replace(/^@/, "") || role;
  let route = resolveRoute(role, input.repo, input.issueNumber, input.model, agentKey);
  // If the human EXPLICITLY selected a model but it couldn't be routed (provider missing/has no API
  // key/base URL), do NOT silently fall back to the Claude subscription — that masks the problem as
  // a Claude rate-limit later. Fail loudly so the dashboard shows what's wrong.
  if (!route) {
    const sel = resolveAssignment(role, input.repo, input.issueNumber, input.model, agentKey);
    if (sel?.providerId && sel.model) {
      const p = getProviders().find((x) => x.id === sel.providerId);
      // route is null only when providerAuth() == "missing". Distinguish a Claude-native provider
      // (needs a subscription token / Anthropic key) from a third-party one (needs key + baseUrl).
      const claudeNative = !p || (!p.apiKey && !p.baseUrl);
      const why = !p
        ? "its provider no longer exists"
        : claudeNative
          ? `no Claude subscription token or Anthropic API key is saved — add it in Settings → Models`
          : !p.apiKey
            ? `no API key is saved for "${p.name}"`
            : !p.baseUrl
              ? `no base URL is set for "${p.name}"`
              : "the provider is misconfigured";
      const msg = `Selected model "${sel.model}" can't run — ${why} (or pick a different model).`;
      pushActivity(input.repo, input.issueNumber, role, "done", `❌ ${msg}`);
      throw new Error(msg);
    }
  }
  let model = canonicalModel(route?.model ?? input.model ?? modelFor(def));
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
      // Attribute the agent's commits to the connected GitHub account (overrides the image's default
      // git identity) so commits/PRs link to it — no separate bot identity needed.
      const ident = githubIdentity();
      if (ident) {
        const email = noreplyEmail(ident.id, ident.login);
        runEnv.GIT_AUTHOR_NAME = ident.name;
        runEnv.GIT_AUTHOR_EMAIL = email;
        runEnv.GIT_COMMITTER_NAME = ident.name;
        runEnv.GIT_COMMITTER_EMAIL = email;
      }
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

  const assignment = resolveAssignment(role, repo, issueNumber, input.model, agentKey);
  const provider = assignment?.providerId ? getProviders().find((x) => x.id === assignment.providerId) : null;
  const providerName = provider ? provider.name : "Claude/Anthropic Subscription";
  const baseUrl = provider ? provider.baseUrl : "https://api.anthropic.com";
  console.log(`[LLM Call] Invoking LLM for role '${role}' on ${repo}#${issueNumber} using model '${model}' via provider '${providerName}' at URL: ${baseUrl}`);
  pushActivity(repo, issueNumber, role, "text", `🤖 LLM Call: ${model} via ${providerName} (${baseUrl})`);

  // Register this run so the dashboard "Stop" can abort it (and every other role run on the issue).
  const abortRun = registerRun(repo, issueNumber);
  // Heartbeat: a single long command (e.g. a slow `pip install` / venv setup) prints nothing until
  // it returns, so the live stream can look frozen/"stuck". Emit a line each minute so it's clearly
  // still alive (and tells you how long it's been on the current step).
  const runStartedAt = Date.now();
  // Inactivity watchdog: a healthy run streams assistant/tool messages; a hung provider (e.g. an
  // unreachable Anthropic-compatible proxy) connects but emits NOTHING, so the run would spin on
  // "still working" until a redeploy. If no message arrives for this long, abort with a clear error.
  let lastMsgAt = Date.now();
  let inactiveAborted = false;
  const INACTIVITY_MS = (Number(process.env.RUN_INACTIVITY_MIN?.trim()) || 6) * 60_000;
  const heartbeat = setInterval(() => {
    if (Date.now() - lastMsgAt > INACTIVITY_MS && !abortRun.controller.signal.aborted) {
      inactiveAborted = true;
      pushActivity(repo, issueNumber, role, "done", `⏱ No output from ${route ? `the provider model (${model})` : "Claude"} for ${Math.round(INACTIVITY_MS / 60000)}m — aborting. Likely an unreachable endpoint or wrong model id; check Settings → Models.`);
      try { abortRun.controller.abort(); } catch { /* noop */ }
      return;
    }
    pushActivity(repo, issueNumber, role, "tool", `⏳ still working… (${Math.round((Date.now() - runStartedAt) / 60000)}m on this step)`);
  }, 60_000);
  // For 401s, name the credential actually used + the likely fixes (this is the #1 support issue).
  const credVia = route ? `the provider model (${model})` : claudeToken() ? "your Claude subscription token" : anthropicApiKey() ? "your Anthropic API key" : "the container-env credential";
  const authAdvice = (msg: string): string =>
    /401|authenticat|bearer|x-api-key|invalid[_ ]?(api[_ ]?)?key/i.test(msg)
      ? ` — auth failed using ${credVia}. Re-check it in Settings (no spaces, correct type), and confirm MASTER_KEY hasn't changed since you saved it (a changed key makes stored tokens undecryptable, then it silently falls back to a stale env token).`
      : "";

  /** One attempt; pass a session id to resume an interrupted run, else a fresh run. */
  async function runQuery(resumeId?: string): Promise<{ text: string; turns: number; costUsd: number; tokens: number; stopped: string; sessionId?: string }> {
    // Route through the AgentRunner seam (#63): the backend is a swappable adapter. Default
    // claude-sdk (the verbatim port of this loop into ClaudeSdkRunner); per-provider / global
    // setting can switch to a CLI runner (pi, claude-cli, gemini, custom).
    const rt = route; const providerRow = rt?.providerId ? getProviders().find((x) => x.id === rt.providerId) : null;
    let runnerKind = (providerRow && (providerRow as { runner?: string }).runner) || defaultRunnerKind();
    const cliCommand = (providerRow && (providerRow as { cliCommand?: string }).cliCommand) || undefined;
    // Preflight: a CLI runner needs its binary on PATH. If it's missing (e.g. `pi` isn't installed
    // in the deploy), fall back to the built-in SDK runner — which drives ANY Anthropic-compatible
    // provider (incl. GLM/Zhipu) directly — instead of dying with a raw "spawn <cmd> ENOENT".
    const wantBin = runnerBinary(runnerKind, cliCommand);
    if (wantBin && !binaryAvailable(wantBin)) {
      pushActivity(repo, issueNumber, role, "tool", `⚠️ "${wantBin}" not found on PATH — using the built-in SDK runner instead (install ${wantBin}, or set the runner to "claude-sdk" in Settings → Pipeline).`);
      runnerKind = "claude-sdk";
    }
    const runner = getRunner(runnerKind, cliCommand);
    const req: RunRequest = {
      task: input.task + coordinationContext(repo, issueNumber, role),
      cwd: input.workdir,
      model,
      allowedTools: [...def.tools, ...(gn?.tools ?? []), ...rc.tools],
      mcpServers: { ...(gn?.servers ?? {}), ...rc.servers },
      env: runEnv,
      systemPrompt,
      abort: abortRun.controller,
      resumeId,
      maxTurns,
      tokenCap,
      template: cliCommand,
    };
    const r = await runner.run(req, (message) => {
      // emitAssistant callback: same side-effects the old inline loop had (SDK path),
      // plus pi-cli streaming (text deltas + tool summaries → live activity feed).
      lastMsgAt = Date.now(); // any message = the run is alive (feeds the inactivity watchdog)
      const sid = (message as { session_id?: string }).session_id;
      if (sid) sessionId = sid;
      const m = message as { type?: string; delta?: string; summary?: string };
      if (m.type === "assistant") {
        emitAssistant(repo, issueNumber, role, message, input.workdir);
      } else if (m.type === "stream_delta" && typeof m.delta === "string") {
        // SDK partial-text fragment — live "typing" feed only, not persisted (final assistant text wins).
        pushActivity(repo, issueNumber, role, "delta", m.delta);
      } else if (m.type === "text_delta" && typeof m.delta === "string") {
        pushActivity(repo, issueNumber, role, "text", m.delta);
      } else if (m.type === "tool" && typeof m.summary === "string") {
        pushActivity(repo, issueNumber, role, "tool", m.summary);
      }
    });
    if (r.sessionId) sessionId = r.sessionId;
    return r;
  }

  /** User pressed Stop: the SDK throws an AbortError — return cleanly, never retry. */
  const wasAborted = (): boolean => abortRun.controller.signal.aborted;

  // Pre-hook: deterministic steps the orchestrator runs before the agent (zero tokens).
  await runHooks(role, "pre", input.workdir, (s) => pushActivity(repo, issueNumber, role, "tool", s)).catch(() => {});

  // GRACEFUL FALLBACK: if the run errors (not a user stop) and the issue allows it, step to the
  // selected model's fallback (defined per provider tier) and retry — best → worse — until one works
  // or there are no more fallbacks. Disable per issue to stay on the chosen model and fail hard.
  const useFallback = getIssueUseFallback(repo, issueNumber);
  const triedModels = new Set<string>([`${route?.providerId}/${model}`]);
  async function attempt(resumeId?: string): Promise<{ text: string; turns: number; costUsd: number; tokens: number; stopped: string; sessionId?: string }> {
    try {
      return await runQuery(resumeId);
    } catch (e) {
      if (wasAborted()) throw e;
      // Try the fallback model if allowed and one exists that we haven't tried.
      if (useFallback && route) {
        const fb = fallbackFor(route.providerId, route.model);
        const key = fb ? `${fb.providerId}/${fb.model}` : "";
        if (fb && key && !triedModels.has(key)) {
          triedModels.add(key);
          const nr = resolveRoute(role, repo, issueNumber, `${fb.providerId}/${fb.model}`, agentKey);
          if (nr) {
            route = nr; model = canonicalModel(nr.model); runEnv = nr.env;
            pushActivity(repo, issueNumber, role, "tool", `↘ ${(e as Error).message.slice(0, 80)} — falling back to ${model} (${getProviders().find((x) => x.id === nr.providerId)?.name || nr.providerId})`);
            return attempt(undefined); // fresh run on the fallback model
          }
        }
      }
      throw e;
    }
  }

  let r: { text: string; turns: number; costUsd: number; tokens: number; stopped: string };
  try {
    try {
      r = await attempt(input.resumeSessionId);
    } catch (err) {
      if (wasAborted()) {
        if (inactiveAborted) throw new Error(`No response from ${route ? `the provider model (${model})` : "Claude"} for ${Math.round(INACTIVITY_MS / 60000)} minutes — the endpoint may be unreachable or the model id wrong.`);
        pushActivity(repo, issueNumber, role, "done", "⏹ stopped by user");
        return { text: "", turns: 0, model, costUsd: 0 };
      }
      // Resume failed? fall back to a fresh run so a bad/missing session never wedges the issue.
      if (input.resumeSessionId) {
        console.warn(`[agency] role:${role} ${repo}#${issueNumber} resume failed — fresh: ${(err as Error).message.slice(0, 140)}`);
        pushActivity(repo, issueNumber, role, "tool", "↻ couldn't resume the prior session — starting fresh");
        try {
          r = await attempt(undefined);
        } catch (err2) {
          if (wasAborted()) {
            if (inactiveAborted) throw new Error(`No response from ${route ? `the provider model (${model})` : "Claude"} for ${Math.round(INACTIVITY_MS / 60000)} minutes — the endpoint may be unreachable or the model id wrong.`);
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
  // Post-hook: deterministic steps after the agent (zero tokens).
  await runHooks(role, "post", input.workdir, (s) => pushActivity(repo, issueNumber, role, "tool", s)).catch(() => {});
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
  // Isolate the test in a throwaway config dir so the CLI authenticates with THIS token only — not a
  // stale ~/.claude credential cached on the (possibly shared) data volume. Makes the test a true
  // check of the token itself; if it passes here but agents still 401, the shared cache is the cause.
  const cfgDir = mkdtempSync(pathJoin(tmpdir(), "claude-test-"));
  runEnv.CLAUDE_CONFIG_DIR = cfgDir;
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
    try { rmSync(cfgDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  if (errText) return { ok: false, via, error: errText.slice(0, 300) };
  return { ok: true, via };
}
