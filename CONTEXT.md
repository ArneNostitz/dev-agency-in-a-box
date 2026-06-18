# Dev Agency

A dashboard that works autonomously on issues: defined workflows run intelligently,
optimising for resources (least tokens, cheapest capable model). The dashboard is a
live representation of the work and the state of the issues; it is the source of truth.
GitHub is a mirror and a code host, not the database.

## Language

### Tracking model

**IssueState**:
The lifecycle position of an issue — where it is in its journey from intake to done.
Five states: `notPlanned → planned → working → review → done`. Owned by a single
module as a closed set with an explicit transition guard. The DB `issues.state`
column holds the canonical enum string directly.
_Avoid_: status, column, stage, label

**IssueKind**:
What sort of thing an issue is — orthogonal to its lifecycle. Examples: a normal work
issue, an Epic, an audit, a queue. An issue keeps its kind across all states.
_Avoid_: type, category

**IssueFlag**:
A boolean facet that is true about an issue regardless of its lifecycle state.
Examples: unlimited (exempt from budget), ignore (muted), audit-finding. Flags
overlay the state; they never replace it.
_Avoid_: tag, attribute, property

**BlockedReason**:
*Why* an issue is paused, independent of where it is in its lifecycle. A separate
field from IssueState: `awaitingApproval | awaitingAnswer | needsAttention |
conflict | rateLimited | budgetExceeded | …`. Cleared independently of the state.
Extensible — new reasons (e.g. real token/$ budget gates) are added here, not as new
states. An issue is "in flight" iff it has a state and no BlockedReason.
_Avoid_: sub-state, status code (it is not a lifecycle position)

**GitHub Label**:
A string attached to an issue on the GitHub host. Two directions, kept strictly apart:
- *Outbound* (`agency:in-progress`, `agency:ready`, …) — a projection of the dashboard's
  IssueState/BlockedReason onto GitHub for human scannability. Write-only and **opt-in,
off by default**; the agency never reads these back. See ADR-0001.
- *Inbound* (`agency:ignore` = mute; `agency:queue` = optional start trigger) — a signal
  the human sends from GitHub into the dashboard. These are real input, not state.
_Avoid_: (when meaning lifecycle) label — use IssueState.

### Roles & execution

**Agent**:
A role with a persona, tools, model, and skills that performs one kind of work
(planner, developer, reviewer, tester, …). Runs via a pluggable runner.
_Avoid_: worker, bot

**Runner**:
The adapter that executes an agent against an LLM backend (Claude SDK, pi CLI, any
CLI). The agency uses external tools as tools; it does not assimilate them.
_Avoid_: provider (that's the LLM account), backend

**Handoff**:
The compact machine state passed between the orchestrator and an agent (and between
agents): branch, changed files, last test, review verdict, open questions. Replaces
re-feeding the whole thread every turn.
_Avoid_: context, message, prompt

**Orchestrator**:
The deterministic controller that owns the work graph — all issues, their states,
file locks, and dispatch — and decides the next move in code, escalating to an LLM
only when genuinely ambiguous.
_Avoid_: pipeline, dispatcher (those are parts of it)
