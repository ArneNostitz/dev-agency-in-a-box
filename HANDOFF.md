# Handoff — Dev Agency architecture arc (2026-06-18 → 06-19)

**Repo:** `ArneNostitz/dev-agency` · **Main:** `b19fe1d` · **Tests:** 181/181 green · **TS errors:** 0
**Author of this arc:** the improve-codebase-architecture review → grind → ship.
**Handoff to:** next agent (pi/Claude/whatever). Read this top-to-bottom before touching anything.

---

## 0. TL;DR — where things stand

The codebase underwent a **DB-first inversion**. GitHub is no longer the database; the local SQLite DB is the source of truth, GitHub is a mirror + the code host. Issue lifecycle state went from "represented three ways at once" (labels in 4 files + a DB column in two string formats + label-derived booleans) to **one canonical module** (`src/state.ts`). The god-module `store.ts` (2146 lines) was split into a 72-line barrel + 25 cohesive `src/db/` modules. Agents now run through a **pluggable runner seam** (Claude SDK default, pi/claude/gemini CLIs as swappable subprocess tools). Per-issue token/$ budgets are real. Button rules are codified as a pure function.

Everything below is on `main`. No branches in flight. `develop` is stale — delete it.

---

## 1. What was done (merged PRs, newest first)

| PR | Issue | What |
|---|---|---|
| **#81** | — | **pi runs report real tokens + cost.** `PiCliRunner` parses pi's `--mode json --print` NDJSON stream (usage, text deltas, tool calls) so pi runs are fully accountable. Was the gap in #63. |
| **#80** | — | **Build-time version stamp.** `scripts/version.mjs` regenerates `web/version.json` every build: `v1.0.1 · build N · YYYY-MM-DD HH:MM · sha`. `version.json` is now build-generated (gitignored). |
| **#79** | #69 | **Tracker default → local-first.** `trackerMode()` defaults to `local`; the webhook adopts issue bodies/labels into the DB, not just comments. |
| **#78** | #63 | **Pluggable runners.** `AgentRunner` seam; `roleAgent` no longer calls the SDK inline; `ClaudeSdkRunner` is a verbatim port of the proven loop; `CliRunner` for pi/claude/gemini subprocesses (shell-less, no injection). |
| **#77** | #5 | **`availableActions()`.** Pure function codifying the button rules (Stop/Cancel/Resume/Merge/Delete/etc.) from IssueStatus + facts. Tested. Not yet wired into the frontend. |
| **#76** | #70 | **store.ts split COMPLETE.** 2146 → 72-line barrel, 25 `src/db/` modules. |
| **#75** | #67 | **Per-issue token/$ budget.** DB-backed override + unlimited flag; budget gate parks over-budget issues with `BlockedReason "budgetExceeded"`; dashboard control. |
| **#74** | #70 | store.ts split (first half). |
| **#68** | #66 | **IssueState module — the spine.** 5-state lifecycle + extensible BlockedReason; canonical enum in the DB (no back-compat); lossless boot migration; GitHub labels lose all power (ADR-0001); frontend reads `{state, blocked}`. |
| **#65** | #61 | .gitignore the runtime `data/` volume. |

Closed issues: #66, #67, #69, #70, #63, #71 (frontend blocked chips — done in #68).

---

## 2. The architecture you're inheriting

