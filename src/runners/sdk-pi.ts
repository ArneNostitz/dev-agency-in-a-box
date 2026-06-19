/**
 * PiCliRunner — runs pi as a subprocess in `--mode json --print` and parses the NDJSON stream
 * so pi runs are fully accountable: real token + cost accounting (from pi's usage reports),
 * live text/tool streaming to the activity feed, and turn counting. This closes the gap where
 * a generic CliRunner returned tokens:0/cost:0.
 *
 * pi is used AS A TOOL (subprocess); nothing in the agency imports pi's internals. The command
 * is templated so a non-pi CLI in the same JSON schema would work too, but the parser is pi's.
 */
import { spawn } from "node:child_process";
import type { AgentRunner, RunRequest, RunResult } from "./interface.js";
import { parsePiLine, ZERO_USAGE, type PiUsage } from "./pi-parse.js";

/** Default pi invocation: json stream, print mode (non-interactive), the run's model + prompt. */
export const PI_TEMPLATE = "pi --mode json --print --model {model} --system-prompt {systemPrompt} {task}";

export class PiCliRunner implements AgentRunner {
  readonly kind = "pi-cli";

  async run(req: RunRequest, emitAssistant: (message: unknown) => void): Promise<RunResult> {
    const tokens = splitArgs(req.template ?? PI_TEMPLATE);
    if (tokens.length === 0) throw new Error("pi command template is empty");
    const cmd = tokens[0];
    const args = tokens.slice(1).map((a) =>
      a.replace(/{model}/g, req.model).replace(/{systemPrompt}/g, req.systemPrompt).replace(/{task}/g, req.task).replace(/{workdir}/g, req.cwd),
    );
    const env = { ...process.env, ...(req.env ?? {}) };

    return new Promise<RunResult>((resolve, reject) => {
      const proc = spawn(cmd, args, { cwd: req.cwd, shell: false, env });
      let finalText = "";
      let turns = 0;
      let usage: PiUsage = { ...ZERO_USAGE };
      let stderr = "";
      let stdoutBuf = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        // Process complete lines; keep any trailing partial line in the buffer.
        let nl: number;
        while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
          const line = stdoutBuf.slice(0, nl);
          stdoutBuf = stdoutBuf.slice(nl + 1);
          for (const ev of parsePiLine(line)) {
            if (ev.textDelta) emitAssistant({ type: "text_delta", delta: ev.textDelta });
            if (ev.tool) emitAssistant({ type: "tool", summary: ev.tool });
            if (ev.usage) usage = ev.usage; // running total — last wins
            if (ev.turnEnded) turns += 1;
            if (ev.finalText) finalText = ev.finalText;
          }
        }
      });
      proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

      const onAbort = (): void => { proc.kill("SIGTERM"); };
      req.abort.signal.addEventListener("abort", onAbort);

      proc.on("error", (err) => {
        req.abort.signal.removeEventListener("abort", onAbort);
        reject(err);
      });
      proc.on("close", (code) => {
        req.abort.signal.removeEventListener("abort", onAbort);
        if (code !== 0 && !req.abort.signal.aborted) {
          reject(new Error(`pi exited ${code}\n${stderr.slice(-400)}`));
          return;
        }
        resolve({
          text: finalText || "pi run completed.",
          turns: Math.max(1, turns),
          tokens: usage.totalTokens,
          costUsd: usage.costTotal,
          stopped: "",
        });
      });
    });
  }
}

/** Minimal shell-less argv split (quotes only — pi-parse handles no metacharacters). */
function splitArgs(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = "";
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = "";
      else cur += c;
    } else if (c === '"' || c === "'") q = c;
    else if (c === " ") {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
