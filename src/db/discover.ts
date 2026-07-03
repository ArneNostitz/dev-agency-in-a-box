/**
 * Live model discovery for providers. THE only source of model lists — there is no static catalog.
 *
 * Two paths, both live:
 *   1. HTTP  — `GET {baseUrl}/v1/models` (Anthropic/OpenAI-compatible) with x-api-key auth.
 *   2. pi    — `pi --list-models --provider {piProvider} --api-key {apiKey} --mode json` subprocess.
 *
 * On success the discovered model ids are persisted into the provider row (by the caller, via
 * setProviders). On failure we return `{models:[], error}` and NEVER throw — the caller leaves the
 * existing list untouched and surfaces the error. There is no silent fallback to any static list.
 *
 * Discovery is triggered on provider add (and on manual "Refresh models"), NOT on every picker open.
 */
import { spawn } from "node:child_process";
import type { Provider } from "./providers.js";
import { inferPiProvider } from "./providers.js";

export interface DiscoverResult {
  models: string[];
  /** Suggested runner for the provider, applied only when the provider has no explicit runner. */
  runner?: "claude-sdk" | "pi-cli";
  /** Where the list came from: "live" (HTTP /v1/models) | "pi" (pi --list-models). */
  via: "live" | "pi";
  error?: string;
}

const ANTHROPIC_HOST = /(^|\/\/)(api\.)?anthropic\.com(\/|$)/i;

/** Resolve a provider's /v1/models endpoint URL from its baseUrl (handles trailing slash + /v1 dupes). */
function modelsEndpoint(baseUrl: string): string {
  let b = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!b) return "";
  if (!/\/v1$/.test(b)) b += "/v1";
  return b + "/models";
}

/**
 * Discover a provider's available models.
 *
 * Strategy:
 *   - pi-cli provider, OR an HTTP failure on a pi-builtin provider → try `pi --list-models`.
 *   - otherwise (and as the first attempt for anything with a baseUrl + apiKey) → HTTP /v1/models.
 *   - if both attempted and both failed → return the more useful error, empty model list.
 *
 * Never throws. A provider with no baseUrl+apiKey and no pi mapping returns an actionable error.
 */
export async function discoverProviderModels(provider: Provider): Promise<DiscoverResult> {
  const pi = inferPiProvider(provider);
  const wantsPi = provider.runner === "pi-cli" || (pi && !provider.baseUrl);
  const httpCapable = Boolean(provider.baseUrl && provider.apiKey);

  // pi-first when explicitly requested, or when there's no baseUrl to probe (a pi builtin keyed by name).
  if (wantsPi && pi) {
    const r = await viaPi(provider, pi);
    if (r.models.length || !httpCapable) return r; // pi answered, or HTTP isn't even possible
    // pi failed but HTTP is possible → fall through to HTTP as a second attempt.
  }

  if (httpCapable) {
    const r = await viaHttp(provider);
    if (r.models.length) return r;
    // HTTP failed; if this looks like a pi builtin, try pi before giving up.
    if (!wantsPi && pi && !ANTHROPIC_HOST.test(provider.baseUrl || "")) {
      const pr = await viaPi(provider, pi);
      if (pr.models.length) return pr;
      return { ...r, error: r.error || pr.error };
    }
    return r;
  }

  return {
    models: [],
    via: "live",
    error: "No base URL + API key set, and no matching pi provider — cannot discover models. Enter a base URL and key, then refresh.",
  };
}

/** HTTP path: GET {baseUrl}/v1/models. Anthropic-compatible (x-api-key) and OpenAI-shaped ({data:[]}). */
async function viaHttp(provider: Provider): Promise<DiscoverResult> {
  const endpoint = modelsEndpoint(provider.baseUrl);
  if (!endpoint) return { models: [], via: "live", error: "No base URL set." };
  const isAnthropic = ANTHROPIC_HOST.test(provider.baseUrl || "");
  const headers: Record<string, string> = isAnthropic
    ? { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" }
    : { authorization: `Bearer ${provider.apiKey}` };
  try {
    const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return { models: [], via: "live", error: `GET ${endpoint} → HTTP ${res.status}${res.status === 401 || res.status === 403 ? " (auth rejected — check the API key)" : ""}` };
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string }> };
    const rows = json.data || json.models || [];
    const models = rows.map((r) => r.id).filter((m): m is string => Boolean(m && typeof m === "string"));
    if (!models.length) return { models: [], via: "live", error: `${endpoint} returned no model ids.` };
    return { models, runner: "claude-sdk", via: "live" };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    return { models: [], via: "live", error: `Couldn't reach ${endpoint} (${msg}). Check the base URL is reachable and Anthropic-compatible.` };
  }
}

/** pi path: `pi --list-models --provider {piProvider} --api-key {apiKey} --mode json`. */
async function viaPi(provider: Provider, piProvider: string): Promise<DiscoverResult> {
  // Don't hand pi a real baseUrl via --provider; pi knows its builtins' endpoints. We only supply the key.
  const args = ["--mode", "json", "--list-models", "--provider", piProvider];
  if (provider.apiKey) args.push("--api-key", provider.apiKey);
  try {
    const out = await runPi(args);
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

/** Spawn pi with the given args and collect stdout/stderr + exit code. */
function runPi(args: string[]): Promise<PiRun> {
  return new Promise((resolve) => {
    const proc = spawn("pi", args, { shell: false });
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
