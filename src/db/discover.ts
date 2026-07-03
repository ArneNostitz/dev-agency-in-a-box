/**
 * Live model discovery. pi is the ONLY source of model lists (besides Claude-native, which is keyed
 * off the saved Claude/Anthropic secret and needs no discovery). pi knows every provider's full model
 * catalog (updated per release), so discovery = `pi --list-models --provider <piKey>`.
 *
 * Auth is already handled: setProviders writes the key (merged) into pi's REAL ~/.pi/agent/auth.json
 * (the login), so pi authenticates for --list-models too. No --api-key flag needed, no env juggling.
 * Sources: https://github.com/earendil-works/pi/tree/main/packages/coding-agent (docs/providers.md)
 *
 * On success the discovered model ids are persisted into the provider row (by the caller, via
 * setProviders). On failure we return {models:[], error} and NEVER throw — the caller leaves the
 * existing list untouched. Discovery runs on provider add + manual "Refresh", never on picker open.
 */
import { spawn } from "node:child_process";
import type { Provider } from "./providers.js";
import { inferPiProvider } from "./providers.js";

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
 * Never throws. A provider with no resolvable pi key returns an actionable error.
 */
export async function discoverProviderModels(provider: Provider): Promise<DiscoverResult> {
  const pi = (provider.piKey || inferPiProvider(provider)).trim();
  if (!pi) {
    return {
      models: [],
      via: "pi",
      error: "This provider has no pi key. Pick a provider from the list when adding it.",
    };
  }
  // Auth already lives in pi's real ~/.pi/agent/auth.json (written at save). Just list models.
  // NOTE: `--provider <pi>` does NOT filter pi's list output (pi lists models from ALL authenticated
  // providers). We pass it anyway, then filter rows by the provider column (column 1) in the parser
  // so each provider gets only its own models.
  const args = ["--list-models", "--provider", pi];
  try {
    const out = await runPi(args);
    // pi prints the model table to BOTH stdout and stderr; parse whichever has content.
    const models = parsePiModels(out.stdout || out.stderr, pi);
    if (out.code !== 0 && !models.length) {
      return { models: [], via: "pi", error: `pi --list-models exited ${out.code}${out.stderr.trim() ? ": " + out.stderr.trim().slice(0, 200) : ""}` };
    }
    if (!models.length) return { models: [], via: "pi", error: `pi --list-models returned no models for provider "${pi}".${out.stderr.trim() ? " " + out.stderr.trim().slice(0, 200) : ""}` };
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
 * Parse `pi --list-models` output. pi prints a space-aligned TABLE (verified against pi 0.79.6):
 *
 *   provider  model         context  max-out  thinking  images
 *   zai       glm-4.5-air   131.1K   98.3K    yes       no
 *   zai       glm-4.7       204.8K   131.1K   yes       no
 *   ...
 *
 * IMPORTANT: pi lists models from ALL authenticated providers (the `--provider` flag does NOT filter
 * the list). Each row is tagged with its provider in column 1, so we filter rows where column 1
 * matches `piKey`, then take column 2 (the model id). When `piKey` is empty (legacy), no filter.
 * Also accepts a JSON array (future-proofing) as a last resort.
 */
function parsePiModels(text: string, piKey = ""): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  // Try JSON first (a future pi build may emit structured output).
  try {
    const parsed = JSON.parse(t);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { models?: unknown[] }).models) ? (parsed as { models: unknown[] }).models : [];
    const rows = arr.map((r) => (r as { provider?: string; id?: string; name?: string }));
    const matched = piKey ? rows.filter((r) => r.provider === piKey) : rows;
    const fromJson = matched.map((r) => r.id || r.name).filter((m): m is string => Boolean(m));
    if (fromJson.length) return fromJson;
  } catch { /* not JSON — fall through to the table parser */ }
  // pi's actual format: a space-separated table. Column 1 = provider, column 2 = model id.
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const models: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(/\s+/);
    // Header row: "provider model context max-out thinking images" — skip it.
    if (i === 0 && cols[0] === "provider" && cols[1] === "model") continue;
    // Data row: column 1 must match the requested piKey (pi lists ALL providers' models). Column 2
    // is the model id. Guard against short/separator rows.
    if (cols.length >= 2 && cols[1] && !/^[-=]+$/.test(cols[1]) && (!piKey || cols[0] === piKey)) models.push(cols[1]);
  }
  return models;
}
