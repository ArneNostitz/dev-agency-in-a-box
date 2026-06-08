# 🤖 Dev Agency

A fully autonomous team of AI agents you operate entirely through GitHub issues.
You write an issue and pin a teammate; the agency plans, asks if it must, waits for your 👍,
builds on a branch, tests, reviews, and hands you a draft PR. You test locally and say
"ship it". It runs 24/7 on Coolify (Docker), reacts instantly to webhooks, heals its own
PRs, learns from every run, and proposes improvements to its own playbooks as PRs.

**Status: all phases live** — roster + orchestrator, SQLite memory, parallel workers,
self-healing PRs, cost guardrails, and the self-evolving loop (librarian → playbook PRs).
Full design: [`../dev-agency-architecture.md`](../dev-agency-architecture.md).

---

## Daily use (the only part you need)

### Start work

Write an issue in a watched repo and pin a teammate in the title or body:

| Pin | Who answers | What happens |
| --- | --- | --- |
| `@dev` / `@agency` | Full pipeline | Planner (Opus) researches & proposes → you approve → Developer builds → Tester runs checks → Reviewer reviews → draft PR |
| `@plan` | 🧠 Planner only | Research + plan, conversational — refine it by replying, then `@dev` to build |
| `@arch` | 🏛 Architect | Technical plan, no code |
| `@review` | 🔍 Reviewer | Reviews the issue's branch/diff |
| `@test` | 🧪 Tester | Runs the project's checks and reports |

The agency reacts 👀 on your comment within seconds and comments 🏗️ when it picks the
issue up. Small/obvious tasks skip the approval gate entirely (`PLAN AUTO`).

