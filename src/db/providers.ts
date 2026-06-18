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

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** Which runner executes roles on this provider. Default claude-sdk. pi/claude/gemini CLIs via cli. */
  runner?: "claude-sdk" | "claude-cli" | "pi-cli" | "custom-cli";
  /** Command template for custom-cli / cli runners: {model} {systemPrompt} {task} {workdir}. */
  cliCommand?: string;
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
