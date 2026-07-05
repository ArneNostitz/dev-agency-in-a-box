/**
 * Live model discovery via pi's ModelRegistry (in-process — the same SDK the runner uses).
 *
 * pi's ModelRegistry loads its full built-in model catalog (every builtin provider's models, kept
 * current per pi release) plus any custom models.json. We filter to the provider's piKey so each
 * provider row gets only its own models. Auth is already handled: setProviders writes the key into
 * pi's real ~/.pi/agent/auth.json (the login), so AuthStorage.create() picks it up natively —
 * getAvailable() returns only models that have auth configured, but we use getAll() + filter so a
 * provider shows its full catalog even before its key is entered.
 *
 * On success the discovered model ids are persisted into the provider row (by the caller, via
 * setProviders). On failure we return {models:[], error} and NEVER throw — the caller leaves the
 * existing list untouched. Discovery runs on provider add + manual "Refresh", never on picker open.
 */
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
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
 * Discover a provider's available models via pi's ModelRegistry (in-process).
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
  try {
    const authStorage = AuthStorage.create();
    // Inject the provider's key from the DB row as a runtime override — auth.json may be absent
    // (fresh container) or stale. The DB is the source of truth.
    const apiKey = provider.apiKey?.trim();
    if (apiKey) authStorage.setRuntimeApiKey(pi, apiKey);
    const registry = ModelRegistry.create(authStorage);
    // getAll() = built-in + custom models. Filter by provider so each row gets only its own catalog.
    const models = registry
      .getAll()
      .filter((m) => m.provider === pi)
      .map((m) => m.id)
      .filter(Boolean);
    if (!models.length) {
      return {
        models: [],
        via: "pi",
        error: `pi's registry has no models for provider "${pi}". The provider key may be wrong, or pi needs an update for this provider.`,
      };
    }
    return { models, runner: "pi-cli", via: "pi" };
  } catch (e) {
    return {
      models: [],
      via: "pi",
      error: `Couldn't read pi's model registry (${(e as Error).message || e}). Is @earendil-works/pi-coding-agent installed?`,
    };
  }
}

/**
 * Ensure the Claude-NATIVE provider row exists whenever a Claude credential is saved, seeded with
 * pi's full anthropic catalog — so Claude's model list is complete, visible, and editable exactly
 * like every pi provider (issue #139). The row is keyless (piKey "" / apiKey "") → providerAuth
 * classifies it "subscription" and runnerKindFor keeps it on the Claude SDK. Model refresh works
 * via the normal /discover-models path (inferPiProvider maps the "Claude" name → "anthropic").
 */
export function ensureClaudeProvider(hasClaudeCred: boolean, getProviders: () => Provider[], setProviders: (l: Provider[]) => void): void {
  try {
    if (!hasClaudeCred) return;
    const list = getProviders();
    if (list.some((p) => p.id === "claude" || (!p.apiKey && !p.piKey && /^claude$/i.test(p.name || "")))) return;
    const registry = ModelRegistry.create(AuthStorage.create());
    const models = registry.getAll().filter((m) => m.provider === "anthropic").map((m) => m.id).filter(Boolean);
    setProviders(list.concat({ id: "claude", name: "Claude", piKey: "", apiKey: "", models }));
  } catch { /* best effort — a missing catalog must never break /models */ }
}
