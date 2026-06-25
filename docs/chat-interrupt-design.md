# Chat-interrupt of a running agency (design)

Status: **DESIGN + partial UI shipped** (v1.18.x). Backend queue mechanics are the documented follow-up.

## Goal
While the agency is running a workflow on an issue, the user can talk to it in the chat to *steer*
it without losing work. A message is either a **nudge** (a hint to the currently-running agent, no
interruption) or an **interruption** (hold the workflow, apply the steer, then resume).

## Model

### Preselected chat target
- **While running:** the preselected agent to talk to is the **currently-running** one. A plain
  comment is a *nudge* — appended to context the agent reads; it does not interrupt.
- **When parked "needs you":** the preselected agent is the **next-in-line** agent (the one who would
  run next), so the user's reply briefs the right teammate.

### Interruption (steer)
- The user can explicitly **interrupt** (a control distinct from a plain nudge). The message is
  **queued** and applied at the **earliest safe break**.
- **Earliest safe break = the next step boundary**: the current agent run finishes (its partial work
  is preserved), then *before the next agent starts*, the queued steer is applied and the **workflow
  goes ON HOLD**.
- On hold, the workflow does not advance. The user can keep chatting. A **Resume** picks the workflow
  back up, carrying the new chat context into the next step.

### Where can we interrupt? (the safe breaks)
The pipeline runs agents in sequence (plan → build → test → review → …). The safe points are the
**step boundaries** already guarded by `isStopRequested` in `pipeline.ts`. A new `isHoldRequested`
flag, checked at the SAME boundaries, lets the engine pause (instead of stop) and persist a
`workflow:held` state. (Stop = cut everything; Hold = pause + resumable.)

## Backend plan (follow-up)
1. `abort.ts`: add `requestHold/clearHold/isHoldRequested` + a queued-steer store
   (`queueSteer(repo,number,text)` / `takeSteer`).
2. `pipeline.ts`: at each step boundary, `if (isHoldRequested) { persist held; return; }` — same
   places as the stop checks. Before running the next step, `takeSteer()` and prepend it to the
   step's task if present.
3. State: a `held` issue status (distinct from parked/needs-you) so the dashboard shows "on hold".
4. Route: `/hold` (queue a steer + request hold) and reuse `/resume` to clear hold and continue.

## Frontend (shipped now)
- Chat composer **preselects** the running agent (or next-in-line when parked).
- A **workflow timeline above the chat** with an "interruption" marker + a **Resume** play when held.
- A plain comment is a nudge; an explicit "Interrupt & steer" queues the hold.

The visible scaffolding ships first so the interaction is testable; the queue/hold engine lands next.
