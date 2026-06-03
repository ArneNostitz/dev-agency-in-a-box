# Morning briefing ☀️

Everything you asked for is built, tested, and pushed. Here's where things stand and how to
start using it.

## What got built overnight

**The full agency (Phase 2/3).** No longer one agent — a real roster with an orchestrator:

- **Architect** plans (reuse-first, KISS) → **Developer** implements on a branch →
  **Tester** runs the project's checks → **Reviewer** reviews against the harness (with one
  revise loop) → a draft PR is opened and the issue is marked `agency:ready`.
- You start work by **pinning a teammate** in an issue. Handles (in `config/team.txt`):
  - `@dev` / `@agency` → the full pipeline
  - `@arch` → a plan only
  - `@review` → review the branch/proposal
  - `@test` → run the checks
- Each agent has an **editable personality** in `memory/central/agents/*.md` and obeys the
  **engineering harness** in `memory/central/playbooks/*.md`. Edit those files (prose) and a
  `git push` updates how the agents behave — no code change.

**Model policy (cheapest that does the job).** Architect / Developer / Reviewer use Sonnet
(judgment + code quality); Tester uses Haiku (mechanical). Override any role with an env var
(`DEVELOPER_MODEL`, `TESTER_MODEL`, …) or globally with `AGENT_MODEL`.

**The engineering harness (your philosophy, encoded as binding rules).** In
`memory/central/playbooks/`:
- `engineering-principles.md` — KISS, reuse-before-create, separation of concerns, composition,
  theme-driven, testable.
- `reuse-first.md` — always check the project, the shared library, and the template before
  creating anything.
- `frontend-atomic-design.md` — UI is only UI; build config-driven organisms
  (`<Form fields={…} />`, never hand-assembled inputs); atoms→molecules→organisms.
- `theming.md` — central theme tokens; no inline styles, no literal colors, no ad-hoc utilities.
- `logic-separation.md` — rules/validation/calculation live apart from UI, pure and shareable.
- `backend.md`, `database.md` — thin controllers, services, repository pattern, migrations.
- `how-to-write-tests.md`, `how-to-review.md`.
The Reviewer enforces every one of these.

**The template repo — `project-template`** (github.com/ArneNostitz/project-template). The
themeable, atomic-design starting point that embodies the harness, with structure for UI,
logic, backend, and database all reusable:
- `src/ui/theme/` — central tokens (`tokens.css`) + typed accessors; a dark theme included.
- `src/ui/atoms|molecules|organisms/` — `Button`, `Input`, `Field`, and the reusable
  **`<Form fields={…} onSubmit={…} />`** and **`<DataTable columns={…} rows={…} />`** organisms.
- `src/logic/domain/` — the Form's validation/field logic lives **here**, not in the UI, so
  it's unit-tested without React and reused by the backend.
- `src/backend/` — controllers → services → repositories (the same validators as the Form).
- `src/db/` — schema, a migration, and the repository pattern.
- `docs/` — the full harness playbooks travel with the template.
- Tests pass (the Form logic is covered); UI builds after `npm install`.

**Tested.** Agency: 5 unit tests green (handle matching, role routing, model policy, config).
Template: 4 unit tests green (form validation logic). Both have a `test` script wired into CI.

## How to start using it tomorrow

1. **Deploy the agency on Coolify** — follow `COOLIFY.md`. Create a Docker Compose resource
   from `dev-agency`, set the env secrets (your GitHub token + the Claude subscription token),
   deploy. It comes up as a watcher in a minute.
2. **Add a repo to work in:** `./scripts/add-repo.sh <name>` (it only ever touches repos you add).
3. **Pin the agency on an issue:** open an issue and write, e.g.
   `@dev add a /health endpoint that returns 200`. Within a minute you'll see the plan, the
   test results, the review, and a draft PR — and the issue flips to `agency:ready`.
4. **Start a new app from the template:** create a repo from `project-template` (or copy it),
   add it with `add-repo.sh`, and pin `@dev` on issues. New work inherits the structure and
   theme automatically.

## Honest notes / what I could not fully prove

- I built and unit-tested everything and confirmed the whole system **boots and routes**
  correctly. I could **not** run a complete multi-agent pipeline end-to-end in my sandbox
  (it caps each run at ~45s; a real pipeline takes minutes). On Coolify there's no such limit,
  so the first real `@dev` issue is the true end-to-end test — watch that one.
- The template's **UI layer** is authored and typed but its React toolchain isn't installed in
  my sandbox; run `npm install` once in the template to build/typecheck the UI. The dependency-
  free logic is tested and green.
- **Still to come (next sprint):** vector/semantic recall (sqlite-vec) on top of the SQLite
  ledger, and the self-evolving loop (agents proposing playbook improvements via reviewed PRs).

## Added after the briefing: Planner + SQLite memory

- **Planner (Opus 4.8, high effort)** now fronts the `@dev` pipeline. It reads the issue and,
  if anything's ambiguous, **asks you clarifying questions** in a comment and labels the issue
  `agency:awaiting-answer` instead of guessing. Reply in a comment and it resumes automatically —
  plans, then the orchestrator builds. You can also pin `@plan` for planning/questions only.
- **SQLite memory** (`node:sqlite`, no native build) records every issue, agent run
  (role + model + turns, for audit/cost), and plan, on the Docker data volume. Verified working.
- Tests now 8/8 green. To deploy, the only new env is optional: `PLANNER_MODEL` (defaults to
  `claude-opus-4-8`); the DB lives at `/app/data/agency.db` (volume already configured).

## Repos
- Agency: github.com/ArneNostitz/dev-agency
- Template: github.com/ArneNostitz/project-template

Sleep well — it's ready for you to drive. — your overnight build
