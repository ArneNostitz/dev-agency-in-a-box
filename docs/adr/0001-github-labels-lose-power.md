# ADR-0001 — GitHub labels lose power; outbound projection is opt-in (off by default)

- **Status:** Accepted
- **Date:** 2026-06-18
- **Context:** [Candidate 1 — IssueState module](../src/state.ts) architecture review

## Context

Historically the agency treated GitHub as its database: `agency:*` labels **were** the
state machine (issues = queue, comments = thread, labels = state). Issue state was
represented three ways at once — labels defined in four files (`github.ts`,
`pipeline.ts`, `runner.ts`, `epics.ts`), a DB `issues.state` column in two string
formats (`"planned"` and `"agency:planned"`), and label-derived booleans — and
`webhook.ts` had to do `state === "planned" || "agency:planned" || "agency:awaiting-approval"`
to recognise one concept.

The dashboard-first inversion (CONTEXT.md) makes the **local DB authoritative**; GitHub
becomes a mirror and a code host. Once the DB owns state, the outbound `agency:*` labels
have no function inside the agency — reading them back as truth is the bug.

## Decision

1. **GitHub labels have no power inside the agency.** Nothing reads `agency:*` labels
   back as state. `IssueState`/`BlockedReason` (in `src/state.ts`) is the only source of
   truth; labels are a derived projection, never an input. (Recorded in CONTEXT.md.)

2. **Outbound label projection is opt-in, off by default.** `state.ts` exposes
   `labelsFor(status)` as a *capability* — the pure function that returns which labels
   *would* represent a status. Actually calling the GitHub label API is gated behind a
   setting (`github_label_projection`, default `off`) at the I/O boundary
   (`GitHubMirror` in Candidate 2). With projection off, the agency writes **zero**
   outbound `agency:*` labels — no stacking, no noise.

3. **Two labels survive as real GitHub objects, because they are inbound, not outbound.**
   - `agency:ignore` — the human's mute signal (GitHub → dashboard).
   - `agency:queue` — an optional start trigger (GitHub → dashboard; only when
     `triggerMode === "label"`).

   These are the human talking *to* the agency from GitHub, the opposite direction from
   state projection. They are handled as an `IssueFlag` / trigger, not as lifecycle
   state, and are not part of `labelsFor`'s output.

4. **`agency:unlimited`** (budget bypass) is deferred — it can stay as an inbound label
   for now or become a dashboard toggle later. Not decided here.

## Alternatives considered

- **Keep projecting all labels for GitHub scannability.** Rejected: the dashboard is the
  live representation of work (CONTEXT.md); if no one drives from the GitHub issue list,
  the labels are pure cost. And they stack (`agency:in-progress` + `agency:awaiting-answer`
  + 🚧), which is noise, not signal.
- **Read labels back as a fallback / for drift detection.** Rejected: that reintroduces
  the two-representation ambiguity the inversion is meant to kill. The webhook is the
  inbound channel for human edits; it writes to the DB, not the other way round.
- **Delete `labelsFor` entirely.** Rejected: the capability is cheap, pure, and tested,
  and some users (or future saved-view integrations) may want outbound projection. Off
  by default, not removed.

## Consequences

- The four duplicated label-constant blocks and the triple-compare (`webhook.ts`) get
  deleted during the Candidate 1 call-site migration; the one remaining notion of "what
  labels would this status have" lives in `state.ts`.
- `labelsFor` is never read back — the test suite asserts this is a write-only projection.
- Anyone who relied on seeing `agency:in-progress` etc. on GitHub must enable
  `github_label_projection`. Default users see a clean GitHub issue list; the dashboard
  is where state lives.
- Inbound trigger/mute labels (`agency:ignore`, optionally `agency:queue`) are unaffected
  and remain first-class inputs.