**When do I need to tag a handle?** Only the **first** time, to start a thread (so the agency
doesn't jump on every random issue). After that the thread is "owned" — **just comment, no
tag.** Any later comment re-engages it, even after you've merged and the issue/PR is closed:

- Reply on an **open issue** → it continues / replans with your note.
- Reply on a **plan** → 👍 (or `ok`) to build, or write the change to refine it.
- Comment on the **PR** → it pushes the fix to that PR.
- Comment on a **closed/merged issue or PR** → it reopens, builds your fix on a fresh branch
  off the latest `main`, and opens a new PR. No more reopening things by hand.

(Pure "thanks / lgtm / 👍" comments are ignored so they don't trigger a pointless build.)

### Approve, steer, merge

- **Approve a plan**: 👍 the proposal comment, or reply `ok` (also: `go`, `lgtm`, `yes`, `build it`…).
- **Change a plan**: just reply with the change — the planner answers with the delta only.
- **Answer questions**: reply normally; the pipeline resumes on its own.
- **Merge**: comment `/merge` (or `merge`, `ship it`, 🚀) on an `agency:ready` issue —
  squash-merges the PR, deletes the branch, closes the issue.
- **Retrigger an issue**: remove its `agency:*` label — it's picked up again instantly.
- **Mute an issue**: add the `agency:ignore` label.

### Work with PRs

- **Request changes**: comment `@dev <what to change>` (or `@fix`) on the PR itself.
- **Self-healing**: failing CI or merge conflicts are fixed automatically (max 2 attempts,
  then it asks you for a hint).
- **Test locally**: `./scripts/checkout-issue.sh <owner/repo> <issue-number>`
  (or `git fetch origin && git checkout agency/issue-N`). PRs are draft on purpose —
  you mark ready / just `/merge`.

### Manage repos from GitHub

File an issue in any watched repo:

- `/add-repo <name | owner/name>` — start watching a repo (bot is auto-invited, webhook auto-registered)
- `/list-repos` — show what's watched

### About the `@dev` / `@plan` autocomplete

GitHub only autocompletes **real accounts and teams** in the `@` box — `@dev`/`@plan` are
plain text the agency parses, so they can't appear there, and that's by design (no extra
collaborators or accounts needed). Two ways to make this painless:

- **You rarely type them anyway** — only the first comment on a thread needs a handle.
  Everything after is just a plain reply (see above).
- **For the first comment**, `@dev` etc. are 4–5 characters; or mention the **bot account**
  (`@your-bot`), which *does* autocomplete once it has commented in the repo, and put the
  role word in the text (e.g. "@your-bot please plan this").

If you want true autocomplete for each role, the only real options are GitHub **org Teams**
(`@org/dev` in org repos) or dedicated bot accounts per role — both heavier than they're
worth given follow-ups need no tag.

### Labels = state machine

`agency:in-progress` → working · `agency:awaiting-answer` / `agency:awaiting-approval` →
waiting on you · `agency:ready` → PR is up · `agency:needs-attention` + 🚧 → blocked, read
the last comment · `agency:ignore` → muted · `agency:unlimited` → exempt from budgets.

### Dashboard

Your Coolify domain serves a password-protected live dashboard: **Working now** + a live
stream card per active issue/PR (real commands and edits, not just tool names), **Waiting
on you**, and today's spend. `/history` has the full firehose, every run with cost, and
archive buttons.

---

## How it stays good and cheap

**Models** — cheapest that can do the job: Planner = Opus 4.8, Architect/Developer/Reviewer
= Sonnet, Tester/Librarian = Haiku. Override per role (`PLANNER_MODEL`, …) or all at once
(`AGENT_MODEL`).

**Cost guardrails** — every run's cost + turns land in the ledger. Per-issue budget
(default $15 / 800 turns across all runs) parks runaways as `agency:needs-attention`
instead of burning more; per-run `maxTurns` stops loops. Label an issue `agency:unlimited`
to exempt it. Tune with `MAX_ISSUE_COST_USD`, `MAX_ISSUE_TURNS`, `MAX_TURNS_PER_RUN`.

**Self-evolving loop** — after each finished build a 📚 Librarian (Haiku) distills 0–3
non-obvious lessons ("repo X needs pnpm", "tests want DATABASE_URL") into memory; recent
lessons ride along in every agent's prompt immediately. Once ~8 pile up, the agency opens a
**draft PR against this repo** folding them into the playbooks — you review and merge, Coolify
redeploys, the agency is permanently smarter. Rule changes never happen silently.
Disable with `SELF_IMPROVE=false`.

**Engineering harness** — every agent is bound by `memory/central/`: the CONSTITUTION plus
playbooks (atomic design, separation of concerns, KISS, reuse-before-create, central theme,
config-driven organisms, test & review standards). Edit the markdown, push, redeploy =
new rules. New projects start from a companion `project-template` repo that ships the same
harness as a working skeleton.

---

## Setup (once)

Runs on Coolify as a Docker Compose resource — step-by-step in **[COOLIFY.md](COOLIFY.md)**.
The short version:

1. Create a Docker Compose resource from this repo; set the domain (container port 3000).
2. Set env vars:

| Variable | What |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | from `claude setup-token` (subscription) — or `ANTHROPIC_API_KEY` |
| `GITHUB_TOKEN` | the **bot account's classic** token (`repo` scope) — actions are attributed to the bot |
| `ADMIN_GITHUB_TOKEN` | your owner token — only used to auto-invite the bot to repos |
| `GITHUB_OWNER` | your GitHub username or org |
| `RUN_MODE` | `webhook` (instant; webhooks auto-register) |
| `PUBLIC_URL` | e.g. `https://agency.example.com` (no port) |
| `GITHUB_WEBHOOK_SECRET` | long random **alphanumeric** string (no `$` — compose mangles it) |
| `DASHBOARD_PASSWORD` | for the dashboard (alphanumeric) |

3. Deploy. Add repos with `/add-repo`, then pin `@dev` on an issue. That's it.

Watched repos live in `config/repos.txt` (plus `/add-repo` additions in the DB volume);
handles in `config/team.txt`. Local/macOS run: `scripts/setup-macos.sh`, `scripts/run-local.sh`.

---

## Under the hood

```
src/
├── runner.ts      scan GitHub -> dispatch to a bounded worker pool (AGENCY_CONCURRENCY=3)
├── pipeline.ts    plan -> approve -> build -> test -> review -> PR (+ reflection)
├── agents/        roles (model + tools + persona), the Agent SDK runner
├── reflect.ts     librarian lessons + self-improvement PRs
├── budget.ts      cost guardrails
├── github.ts      gh CLI wrappers, labels, reactions, webhooks, collaborator invites
├── commands.ts    /add-repo, /merge, orphan recovery
├── store.ts       SQLite ledger (issues, runs+cost, plans, lessons, activity)
├── webhook.ts     event server + dashboard routes (+ safety poll)
└── dashboard.ts   live status + /history
memory/central/    CONSTITUTION, playbooks, personas  <- the agency's editable brain
```

Issues/PRs are worked **in parallel** (default 3 at once), each in its own clone. Agent
runs use `bypassPermissions` inside the container (non-root), with the bot's git identity.
`npm test` runs the unit suite.
