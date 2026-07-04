/**
 * LLM providers, model assignments, fallback chain, and per-issue model overrides.
 * Extracted from store.ts (Candidate 3, #70). Depends on settings (getSetting/setSetting).
 *
 * There is NO static model catalog here. A provider's `models[]` is populated by LIVE discovery
 * (`pi --list-models`) on add/refresh, and persisted into the provider row. The DB
 * (settings → "providers") is the single source of truth for what's configured; discovery just
 * fills the model lists.
 *
 * Provider model (per pi's docs): a provider is identified by its `piKey` — pi's own built-in
 * provider name (e.g. "google", "zai", "deepseek", "kimi-coding"). pi knows the endpoint + model
 * catalog for each. The user picks a provider + pastes a key; setProviders writes that key (merged)
 * into pi's real ~/.pi/agent/auth.json (the login), and runs/discovery use `pi --provider <piKey>`.
 */
import { getDb } from "./connection.js";
import { getSetting, setSetting } from "./settings.js";
import { writePiAuthKey } from "./pi-auth.js";

export type Tier = "high" | "medium" | "low";
/** A model tier slot: which model the per-agent picker offers for this tier. */
export interface TierSlot { model: string; fallback?: string; }
export interface Provider {
  id: string;
  name: string;
  /** pi's built-in provider key (e.g. "google", "zai", "deepseek"). pi knows the endpoint + catalog. */
  piKey: string;
  apiKey: string;
  models: string[];
  /** Per-provider High/Medium/Low model slots the per-agent picker offers. */
  tiers?: { high?: TierSlot; medium?: TierSlot; low?: TierSlot };
  /** Legacy fields kept for backward-compat with old rows; not user-facing anymore. */
  baseUrl?: string;
  runner?: string;
  cliCommand?: string;
  piProvider?: string;
  runnerConfig?: Record<string, unknown>;
}

export function getProviders(): Provider[] {
  try {
    return JSON.parse(getSetting("providers") ?? "[]") as Provider[];
  } catch {
    return [];
  }
}
export function setProviders(list: Provider[]): void {
  const safe = list ?? [];
  setSetting("providers", JSON.stringify(safe));
  // Register each provider's key into pi's REAL auth store (~/.pi/agent/auth.json), merged — this is
  // the "login" pi's own /login performs. pi then authenticates for runs + --list-models.
  for (const p of safe) {
    const key = (p.piKey || inferPiProvider(p)).trim();
    if (key && p.apiKey) writePiAuthKey(key, p.apiKey);
  }
  // Cascade: drop any globalModel / roleModels / fallbackChain entries pointing at a provider that
  // no longer exists. Otherwise the model pickers keep displaying dead refs (and the UI's Global
  // Default dropdown shows a phantom selection long after the provider was removed).
  const validIds = new Set(safe.map((p) => p.id));
  const gm = getGlobalModel();
  if (gm && !validIds.has(gm.providerId)) setGlobalModel(null);
  const rm = getRoleModels();
  let rmChanged = false;
  for (const role of Object.keys(rm)) {
    if (!validIds.has(rm[role]?.providerId)) { delete rm[role]; rmChanged = true; }
  }
  if (rmChanged) setRoleModels(rm);
  const chain = getFallbackChain();
  const cleanChain = chain.filter((e) => validIds.has(e.providerId));
  if (cleanChain.length !== chain.length) setFallbackChain(cleanChain);
}

export function getRoleModels(): Record<string, { providerId: string; model: string }> {
  try {
    return JSON.parse(getSetting("role_models") ?? "{}") as Record<string, { providerId: string; model: string }>;
  } catch {
    return {};
  }
}
export function setRoleModels(map: Record<string, { providerId: string; model: string }>): void {
  setSetting("role_models", JSON.stringify(map ?? {}));
}

export function getGlobalModel(): { providerId: string; model: string } | null {
  try {
    const v = getSetting("global_model");
    return v ? (JSON.parse(v) as { providerId: string; model: string }) : null;
  } catch {
    return null;
  }
}
export function setGlobalModel(model: { providerId: string; model: string } | null): void {
  if (model) {
    setSetting("global_model", JSON.stringify(model));
  } else {
    const d = getDb();
    if (d) {
      try {
        d.prepare(`DELETE FROM settings WHERE key = ?`).run("global_model");
      } catch {}
    }
  }
}

// ---- in-memory session-level fallback (not persisted; cleared after each auto-switch run) ----
let _sessionFallback: { providerId: string; model: string } | null = null;
export function setSessionFallback(f: { providerId: string; model: string }): void {
  _sessionFallback = f;
}
export function clearSessionFallback(): void {
  _sessionFallback = null;
}
/** Returns the active session-level fallback, or null if none is set. */
export function getSessionFallback(): { providerId: string; model: string } | null {
  return _sessionFallback;
}

/**
 * Ordered fallback chain: when the primary model (Claude) hits a usage limit, the agency
 * tries providers in this list in order.
 */
export function getFallbackChain(): Array<{ providerId: string; model: string }> {
  try {
    return JSON.parse(getSetting("fallback_chain") ?? "[]") as Array<{ providerId: string; model: string }>;
  } catch {
    return [];
  }
}
export function setFallbackChain(chain: Array<{ providerId: string; model: string }>): void {
  setSetting("fallback_chain", JSON.stringify(chain ?? []));
}

/** true → when Claude hits a usage limit, automatically switch all unassigned roles to the fallback chain */
export function getAutoSwitchOnLimit(): boolean {
  return getSetting("auto_switch_on_limit") === "on";
}

