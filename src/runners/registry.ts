/**
 * The runner registry + the ONE shared summarizeTool. Picks the backend from a RunnerKind
 * (default claude-sdk), with an optional custom CLI template. Provider.runner overrides per
 * provider; the global agent_runner / agent_cli_command settings are the fallback.
 */
import { sStr } from "../settings.js";
import type { AgentRunner, RunnerKind } from "./interface.js";
import { ClaudeSdkRunner } from "./sdk-claude.js";
import { CliRunner, CLI_TEMPLATES } from "./cli.js";

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
    default:
      return `🔧 ${name}${input.description ? `: ${s(input.description)}` : ""}`;
  }
}

/** Resolve the active runner from a kind + optional custom template. */
export function getRunner(kind: RunnerKind | string, customCliCommand?: string): AgentRunner {
  switch (kind) {
    case "claude-sdk":
      return new ClaudeSdkRunner();
    case "claude-cli":
      return new CliRunner(customCliCommand || CLI_TEMPLATES["claude-cli"]);
    case "pi-cli":
      return new CliRunner(customCliCommand || CLI_TEMPLATES["pi-cli"]);
    case "custom-cli":
    default:
      // custom-cli falls back to the pi template if no command is configured (sensible default
      // for "any CLI" — the user overrides via the agent_cli_command setting).
      return new CliRunner(customCliCommand || sStr("agent_cli_command", "AGENT_CLI_COMMAND", CLI_TEMPLATES["pi-cli"]));
  }
}

/** The default runner kind, from the agent_runner setting (default claude-sdk). */
export function defaultRunnerKind(): RunnerKind {
  const k = sStr("agent_runner", "AGENT_RUNNER", "claude-sdk");
  return k === "claude-sdk" || k === "claude-cli" || k === "pi-cli" || k === "custom-cli" ? (k as RunnerKind) : "claude-sdk";
}
