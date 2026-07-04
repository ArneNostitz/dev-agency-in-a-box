/**
 * The runner registry. Picks the backend from a RunnerKind (default claude-sdk), with an optional
 * custom CLI template. Provider.runner overrides per provider; the global agent_runner /
 * agent_cli_command settings are the fallback.
 *
 * summarizeTool is re-exported from ./tool-summary.js (its own module, so runners can import it
 * without forming a cycle with this registry).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sStr } from "../settings.js";
import type { AgentRunner, RunnerKind } from "./interface.js";
import { ClaudeSdkRunner } from "./sdk-claude.js";
import { CliRunner, CLI_TEMPLATES } from "./cli.js";
import { PiSdkRunner } from "./sdk-pi.js";

// Re-export for back-compat (roleAgent and others import summarizeTool from "./registry.js").
export { summarizeTool } from "./tool-summary.js";

/**
 * Runner registry — the single source of truth for backends. To add a runner: add one entry here
 * (and its kind to RunnerKind in interface.ts). getRunner/defaultRunnerKind derive from this map,
 * so no switch to update.
 */
const RUNNERS: Record<RunnerKind, (customCliCommand?: string) => AgentRunner> = {
  "claude-sdk": () => new ClaudeSdkRunner(),
  "pi-cli": () => new PiSdkRunner(),
  "claude-cli": (cli) => new CliRunner(cli || CLI_TEMPLATES["claude-cli"]),
  // custom-cli falls back to a generic template if no command is configured (sensible "any CLI"
  // default; overridden via the agent_cli_command setting).
  "custom-cli": (cli) => new CliRunner(cli || sStr("agent_cli_command", "AGENT_CLI_COMMAND", CLI_TEMPLATES["pi-cli"])),
};

/** Resolve the active runner from a kind + optional custom template. */
export function getRunner(kind: RunnerKind | string, customCliCommand?: string): AgentRunner {
  return (RUNNERS[kind as RunnerKind] ?? RUNNERS["custom-cli"])(customCliCommand);
}

/** The default runner kind, from the agent_runner setting (default claude-sdk). */
export function defaultRunnerKind(): RunnerKind {
  const k = sStr("agent_runner", "AGENT_RUNNER", "claude-sdk");
  return k in RUNNERS ? (k as RunnerKind) : "claude-sdk";
}

/**
 * The executable a runner of this kind would spawn, or null for an in-process SDK runner (claude-sdk
 * and pi-cli both run in-process now — pi uses createAgentSession from the SDK, no `pi` binary).
 * Lets the caller preflight that the binary exists before launching (avoids a raw ENOENT).
 */
export function runnerBinary(kind: RunnerKind | string, customCliCommand?: string): string | null {
  if (kind === "claude-sdk" || kind === "pi-cli") return null;
  let template: string;
  if (kind === "claude-cli") template = customCliCommand || CLI_TEMPLATES["claude-cli"];
  else template = customCliCommand || sStr("agent_cli_command", "AGENT_CLI_COMMAND", CLI_TEMPLATES["pi-cli"]);
  const first = template.trim().split(/\s+/)[0];
  return first || null;
}

/** True if `cmd` is runnable: a path that exists, or a bare name found on $PATH. */
export function binaryAvailable(cmd: string): boolean {
  if (!cmd) return false;
  if (cmd.includes("/")) return existsSync(cmd);
  const dirs = (process.env.PATH || "").split(":").filter(Boolean);
  return dirs.some((d) => existsSync(join(d, cmd)));
}
