/**
 * The runner registry — the single source of truth for backends. Two in-process runners remain:
 * the Claude Agent SDK and the pi SDK. The runner is decided purely by what the provider IS
 * (runnerKindFor in exec.ts) — there is no global runner setting and no CLI shell-out path anymore
 * (the old subprocess runners were the source of silent hangs and env leaks).
 *
 * summarizeTool is re-exported from ./tool-summary.js (its own module, so runners can import it
 * without forming a cycle with this registry).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunner, RunnerKind } from "./interface.js";
import { ClaudeSdkRunner } from "./sdk-claude.js";
import { PiSdkRunner } from "./sdk-pi.js";

// Re-export for back-compat (roleAgent and others import summarizeTool from "./registry.js").
export { summarizeTool } from "./tool-summary.js";

const RUNNERS: Record<RunnerKind, () => AgentRunner> = {
  "claude-sdk": () => new ClaudeSdkRunner(),
  "pi-cli": () => new PiSdkRunner(),
};

/** Resolve the active runner from a kind. Unknown kinds fall back to the Claude SDK. */
export function getRunner(kind: RunnerKind | string): AgentRunner {
  return (RUNNERS[kind as RunnerKind] ?? RUNNERS["claude-sdk"])();
}

/** True if `cmd` is runnable: a path that exists, or a bare name found on $PATH. */
export function binaryAvailable(cmd: string): boolean {
  if (!cmd) return false;
  if (cmd.includes("/")) return existsSync(cmd);
  const dirs = (process.env.PATH || "").split(":").filter(Boolean);
  return dirs.some((d) => existsSync(join(d, cmd)));
}
