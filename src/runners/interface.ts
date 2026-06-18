/**
 * The AgentRunner seam (architecture review, Candidate 4 / issue #63) — the single interface
 * every role's execution goes through, so the backend (Claude SDK, pi CLI, gemini CLI, any
 * subprocess) is a swappable adapter instead of a hard-wired call. The agency uses external
 * tools AS TOOLS; it does not assimilate them (pi = the CliRunner subprocess, never in-process).
 *
 * Shape: callback-based (emitAssistant), matching the proven roleAgent.runQuery path — a
 * behavior-preserving extraction, not a rewrite. A future deepening could turn this into
 * `run(req): AsyncIterable<RunEvent>`; that's deferred (it's a render change, not needed for
 * the pluggability goal).
 */
// AbortController is a global (lib es2022); no import needed.

/** Everything a runner needs to execute one role turn. */
export interface RunRequest {
  task: string;
  cwd: string;
  /** The model id the runner resolves (SDK runners pass it to the SDK; CLI runners template it). */
  model: string;
  /** Allowed tool names (SDK runners) or ignored (CLI runners — the CLI picks its own tools). */
  allowedTools: string[];
  /** MCP servers (SDK runners only). */
  mcpServers?: Record<string, unknown>;
  /** Extra env (e.g. ANTHROPIC_BASE_URL for a routed provider). */
  env?: Record<string, string>;
  /** System prompt assembled from the editable vault. */
  systemPrompt: string;
  /** Abort signal from the dashboard "Stop" button. */
  abort: AbortController;
  /** Resume a prior session by id (undefined = fresh run). */
  resumeId?: string;
  /** Per-run turn cap. */
  maxTurns: number;
  /** Forward-progress token kill-switch (0 disables). */
  tokenCap: number;
}

/** What a runner returns. roleAgent does the accounting (recordTokens/setSession/pushActivity). */
export interface RunResult {
  text: string;
  turns: number;
  costUsd: number;
  tokens: number;
  /** Non-empty if the run hit the token cap (roleAgent surfaces it). */
  stopped: string;
  /** Session id for resume (SDK runners). */
  sessionId?: string;
}

/** The contract every backend satisfies. */
export interface AgentRunner {
  readonly kind: string;
  run(req: RunRequest, emitAssistant: (message: unknown) => void): Promise<RunResult>;
}

/** Runner type strings (stored on Provider.runner / the agent_runner setting). */
export type RunnerKind = "claude-sdk" | "claude-cli" | "pi-cli" | "custom-cli";
