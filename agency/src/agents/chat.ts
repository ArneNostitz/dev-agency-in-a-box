/**
 * Chat agents (v3): interactive, NON-repo agents (e.g. spec-creator, grill-me). No clone, no
 * branch/PR. The back-and-forth happens in the issue thread; the agent reads the conversation,
 * responds, and — when it has a result — that result + summary is posted to GitHub (per the locked
 * decision). Reuses the same provider/credential routing as the coding roles so GLM/etc. work.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDef } from "../store.js";
import { getGlobalModel, getProviders, setSession, getSession, recordRun, recordRunStep, skillsPrompt } from "../store.js";
import { claudeToken, anthropicApiKey, ghBotToken } from "../creds.js";
import { pushActivity, setActive, clearActive } from "../activity.js";
import { commentOnIssue } from "../github.js";
import { registerRun } from "../abort.js";
import { recallWiring, RECALL_PROMPT } from "./recall.js";
import { MODELS } from "./roles.js";

/** Resolve model + subprocess env for a chat agent (global provider route, else Claude default). */
export function resolveChatExec(modelOverride: string): { model: string; env: Record<string, string> } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  const g = getGlobalModel();
  const provider = g?.providerId ? getProviders().find((p) => p.id === g.providerId) : null;
  if (provider?.baseUrl && provider.apiKey && !modelOverride) {
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
    env.ANTHROPIC_API_KEY = provider.apiKey;
    return { model: modelOverride || g!.model, env };
  }
  // Default: Claude subscription / API key.
  const ct = claudeToken();
  const ak = ct ? "" : anthropicApiKey();
  if (ct) { env.CLAUDE_CODE_OAUTH_TOKEN = ct; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_BASE_URL; }
  else if (ak) { env.ANTHROPIC_API_KEY = ak; delete env.CLAUDE_CODE_OAUTH_TOKEN; delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_BASE_URL; }
  const bot = ghBotToken();
  if (bot) { env.GH_TOKEN = bot; env.GITHUB_TOKEN = bot; }
  return { model: modelOverride || MODELS.sonnet, env };
}

/**
 * Run one turn of a chat agent over the issue thread. Posts the agent's reply to the GitHub thread
 * (so multi-turn interactivity flows through the normal comment → re-engage loop).
 */
export async function runChatAgent(def: AgentDef, repo: string, number: number, thread: string): Promise<void> {
  const { model, env } = resolveChatExec(def.model);
  const cfgDir = mkdtempSync(join(tmpdir(), "chat-cfg-"));
  const workdir = mkdtempSync(join(tmpdir(), "chat-wd-"));
  env.CLAUDE_CONFIG_DIR = cfgDir;
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
    for await (const message of query({
      prompt:
        `### Conversation so far\n${thread}\n\n` +
        `Respond as ${def.name}. If the work is complete, give your final result followed by a short **Summary:** line.`,
      options: {
        cwd: workdir,
        systemPrompt,
        model,
        env,
        allowedTools: [...def.tools, ...rc.tools],
        mcpServers: { ...rc.servers },
        permissionMode: "bypassPermissions",
        maxTurns: 30,
        abortController: abortRun.controller,
        ...(resumeId ? { resume: resumeId } : {}),
        settingSources: [],
        stderr: () => {},
      },
    })) {
      const sid = (message as { session_id?: string }).session_id;
      if (sid) setSession(repo, number, def.name, sid);
      if (message.type === "assistant") {
        turns++;
        const content = (message as { message?: { content?: Array<{ type?: string; text?: string; name?: string }> } }).message?.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === "text" && b.text?.trim()) { text += (text ? "\n\n" : "") + b.text.trim(); pushActivity(repo, number, "chat", "text", b.text.trim().slice(0, 1200)); }
            else if (b.type === "tool_use" && b.name) { pushActivity(repo, number, "chat", "tool", b.name); recordRunStep(repo, number, def.name, b.name, "", true); }
          }
        }
      }
    }
  } finally {
    abortRun.release();
    clearActive(repo, number);
    try { rmSync(cfgDir, { recursive: true, force: true }); } catch { /* noop */ }
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  recordRun(repo, number, def.name, model, turns, "chat", 0);
  // The result + summary goes to GitHub (decision); the interaction itself stayed local.
  if (def.pushesGithub && text.trim()) {
    await commentOnIssue(repo, number, `🗣️ **${def.name}**\n\n${text}`).catch(() => {});
  }
}
