# Dev Agency v2 — Orchestrator, Unified Memory & GitHub-as-Adapter

A plan to make the agency dramatically cheaper and faster while keeping the parts that
earn their cost (independent review, permission scoping, cheap-model tiering).

## Principles

1. **Tokens are spent only on judgment.** Anything deterministic (running checks, deciding
   the obvious next step, moving state) is plain code, not an LLM call.
2. **Push a tiny handoff; pull detail on demand.** Stop re-feeding the whole thread to every
   agent. The orchestrator passes compact machine state; agents `recall()` what they lack.
3. **Warm where continuity helps, cold where independence helps.**
4. **The local DB is the source of truth.** GitHub (and git) are adapters behind a port, so the
   tracker can be swapped (GitLab/Linear/none) without touching the core.

---

## 1. Per-issue Orchestrator (deterministic controller)

Today `pipeline.ts` runs a fixed chain (planner→architect→developer→tester→reviewer) and
re-feeds the GitHub thread to each. Replace with a per-issue **orchestrator**: a small state
machine in code that owns the run.

- Holds a compact **handoff state** (JSON), not the thread:
  `{ issue, plan?, branch, changedFiles[], lastTest{pass,errors[]}, review{verdict,asks[]}, openQs[] }`
- Decides the next move from state (zero tokens for routine decisions):
  - no diff after a dev turn → stop, ask human (already shipped for review-fix)
  - test failed → loop **back to the same warm developer** with *only* the failing errors
  - test passed + not yet reviewed → reviewer
  - reviewer approved + mergeable → finalize
  - conflict → deterministic merge (already shipped), agent only for real content conflicts
- Escalates to an LLM "lead" **only** when genuinely ambiguous (rare), never per step.

Result: the expensive "what next / re-read everything" reasoning that's currently delegated to
agents becomes free controller logic.

## 2. Agent roster (warm/cold + model tier)

| Agent | Lifetime | Model | Notes |
|---|---|---|---|
| **planner** | up front, then `recall()` instead of re-reading | Opus (cap ~20–25 turns) | only on fresh pin / scope change |
| **developer** | **warm** — writes → resumes to fix → resumes to resolve conflicts | Sonnet (≤50 turns) | one continuous agent; never cold-restarted; never re-fed the thread (it has the context) |
| **tester** | **code-only** by default; cheap LLM only on unknown/ambiguous | Haiku (fallback only) | see §3 |
| **reviewer** | **warm across its own rounds**, but a *separate* agent from dev | Sonnet (≤40) | independence preserved; remembers its own prior asks on re-review |

"Dev and fix are the same" = the developer role, guaranteed to **resume its session** for fixes
and conflict resolution rather than spawn a cold process.

## 3. Code-only tester

The tester mostly runs commands and reports pass/fail — deterministic, no LLM needed.

- **Detect check commands once** per repo (from `package.json` scripts: `typecheck`/`lint`/
  `test`/`build`; fall back to language defaults). Cache in the DB.
- Run them in **Bash, zero tokens**; capture exit code + first error.
- Only invoke the **LLM tester** when: commands can't be detected, or output needs interpreting
  (e.g. a flaky/ambiguous failure). This is the rare path.

Net: the standard build/lint/test gate becomes token-free; "tester stays cheapest" becomes
"tester is usually free."

## 4. Unified Memory / `recall` tool (combine GitNexus + Graphify + DB)

One MCP tool every agent can call when stuck or lacking context. Three lenses behind one door:

- **Code structure (GitNexus)** — fine-grained, interactive: callers/impact of a symbol. *Already
  wired as a tool; now default-on.*
- **Code architecture (Graphify)** — coarse-grained: god-nodes, module clusters, hotspots.
  Today a one-shot `GRAPH_REPORT.md` read only by the auditor → **graduate into a query** in the
  recall tool ("what's the architecture around X / what are the risky hubs").
- **Project history (DB)** — *new, the missing piece*: past plans, prior lessons, reviewer
  verdicts, how similar issues were solved, the current handoff. Today only a tiny capped snippet
  is force-fed; expose it as `recall(query)` so agents **pull** it on demand.

This is what lets us stop force-feeding the snowballing thread: orchestrator pushes the small
handoff, the agent `recall()`s detail only if it needs it.

## 5. GitHub-as-Adapter (the inversion)

**Today:** GitHub *is* the database. Issues = the queue, comments = the thread/memory, labels =
state, PRs = output. Every read/write is a `gh` round-trip — slow, rate-limited, and welds the
whole system to GitHub.

