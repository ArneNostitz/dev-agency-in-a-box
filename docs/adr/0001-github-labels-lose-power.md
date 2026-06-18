# ADR-0001 — GitHub labels lose power; DB holds canonical state (no back-compat)

- **Status:** Accepted
- **Date:** 2026-06-18
- **Supersedes:** the earlier draft that kept a legacy `agency:*` composite in the DB column.
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
have no function inside the agency.

## Decision

1. **GitHub labels have no power inside the agency.** Nothing reads `agency:*` labels
   back as state. `IssueState`/`BlockedReason` (in `src/state.ts`) is the only source of
   truth. (Recorded in CONTEXT.md.)

2. **The DB `issues.state` column holds the canonical lifecycle enum directly**
   (`notPlanned` / `planned` / `working` / `review` / `done`), and `issues.blocked` holds
   the `BlockedReason`. **No legacy `agency:*` composite, no back-compat mapping.** This
   project is beta, single-user, and the DB can be flushed/re-imported, so the cleanest
   representation wins.

3. **Outbound GitHub label projection is opt-in, off by default.** `state.ts` exposes
   `labelsFor(status)` as a *capability* — the pure function that returns which labels
   *would* represent a status. Actually calling the GitHub label API is gated behind a
   setting (`github_label_projection`, default `off`) at the I/O boundary (`GitHubMirror`
   in Candidate 2, #69). With projection off, the agency writes **zero** outbound
   `agency:*` labels.

4. **Two labels survive as real GitHub objects, because they are inbound, not outbound.**
   - `agency:ignore` — the human's mute signal (GitHub → dashboard).
   - `agency:queue` — an optional start trigger (GitHub → dashboard; only when
     `triggerMode === "label"`).

   These are the human talking *to* the agency from GitHub, the opposite direction from
   state projection. They are handled as an `IssueFlag` / trigger, not as lifecycle
   state, and are not part of `labelsFor`'s output.

5. **Frontend reads `{state, blocked}`** (the `/data` payload carries both). It no longer
   string-matches `agency:*` composites.

6. **`parseLegacyStatus` stays as a fallback for one-way import** only — reading existing
   GitHub labels or pre-flush DB rows during a fresh adoption. It is not a live read path.

## Alternatives considered

- **Keep projecting a legacy `agency:*` composite in the DB column for back-compat.**
  Rejected: this is beta, single-user, and the DB can be flushed. Carrying the composite
  keeps the old ambiguity alive and forces every reader to know two vocabularies.
- **Keep projecting all labels for GitHub scannability.** Rejected: the dashboard is the
  live representation of work (CONTEXT.md); if no one drives from the GitHub issue list,
  the labels are pure cost, and they stack.
- **Read labels back as a fallback / for drift detection.** Rejected: reintroduces the
  two-representation ambiguity. The webhook is the inbound channel for human edits.

## Consequences

- The four duplicated label-constant blocks are deleted; the single notion of "what
  labels would this status have" lives in `state.ts` and is write-only.
- `issues.state` stores `working`/`review`/… not `agency:in-progress`/`agency:ready`/…
- `labelsFor` is never read back — the test suite asserts this is a write-only projection.
- Existing DB rows (pre-flush) hold `agency:*` values; on the next adoption the DB is
  flushed and re-seeded, or `parseLegacyStatus` re-derives them once at import time.
- Inbound trigger/mute labels (`agency:ignore`, optionally `agency:queue`) are unaffected
  and remain first-class inputs.
