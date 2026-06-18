/**
 * Cost guardrails. Three layers:
 *   1. Per-run: maxTurns / maxTokensPerRun passed to the agent runner.
 *   2. Per-issue: total spend (USD if reported, turns as the universal backstop) across all
 *      runs for an issue. Over budget → the issue is parked with BlockedReason "budgetExceeded"
 *      (see src/state.ts), never silently burning more.
 *   3. Per-issue OVERRIDE: each issue can carry its own {maxCostUsd, maxTurns, maxTokensPerRun}
 *      and/or an `unlimited` flag (DB-backed, set from the dashboard — replaces the old
 *      `agency:unlimited` GitHub label, which has no power per ADR-0001).
 *
 * "Cheapest model capable" is the project goal; per-issue budgets let a small task cap itself
 * low and a big task get room, instead of one global ceiling.
 */
import { getSetting, setSetting } from "./store.js";

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

/** A per-issue budget override. Any unset field inherits the global limit. `unlimited` exempts. */
export interface IssueBudget {
  maxCostUsd?: number;
  maxTurns?: number;
  maxTokensPerRun?: number;
  unlimited?: boolean;
}

const BUDGET_KEY = (repo: string, number: number): string => `issue_budget.${repo}#${number}`;

// Dashboard setting wins over env var wins over the built-in default (so it's tunable live).
const num = (name: string, fallback: number, settingKey?: string): number => {
  if (settingKey) {
    const raw = getSetting(settingKey);
    if (raw != null && raw !== "") {
      const s = Number(raw);
      if (Number.isFinite(s) && s >= 0) return s;
    }
  }
  const v = Number(process.env[name]?.trim());
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/** The global limits, as configured in the dashboard / env / defaults. */
export function loadBudget(): BudgetLimits {
  return {
    maxIssueCostUsd: num("MAX_ISSUE_COST_USD", 15, "max_issue_cost_usd"),
    maxIssueTurns: num("MAX_ISSUE_TURNS", 800, "max_issue_turns"),
    maxTurnsPerRun: num("MAX_TURNS_PER_RUN", 250, "max_turns_per_run"),
    maxTokensPerRun: num("MAX_TOKENS_PER_RUN", 600_000, "max_tokens_per_run"),
  };
};

/** Read a per-issue budget override (or null if none set). */
export function getIssueBudget(repo: string, number: number): IssueBudget | null {
  const raw = getSetting(BUDGET_KEY(repo, number));
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as IssueBudget;
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

/** Set (or clear, with an empty object) a per-issue budget override. */
export function setIssueBudget(repo: string, number: number, b: IssueBudget | null): void {
  if (!b || Object.keys(b).length === 0) setSetting(BUDGET_KEY(repo, number), "");
  else setSetting(BUDGET_KEY(repo, number), JSON.stringify(b));
}

/** Convenience: toggle the unlimited flag on/off for an issue. */
export function setIssueUnlimited(repo: string, number: number, unlimited: boolean): void {
  const b = getIssueBudget(repo, number) ?? {};
  setIssueBudget(repo, number, { ...b, unlimited });
}

/**
 * The effective limits for an issue: the per-issue override merged over the global limits,
 * plus the resolved `unlimited` flag. `unlimited` short-circuits every check.
 */
export function effectiveLimits(repo: string, number: number): BudgetLimits & { unlimited: boolean } {
  const base = loadBudget();
  const o = getIssueBudget(repo, number);
  if (!o) return { ...base, unlimited: false };
  return {
    maxIssueCostUsd: o.maxCostUsd ?? base.maxIssueCostUsd,
    maxIssueTurns: o.maxTurns ?? base.maxIssueTurns,
    maxTurnsPerRun: base.maxTurnsPerRun, // not overridden per-issue
    maxTokensPerRun: o.maxTokensPerRun ?? base.maxTokensPerRun,
    unlimited: o.unlimited === true,
  };
}

/**
 * Returns a human-readable reason if the issue is over budget, else null.
 * A limit of 0 disables that check. Callers should also honour `effectiveLimits(...).unlimited`
 * (which short-circuits before calling this).
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
