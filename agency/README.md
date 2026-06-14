# 🤖 Dev Agency

A fully autonomous team of AI agents you operate entirely through GitHub issues.
You write an issue and pin a teammate; the agency plans, asks if it must, waits for your 👍,
builds on a branch, tests, reviews, and hands you a draft PR. You test locally and say
"ship it". It runs 24/7 on Coolify (Docker), reacts instantly to webhooks, heals its own
PRs, learns from every run, and proposes improvements to its own playbooks as PRs.

**Status (v1.2.0):** mobile-first dashboard (installable PWA, light/dark), multi-user login with
encrypted per-user credentials, a guided onboarding wizard, kanban with auto-resume/auto-merge,
and the self-evolving loop. Full design: [`../dev-agency-architecture.md`](../dev-agency-architecture.md).

---

## Quick start

1. **Deploy on Coolify** (Docker Compose from this repo) — **zero env vars required**. A
   `MASTER_KEY` is auto-generated and persisted on the data volume on first boot; everything else
   is configured in-app. Just make the domain route to **container port 3000** and keep the
   `agency-data` volume. Full steps + troubleshooting: [`COOLIFY.md`](COOLIFY.md).
2. **Open the dashboard** → create the admin account (first-run screen).
3. **Onboarding wizard** walks you through the rest: pick your models (Claude subscription/API,
   GLM, DeepSeek…), paste each token with step-by-step "where to get it" instructions, and add
   your first repo. No tokens in env — it's all in the dashboard, stored encrypted.
4. **Use it**: open an issue (or **+ New**) and the agency plans → builds → reviews → opens a PR.

Dev/prod split and staging: [`DEPLOY.md`](DEPLOY.md). The old single-page dashboard stays at
`/classic` (advanced models/agents editors live there).

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

### Dashboard (mobile-first)

Your Coolify domain serves a password-protected, light, **mobile-first kanban**, grouped by
repo then state (Working · Waiting on you · Ready · Needs attention · Merged). Tap a card to
open a detail drawer with:

- **Direct links** to the issue and the PR, plus **Open preview ↗** (the PR running live, no
  merge — see COOLIFY.md to enable).
- **Run checks ▶** — runs the tests on the branch and reports back, no merge.
- The **live agent stream** for that card, and the full **GitHub conversation** (markdown).
- An **inline reply** box that posts straight to GitHub — which re-engages the agency. So you
  can drive the whole thing from your phone without leaving the board.

`/history` has the full firehose, every run with its cost, and archive buttons.

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
2. Deploy — **no env vars required.** A `MASTER_KEY` auto-generates and persists on the
   `agency-data` volume. (Everything that used to be env — GitHub/Claude tokens, owner, repos,
   run mode, budgets — is now set in-app via the onboarding wizard and Settings → Operations.)
3. Open the dashboard → create the admin account → run onboarding to add your tokens + first repo,
   then pin `@dev` on an issue. That's it.

**Optional env overrides** (none required): `MASTER_KEY` (pin instead of auto-gen — keep it
stable), `RUN_MODE` (`watch`/`webhook`/`once`), `AGENCY_ENV=development` (DEV badge),
`ADMIN_USERNAME`/`ADMIN_PASSWORD` (seed the admin headlessly), `RESET_ADMIN_PASSWORD` (password
recovery), `GITHUB_WEBHOOK_SECRET` (webhook mode).

**Lost / rotating the encryption key?** Run `node scripts/reset-master-key.mjs` in the container
terminal — it wipes the stored (now-undecryptable) secrets + sessions and regenerates the key;
re-run onboarding afterwards.

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
