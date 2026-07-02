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
import { getRunner, defaultRunnerKind, runnerBinary, binaryAvailable } from "./registry.js";
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
  /** Optional CLI command template override (Provider.cliCommand is preferred). */
  cliCommand?: string;
}

/**
 * The runner kind for this run: the provider's configured runner, else the global agent_runner
 * setting, else claude-sdk. Pure — exported so callers/tests can predict which backend a run uses.
 */
export function runnerKindFor(provider: Provider | null): RunnerKind {
  const k = (provider && (provider as { runner?: string }).runner) || defaultRunnerKind();
  return k as RunnerKind;
}

/**
 * Resolve + preflight + dispatch one run. The binary preflight FAILS LOUD (never silently swaps the
 * runner) — a selected runner is a deliberate Settings pick; swapping it for claude-sdk would hide a
 * real deploy problem (e.g. `pi` not installed) behind a run that "works" on the wrong backend.
 */
export async function runLLM(opts: LlmRunOptions, emitAssistant: (message: unknown) => void): Promise<RunResult> {
  const kind = runnerKindFor(opts.provider);
  const cliCommand = opts.cliCommand || opts.provider?.cliCommand || undefined;
  const wantBin = runnerBinary(kind, cliCommand);
  if (wantBin && !binaryAvailable(wantBin)) {
    throw new Error(
      `Selected runner "${kind}" can't run — the "${wantBin}" binary isn't installed in this deployment ` +
        `(or pick a different runner for this provider in Settings → Models & runners).`,
    );
  }
  const runner: AgentRunner = getRunner(kind, cliCommand);
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
    template: cliCommand,
  };
  return runner.run(req, emitAssistant);
}
