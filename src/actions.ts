/**
 * availableActions — the single source of truth for which actions an issue offers, derived
 * from its IssueStatus + observable facts (architecture review, Candidate 5). Pure and
 * unit-testable; the frontend renders the list, the server can mirror it so a stale UI
 * can't offer an invalid action.
 *
 * This codifies the decision tree that lived inline in web/detail.js's button-builders
 * (the "bulletproof buttons" ask): every guard (running, hasPr, parked, awaiting, epic,
 * approved, …) becomes a branch, and the result is a list of {id, variant, confirm?} the
 * UI maps to buttons. Stop/Cancel/Resume/Reload/Delete/Merge all have explicit rules.
 */
import type { IssueStatus, BlockedReason } from "./state.js";

export type ActionId =
  | "stop" // interrupt the running agent
  | "toPlanned" // park (no AI until started)
  | "start" // begin building
  | "approve" // approve a posted plan
  | "resume" // re-run the agent
  | "fix" // address review changes / resolve conflicts
  | "createPr" // open a PR from the approved branch (token-free)
  | "merge" // merge the PR & close
  | "mergeAnyway" // merge despite requested changes
  | "close" // mark done (no PR) / complete an epic
  | "cancel" // reset to Planned, keep branch/PR on GitHub
  | "delete"; // hard delete

export type Variant = "primary" | "green" | "warn" | "danger" | "neutral";

export interface Action {
  id: ActionId;
  variant: Variant;
  /** Requires a confirm tap (armed) before firing — destructive / irreversible actions. */
  confirm?: boolean;
}

/** The observable facts an issue presents, beyond its lifecycle status. */
export interface ActionFacts {
  /** A run is actually executing right now (the live abort registry). */
  running: boolean;
  /** An open PR exists for this issue. */
  hasPr: boolean;
  /** Reviewer verdict (only meaningful when hasPr / state review). */
  review?: "approved" | "changes";
  /** A merge conflict is blocking the branch. */
  conflict: boolean;
  /** This issue is an Epic (a parent with sub-issues). */
  isEpic: boolean;
  /** The reviewer approved but no PR has been opened yet. */
  approvedNoPr: boolean;
  /** Whether a "fix" is wanted (reviewer requested changes). */
  needsFix: boolean;
}

/**
 * Decide the ordered action set for an issue from its status + facts. Mirrors the
 * web/detail.js toolbar tree exactly, but as data. `done` issues offer nothing (the
 * closed/merged issue is the signal); a done issue that's re-opened arrives as a non-done
 * status via the state machine.
 */
export function availableActions(status: IssueStatus, facts: ActionFacts): Action[] {
  if (status.state === "done") return [];
  const out: Action[] = [];

  if (facts.running) {
    out.push({ id: "stop", variant: "warn" });
    return out; // the only meaningful action while executing
  }

  if (facts.hasPr) {
    if (facts.conflict) out.push({ id: "fix", variant: "primary" });
    else if (facts.needsFix) {
      out.push({ id: "fix", variant: "primary" });
      out.push({ id: "mergeAnyway", variant: "green", confirm: true });
    } else out.push({ id: "merge", variant: "green", confirm: true });
    out.push({ id: "resume", variant: "neutral" });
    out.push({ id: "cancel", variant: "warn" });
    return out;
  }

  const parked = status.state === "notPlanned" || status.state === "planned";
  const awaiting = status.blocked === "awaitingApproval";

  // Inbox: a never-triaged GitHub issue. Offer both a straight Start and a Plan (park in
  // Planned without starting) — the only place both are offered together.
  if (status.state === "notPlanned") {
    out.push({ id: "start", variant: "green" });
    out.push({ id: "toPlanned", variant: "neutral" });
    return out;
  }

  if (facts.isEpic) {
    out.push({ id: "close", variant: "green", confirm: true }); // complete/close (merges remaining sub-PRs)
    out.push({ id: "resume", variant: "neutral" });
    out.push({ id: "cancel", variant: "warn" });
    return out;
  }
  if (parked && !awaiting) {
    out.push({ id: "start", variant: "green" });
    return out;
  }
  if (awaiting) {
    out.push({ id: "approve", variant: "primary" });
    out.push({ id: "toPlanned", variant: "neutral" });
    return out;
  }
  if (facts.approvedNoPr) {
    out.push({ id: "createPr", variant: "green" });
    out.push({ id: "resume", variant: "neutral" });
    out.push({ id: "cancel", variant: "warn" });
    return out;
  }
  // working / review / needs-attention / answered, no PR → re-engage, close, or park
  out.push({ id: "resume", variant: "neutral" });
  out.push({ id: "close", variant: "neutral", confirm: true });
  out.push({ id: "cancel", variant: "warn" });
  return out;
}

/** True if `id` is offered for the given status + facts. */
export function offersAction(status: IssueStatus, facts: ActionFacts, id: ActionId): boolean {
  return availableActions(status, facts).some((a) => a.id === id);
}
