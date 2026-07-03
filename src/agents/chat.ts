/**
 * Chat agents (v3): interactive, NON-repo agents (e.g. spec-creator, grill-me). No clone, no
 * branch/PR. The back-and-forth happens in the issue thread; the agent reads the conversation,
 * responds, and — when it has a result — that result + summary is posted to GitHub (per the locked
 * decision). Honors the same provider/credential routing AND the same runner seam (runLLM) as the
 * coding roles — so a GLM-via-pi pick runs on pi here too, not silently on the Claude SDK (#108).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDef } from "../store.js";
import type { Provider } from "../db/providers.js";
import { getGlobalModel, getProviders, getIssueModelOverride, getSessionFallback, setSession, getSession, recordRun, recordRunStep, skillsPrompt } from "../store.js";
import { claudeToken, anthropicApiKey, ghBotToken } from "../creds.js";
import { pushActivity, setActive, clearActive } from "../activity.js";
import { commentOnIssue } from "../github.js";
import { registerRun } from "../abort.js";
import { recallWiring, RECALL_PROMPT } from "./recall.js";
import { providerAuth } from "./provider-auth.js";
import { MODELS, canonicalModel } from "./roles.js";
import { runLLM } from "../runners/exec.js";

/** A resolved chat run: which provider + model + how to authenticate. Mirrors roleAgent.resolveRoute. */
export interface ChatExec {
  model: string;
  provider: Provider | null;
  authKind: "subscription" | "apiKey";
}

/**
 * Resolve model + provider + auth for a chat agent (the WHAT — runLLM does the HOW, picking the runner
 * from provider.runner). This used to build a Claude-shaped env and the callers ran a raw query(), which
 * ignored Settings → GLM-via-pi chat silently ran on the SDK. Now it returns the route and runLLM honors it.
 *
 * `pick` — a resolved {providerId, model} — is the model the run should actually use: the per-issue
 * chatbox override, the session auto-switch fallback, or the global Settings model. Without a pick — the
 * orchestrator/dealer/analyzer global callers, or nothing configured — it keeps the original
 * global-provider-or-Claude-default behaviour.
 */
export function resolveChatExec(
  modelOverride: string,
  pick?: { providerId: string; model: string } | null,
): ChatExec {
  // A deliberate model pick routes at that specific provider — honoring the model chosen in the chat
  // or Settings rather than the global default.
  if (pick?.providerId && pick.model) {
    const p = getProviders().find((x) => x.id === pick.providerId) || null;
    if (providerAuth(p, Boolean(claudeToken() || anthropicApiKey())) === "apiKey" && p) {
      return { model: canonicalModel(pick.model), provider: p, authKind: "apiKey" };
    }
    return { model: canonicalModel(pick.model), provider: null, authKind: "subscription" }; // Claude-native pick
  }

  const g = getGlobalModel();
  const provider = g?.providerId ? getProviders().find((p) => p.id === g.providerId) : null;
  if (provider?.baseUrl && provider.apiKey && !modelOverride) {
    return { model: canonicalModel(modelOverride || g!.model), provider, authKind: "apiKey" };
  }
  // No deliberate pick and no configured global provider. Only proceed on a real Claude credential
  // (saved OR env — the local-dev escape hatch). Otherwise REFUSE: there is no model to run on, and
  // silently defaulting to Claude was the hardcoded-Claude leak. Callers degrade gracefully.
  const hasClaudeCred = Boolean(claudeToken() || anthropicApiKey());
  if (!hasClaudeCred) {
    throw new Error("No model is set up — add a provider in Settings → Models.");
  }
  return { model: canonicalModel(modelOverride || MODELS.sonnet), provider: null, authKind: "subscription" };
}

/** Base env for a chat/orchestrator/dealer run: process env + the agency bot token. */
export function chatBaseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  const bot = ghBotToken();
  if (bot) { env.GH_TOKEN = bot; env.GITHUB_TOKEN = bot; }
  return env;
}

/**
 * Run one turn of a chat agent over the issue thread. Posts the agent's reply to the GitHub thread
 * (so multi-turn interactivity flows through the normal comment → re-engage loop).
 */
export async function runChatAgent(def: AgentDef, repo: string, number: number, thread: string): Promise<void> {
  // Respect Settings + the chatbox pick (mirrors the role routing): the per-issue override chosen in
  // the chat → the session auto-switch fallback (rate-limit offload) → the global Settings model → the
  // agent's configured default. The RUNNER now comes from provider.runner via runLLM (not a raw query).
  const pick = getIssueModelOverride(repo, number) ?? getSessionFallback() ?? getGlobalModel();
  let model = "", provider: Provider | null = null, authKind: "subscription" | "apiKey" = "subscription";
  try {
    const resolved = resolveChatExec(def.model, pick);
    model = resolved.model; provider = resolved.provider; authKind = resolved.authKind;
  } catch (e) {
    // No model configured — surface it on the issue thread instead of silently invoking Claude.
    pushActivity(repo, number, "chat", "done", `❌ ${(e as Error).message}`);
    throw e;
  }
  const workdir = mkdtempSync(join(tmpdir(), "chat-wd-"));
  const rc = recallWiring(repo);
  const skills = skillsPrompt(def.skills);
  const systemPrompt = `${def.persona}\n\nYou are an INTERACTIVE chat agent: no code changes, no branches, no PRs. Hold a focused conversation. ${RECALL_PROMPT}${skills ? "\n\n" + skills : ""}`;
  const abortRun = registerRun(repo, number);
  setActive(repo, number, "issue", "chat", def.name);
  pushActivity(repo, number, "chat", "start", `started ${def.name} (${model})`);
  let text = "";
  let turns = 0;
  const resumeId = getSession(repo, number, def.name) || undefined;
  try {
    const r = await runLLM(
      {
        task:
          `### Conversation so far\n${thread}\n\n` +
          `Respond as ${def.name}. If the work is complete, give your final result followed by a short **Summary:** line.`,
        cwd: workdir,
        model,
        provider,
        authKind,
        allowedTools: [...def.tools, ...rc.tools],
        mcpServers: { ...rc.servers },
        env: chatBaseEnv(),
        systemPrompt,
        abort: abortRun.controller,
        resumeId,
        maxTurns: 30,
        tokenCap: 0,
      },
      (message) => {
        const sid = (message as { session_id?: string }).session_id;
        if (sid) setSession(repo, number, def.name, sid);
        const m = message as { type?: string; delta?: string };
        if (m.type === "assistant") {
          const content = (message as { message?: { content?: Array<{ type?: string; text?: string; name?: string }> } }).message?.content;
          if (Array.isArray(content)) {
            for (const b of content) {
              if (b.type === "text" && b.text?.trim()) { text += (text ? "\n\n" : "") + b.text.trim(); pushActivity(repo, number, "chat", "text", b.text.trim().slice(0, 1200)); }
              else if (b.type === "tool_use" && b.name) { pushActivity(repo, number, "chat", "tool", b.name); recordRunStep(repo, number, def.name, b.name, "", true); }
            }
          }
        } else if (m.type === "stream_delta" && typeof m.delta === "string") {
          pushActivity(repo, number, "chat", "delta", m.delta);
        }
      },
    );
    turns = r.turns;
  } finally {
    abortRun.release();
    clearActive(repo, number);
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  recordRun(repo, number, def.name, model, turns, "chat", 0);
  // The result + summary goes to GitHub (decision); the interaction itself stayed local.
  if (def.pushesGithub && text.trim()) {
    await commentOnIssue(repo, number, `🗣️ **${def.name}**\n\n${text}`).catch(() => {});
  }
}
