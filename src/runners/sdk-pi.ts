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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunner, RunRequest, RunResult } from "./interface.js";
import type { Provider } from "../db/providers.js";
import { inferPiProvider } from "../db/providers.js";
import { parsePiLine, ZERO_USAGE, type PiUsage } from "./pi-parse.js";

/**
 * Default pi invocation: json stream, print mode (non-interactive), the run's provider + model + prompt.
 * `{piProvider}` is pi's own provider name (e.g. "zai"); when a custom provider is registered via
 * models.json it becomes the provider key there instead.
 */
export const PI_TEMPLATE = "pi --mode json --print --provider {piProvider} --model {model} --system-prompt {systemPrompt} {task}";

/** Mark an Anthropic/Anthropic-compatible base URL so we never point pi (provider-keyed) at it. */
const ANTHROPIC_HOST = /(^|\/\/)(api\.)?anthropic\.com(\/|$)/i;

/**
 * pi's built-in provider keys (verified against pi's known provider set). When the resolved provider
 * maps to one of these, pi knows its endpoint + catalog and we only need to supply the key.
 */
const BUILTIN_PI_PROVIDERS = new Set(["zai", "anthropic", "openai", "google", "deepseek", "kimi-coding", "openrouter"]);

/** The config the pi runner materializes into an isolated temp HOME for one run. */
export interface PiConfig {
  /** pi's own provider name to pass as --provider (a builtin, or a custom key registered in models.json). */
  piProvider: string;
  /** Temp HOME dir containing ~/.pi/agent/{auth.json[, models.json]}; caller removes it when done. null = no override needed. */
  home: string | null;
}

/**
 * Materialize an isolated ~/.pi/agent config for this run, from the Provider row:
 *  - BUILTIN provider (zai/deepseek/kimi-coding/openrouter/openai/anthropic): write ONLY auth.json in
 *    pi's real schema `{ "<name>": { type: "api_key", key } }`. pi knows the rest.
 *  - CUSTOM provider (custom baseUrl, no builtin name): ALSO write a real-schema models.json registering
 *    the provider + model (ProviderConfigSchema from pi's model-registry.js), keyed by a stable slug.
 *  - No provider / Anthropic-default: return { home: null } — pi's built-in CLAUDE/ANTHROPIC_* env
 *    handling already covers a subscription/API-key run (we pass those through the base env).
 * Returns the temp HOME to clean up (or null) + the piProvider to invoke.
 */
export function preparePiConfig(provider: Provider | null, model: string): PiConfig {
  if (!provider || !provider.apiKey) return { piProvider: "", home: null };
  // Don't hijack a Claude-native/Anthropic route into pi — pi handles that via ANTHROPIC_* env too,
  // and overriding HOME would just drop the user's real ~/.pi for no benefit.
  if (ANTHROPIC_HOST.test(provider.baseUrl || "")) return { piProvider: "anthropic", home: null };

  const piProvider = inferPiProvider(provider) || "dev-agency-custom";
  const home = mkdtempSync(join(tmpdir(), "pi-home-"));
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });

  // auth.json — pi's REAL schema (the only thing a builtin provider needs).
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({ [piProvider]: { type: "api_key", key: provider.apiKey } }, null, 2),
  );

  // models.json — ONLY for a truly custom provider pi doesn't ship. Uses pi's real ProviderConfigSchema
  // (NOT the invented "dev-agency-routed" shape that broke #108): providers.<key> = { baseUrl, apiKey,
  // api, models:[{id,name}] }. For a builtin, skip this entirely — pi already has the catalog.
  if (!BUILTIN_PI_PROVIDERS.has(piProvider) && provider.baseUrl) {
    const config = {
      providers: {
        [piProvider]: {
          baseUrl: provider.baseUrl,
          api: "anthropic-messages",
          apiKey: provider.apiKey,
          models: [{ id: model, name: model }],
        },
      },
    };
    writeFileSync(join(agentDir, "models.json"), JSON.stringify(config, null, 2));
  }
  return { piProvider, home };
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
    const { home } = preparePiConfig(req.provider, req.model);
    // Base env is what roleAgent built (process env + GH_TOKEN/GIT identity, never the provider key —
    // pi reads the key from the isolated auth.json). Redirect HOME so pi finds our config, not the
    // operator's real ~/.pi (keeps runs isolated + concurrent-safe; never drops a real config again).
    const env: Record<string, string> = { ...process.env, ...(req.env ?? {}), ...(home ? { HOME: home } : {}) };
    // The API key must NOT travel in env here (pi would then read ANTHROPIC_API_KEY and route wrong);
    // it lives only in the isolated auth.json we just wrote. Strip any stale third-party routing.
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;

    try {
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
    } finally {
      if (home) try { rmSync(home, { recursive: true, force: true }); } catch { /* noop */ }
    }
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
