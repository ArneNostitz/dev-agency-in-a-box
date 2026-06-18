/**
 * IssueState — the single owner of an issue's lifecycle (architecture review,
 * Candidate 1). Five lifecycle states plus a separate, extensible BlockedReason.
 *
 * Labels are a WRITE-ONLY projection of this module's state onto GitHub (see
 * `labelsFor`); nothing in the agency reads them back as truth. That removes the
 * class of bugs where the GitHub label and the DB disagreed.
 *
 * `parseLegacyStatus` maps the old `agency:*` label strings and the old mixed DB
 * column ("planned" vs "agency:planned") onto the new vocabulary, so the cutover can
 * read existing rows with no data migration.
 *
 * NOTE: IssueKind (epic / audit / queue / analyzer) and IssueFlags (unlimited /
 * ignore / audit-finding) are orthogonal and live elsewhere — this module owns the
 * lifecycle axis only. See CONTEXT.md.
 */

/** The lifecycle position of an issue. */
export type IssueState = "notPlanned" | "planned" | "working" | "review" | "done";

/** Why an issue is paused, independent of where it is in its lifecycle. Extensible. */
export type BlockedReason =
  | "awaitingApproval" // human must approve the plan before building
  | "awaitingAnswer" // agent asked a question mid-work
  | "needsAttention" // parked: out of revise rounds, unresolved, etc.
  | "conflict" // merge conflict on the branch
  | "rateLimited" // transient — provider rate limit
  | "budgetExceeded"; // over the per-issue token/$ budget

export interface IssueStatus {
  state: IssueState;
  blocked: BlockedReason | null;
}

/** The default status for an issue the agency has never touched. */
export const STATUS_NOT_PLANNED: IssueStatus = { state: "notPlanned", blocked: null };

export const ISSUE_STATES: readonly IssueState[] = ["notPlanned", "planned", "working", "review", "done"];
export const BLOCKED_REASONS: readonly BlockedReason[] = [
  "awaitingApproval",
  "awaitingAnswer",
  "needsAttention",
  "conflict",
  "rateLimited",
  "budgetExceeded",
];

const STATE_SET: ReadonlySet<string> = new Set(ISSUE_STATES);
const BLOCKED_SET: ReadonlySet<string> = new Set(BLOCKED_REASONS);

export function isIssueState(s: unknown): s is IssueState {
  return typeof s === "string" && STATE_SET.has(s);
}
export function isBlockedReason(s: unknown): s is BlockedReason {
  return typeof s === "string" && BLOCKED_SET.has(s);
}

/**
 * Allowed lifecycle edges. Every state also transitions to itself (no-op).
 * Permissive enough for reopens / follow-ups (done → working) while rejecting
 * nonsense jumps (e.g. notPlanned → review).
 */
const ALLOWED_TRANSITIONS: Record<IssueState, IssueState[]> = {
  notPlanned: ["planned", "done"],
  planned: ["working", "done", "notPlanned"],
  working: ["review", "done", "planned", "notPlanned"],
  review: ["working", "done", "planned"],
  done: ["working", "planned"], // reopen / follow-up on a closed issue
};

/** True iff `from → to` is a legal lifecycle transition (or a no-op). */
export function canTransition(from: IssueState, to: IssueState): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Move from → to, guarding the legal edges. Throws on an illegal jump so the bug
 * surfaces at the call site instead of silently corrupting state.
 */
export function transition(from: IssueState, to: IssueState): IssueState {
  if (!canTransition(from, to)) {
    throw new Error(`illegal IssueState transition: ${from} → ${to}`);
  }
  return to;
}

/** Construct a status, validating both fields. */
export function withStatus(state: IssueState, blocked: BlockedReason | null = null): IssueStatus {
  if (!isIssueState(state)) throw new Error(`invalid IssueState: ${String(state)}`);
  if (blocked != null && !isBlockedReason(blocked)) throw new Error(`invalid BlockedReason: ${String(blocked)}`);
  return { state, blocked };
}

/** Set a blocked reason, leaving the lifecycle state untouched. */
export function setBlocked(status: IssueStatus, reason: BlockedReason): IssueStatus {
  return { state: status.state, blocked: reason };
}

/** Clear any blocked reason, leaving the lifecycle state untouched. */
export function clearBlocked(status: IssueStatus): IssueStatus {
  return status.blocked == null ? status : { state: status.state, blocked: null };
}