### 2.1 The state model (`src/state.ts`) — READ THIS FIRST
Issue lifecycle is **one closed 5-state enum** + a separate extensible blocked reason:
```
IssueState  = notPlanned | planned | working | review | done
BlockedReason = awaitingApproval | awaitingAnswer | needsAttention
              | conflict | rateLimited | budgetExceeded   (extensible)
IssueStatus = { state: IssueState; blocked: BlockedReason | null }
```
- `canTransition`/`transition` guard the legal edges (reopens allowed: `done → working`).
- `recordIssueStatus(repo, n, status)` is the **only** way state is written; `getIssueStatus(repo, n)` the only way it's read. Both in `src/db/issues.ts` (re-exported from `store.ts`).
- The DB `issues.state` column holds the **canonical enum** (`working`, not `agency:in-progress`). The `issues.blocked` column holds the reason. **No `agency:*` composite, no back-compat** (the user explicitly waived it — beta, single-user, DB can be flushed).
- `labelsFor(status)` is a **write-only** projection onto GitHub labels — nothing reads it back. Outbound label-writing still exists but is intended to be gated behind `github_label_projection` (default off — see ADR-0001). Inbound labels that still matter: `agency:ignore` (mute), `agency:queue` (optional trigger) — these are human→agency signals, the opposite direction.
- `parseLegacyStatus(raw)` is a **one-way import-time fallback only** — used by the boot migration (`migrateIssueStates()` in `src/db/connection.ts`) to convert old `agency:*` rows losslessly. Not a live read path.

**Glossary lives in `CONTEXT.md`** (IssueState, BlockedReason, IssueKind, IssueFlag, GitHub Label, Agent, Runner, Handoff, Orchestrator). **ADR-0001** (`docs/adr/0001-github-labels-lose-power.md`) records the labels-lose-power decision.

### 2.2 The DB layer (`src/db/`, 25 modules)
`store.ts` is a **72-line barrel** — just imports + `export … from "./db/*.js"`. Every aggregate is its own module: `connection` (getDb + schema + migrations), `issues`, `tokens`, `users`, `providers`, `settings`, `local` (local-first tracking), `epic_tables`, `agent_def`, `skills_hooks`, `telemetry`, etc. **Call sites are unchanged** — they still import from `./store.js`. Migrate them to direct `./db/*.js` imports opportunistically (low priority).

Cross-aggregate deps are explicit (e.g. `providers`/`auto` import `getSetting` from `settings`; `issues` imports the state module). No cycles.

### 2.3 The runner seam (`src/runners/`)
`roleAgent.runRole` no longer calls `query()` inline. It builds a `RunRequest` and calls `getRunner(kind, cliCommand).run(req, emitAssistant)`.
- `interface.ts` — `AgentRunner`, `RunRequest`, `RunResult`, `RunnerKind`.
- `sdk-claude.ts` — `ClaudeSdkRunner` (default). **Verbatim port** of the old proven loop.
- `cli.ts` — `CliRunner` + `parseCommandLine` (shell-less `spawn`, no injection). For `claude-cli` / `custom-cli`.
- `sdk-pi.ts` — `PiCliRunner`. Spawns `pi --mode json --print …`, parses the NDJSON stream (`pi-parse.ts`), returns **real `{tokens, costUsd, turns}`** and streams text/tool events. **This is how pi is used as a tool** — subprocess, zero `@earendil-works` dep, no assimilation.
- `registry.ts` — `getRunner(kind)` + the **one shared `summarizeTool`** + `defaultRunnerKind()`.

Runner selection: `Provider.runner?` overrides per-provider; global `agent_runner` setting (default `claude-sdk`) is the fallback. Settable from Settings → Pipeline.

### 2.4 Tracker / DB-first (`src/tracker.ts`)
`trackerMode()` defaults to `local`. `getTracker()` returns `LocalTracker` (DB-authoritative) by default; `GitHubTracker` if `tracker=github`. The hot-path reads (intake scan, merge, orphan-recovery) read `getIssueStatus()` from the DB directly, bypassing the Tracker port for state. The webhook adopts inbound GitHub issues/comments into the DB via `syncInIssue`/`syncInComment`.

**`github.ts` has NOT been split yet** into `CodeHost` (git/PR/merge) + `GitHubMirror` (write-only outbound). It's still the one big module. Low marginal value now that reads bypass it, but it's the next structural cleanup if you want tracker-swap to be clean.

### 2.5 Budgets (`src/budget.ts`)
`effectiveLimits(repo, n)` merges a per-issue override (`{maxCostUsd, maxTurns, maxTokensPerRun, unlimited}`) over the global limits. The runner gate (`runner.ts`) parks over-budget issues with `BlockedReason "budgetExceeded"`. Set from the dashboard (Unlimited toggle + cost-cap prompt in the issue detail "more" menu; `POST /issue-budget`).

