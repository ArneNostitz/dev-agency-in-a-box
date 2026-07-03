/**
 * PiCliRunner — runs pi as a subprocess in `--mode json --print` and parses the NDJSON stream
 * so pi runs are fully accountable: real token + cost accounting (from pi's usage reports),
 * live text/tool streaming to the activity feed, and turn counting.
 *
 * pi is used AS A TOOL (subprocess); nothing in the agency imports pi's internals. The command
 * is templated so a non-pi CLI in the same JSON schema would work too, but the parser is pi's.
 *
 * Provider model: pi is provider-keyed (`--provider <piKey> --model <id>`). pi knows every builtin
 * provider's endpoint + catalog. Auth is pi's native store: setProviders writes the user's key
 * (merged) into pi's REAL ~/.pi/agent/auth.json (the login), so a run just needs the provider key.
 * No isolated config dir, no PI_CODING_AGENT_DIR. Sources: docs/providers.md.
 */
import { spawn } from "node:child_process";
import type { AgentRunner, RunRequest, RunResult } from "./interface.js";
import type { Provider } from "../db/providers.js";
import { inferPiProvider } from "../db/providers.js";
import { parsePiLine, ZERO_USAGE, type PiUsage } from "./pi-parse.js";

/**
 * Default pi invocation: json stream, print mode (non-interactive), the run's provider + model + prompt.
 * `{piProvider}` is pi's own provider key (e.g. "zai", "google").
 */
export const PI_TEMPLATE = "pi --mode json --print --provider {piProvider} --model {model} --system-prompt {systemPrompt} {task}";

/** Mark an Anthropic/Anthropic-compatible base URL so we never point pi (provider-keyed) at it. */
const ANTHROPIC_HOST = /(^|\/\/)(api\.)?anthropic\.com(\/|$)/i;

/**
 * Resolve the pi provider key for a run. Primary source is the explicit `piKey` on the row; legacy
 * baseUrl/name inference is a fallback for old rows. Anthropic base URLs map to "anthropic". No
 * isolated agent dir — auth lives in pi's real ~/.pi/agent/auth.json (written at save).
 */
export function preparePiConfig(provider: Provider | null): { piProvider: string } {
  if (!provider) return { piProvider: "" };
  if (ANTHROPIC_HOST.test(provider.baseUrl || "")) return { piProvider: "anthropic" };
  return { piProvider: inferPiProvider(provider) };
}

export class PiCliRunner implements AgentRunner {
  readonly kind = "pi-cli";

  async run(req: RunRequest, emitAssistant: (message: unknown) => void): Promise<RunResult> {
    const tokens = splitArgs(req.template ?? PI_TEMPLATE);
    if (tokens.length === 0) throw new Error("pi command template is empty");
    const cmd = tokens[0];
    const piProvider = preparePiConfig(req.provider).piProvider || "anthropic";
    const args = tokens.slice(1).map((a) =>
      a.replace(/{piProvider}/g, piProvider)
        .replace(/{model}/g, req.model)
        .replace(/{systemPrompt}/g, req.systemPrompt)
        .replace(/{task}/g, req.task)
        .replace(/{workdir}/g, req.cwd),
    );
    // pi reads the provider key from its real ~/.pi/agent/auth.json (written at save). Build a clean
    // env (string values only) and strip any stray provider creds so they can't shadow the intended
    // provider.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
    for (const [k, v] of Object.entries(req.env ?? {})) if (typeof v === "string") env[k] = v;
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;

    return await new Promise<RunResult>((resolve, reject) => {
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