/** True iff the issue is paused and needs the human before it can proceed. */
export function isWaitingOnHuman(status: IssueStatus): boolean {
  return status.blocked === "awaitingApproval" || status.blocked === "awaitingAnswer";
}

/** True iff the issue is finished (closed/merged). */
export function isTerminal(status: IssueStatus): boolean {
  return status.state === "done";
}

/**
 * The WRITE-ONLY GitHub-label projection of a status. Returns the legacy `agency:*`
 * strings so the human-facing board keeps working during migration; the agency never
 * reads these back. Both the state label and (if any) the blocked label are projected.
 */
const STATE_LABEL: Record<IssueState, string> = {
  notPlanned: "", // untouched issue — no label
  planned: "agency:planned",
  working: "agency:in-progress",
  review: "agency:ready",
  done: "", // done = closed/merged; the closed issue is the signal, no label needed
};

const BLOCKED_LABEL: Record<BlockedReason, string> = {
  awaitingApproval: "agency:awaiting-approval",
  awaitingAnswer: "agency:awaiting-answer",
  needsAttention: "agency:needs-attention",
  conflict: "🚧 blocked",
  rateLimited: "agency:rate-limited",
  budgetExceeded: "agency:needs-attention", // reuses the attention label; split later if useful
};

/**
 * Canonical GitHub-label strings — the SINGLE source for the `agency:*` projection
 * vocabulary (ADR-0001). Every other module imports these instead of redefining the
 * literals, so the label namespace can't drift. These are write-only projection
 * strings; reading them back as state is the bug the inversion kills.
 */
export const LABEL_PLANNED = STATE_LABEL.planned;
export const LABEL_IN_PROGRESS = STATE_LABEL.working;
export const LABEL_READY = STATE_LABEL.review;
export const LABEL_AWAITING_ANSWER = BLOCKED_LABEL.awaitingAnswer;
export const LABEL_AWAITING_APPROVAL = BLOCKED_LABEL.awaitingApproval;
export const LABEL_NEEDS_ATTENTION = BLOCKED_LABEL.needsAttention;
export const LABEL_RATE_LIMITED = BLOCKED_LABEL.rateLimited;
export const LABEL_CONFLICT = BLOCKED_LABEL.conflict;

/** Back-compat aliases for the names github.ts historically exported. */
export const AWAITING_LABEL = LABEL_AWAITING_ANSWER;
export const APPROVAL_LABEL = LABEL_AWAITING_APPROVAL;

/** Issues already in an agency lifecycle state — skip these when scanning for fresh work. */
export const STATE_LABELS = [LABEL_IN_PROGRESS, LABEL_READY, LABEL_NEEDS_ATTENTION];

/** Any state where the agency is paused waiting on the human. */
export const AWAITING_LABELS = [AWAITING_LABEL, APPROVAL_LABEL];

export function labelsFor(status: IssueStatus): string[] {
  const out: string[] = [];
  const s = STATE_LABEL[status.state];
  if (s) out.push(s);
  if (status.blocked) out.push(BLOCKED_LABEL[status.blocked]);
  return out;
}

/**
 * Loss-free migration of the old single-value representation onto the new vocabulary.
 * The old `issues.state` column (and the old labels) flattened state + blocked into one
 * string; this splits them back out. Limitation: when the old value was `agency:needs-
 * attention` we can't tell whether the underlying lifecycle was working or review, so we
 * default to working — a safe, conservative choice for the cutover.
 *
 * IssueKind/flag labels (agency:epic, agency:ignore, agency:unlimited, agency:audit…)
 * are NOT lifecycle states and map to notPlanned here; they are handled by their own
 * representations.
 */
export function parseLegacyStatus(raw: string | null | undefined): IssueStatus {
  switch ((raw ?? "").trim()) {
    case "agency:awaiting-approval":
      return { state: "planned", blocked: "awaitingApproval" };
    case "agency:awaiting-answer":
      return { state: "working", blocked: "awaitingAnswer" };
    case "agency:needs-attention":
      return { state: "working", blocked: "needsAttention" };
    case "agency:rate-limited":
      return { state: "working", blocked: "rateLimited" };
    case "agency:planned":
    case "planned":
      return { state: "planned", blocked: null };
    case "agency:in-progress":
      return { state: "working", blocked: null };
    case "agency:ready":
      return { state: "review", blocked: null };
    case "done":
    case "merged":
    case "closed":
      return { state: "done", blocked: null };
    default:
      return STATUS_NOT_PLANNED;
  }
}
