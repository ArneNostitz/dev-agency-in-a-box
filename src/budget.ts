/**
 * Cost guardrails. Two layers:
 *   1. Per-run: maxTurns passed to the Agent SDK (a single agent can't loop forever).
 *   2. Per-issue: total spend (USD if reported, turns as the universal backstop) across all
 *      runs for an issue. Over budget -> the issue is parked `agency:needs-attention` with a
 *      clear comment, never silently burning more.
 * Escape hatch: label an issue `agency:unlimited` to exempt it.
 */

export const UNLIMITED_LABEL = "agency:unlimited";

export interface BudgetLimits {
  /** Max total USD per issue (0 disables the cost check — e.g. subscription auth). */
  maxIssueCostUsd: number;
  /** Max total agent turns per issue (universal backstop, works without cost data). */
  maxIssueTurns: number;
  /** Max turns for a single agent run (passed to the SDK). */
  maxTurnsPerRun: number;
}

const num = (name: string, fallback: number): number => {
  const trimmed = process.env[name]?.trim();
  if (!trimmed) return fallback;
  const v = Number(trimmed);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export function loadBudget(): BudgetLimits {
  return {
    maxIssueCostUsd: num("MAX_ISSUE_COST_USD", 15),
    maxIssueTurns: num("MAX_ISSUE_TURNS", 800),
    maxTurnsPerRun: num("MAX_TURNS_PER_RUN", 250),
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
