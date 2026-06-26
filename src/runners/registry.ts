/**
 * The runner registry + the ONE shared summarizeTool. Picks the backend from a RunnerKind
 * (default claude-sdk), with an optional custom CLI template. Provider.runner overrides per
 * provider; the global agent_runner / agent_cli_command settings are the fallback.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sStr } from "../settings.js";
import type { AgentRunner, RunnerKind } from "./interface.js";
import { ClaudeSdkRunner } from "./sdk-claude.js";
import { CliRunner, CLI_TEMPLATES } from "./cli.js";
import { PiCliRunner, PI_TEMPLATE } from "./sdk-pi.js";

/**
 * The one-liner tool-call summary for the activity stream. Single source (issue #61 dedup) —
 * imported by roleAgent (SDK path) and any runner that wants consistent tool labels.
 */
export function summarizeTool(name: string, input: Record<string, unknown> = {}): string {
  const s = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  switch (name) {
    case "Bash":
      return `$ ${s(input.command)}`;
    case "Write":
      return `✏️ write ${s(input.file_path)}`;
    case "Edit":
      return `✏️ edit ${s(input.file_path)}`;
    case "Read":
      return `📖 read ${s(input.file_path)}`;
    case "Grep":
      return `🔎 grep ${s(input.pattern)}`;
    case "Glob":
      return `🔎 glob ${s(input.pattern)}`;
    case "WebSearch":
      return `🌐 search ${s(input.query)}`;
    case "WebFetch":
      return `🌐 fetch ${s(input.url)}`;
    case "TodoWrite":
      return `📋 plan: ${(Array.isArray(input.todos) ? input.todos : []).map((t: unknown) => (t as { content?: string }).content || "").filter(Boolean).slice(0, 4).join(" · ").slice(0, 160) || "updated the todo list"}`;
    case "Task":
      return `🤝 subagent: ${s(input.description || input.prompt)}`;
    default: {
      // MCP tools — surface the server + tool + its key argument so GitNexus/recall calls are legible.
      const mcp = /^mcp__([^_]+)__(.+)$/.exec(name);
      if (mcp) {
        const [, server, tool] = mcp;
        const arg = s(input.symbol || input.query || input.name || input.q || input.path || input.cypher || Object.values(input)[0]);
        const icon = server === "gitnexus" ? "🧠" : server === "recall" ? "📚" : "🔌";
        return `${icon} ${server}.${tool}${arg ? `(${arg})` : ""}`;
      }
      return `🔧 ${name}${input.description ? `: ${s(input.description)}` : ""}`;
    }
  }
}

/**
 * Runner registry — the single source of truth for backends. To add a runner: add one entry here
 * (and its kind to RunnerKind in interface.ts). getRunner/defaultRunnerKind derive from this map,
 * so no switch to update.
 */
const RUNNERS: Record<RunnerKind, (customCliCommand?: string) => AgentRunner> = {
  "claude-sdk": () => new ClaudeSdkRunner(),
  "pi-cli": () => new PiCliRunner(),
  "claude-cli": (cli) => new CliRunner(cli || CLI_TEMPLATES["claude-cli"]),
  // custom-cli falls back to the pi template if no command is configured (sensible "any CLI" default;
  // overridden via the agent_cli_command setting).
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
 * The executable a runner of this kind would spawn, or null for the in-process SDK runner.
 * Lets the caller preflight that the binary exists before launching (avoids a raw ENOENT).
 */
export function runnerBinary(kind: RunnerKind | string, customCliCommand?: string): string | null {
  if (kind === "claude-sdk") return null;
  let template: string;
  if (kind === "pi-cli") template = customCliCommand || PI_TEMPLATE;
  else if (kind === "claude-cli") template = customCliCommand || CLI_TEMPLATES["claude-cli"];
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
