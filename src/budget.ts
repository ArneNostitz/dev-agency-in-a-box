/**
 * Cost guardrails. Two layers:
 *   1. Per-run: maxTurns passed to the Agent SDK (a single agent can't loop forever).
 *   2. Per-issue: total spend (USD if reported, turns as the universal backstop) across all
 *      runs for an issue. Over budget -> the issue is parked `agency:needs-attention` with a
 *      clear comment, never silently burning more.
 * Escape hatch: label an issue `agency:unlimited` to exempt it.
 */

import { getSetting } from "./store.js";

export const UNLIMITED_LABEL = "agency:unlimited";

export interface BudgetLimits {
  /** Max total USD per issue (0 disables the cost check — e.g. subscription auth). */
  maxIssueCostUsd: number;
  /** Max total agent turns per issue (universal backstop, works without cost data). */
  maxIssueTurns: number;
  /** Global ceiling on turns for a single agent run (per-role caps may be lower). */
  maxTurnsPerRun: number;
  /** Hard token kill-switch for a single run — stop it if it blows past this (0 disables). */
  maxTokensPerRun: number;
}

// Dashboard setting wins over env var wins over the built-in default (so it's tunable live).
const num = (name: string, fallback: number, settingKey?: string): number => {
  if (settingKey) {
    const s = Number(getSetting(settingKey));
    if (Number.isFinite(s) && s >= 0) return s;
  }
  const v = Number(process.env[name]?.trim());
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export function loadBudget(): BudgetLimits {
  return {
    maxIssueCostUsd: num("MAX_ISSUE_COST_USD", 15),
    maxIssueTurns: num("MAX_ISSUE_TURNS", 800),
    maxTurnsPerRun: num("MAX_TURNS_PER_RUN", 250),
    maxTokensPerRun: num("MAX_TOKENS_PER_RUN", 600_000, "max_tokens_per_run"),
  };
}

/**
 * Returns a human-readable reason if the issue is over budget, else null.
 * A limit of 0 disables that check.
 */
export function overBudget(
  spend: { costUsd: number; turns: number },
  limits: BudgetLimits,
): string | null {
  if (limits.maxIssueCostUsd > 0 && spend.costUsd >= limits.maxIssueCostUsd) {
    return `spent $${spend.costUsd.toFixed(2)} (limit $${limits.maxIssueCostUsd})`;
  }
  if (limits.maxIssueTurns > 0 && spend.turns >= limits.maxIssueTurns) {
    return `used ${spend.turns} agent turns (limit ${limits.maxIssueTurns})`;
  }
  return null;
}
