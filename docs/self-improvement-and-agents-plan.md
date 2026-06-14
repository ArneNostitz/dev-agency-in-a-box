# Dev Agency v3 — Self-Improvement, Decoupled Repo Prep & Pluggable Agents

Three capabilities, designed so each ships independently and the data/decisions live in the right place.

---

## 0. Where does the data live? (the core question)

- **Process / behaviour telemetry → the DB.** Every run, tool call, plan, review verdict, token
  cost, and lesson is structured data. That's what a *process* analyzer reasons over. The DB already
  has `runs`, `activity`, `plans`, `pr_review`, `token_usage`, `lessons`. We add one table:
  `run_step` (role, run id, tool name, args-hash, duration, ok) so repeated *tool sequences* are
  detectable — the raw material for "this is a repeating task, make it deterministic."
- **Code structure → GitNexus / Graphify.** These answer "how is the code shaped" (callers, impact,
  god-nodes). They are NOT process telemetry. The analyzer uses them only when a proposed change
  touches code.
- **Conversation / artifacts → the DB (local-first, Phase 4).** Chat-only agents (spec-creator,
  grill-me) keep their interaction + result in the DB, never GitHub.

So: **DB = process + conversation memory; GitNexus/Graphify = code memory.** The analyzer is a DB
consumer first, code-graph consumer second.

---

## 1. Decoupled repo prep (indexing outside agent runs)

**Problem:** indexing (GitNexus, and later Graphify) ran on the agent's critical path. Already moved
to a background build; now decouple it entirely from runs.

**Design — a RepoMaintainer:**
- Triggered by GitHub **push** webhooks for watched repos, and a periodic sweep (safety net).
- Rebuilds each repo's GitNexus + Graphify cache in a throwaway clone, keyed by HEAD.
- Agent runs ONLY restore from cache — they never trigger a build. If the cache is cold, the run
  uses file search and the maintainer fills the cache out of band.
- One build per repo at a time (lock); skip if HEAD unchanged.

Result: repo prep is a property of the *repo*, not of *each issue*. (Largely built — finish the
push-trigger + periodic sweep.)

---

## 2. Process Analyzer (self-improvement, its own service)

A separate agent that watches the agency work and turns repeating effort into deterministic code,
skills, and hooks. **Advisory + guardrailed**, runs occasionally, gated on "enough new data."

**What it observes (from the DB):**
- Repeated tool sequences across runs (`run_step`) → candidates for a deterministic hook or skill.
- High-cost / high-turn runs → candidates for a cheaper path.
- Recurring review asks / lessons → candidates for a playbook or pre-hook.

**What it produces:**
- **Skills** — reusable instruction modules attachable to roles (see §4 registry). Create + maintain.
- **Hooks** — deterministic pre/post steps around a role (e.g. "always run X before the developer",
  "always do Y after the tester"). Code, zero tokens, run by the orchestrator.
- **Deterministic replacements** — when a task is fully mechanical (like the code-only tester), a PR
  that replaces an agent step with code.
- All output is a **proposal** (PR or a queued skill/hook change), never an unattended live edit.

**Cadence & gating:** runs on a schedule (e.g. daily) AND only when ≥ N new runs since last pass.

**Its own instance + guardrails:**
- A second deployment (`RUN_MODE=analyzer`) with read access to the DB and permission to open PRs.
- Because it can propose changes that need a redeploy or tool installs, it also **verifies the
  deployment** afterward (health check the target URL / build status) and rolls back its proposal if
  the deploy breaks.
- Guardrails: advisory-only by default; bounded token budget; can't touch its own guardrails; every
  change is a reviewable PR on a branch.

**Why separate:** it must keep working (and watching) even if the main agency is mid-change, and it
needs different permissions (skill/hook/deploy authority) than a normal coding agent.

---

## 3. Pluggable agents + agent editor

**Goal:** add new agent types from the frontend, including **interactive, non-GitHub** agents.

**Agent registry (DB-backed):** extend today's `agent_overrides` into `agent_def`:
`{ name, persona(markdown), tools[], model, mode: "repo" | "chat", pushesToGitHub: bool, skills[] }`.
Built-in roles seed it; new ones are added via the editor. `roles.ts` reads the registry (with the
hardcoded set as defaults).

**Two agent modes:**
- **repo** (today's agents): clone, branch, PR/merge.
- **chat** (new): interactive in the dashboard, **no clone / no GitHub**. Conversation + result live
  in the DB (local-first). Output is a document/summary the user reads. The agent can call `recall`
  and read-only tools, but never pushes.

**First chat agents:**
- **spec-creator** — long interactive chat to shape a spec; emits a clean spec + summary (local).
- **grill-me** — adversarial deep-dive that stress-tests a spec; interactive; emits findings (local).

**Agent editor (frontend):** a panel to create/edit an agent — name, model, tools, mode, GitHub
toggle, and a **markdown editor** for the persona + skill attachments. Saves to `agent_def`.
Versioned (we already keep agent revisions).

---

## Phasing (each ships on `develop`, independently)

1. **Repo prep decoupled** — push-trigger + periodic maintainer; runs never index. *(small; mostly done)*
2. **Telemetry: `run_step`** — log tool sequences per run. Foundation for the analyzer. *(small)*
3. **Agent registry + chat mode** — DB-backed `agent_def`, `mode: chat` runtime (no clone, local
   result), seed built-ins. *(medium)*
4. **Agent editor UI** — frontend CRUD + markdown persona editor; ship spec-creator & grill-me. *(medium)*
5. **Skills + hooks system** — reusable skill modules + deterministic pre/post hooks per role, run by
   the orchestrator. *(medium)*
6. **Process Analyzer service** — `RUN_MODE=analyzer`, DB-driven proposals (skills/hooks/code PRs),
   deploy verification, guardrails. *(large — the headline)*

Dependencies: 6 needs 2 (telemetry) + 5 (skills/hooks to write into). 4 needs 3 (registry). 1 is
independent and lands first.

## Open decisions
- **Analyzer authority:** advisory PRs only (recommended) vs. allowed to auto-merge low-risk
  deterministic replacements behind a flag.
- **Chat-agent results:** keep purely in the DB, or optionally export to a file/GitHub on request.
- **Skill format:** markdown instruction modules (like personas) vs. a structured schema. Recommend
  markdown for authorability, with optional front-matter for targeting.
