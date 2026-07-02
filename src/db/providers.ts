/**
 * LLM providers, model assignments, fallback chain, and per-issue model overrides.
 * Extracted from store.ts (Candidate 3, #70). Depends on settings (getSetting/setSetting)
 * and reads web/models.json for presets. NOTE: the models.json path is relative to this
 * file (src/db/), so it's ../../web/models.json.
 */
import { getDb } from "./connection.js";
import { getSetting, setSetting } from "./settings.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Tier = "high" | "medium" | "low";
/** A model tier slot: which model + its graceful-fallback (a "providerId/model" string, "" = none). */
export interface TierSlot { model: string; fallback: string; }
export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** Per-provider High/Medium/Low model slots (each with its own fallback model). */
  tiers?: { high?: TierSlot; medium?: TierSlot; low?: TierSlot };
  /** Which runner executes roles on this provider. Default claude-sdk. pi/claude/gemini CLIs via cli. */
  runner?: "claude-sdk" | "claude-cli" | "pi-cli" | "custom-cli";
  /** Command template for custom-cli / cli runners: {model} {systemPrompt} {task} {workdir}. */
  cliCommand?: string;
  /**
   * pi runner: pi's OWN built-in provider name (e.g. "zai", "deepseek", "kimi-coding", "openrouter").
   * The pi runner registers this provider via an isolated ~/.pi/agent/auth.json (pi's real schema) so
   * pi authenticates against the right endpoint without a hand-built models.json. Optional: when unset,
   * inferPiProvider() derives it from baseUrl/name so the seeded presets (GLM, DeepSeek, Kimi…) work
   * with zero configuration. Set it explicitly in Settings → Models & runners to override the guess.
   */
  piProvider?: string;
  /**
   * Opaque per-runner config blob for future/CLI runners (e.g. a gemini-cli flag set). Not read by the
   * built-in runners yet — kept on the row so adding a runner is a registry entry + Settings field,
   * not a schema change. Forward-compatible; safely ignored when unused.
   */
  runnerConfig?: Record<string, unknown>;
}

let _modelsPresetCache: Record<string, string[]> | null = null;
export function getModelsPresets(): Record<string, string[]> {
  if (_modelsPresetCache) return _modelsPresetCache;
  try {
    const filePath = join(dirname(fileURLToPath(import.meta.url)), "../../web/models.json");
    if (existsSync(filePath)) {
      _modelsPresetCache = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string[]>;
      return _modelsPresetCache;
    }
  } catch {
    /* ignore */
  }
  return {
    "Claude (Subscription)": ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    "Gemini": ["gemini-3.5-flash", "gemini-3.5-pro", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro", "gemini-1.5-flash"],
    "GLM (Zhipu)": ["glm-5.2", "glm-5.1", "glm-4.6", "glm-4.5"],
    "DeepSeek": ["deepseek-chat", "deepseek-reasoner"],
    "Kimi (Moonshot)": ["kimi-k2-0905-preview"]
  };
}

export function getProviders(): Provider[] {
  try {
    const list = JSON.parse(getSetting("providers") ?? "[]") as Provider[];
    const presets = getModelsPresets();
    for (const p of list) {
      const presetModels = presets[p.name];
      if (presetModels && presetModels.length) {
        const missing = presetModels.filter((m) => !p.models.includes(m));
        if (missing.length > 0) {
          p.models = [...missing, ...p.models];
        }
      }
    }
    return list;
  } catch {
    return [];
  }
}
export function setProviders(list: Provider[]): void {
  setSetting("providers", JSON.stringify(list ?? []));
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
 * Map an agency Provider to pi's OWN built-in provider name — the one pi uses to know a provider's
 * baseUrl/protocol/model-catalog, so the pi runner only has to supply the API key (via an isolated
 * auth.json in pi's real schema). Explicit `p.piProvider` always wins; otherwise we infer from the
 * baseUrl/name so the seeded presets (GLM, DeepSeek, Kimi, OpenRouter, OpenAI, Anthropic) work with
 * no configuration. Returns "" when no built-in matches → the pi runner will register a custom
 * provider via a real-schema models.json (see preparePiConfig).
 */
export function inferPiProvider(p: Provider | null | undefined): string {
  if (!p) return "";
  if (p.piProvider && p.piProvider.trim()) return p.piProvider.trim();
  const url = (p.baseUrl || "").toLowerCase();
  const name = (p.name || "").toLowerCase();
  // Order matters: most-specific hosts first. Each entry maps a recognizable baseUrl/name fragment
  // to pi's built-in provider key (verified against pi's known provider set).
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
