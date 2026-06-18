/**
 * ClaudeSdkRunner — the default backend, via @anthropic-ai/claude-agent-sdk. This is a
 * behavior-preserving extraction of roleAgent.ts's proven runQuery loop (issue #63): the body
 * is identical, only reorganized behind the AgentRunner interface. Every side-effect the old
 * loop had (session capture, assistant emit, usage + cost + token-cap accounting, stderr
 * capture, abort) is preserved here.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunner, RunRequest, RunResult } from "./interface.js";

export class ClaudeSdkRunner implements AgentRunner {
  readonly kind = "claude-sdk";

  async run(req: RunRequest, emitAssistant: (message: unknown) => void): Promise<RunResult> {
    let sessionId = "";
    let text = "";
    let turns = 0;
    let costUsd = 0;
    let tokens = 0;
    let capTokens = 0;
    let stopped = "";
    let stderrBuf = "";

    const n = (u: Record<string, unknown>, k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
    const sumUsage = (u: Record<string, unknown>): number =>
      n(u, "input_tokens") + n(u, "output_tokens") + n(u, "cache_creation_input_tokens") + n(u, "cache_read_input_tokens");
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
          ...(req.env ? { env: req.env } : {}),
          ...(req.resumeId ? { resume: req.resumeId } : {}),
          // Fully autonomous. Requires the container to run as a NON-root user (Claude Code
          // refuses --dangerously-skip-permissions as root) — see Dockerfile `USER node`.
          permissionMode: "bypassPermissions",
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
        if (message.type === "assistant") {
          turns += 1;
          emitAssistant(message);
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
        if (req.tokenCap > 0 && capTokens > req.tokenCap) {
          stopped = `token cap (${Math.round(capTokens / 1000)}k > ${Math.round(req.tokenCap / 1000)}k)`;
          break;
        }
      }
    } catch (err) {
      const detail = stderrBuf.trim().split("\n").slice(-3).join(" ").slice(-400);
      throw new Error(`${(err as Error).message ?? String(err)}${detail ? ` | ${detail}` : ""}`);
    }

    return { text, turns, costUsd, tokens, stopped, sessionId: sessionId || undefined };
  }
}
