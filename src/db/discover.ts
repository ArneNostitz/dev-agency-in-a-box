/**
 * Live model discovery. pi is the ONLY source of model lists (besides Claude-native, which is keyed
 * off the saved Claude/Anthropic secret and needs no discovery). pi offers basically every model, so
 * every non-Claude provider is a pi provider. There is no static catalog and no HTTP /v1/msodels path.
 *
 *   `pi --list-models --provider {piProvider} --mode json`
 *
 * Auth: pi's --list-models does NOT pick the key up from the --api-key flag alone (it prints
 * "No models available. Use /login"). pi reads credentials from its agent config dir's auth.json, so
 * we register the key the SAME way a real run does: writePiProviderFiles() writes
 * ~/.pi-agency/providers/<id>/auth.json (pi's real schema) and we point pi at that dir via
 * PI_CODING_AGENT_DIR. --api-key is also passed per the docs; the dir registration is what works.
 * Sources: https://github.com/earendil-works/pi/tree/main/packages/coding-agent#programmatic-usage
 *
 * On success the discovered model ids are persisted into the provider row (by the caller, via
 * setProviders). On failure we return {models:[], error} and NEVER throw — the caller leaves the
 * existing list untouched. Discovery runs on provider add + manual "Refresh", never on picker open.
 */
import { spawn } from "node:child_process";
import type { Provider } from "./providers.js";
import { inferPiProvider, writePiProviderFiles, getPiProviderDir } from "./providers.js";

export interface DiscoverResult {
  models: string[];
  /** Suggested runner for the provider, applied only when the provider has no explicit runner. */
  runner?: "pi-cli";
  /** Always "pi" — pi is the only discovery source. */
  via: "pi";
  error?: string;
}

/**
 * Discover a provider's available models via `pi --list-models`.
 *
 * Never throws. A provider with no resolvable pi provider name returns an actionable error.
 */
export async function discoverProviderModels(provider: Provider): Promise<DiscoverResult> {
  const pi = inferPiProvider(provider);
  if (!pi) {
    return {
      models: [],
      via: "pi",
      error: "Couldn't infer this provider's pi name. Set a base URL or name that matches a pi provider (e.g. zai for GLM, deepseek, kimi).",
    };
  }
  return viaPi(provider, pi);
}

/**
 * pi path: `pi --list-models --provider {piProvider} --mode json`, with the key registered into pi's
 * per-provider config dir so pi actually authenticates (not just --api-key, which --list-models ignores).
 */
async function viaPi(provider: Provider, piProvider: string): Promise<DiscoverResult> {
  const args = ["--mode", "json", "--list-models", "--provider", piProvider];
  if (provider.apiKey) args.push("--api-key", provider.apiKey);
  // Register the key into pi's isolated per-provider config dir (mirrors the run path). Build a clean
  // env (string values only) so PI_CODING_AGENT_DIR can be added without TS complaining about
  // `string | undefined`. Best-effort: on failure we still try — pi may pick the key from --api-key/env.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  try {
    if (provider.apiKey) {
      writePiProviderFiles(provider);
      env.PI_CODING_AGENT_DIR = getPiProviderDir(provider.id);
    }
  } catch { /* best-effort — fall through and let pi try --api-key / env */ }
  try {
    const out = await runPi(args, env);
    if (out.code !== 0 && !out.stdout.trim()) {
      return { models: [], via: "pi", error: `pi --list-models exited ${out.code}${out.stderr.trim() ? ": " + out.stderr.trim().slice(0, 200) : ""}` };
    }
    const models = parsePiModels(out.stdout);
    if (!models.length) return { models: [], via: "pi", error: `pi --list-models returned no models.${out.stderr.trim() ? " " + out.stderr.trim().slice(0, 200) : ""}` };
    return { models, runner: "pi-cli", via: "pi" };
  } catch (e) {
    return { models: [], via: "pi", error: `Couldn't run pi (${(e as Error).message || e}). Is the pi CLI installed?` };
  }
}

interface PiRun { code: number; stdout: string; stderr: string; }

/** Spawn pi with the given args (+ env override) and collect stdout/stderr + exit code. */
function runPi(args: string[], env?: Record<string, string>): Promise<PiRun> {
  return new Promise((resolve) => {
    const proc = spawn("pi", args, { shell: false, env: env ?? process.env });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", (err) => resolve({ code: -1, stdout, stderr: stderr + (stderr ? "\n" : "") + (err.message || err) }));
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * Parse `pi --list-models --mode json` output. pi prints a JSON array of model objects (each with an
 * `id`/`name`) or, in some builds, one JSON object per line. Accept both; fall back to splitting
 * trimmed non-empty lines when the output isn't JSON.
 */
function parsePiModels(stdout: string): string[] {
  const text = stdout.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { models?: unknown[] }).models) ? (parsed as { models: unknown[] }).models : [];
    return arr.map((r) => (r as { id?: string; name?: string }).id || (r as { name?: string }).name).filter((m): m is string => Boolean(m));
  } catch {
    // Not JSON — treat each non-empty line as a model id (pi's non-json list format).
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
}
