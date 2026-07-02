/**
 * The single rule that decides what to do with a thread (issue OR PR) on each scan.
 *
 * Guiding principle: once the agency has *touched* a thread, any new comment from the human
 * re-engages it — open or closed, issue or PR, with no need to re-tag a handle. A thread the
 * agency has never touched sits in Inbox until a human explicitly promotes it from the
 * dashboard — nothing auto-starts a fresh GitHub issue.
 *
 * This is a pure function so it can be unit-tested without GitHub.
 */
export type ThreadAction = "skip" | "fresh" | "resume" | "prfix" | "followup";

export interface ThreadSignals {
  ignored: boolean;
  inProgress: boolean;
  /** issue is closed (or its PR was merged). */
  closed: boolean;
  /** state is "review" (an open PR was delivered). */
  ready: boolean;
  /** blocked is "needsAttention" (parked / blocked). */
  needsAttention: boolean;
  /** is paused waiting on the human (awaiting-answer / awaiting-approval). */
  awaiting: boolean;
  /** the agency has touched this thread before (triaged past Inbox, or an agency comment). */
  owned: boolean;
  /** there is a NEW human comment we have not handled yet (cursor-deduped). */
  newHumanComment: boolean;
  /** the human 👍'd the latest proposal (approval without a comment). */
  approvedReaction: boolean;
  /** an OPEN agency PR exists for this issue's branch. */
  hasOpenPr: boolean;
}

export function decideThreadAction(s: ThreadSignals): ThreadAction {
  if (s.ignored) return "skip";
  if (s.inProgress) return "skip"; // actively being worked — don't double-dispatch

  // A new comment on a thread with a live PR is feedback for that PR.
  if (s.hasOpenPr && s.newHumanComment) return "prfix";

  // Paused on the human: resume on a reply or a 👍 (the pipeline sorts approve vs. answer vs. change).
  if (s.awaiting) return s.newHumanComment || s.approvedReaction ? "resume" : "skip";

  // A new comment on a thread the agency owns re-engages it — even if closed/merged/ready.
  if (s.newHumanComment && s.owned) {
    return s.closed || s.ready || s.needsAttention ? "followup" : "fresh";
  }

  return "skip";
}
