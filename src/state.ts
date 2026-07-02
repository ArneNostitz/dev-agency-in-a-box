/**
 * IssueState — the single owner of an issue's lifecycle (architecture review,
 * Candidate 1). Five lifecycle states plus a separate, extensible BlockedReason.
 *
 * GitHub labels are gone entirely (docs/adr/0003) — the DB `issues.state`/`issues.blocked`
 * columns are the only representation of an issue's status, full stop.
 *
 * `notPlanned` doubles as "Inbox": a GitHub-originated issue the agency has never had a
 * human decision on. It starts there and moves to `planned`/`working` only when a human
 * explicitly promotes it from the dashboard — nothing auto-starts it.
 *
 * `parseLegacyStatus` maps the old `agency:*` label strings and the old mixed DB
 * column ("planned" vs "agency:planned") onto the new vocabulary, so the cutover can
 * read existing rows with no data migration.
 *
 * NOTE: IssueKind (epic / audit / analyzer) and IssueFlags (unlimited) are orthogonal
 * and live elsewhere — this module owns the lifecycle axis only. See CONTEXT.md.
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
  | "budgetExceeded" // over the per-issue token/$ budget
  | "held"; // user interrupted to steer — paused at a step boundary, resumable

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
  "held",
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
  notPlanned: ["planned", "working", "done"],
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
 * The DB `issues.state` column value for a status — the canonical lifecycle enum string
 * itself ("notPlanned"/"planned"/"working"/"review"/"done"). No legacy composite, no
 * `agency:*` mapping (ADR-0001: no back-compat — beta/single-user, DB can be flushed).
 * The BlockedReason lives in its own `issues.blocked` column.
 */
export function stateColumnFor(status: IssueStatus): string {
  return status.state;
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
    case "working":
      return { state: "working", blocked: null };
    case "agency:ready":
    case "review":
      return { state: "review", blocked: null };
    case "done":
    case "merged":
    case "closed":
      return { state: "done", blocked: null };
    case "notPlanned":
      return STATUS_NOT_PLANNED;
    default:
      return STATUS_NOT_PLANNED;
  }
}
