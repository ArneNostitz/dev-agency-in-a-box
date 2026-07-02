# ADR-0003 — Remove GitHub labels entirely; Inbox replaces mention/trigger-mode intake

- **Status:** Accepted
- **Date:** 2026-07-02
- **Supersedes:** ADR-0001 §3–4 (opt-in label projection, `agency:ignore`/`agency:queue` as
  inbound signals). ADR-0001 §1–2, §5–6 (DB is the only source of truth for lifecycle state)
  stand unchanged — this ADR just finishes what they started.

## Context

ADR-0001 said outbound `agency:*` label writes should move behind a `github_label_projection`
setting, off by default. That gate was never built: `addLabel`/`removeLabel` were called
unconditionally from ~120 call sites across `pipeline.ts`, `runner.ts`, `epics.ts`,
`commands.ts`, `analyzer.ts`, `webhook.ts`, `tracker.ts`. Several places also still *read*
`agency:*` labels back as a live signal (`t.labels.includes(...)`) — exactly the class of bug
ADR-0001 said the DB inversion would kill.

Separately, fresh GitHub issues had no visible holding area: an issue that didn't `@mention` a
repo member just got silently pushed into the Planned column (or auto-started if it matched the
mention trigger), with no explicit human decision point.

## Decision

1. **Delete the label subsystem completely.** No `agency:*` (or `🚧 blocked`) label is ever
   created, read, or removed anywhere in the agency. `addLabel`/`removeLabel`/`mentionsHandle`/
   `listActionableIssues`/`ActionableOptions` are deleted from `github.ts`. Every GitHub `--json`
   field list drops `labels`. `state.ts`'s `labelsFor`/`STATE_LABEL`/`BLOCKED_LABEL`/`LABEL_*`
   exports are deleted.

2. **The @mention/trigger-mode auto-start system is removed entirely**, not made stricter.
   `config.triggerMode`/`handles`/`queueLabel`/`ignoreLabel`, `parseTrigger`, `loadHandles`, and
   the `triggerMatch` signal in `route.ts`/`runner.ts` are deleted. Nothing auto-starts a fresh
   GitHub issue anymore, mention or not — the dashboard is the only place work begins.

3. **`notPlanned` becomes Inbox — a real, eagerly-persisted board column**, not just a virtual
   default. Every GitHub-originated issue the agency has never triaged gets an explicit DB row
   with `state = "notPlanned"` on first sight (webhook `opened` or the next scan), instead of
   being silently promoted to Planned. From Inbox, a human explicitly promotes to Planned (queue
   it) or Working (start it) — both actions already existed (`toPlanned`, `start`); Inbox is the
   first status to offer both together.

4. **Issues the agency creates itself do not round-trip through Inbox.** Epic children, audit
   findings, dashboard `/new-issue`, and orchestrator handoffs already get an explicit starting
   state (`planned` or `working`) at creation time — unaffected by this change, since they never
   went through the untriaged-GitHub-issue path Inbox governs.

5. **"Kind" flags that were piggybacking on labels move to the DB**, matching the `IssueKind`
   seam ADR-0001 already called out as orthogonal:
   - The audit tracking issue (`agency:audit`) becomes a `audit_tracking.<repo>` setting holding
     the one open tracking issue's number, instead of a `gh issue list --label` filter.
   - The epic parent's lifecycle `state` column stops being overwritten with the literal string
     `"agency:epic"` (a standing ADR-0001 violation — `epics.ts` was writing a non-canonical
     value into the same column the enum owns). Epic-ness truth is `isEpic()` (the `epics` DB
     table), already independent of the lifecycle state; the parent's real state (`working`)
     is left alone while children build.
   - The analyzer's advisory issue gets no DB row at creation (unchanged) — it now surfaces in
     Inbox like any other untouched issue instead of being permanently hidden by
     `agency:ignore`. It was never auto-actioned either way, so this is equivalent-or-better,
     with no new suppression mechanism needed.

6. **One-way read compat for pre-existing `"agency:epic"` DB rows is kept**, in the frontend
   `classify()`/`statusChip()` (`web/core.js`) only. Nothing writes that value anymore after
   this change ships, but a database that already has one mid-flight epic needs a render path
   that doesn't silently misclassify it. This is DB-value tolerance, not GitHub label handling.

## Alternatives considered

- **Build the `github_label_projection` gate ADR-0001 specified.** Rejected: the user explicitly
  asked for full removal, not an opt-in toggle nobody would flip on. A toggle nobody uses is the
  same maintenance cost as the code it guards.
- **Keep @mention as a fast-track that skips Inbox.** Rejected (confirmed with the user): a
  sibling initiative is removing all `@`-mention triggering agency-wide, and a fast-track would
  reintroduce the exact "did a random mention just start a run" ambiguity Inbox exists to close.
- **Add a brand-new `"inbox"` `IssueState` value.** Rejected: `notPlanned` already is that
  concept (untriaged default) — it was just never persisted eagerly. Reusing it is a much smaller
  change, keeps `parseLegacyStatus`/the one-time migration/existing tests intact, and avoids a
  redundant parallel "nobody has decided yet" state.

## Consequences

- `Issue`/`RecentThread` no longer carry a `labels` field anywhere in the codebase.
- The Settings → Operations panel loses "How issues start the agency" / "Trigger handles" /
  "Queue label" / "Ignore label" — there is nothing left to configure; Inbox is unconditional.
- Existing `agency:*` labels already on GitHub issues/repos are left alone — the agency simply
  stops touching them. Cleaning up stale labels on a shared GitHub repo is a separate,
  human-initiated action, not automated by this change.
- The board gains an "Inbox" column (first, before Planned) for `notPlanned` issues, with two
  actions: **Plan** (→ Planned, via the existing "reset to Planned" endpoint) and **Start** (→
  Working, via the existing start endpoint) — no new server routes were needed.
