/**
 * The orchestrator's decision core (Phase 3) — pure, deterministic, zero-token "what next?".
 *
 * The old flow ran a fixed planner→dev→test→review chain with the branching logic tangled into the
 * loop body. This extracts the decisions into one function over a compact handoff state, so the
 * controller does the cheap thinking in code instead of paying an agent to re-derive it. A failing
 * test loops back to the (warm) developer with just the errors; a no-op stops; approval finalizes.
 */

export type Phase = "developed" | "tested" | "reviewed" | "revised";
export type Action = "test" | "review" | "revise" | "finalize" | "stop";

export interface HandoffState {
  phase: Phase;
  /** Did the last developer turn actually change anything (HEAD moved / tree dirty)? */
  devChanged: boolean;
  /** Did the last test run pass? (undefined before any test) */
  testPass?: boolean;
  /** Latest reviewer verdict. (undefined before any review) */
  reviewVerdict?: "approved" | "changes";
  /** Completed revise rounds so far. */
  round: number;
  /** Max revise rounds before we stop auto-revising and hand back to the human. */
  maxRounds: number;
}

export interface Decision {
  action: Action;
  /** Short machine-ish reason (for logs / the handoff trail), not necessarily human-facing. */
  reason: string;
  /** True when finalizing with the reviewer still wanting changes (park as "ready, needs changes"). */
  stillChanges?: boolean;
}

/** Decide the next move from the current handoff state. Pure — no I/O, fully unit-testable. */
export function decideNext(s: HandoffState): Decision {
  switch (s.phase) {
    case "developed":
      return { action: "test", reason: "fresh code → run checks" };

    case "revised":
      if (!s.devChanged) return { action: "stop", reason: "revise produced no change" };
      return { action: "test", reason: "revised code → re-run checks" };

    case "tested":
      if (s.testPass === false) {
        if (s.round < s.maxRounds) return { action: "revise", reason: "tests failed → fix (errors only)" };
        return { action: "finalize", reason: "tests failing, out of rounds → park", stillChanges: true };
      }
      return { action: "review", reason: "tests passed → review" };

    case "reviewed":
      if (s.reviewVerdict === "approved") return { action: "finalize", reason: "approved" };
      if (s.round < s.maxRounds) return { action: "revise", reason: "changes requested → fix" };
      return { action: "finalize", reason: "changes requested, out of rounds → park", stillChanges: true };

    default:
      return { action: "finalize", reason: "unknown phase → finalize" };
  }
}
