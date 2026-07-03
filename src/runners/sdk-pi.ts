/**
 * PiCliRunner — runs pi as a subprocess in `--mode json --print` and parses the NDJSON stream
 * so pi runs are fully accountable: real token + cost accounting (from pi's usage reports),
 * live text/tool streaming to the activity feed, and turn counting. This closes the gap where
 * a generic CliRunner returned tokens:0/cost:0.
 *
 * pi is used AS A TOOL (subprocess); nothing in the agency imports pi's internals. The command
 * is templated so a non-pi CLI in the same JSON schema would work too, but the parser is pi's.
 *
 * Provider translation (#108, the real fix): pi is provider-keyed (`--provider <name> --model <id>`).
 * For one of pi's BUILT-IN providers (zai/anthropic/openai/deepseek/kimi-coding/openrouter) pi already
 * knows the baseUrl + protocol + model catalog — so all we have to supply is the API KEY, via an
 * isolated ~/.pi/agent/auth.json in pi's REAL documented schema. The previous preparePiHome wrote a
 * models.json with an INVENTED schema (`providers."dev-agency-routed"`) and no auth.json, discarding
 * the user's real ~/.pi — which is exactly why a routed GLM run hung / fell back to Claude. This now
 * writes the correct schema and points pi at the right built-in provider, so GLM-via-pi actually runs.
 * For a truly CUSTOM provider (no built-in name) we additionally write a real-schema models.json.
 *
 * Sources: pi's model-registry.js (ProviderConfigSchema / ModelsConfigSchema) and
 * docs/providers.md — auth resolves flag → auth.json → env → models.json.
 */
import { spawn } from "node:child_process";
import type { AgentRunner, RunRequest, RunResult } from "./interface.js";
import type { Provider } from "../db/providers.js";
import { inferPiProvider, getPiProviderDir, writePiProviderFiles } from "../db/providers.js";
import { parsePiLine, ZERO_USAGE, type PiUsage } from "./pi-parse.js";

/**
 * Default pi invocation: json stream, print mode (non-interactive), the run's provider + model + prompt.
 * `{piProvider}` is pi's own provider name (e.g. "zai"); when a custom provider is registered via
 * models.json it becomes the provider key there instead.
 */
export const PI_TEMPLATE = "pi --mode json --print --provider {piProvider} --model {model} --system-prompt {systemPrompt} {task}";

/** Mark an Anthropic/Anthropic-compatible base URL so we never point pi (provider-keyed) at it. */
const ANTHROPIC_HOST = /(^|\/\/)(api\.)?anthropic\.com(\/|$)/i;

/** The config the pi runner uses to set PI_CODING_AGENT_DIR for a run. */
export interface PiConfig {
  /** pi's own provider name to pass as --provider (a builtin, or a custom key registered in models.json). */
  piProvider: string;
  /** Permanent per-provider config dir to set as PI_CODING_AGENT_DIR; null = no override needed. */
  agentDir: string | null;
}

/**
 * Resolve the pi provider name + permanent agent-config dir for a run.
 *  - BUILTIN provider (zai/deepseek/…): auth.json was written at save time (setProviders).
 *    Safety-net call to writePiProviderFiles ensures it exists after a container restart.
 *  - CUSTOM provider: same — models.json is also written (all provider.models, not just one).
 *  - No provider / Anthropic-default: return { agentDir: null } — pi uses ANTHROPIC_* env.
 * Returns piProvider (for --provider flag) + agentDir (for PI_CODING_AGENT_DIR). Never a temp dir.
 */
export function preparePiConfig(provider: Provider | null): PiConfig {
  if (!provider || !provider.apiKey) return { piProvider: "", agentDir: null };
  if (ANTHROPIC_HOST.test(provider.baseUrl || "")) return { piProvider: "anthropic", agentDir: null };
  const piProvider = inferPiProvider(provider) || "dev-agency-custom";
  writePiProviderFiles(provider); // safety-net: write/refresh if missing (e.g. after container restart)
  return { piProvider, agentDir: getPiProviderDir(provider.id) };
}

export class PiCliRunner implements AgentRunner {
  readonly kind = "pi-cli";

  async run(req: RunRequest, emitAssistant: (message: unknown) => void): Promise<RunResult> {
    const tokens = splitArgs(req.template ?? PI_TEMPLATE);
    if (tokens.length === 0) throw new Error("pi command template is empty");
    const cmd = tokens[0];
    const piProvider = inferPiProvider(req.provider) || "anthropic";
    const args = tokens.slice(1).map((a) =>
      a.replace(/{piProvider}/g, piProvider)
        .replace(/{model}/g, req.model)
        .replace(/{systemPrompt}/g, req.systemPrompt)
        .replace(/{task}/g, req.task)
        .replace(/{workdir}/g, req.cwd),
    );
    const { agentDir } = preparePiConfig(req.provider);
    // PI_CODING_AGENT_DIR is pi's own env var for its agent config dir (auth.json / models.json).
    // Using it instead of overriding HOME keeps the subprocess's home intact for everything else.
    const env: Record<string, string> = { ...process.env, ...(req.env ?? {}), ...(agentDir ? { PI_CODING_AGENT_DIR: agentDir } : {}) };
    // Strip provider creds from env — pi reads the key from auth.json in the config dir.
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