/** Per-issue model override: the human picks a model in the chatbox; used for the next run. */
export function setIssueModelOverride(repo: string, number: number, providerId: string, model: string): void {
  setSetting(`issue_model.${repo}#${number}`, JSON.stringify({ providerId, model }));
}
export function getIssueModelOverride(repo: string, number: number): { providerId: string; model: string } | null {
  try {
    const v = getSetting(`issue_model.${repo}#${number}`);
    return v ? (JSON.parse(v) as { providerId: string; model: string }) : null;
  } catch {
    return null;
  }
}
export function clearIssueModelOverride(repo: string, number: number): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM settings WHERE key = ?`).run(`issue_model.${repo}#${number}`);
  } catch {
    /* best effort */
  }
}

// Per-issue WORKFLOW override — pins which workflow this issue runs, persisted across runs and
// honored even on resume (unlike text-trigger resolution which only reads title/body on a fresh run).
export function setIssueWorkflow(repo: string, number: number, workflowId: string): void {
  setSetting(`issue_workflow.${repo}#${number}`, workflowId);
}
export function getIssueWorkflow(repo: string, number: number): string | null {
  try {
    const v = getSetting(`issue_workflow.${repo}#${number}`);
    return v || null;
  } catch {
    return null;
  }
}
export function clearIssueWorkflow(repo: string, number: number): void {
  setSetting(`issue_workflow.${repo}#${number}`, "");
}

// ---- H/M/L tier resolution + per-issue / per-agent overrides ----
/** Resolve a tier (high/medium/low) on a provider → its model. Falls back to the provider's first model. */
export function tierModel(providerId: string, tier: Tier): { providerId: string; model: string } | null {
  const p = getProviders().find((x) => x.id === providerId);
  if (!p) return null;
  const slot = p.tiers?.[tier];
  const model = slot?.model || p.models[0] || "";
  return model ? { providerId, model } : null;
}
/** Parse a "providerId/model" ModelRef string into parts. */
export function parseModelRef(ref: string | undefined | null): { providerId: string; model: string } | null {
  if (!ref) return null; const i = ref.indexOf("/"); if (i <= 0) return null;
  return { providerId: ref.slice(0, i), model: ref.slice(i + 1) };
}

/**
 * pi's built-in provider keys. When the resolved provider maps to one of these, pi already knows
 * its endpoint + model catalog — we only need to supply the API key via auth.json.
 */
export const BUILTIN_PI_PROVIDERS = new Set(["zai", "anthropic", "openai", "google", "deepseek", "kimi-coding", "openrouter"]);

/**
 * Resolve a provider to pi's built-in provider key. The primary source is the explicit `piKey` on the
 * row (set when the provider was added via the preset dropdown). The legacy baseUrl/name regex
 * inference is kept ONLY as a fallback for old rows that predate `piKey`. Returns "" when unknown.
 */
export function inferPiProvider(p: Provider | null | undefined): string {
  if (!p) return "";
  if (p.piKey && p.piKey.trim()) return p.piKey.trim();
  if (p.piProvider && p.piProvider.trim()) return p.piProvider.trim();
  const url = (p.baseUrl || "").toLowerCase();
  const name = (p.name || "").toLowerCase();
  if (/zhipu|glm|bigmodel|chatglm|z\.ai|\bzai\b/.test(url + " " + name)) return "zai";
  if (/deepseek/.test(url + " " + name)) return "deepseek";
  if (/moonshot|kimi/.test(url + " " + name)) return "kimi-coding";
  if (/openrouter/.test(url + " " + name)) return "openrouter";
  if (/api\.openai\.com|openai/.test(url + " " + name)) return "openai";
  if (/anthropic\.com|claude/.test(url + " " + name)) return "anthropic";
  return "";
}
/** The graceful fallback for a {providerId, model} (the model's slot fallback if it is a tiered model). */
export function fallbackFor(providerId: string, model: string): { providerId: string; model: string } | null {
  const p = getProviders().find((x) => x.id === providerId);
  if (!p?.tiers) return null;
  for (const t of ["high", "medium", "low"] as Tier[]) {
    if (p.tiers[t]?.model === model && p.tiers[t]?.fallback) return parseModelRef(p.tiers[t]!.fallback);
  }
  return null;
}

// Per-issue: the issue-wide PROVIDER override (the provider whose tiers the agents resolve against).
export function setIssueProvider(repo: string, number: number, providerId: string): void { setSetting(`issue_provider.${repo}#${number}`, providerId || ""); }
export function getIssueProvider(repo: string, number: number): string | null { const v = getSetting(`issue_provider.${repo}#${number}`); return v || null; }
export function clearIssueProvider(repo: string, number: number): void { setSetting(`issue_provider.${repo}#${number}`, ""); }

// Per-issue PER-AGENT override: { "<roleOrHandle>": "providerId/model" }.
export function setIssueAgentModel(repo: string, number: number, agent: string, ref: string): void {
  const cur = getIssueAgentModels(repo, number); if (ref) cur[agent] = ref; else delete cur[agent];
  setSetting(`issue_agent_models.${repo}#${number}`, JSON.stringify(cur));
}
export function getIssueAgentModels(repo: string, number: number): Record<string, string> {
  try { return JSON.parse(getSetting(`issue_agent_models.${repo}#${number}`) ?? "{}") as Record<string, string>; } catch { return {}; }
}

// Per-issue "use fallback" toggle (step best→worse on failure). Default ON.
export function setIssueUseFallback(repo: string, number: number, on: boolean): void { setSetting(`issue_use_fallback.${repo}#${number}`, on ? "1" : "0"); }
export function getIssueUseFallback(repo: string, number: number): boolean { const v = getSetting(`issue_use_fallback.${repo}#${number}`); return v == null ? true : v === "1"; }