**Target:** the **local DB is authoritative** for the *tracking* layer; GitHub becomes one
**Tracker adapter** behind a port. The dashboard already creates issues and the DB already stores
issues/activity/runs — most of the substrate exists.

Split the boundary cleanly:

- **Tracking layer → pluggable.** Issues, threads, state, runs live in the DB. The UI reads/writes
  locally (fast, offline-capable, no rate limits). A `Tracker` interface:
  `listIssues / getThread / postComment / setState / createIssue`. Adapters: `LocalTracker`
  (DB only) and `GitHubTracker` (mirrors to issues/comments/labels). A background **syncer**
  pushes human-facing results out to GitHub async and imports human replies in.
- **Code layer → stays git.** Clone/branch/commit/PR/merge stay on the git host (you can't host
  code "without GitHub" unless you self-host git). This is already isolated in `github.ts`; keep a
  thin `CodeHost` port (GitHub today, GitLab/Gitea later via remote URL + provider API).

So "turn GitHub around" = **tracking goes local-first with GitHub as an optional mirror; git stays
git behind a swappable CodeHost port.** Exchangeable later, fast now.

### Why this is worth it
- **Speed:** issue/thread/state reads are local, not `gh` calls.
- **No rate limits** on the hot path; GitHub touched only on async sync.
- **Decoupling:** swap tracker (Linear/GitLab/none) without touching the core; the app runs even
  if GitHub is down.

### What to watch
- **Conflict of record:** if a human edits on GitHub and the app edits locally, the syncer needs a
  clear precedence rule (last-writer-wins per field, or app-authoritative with GitHub import-only).
- **Issue origin:** decide whether new issues originate in the dashboard (local) and mirror out, or
  can still be opened on GitHub and imported. Both are fine; pick a default.
- Don't boil the ocean: git operations are *not* part of the inversion.

---

## Phased migration (each phase ships independently, nothing breaks)

**Phase 0 — already shipped:** deterministic conflict merge + loop fix; no-op skip on review-fix;
GitNexus default-on; dev cap 120→50; model-selector errors surfaced; auto version.

**Phase 1 — `recall` tool (highest leverage).** Wrap DB + GitNexus + Graphify behind one MCP tool;
add it to every code-touching role. Start trimming the thread fed to agents (last ~8 comments) and
let them `recall()` the rest.

**Phase 2 — code-only tester.** Detect+cache check commands; run in Bash; LLM tester only on
unknown/ambiguous. Wire orchestrator to call it directly.

**Phase 3 — per-issue orchestrator.** Introduce the handoff-state controller; route dev↔test↔fix
as warm-resume loops; reviewer warm across rounds; orchestrator owns next-move decisions. Retire
the fixed linear chain. (Biggest refactor of `pipeline.ts`/`runner.ts`.)

**Phase 4 — Tracker port + local-first tracking.** Extract `Tracker` interface; make the DB
authoritative; build the async GitHub syncer; UI reads/writes locally. Keep `CodeHost` (git)
behind its own thin port.

**Phase 5 — CodeHost port.** Generalize `github.ts` git/PR operations to a provider interface so a
different host can be dropped in.

---

## Decisions (locked)

1. **Orchestrator brain:** deterministic code first; LLM escalation only when genuinely stuck.
2. **Two-way sync, no conflicts by design.** Issues and comments can originate from *either* end
   (GitHub or dashboard), so the agency can still be triggered from GitHub but ultimately lives in
   the dashboard. The dashboard **pushes out immediately** on every change, so there's nothing to
   conflict with. **Once an issue exists in the dashboard DB, the DB is the source of truth.** A
   periodic **sync-in check** pulls anything that changed on GitHub (new issues/comments) into the
   DB. Genuine merge/PR conflicts are still resolved **case by case** (the deterministic merge +
   single-agent-turn flow already shipped) — never blindly.
3. **Build it.** Fix/strengthen the agency by hand first, then let it run on its own.
4. **Keep git as the code host.** Still put a thin `CodeHost` port around git so an alternative VCS
   *could* be dropped in later — but that's **low priority / "planned" only**, not part of this push.

## Sync model (decision #2, expanded)

- **Origin:** an issue/comment can start on GitHub *or* in the dashboard.
- **Adoption:** the moment an issue is represented in the DB, the **DB is authoritative**.
- **Outbound:** every dashboard change is pushed to GitHub **immediately** (so the two stay in step
  and there's no window for a conflicting concurrent edit).
- **Inbound:** a lightweight poller/webhook detects new GitHub activity (issues opened, human
  comments) and **syncs it in** to the DB, attributed to the human.
- **Code conflicts** (branch/PR merge) are unaffected by this and stay case-by-case.
