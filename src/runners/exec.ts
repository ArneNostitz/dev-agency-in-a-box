/**
 * runLLM — the SINGLE funnel every agent invocation goes through (issue #108).
 *
 * Before this, two parallel paths resolved a model into a Claude-SDK-shaped env and ran it:
 *   - roleAgent.resolveRoute + the AgentRunner seam (honored provider.runner)
 *   - chat.resolveChatExec + a raw query() (did NOT — always Claude SDK)
 * so chat/orchestrator/dealer/analyzer ignored Settings → a GLM-via-pi pick silently ran on the SDK.
 *
 * runLLM closes that gap: callers resolve the PROVIDER + MODEL + AUTH (the what); runLLM resolves the
 * RUNNER from provider.runner (else the global default) and dispatches via the registry (the how).
 * Each runner then translates the provider for its own backend (SDK → ANTHROPIC_* env, pi → auth.json).
 * To add a backend: one entry in registry.ts + implement the translation — nothing here or in callers
 * changes. That is the "runners as plugins" contract.
 */
import type { AgentRunner, RunRequest, RunResult, RunnerKind } from "./interface.js";
import { getRunner } from "./registry.js";
import type { Provider } from "../db/providers.js";

export interface LlmRunOptions {
  task: string;
  cwd: string;
  model: string;
  systemPrompt: string;
  /** The resolved provider row (null for a Claude-native/subscription run with no provider row). */
  provider: Provider | null;
  /** How the run authenticates — drives each runner's provider translation. */
  authKind: "subscription" | "apiKey";
  /** Allowed tools (SDK runners) / ignored by CLI runners. */
  allowedTools: string[];
  /** MCP servers (SDK runners). */
  mcpServers?: Record<string, unknown>;
  /** Base env (process env + GH_TOKEN/GIT identity); the runner layers provider auth on top. */
  env?: Record<string, string>;
  /** AbortController from the dashboard "Stop" button. */
  abort: AbortController;
  /** Resume a prior session by id (undefined = fresh). */
  resumeId?: string;
  /** Per-run turn cap. */
  maxTurns: number;
  /** Forward-progress token kill-switch (0 disables). */
  tokenCap: number;
}

/**
 * The runner kind for a run, decided purely by what the provider IS (no global setting, no
 * per-provider runner field):
 *   - Claude-native (authKind "subscription", or no provider row) → claude-sdk (always).
 *   - everything else (a provider with a piKey) → pi-cli.
 */
export function runnerKindFor(provider: Provider | null, authKind?: "subscription" | "apiKey"): RunnerKind {
  if (provider && provider.piKey) return "pi-cli";
  if (authKind === "apiKey" && provider) return "pi-cli";
  return "claude-sdk";
}

/**
 * Resolve + dispatch one run. Both runners are in-process SDKs — no binary preflight needed.
 */
export async function runLLM(opts: LlmRunOptions, emitAssistant: (message: unknown) => void): Promise<RunResult> {
  const kind = runnerKindFor(opts.provider, opts.authKind);
  const runner: AgentRunner = getRunner(kind);
  const req: RunRequest = {
    task: opts.task,
    cwd: opts.cwd,
    model: opts.model,
    allowedTools: opts.allowedTools,
    mcpServers: opts.mcpServers,
    provider: opts.provider,
    authKind: opts.authKind,
    env: opts.env,
    systemPrompt: opts.systemPrompt,
    abort: opts.abort,
    resumeId: opts.resumeId,
    maxTurns: opts.maxTurns,
    tokenCap: opts.tokenCap,
  };
  return runner.run(req, emitAssistant);
}