⚠️ **Budget vs pi:** pi runs now report real tokens (#81), so the budget gate CAN trip on them. But the gate runs *before* the run starts — it checks `issueSpend` (cumulative). A single runaway pi run is bounded by `maxTurns`/`maxTokensPerRun` per-run, not the per-issue budget mid-run.

### 2.6 Button rules (`src/actions.ts`)
`availableActions(status, facts) → Action[]` is pure + tested. **Not yet wired into the frontend** — `web/detail.js` still has the inline `if (running)/else if (hasPr)/…` tree. The swap (`availableActions(...).map(render)`) is a small, safe, render-only follow-up.

---

## 3. Conventions you must follow

- **Tests are the contract.** `npm test` runs `npm run build` then `node --test test/*.test.mjs`. Pure-logic tests use a temp SQLite (`mkdtempSync` + `DB_PATH`). 181 tests, must stay green. **Green before AND after every commit.**
- **No back-compat.** User waived it (beta, single-user, DB can be flushed). Canonical representations win; `parseLegacyStatus` is import-time only.
- **Labels have no power** (ADR-0001). Never read `agency:*` labels back as state. Write them only via `labelsFor()` and only if/when `github_label_projection` is on.
- **State writes go through `recordIssueStatus`.** Never write `issues.state` directly.
- **State reads go through `getIssueStatus`.** Never infer state from labels.
- **GitHub is the code host + a mirror.** The only operation that MUST check GitHub is **merge**. Everything else is DB-first.
- **Use external tools as tools.** pi = subprocess via `PiCliRunner`. Never `import` from `@earendil-works/*`.
- **Small, single-responsibility files.** New DB work goes in `src/db/<aggregate>.ts` + a re-export in `store.ts`. Don't grow god-modules.
- **Branch + PR + rebase-merge.** Off `origin/main`. One logical change per commit. The version stamp auto-updates on build.

---

## 4. Deploy notes

- **Just redeploy.** On boot, `getDb()` runs `migrateIssueStates()` once (guarded by the `state_migration_v2` settings flag): converts any old `agency:*` rows to canonical `{state, blocked}` losslessly. Logs `[agency] migrated N issue row(s)`.
- **Tracker defaults to `local`.** Set `tracker=github` (or `TRACKER=github`) to restore old behaviour.
- **First deploy after #78 should be watched** — trigger one real Claude run (`agent_runner=claude-sdk`, the default) and confirm the activity stream + token accounting look right. The Claude path is a verbatim port, so it should be identical, but live-verify it. Then optionally try `agent_runner=pi-cli`.
- **`web/version.json` is build-generated** (gitignored). Don't commit it. `npm run build` / Docker build regenerates it.
- **`develop` branch is stale** — carries the pre-cleanup mess (junk files, the old 11-param `runnerInterface.ts`, binary DB). **Delete it.** Its useful ideas (runners, editable agents) are already on main in cleaner form.

---

## 5. What's planned / open (priority order)

### Tier 1 — unblocks the most
- **#62 (Models modal simplify)** — make adding a provider as simple as pi's `/login` (preset → paste key → done). Was blocked on #63 (runners); now unblocked. The develop version ballooned `web/settings.js`; rebuild clean off main.
- **#64 (Editable agents/workflows)** — the largest unmerged develop chunk (~590 lines). Was blocked on #63. Rebuild clean off main: custom agent defs already exist (`src/db/agent_def.ts`); the work is the workflow execution module + frontend. Consider `src/workflow.ts` rather than growing `pipeline.ts`.

### Tier 2 — quality / safety
- **#5 frontend wiring** — swap `web/detail.js`'s inline button tree for `availableActions(...).map(render)` (the pure fn + tests are ready in `src/actions.ts`). Render-only, low risk.
- **#73 (Reset tracking from GitHub)** — optional admin "nuke & re-adopt" safety valve. Needs the scan-and-adopt loop. Low priority now that the boot migration handles the common case.
- **Split `github.ts`** into `CodeHost` (git/PR/merge) + `GitHubMirror` (write-only outbound). Makes tracker-swap clean. Low marginal value today (reads bypass it) but it's the structural cleanup.

### Tier 3 — the bigger architecture pieces (their own projects)
- **#6 (repo-wide Orchestrator)** — fold `locks.ts` + `pool.ts` + `route.ts` into one orchestrator that owns the work graph (all issues, states, file locks, dispatch) and answers "next move" one way. Smarter locks ("rebases after #7 releases X.ts"). See the architecture-review HTML report (Candidate 6).
- **#8 (Handoff protocol)** — compact machine `{state, branch, changed[], lastTest, review, openQs}` passed between agents instead of re-feeding the thread. "Less tokens" made literal. The v2 plan §1, unbuilt. Highest-risk candidate; needs #6 first.
- **#28 (v3: Self-improvement, decoupled repo prep, pluggable agents)** — the analyzer service, skills/hooks authoring, chat agents. Big. `docs/self-improvement-and-agents-plan.md` has the plan.
- **#22 / #25 / #26 / #27** — the v2 phased plan (orchestrator, unified memory, tracker port, codehost port). Mostly subsumed by what landed; read `docs/orchestrator-v2-plan.md` for intent.

### Misc open issues to triage
#72 (omnigent), #56 (agent name by avatar), #55 (rate-limit errors), #54/#52/#48/#47/#40/#28 — old/smaller; confirm relevance before working.

---

## 6. Where the docs are

- **`CONTEXT.md`** — the glossary (IssueState, BlockedReason, IssueKind, IssueFlag, GitHub Label, Agent, Runner, Handoff, Orchestrator). Read first; speak this vocabulary.
- **`docs/adr/0001-github-labels-lose-power.md`** — the labels decision. Don't re-litigate without reading.
- **`docs/agents/`** — agent-skills config (issue tracker = GitHub `ArneNostitz/dev-agency`; triage labels; domain-doc layout).
- **`docs/orchestrator-v2-plan.md`** + **`docs/self-improvement-and-agents-plan.md`** — the v2/v3 plans. Some parts now shipped; read for intent.
- **Architecture-review HTML report** (was at `$TMPDIR/architecture-review-dev-agency-20260618.html`) — Candidates 1–8 with before/after diagrams. Candidates 1–5 landed; 6–8 are the Tier-3 work above.

---

## 7. Red flags / things that will bite you

1. **The brace-counting extraction scripts (`/tmp/extract_*.py`) are fragile** on functions with block comments or multi-line type literals. If you resume the store split (only `getIssueRole` is non-canonical now, everything's extracted), don't trust them blindly — verify each with build+test.
2. **`webhook.ts` is still 1400+ lines** — HTTP server + all routes + auth + the `/data` projection assembly in one file. Candidate 7 (split it; extract a pure `buildDashboardPayload`) is unwritten and would be a real win.
3. **Agent execution isn't live-tested in CI.** The test suite covers pure logic only (no API keys). Any change to `roleAgent`/runners should be live-verified on one real run before trusting it.
4. **`pipeline.ts` (812 lines)** is the next "god-module" after webhook. The orchestrator's `decideNext` is wired in but only for micro-steps; macro intake lives in `route.ts`, dispatch in `runner.ts`. Candidate 6 unifies these — don't grow `pipeline.ts` further in the meantime.
5. **`EPIC_LABEL` (`agency:epic`) is an IssueKind still carried in the state column** (deferred — moves when an `IssueKind` module exists). `epics.ts childStatus()` still reads GitHub labels for epic-child display; that's a known inconsistency, not a regression.

---

## 8. Quick start for the next agent

```bash
git checkout main && git pull
npm install && npm test          # 181/181 must pass
# Read, in order: CONTEXT.md → docs/adr/0001 → src/state.ts → src/runners/interface.ts
# Then pick from Section 5 (Tier 1 first).
```

Main is clean, tested, and the foundation is solid. The risky blind-refactor days are over — most remaining work is additive or well-scoped. Good luck.
