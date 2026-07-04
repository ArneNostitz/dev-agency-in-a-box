// Model / provider logic — pure functions. Needs shortModel from format.js.

import { shortModel } from "./format.js";

// A provider counts as "available" (its models show in pickers) only when it's authenticated.
// The backend annotates each row with auth: "apiKey" | "subscription" | "missing" via providerAuth().
export function authedProviders(data) {
  return ((data && data.providers) || []).filter((p) => p.auth === "apiKey" || p.auth === "subscription");
}

// Is ANY model actually available? true iff ≥1 authenticated provider has models OR a Claude
// credential is saved (Claude-native picks need no providers[] row).
export function anyModelSetUp(data) {
  if (!data) return false;
  if (authedProviders(data).some((p) => (p.models || []).length > 0)) return true;
  const keys = data.secretKeys || [];
  return keys.includes("claude_token") || keys.includes("anthropic_api_key");
}

// The provider name backing the configured DEFAULT model — so the "Default model" option can show the
// real logo instead of a generic icon. Returns "" when nothing is set up (NEVER a phantom "Claude").
export function defaultModelLogo(data) {
  const gm = data && data.globalModel;
  if (gm && gm.providerId) {
    const p = ((data && data.providers) || []).find((x) => x.id === gm.providerId);
    if (p && p.name) return p.name;
  }
  // Only name Claude when a Claude credential genuinely exists; else nothing is configured.
  const keys = (data && data.secretKeys) || [];
  return keys.includes("claude_token") || keys.includes("anthropic_api_key") ? "Claude" : "";
}

// Human label for what the DEFAULT model actually resolves to — so the "Default" picker can SAY what
// it is (provider · model). Returns "" when nothing is set up (NEVER a phantom "Claude subscription").
export function defaultModelLabel(data) {
  const gm = data && data.globalModel;
  if (gm && gm.model) {
    const p = ((data && data.providers) || []).find((x) => x.id === gm.providerId);
    return (p && p.name ? p.name + " · " : "") + shortModel(gm.model);
  }
  // Only mention Claude when a Claude credential genuinely exists; else nothing is configured.
  const keys = (data && data.secretKeys) || [];
  return keys.includes("claude_token") || keys.includes("anthropic_api_key") ? "Claude subscription" : "";
}

export function parseModelRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  const i = ref.indexOf("/");
  if (i <= 0) return null;
  return { providerId: ref.slice(0, i), model: ref.slice(i + 1) };
}

export function toModelRef(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.providerId && v.model ? v.providerId + "/" + v.model : "";
}

// Flat list of {value:"providerId/model", label, logo, hint} for every model on every AUTHENTICATED
// provider. A provider's models reach the picker ONLY when auth is "apiKey" or "subscription" — the
// single rule that keeps unconfigured/keyless providers out of every model menu. `short` → model id.
export function providerModelOptions(providers, { short = true } = {}) {
  return (providers || [])
    .filter((p) => p.auth === "apiKey" || p.auth === "subscription")
    .flatMap((p) => (p.models || []).map((m) => ({
      value: p.id + "/" + m,
      label: short ? m : ((p.name || "") + " · " + m),
      logo: p.name,
      hint: p.name,
    })));
}

// Is a configured model ref still offered by its provider? If not, suggest the closest substitute
// (same tier model if the provider is tiered, else the first available model on that provider).
// Returns {available, substitute}. Used to warn (never auto-change) when discovery drops a model.
export function modelAvailability(ref, providers) {
  const r = typeof ref === "string" ? parseModelRef(ref) : ref;
  if (!r || !r.providerId) return { available: true, substitute: null };
  const p = ((providers || []).find((x) => x.id === r.providerId)) || null;
  // Unknown provider (e.g. deleted, or a tier resolved at run time) — not ours to flag as stale.
  if (!p) return { available: true, substitute: null };
  const models = (p && p.models) || [];
  if (models.includes(r.model)) return { available: true, substitute: null };
  // Stale: try same-tier slot, else first model on the provider.
  let substitute = null;
  if (p && p.tiers) {
    for (const t of ["high", "medium", "low"]) {
      const slot = p.tiers[t];
      if (slot && slot.model && slot.model !== r.model) { substitute = slot.model; break; }
    }
  }
  if (!substitute && models.length) substitute = models[0];
  return { available: false, substitute };
}

// Resolve the provider whose High/Medium/Low tier slots a "tier" pick resolves against: the global
// default's provider, else the first provider that actually defines tiers, else the first provider.
export function tierProviderFor(data) {
  const providers = (data && data.providers) || [];
  const gm = data && data.globalModel;
  const gp = providers.find((p) => p.id === (gm && gm.providerId));
  if (gp) return gp;
  const withTiers = providers.find((p) => p.tiers && Object.keys(p.tiers).length);
  return withTiers || providers[0] || null;
}
