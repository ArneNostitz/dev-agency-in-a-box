/**
 * CliRunner — execute a role via an external CLI subprocess (pi, claude, gemini, anything).
 * This is how the agency uses pi AS A TOOL without assimilating it: `pi --mode print …` runs
 * as a child process, so a pi update can never break the core. The runner is generic — the
 * command template decides which CLI.
 *
 * Shell-less spawn with a manual arg parser (no shell injection). Templates substitute
 * {model}, {systemPrompt}, {task}, {role}, {workdir}.
 */
import { spawn } from "node:child_process";
import type { AgentRunner, RunRequest, RunResult } from "./interface.js";
import { pushActivity } from "../activity.js";

/** Parse a command line into argv, honoring single/double quotes. No shell, no injection. */
export function parseCommandLine(cmdLine: string): string[] {
  const args: string[] = [];
  let current = "";
  let inDoubleQuote = false;
  let inSingleQuote = false;
  for (let i = 0; i < cmdLine.length; i++) {
    const char = cmdLine[i];
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === " " && !inDoubleQuote && !inSingleQuote) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

/** Default command templates per CLI kind. */
export const CLI_TEMPLATES: Record<string, string> = {
  "claude-cli": "claude -p {task}",
  "pi-cli": "pi --mode print --model {model} --system-prompt {systemPrompt} {task}",
};

export class CliRunner implements AgentRunner {
  readonly kind = "cli";
  constructor(private template: string) {}

  async run(req: RunRequest, _emitAssistant: (message: unknown) => void): Promise<RunResult> {
    const tokens = parseCommandLine(this.template);
    if (tokens.length === 0) throw new Error("CLI command template is empty.");

    const command = tokens[0];
    const resolvedArgs = tokens.slice(1).map((arg) =>
      arg
        .replace(/{model}/g, req.model)
        .replace(/{systemPrompt}/g, req.systemPrompt)
        .replace(/{task}/g, req.task)
        .replace(/{role}/g, "")
        .replace(/{workdir}/g, req.cwd),
    );

    console.log(`[CliRunner] ${command} ${resolvedArgs.map((a) => a.slice(0, 40) + (a.length > 40 ? "…" : "")).join(" ")}`);

    const runEnv = { ...process.env, ...(req.env ?? {}) };

    return new Promise<RunResult>((resolve, reject) => {
      const proc = spawn(command, resolvedArgs, { cwd: req.cwd, shell: false, env: runEnv });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

      const onAbort = (): void => {
        proc.kill("SIGTERM");
      };
      req.abort.signal.addEventListener("abort", onAbort);

      proc.on("error", (err) => {
        req.abort.signal.removeEventListener("abort", onAbort);
        reject(err);
      });
      proc.on("close", (code) => {
        req.abort.signal.removeEventListener("abort", onAbort);
        if (code !== 0 && !req.abort.signal.aborted) {
          reject(new Error(`CLI exited ${code}\n${stderr.slice(-400)}`));
        } else {
          resolve({ text: stdout || "CLI execution completed.", turns: 1, costUsd: 0, tokens: 0, stopped: "" });
        }
      });
    });
  }
}
