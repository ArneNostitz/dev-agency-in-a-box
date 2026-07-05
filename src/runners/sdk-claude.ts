/**
 * ClaudeSdkRunner — the @anthropic-ai/claude-agent-sdk backend. This is a behavior-preserving
 * extraction of roleAgent.ts's proven runQuery loop (issue #63): the body is identical, only
 * reorganized behind the AgentRunner interface. Every side-effect the old loop had (session
 * capture, assistant emit, usage + cost + token-cap accounting, stderr capture, abort) is here.
 *
 * Provider translation (#108): this is the ONLY backend that wants a Claude-shaped env
 * (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY, or the Claude subscription
 * token), so the env-building that used to live in roleAgent.resolveRoute / chat.resolveChatExec
 * moved HERE. Other runners (pi, gemini-cli, …) translate the same Provider row their own way and
 * never see these env vars. One source of truth (the Provider row + creds); per-backend translation.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunner, RunRequest, RunResult } from "./interface.js";
import { claudeToken, anthropicApiKey } from "../creds.js";

/**
 * Build the Claude-shaped env for a run, layered over the base env. Two shapes:
 *  - subscription: a Claude-native run (no provider row / no third-party key) → use the stored
 *    Claude subscription token or Anthropic API key on the DEFAULT endpoint, clearing any
 *    third-party routing so the chosen cred is the only one the SDK sees.
 *  - apiKey: a third-party Anthropic-compatible provider (GLM, DeepSeek, Kimi…) → the provider's
 *    own baseUrl + apiKey, with the subscription token removed so the SDK targets that provider.
 * Exported so the orchestrator/chat paths (which build the same env) share one implementation.
 */
export function claudeRunEnv(
  base: Record<string, string>,
  provider: { baseUrl?: string; apiKey?: string } | null,
  authKind: "subscription" | "apiKey",
): Record<string, string> {
  const env: Record<string, string> = { ...base };
  if (authKind === "apiKey" && provider?.baseUrl && provider.apiKey) {
    delete env.CLAUDE_CODE_OAUTH_TOKEN; // don't use the Claude subscription for this provider
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
    env.ANTHROPIC_API_KEY = provider.apiKey;
    return env;
  }
  // subscription (or a malformed apiKey route — fall back to the subscription default, never 401 silent)
  const ct = claudeToken();
  if (ct) {
    env.CLAUDE_CODE_OAUTH_TOKEN = ct;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_BASE_URL;
  } else {
    const ak = anthropicApiKey();
    if (ak) env.ANTHROPIC_API_KEY = ak;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_BASE_URL;
  }
  return env;
}

export class ClaudeSdkRunner implements AgentRunner {
  readonly kind = "claude-sdk";

  async run(req: RunRequest, emitAssistant: (message: unknown) => void): Promise<RunResult> {
    // Translate the provider into the env this backend wants — isolated config dir per WORKDIR so
    // the SDK authenticates with THIS credential only (never a stale ~/.claude cache on a shared
    // volume). Stable (not a throwaway temp dir): the SDK stores session transcripts under the
    // config dir, so deleting it after every run made `resume: <sessionId>` always fail — that was
    // the "resume starts fresh every time" bug. Reset wipes it via data/claude-cfg.
    const env = claudeRunEnv(req.env ?? {}, req.provider, req.authKind);
    const cfgDir = join(process.cwd(), "data", "claude-cfg", createHash("sha1").update(req.cwd).digest("hex").slice(0, 16));
    try { mkdirSync(cfgDir, { recursive: true }); } catch { /* best effort */ }
    env.CLAUDE_CONFIG_DIR = cfgDir;

    let sessionId = "";
    let text = "";
    let turns = 0;
    let costUsd = 0;
    let tokens = 0;
    let capTokens = 0;
    let stopped = "";
    let stderrBuf = "";

    const n = (u: Record<string, unknown>, k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
    const sumBillable = (u: Record<string, unknown>): number =>
      n(u, "input_tokens") + n(u, "output_tokens") + n(u, "cache_creation_input_tokens");

    try {
      for await (const message of query({
        prompt: req.task,
        options: {
          cwd: req.cwd,
          systemPrompt: req.systemPrompt,
          model: req.model,
          allowedTools: req.allowedTools,
          mcpServers: (req.mcpServers ?? {}) as never,
          env,
          ...(req.resumeId ? { resume: req.resumeId } : {}),
          // Fully autonomous. Requires the container to run as a NON-root user (Claude Code
          // refuses --dangerously-skip-permissions as root) — see Dockerfile `USER node`.
          permissionMode: "bypassPermissions",
          includePartialMessages: true,
          maxTurns: req.maxTurns,
          abortController: req.abort,
          stderr: (data: string) => {
            stderrBuf += data;
          },
          settingSources: [],
        },
      })) {
        const sid = (message as { session_id?: string }).session_id;
        if (sid) sessionId = sid;
        if (message.type === "stream_event") {
          // Partial assistant text as it's generated — gives the live feed a "typing" pulse during a
          // long turn instead of a frozen "still working". Forwarded as a delta (not persisted).
          const ev = (message as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
            emitAssistant({ type: "stream_delta", delta: ev.delta.text } as unknown);
          }
          continue;
        }
        if (message.type === "assistant") {
          turns += 1;
          emitAssistant(message);
          const au = (message as unknown as { message?: { usage?: Record<string, unknown> } }).message?.usage;
          if (au) {
            // Billable tokens (input + output + cache-CREATION). We deliberately EXCLUDE
            // cache_read_input_tokens here: cached context is re-read every turn, so summing it
            // per-turn balloons the count into the millions while costing almost nothing — a
            // misleading "2.7M tokens" on a cheap run. Cost still comes from total_cost_usd.
            const billable = sumBillable(au);
            tokens += billable;
            capTokens += billable;
          }
        }
        else if (message.type === "user") {
          // Tool results come back as user messages — surface a short preview so the stream shows what
          // a Read/Bash/MCP call actually returned, not just that it was invoked.
          const uc = (message as { message?: { content?: unknown[] } }).message?.content;
          if (Array.isArray(uc)) for (const b of uc as Array<{ type?: string; content?: unknown; is_error?: boolean }>) {
            if (b.type === "tool_result") {
              const txt = Array.isArray(b.content) ? (b.content as Array<{ text?: string }>).map((x) => x.text || "").join(" ") : String(b.content ?? "");
              const prev = txt.replace(/\s+/g, " ").trim().slice(0, 200);
              if (prev) emitAssistant({ type: "assistant", message: { content: [{ type: "text", text: `${b.is_error ? "⚠ " : "↳ "}${prev}` }] } });
            }
          }
        }
        if ("result" in message && typeof (message as { result?: unknown }).result === "string") {
          text = (message as { result: string }).result;
        }
        const cost = (message as { total_cost_usd?: unknown }).total_cost_usd;
        if (typeof cost === "number" && Number.isFinite(cost)) costUsd = cost;
        if (req.tokenCap > 0 && capTokens > req.tokenCap) {
          stopped = `token cap (${Math.round(capTokens / 1000)}k > ${Math.round(req.tokenCap / 1000)}k)`;
          break;
        }
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // Hitting the turn backstop is NOT a failure — degrade gracefully like the token cap below:
      // keep the partial text + a `stopped` reason so the run finishes (and can be resumed) instead
      // of surfacing a red "Reached maximum number of turns" ERROR. The real guard is the token cap.
      if (/maximum number of turns/i.test(msg)) {
        return { text, turns, costUsd, tokens, stopped: stopped || `turn cap (${turns} turns)`, sessionId: sessionId || undefined };
      }
      const detail = stderrBuf.trim().split("\n").slice(-3).join(" ").slice(-400);
      throw new Error(`${msg}${detail ? ` | ${detail}` : ""}`);
    }

    return { text, turns, costUsd, tokens, stopped, sessionId: sessionId || undefined };
  }
}
