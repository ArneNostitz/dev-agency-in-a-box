# Dev Agency

A self-contained, self-evolving developer agency of AI agents, driven by GitHub issues.
You file an issue, the agency does the work on a branch and opens a linked pull request,
and you test it locally. Built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).

See [`../dev-agency-architecture.md`](../dev-agency-architecture.md) for the full design and roadmap.

## Status: Phase 2/3 — the full roster

Pin a teammate by mentioning its handle in an issue; the orchestrator runs the right
specialists and drives the work to a reviewed PR:

```
@dev <task>  ->  Planner researches + recommends  ->  Architect drafts a technical plan
             ->  posts the proposal, waits for your "ok"  (agency:awaiting-approval)
   you: ok  ->  Developer implements  ->  Tester  ->  Reviewer (1 revise)  ->  draft PR  ->  agency:ready
```

It's a conversation, not a one-shot. The **Planner** (Opus 4.8, high effort) researches the
repo and *proactively recommends* an approach; the **Architect** turns it into a concrete
technical plan; the proposal is posted and the issue waits. Reply **ok** to build it, or reply
with changes and it re-proposes. (It only asks up-front questions when genuinely blocked.)

**Watch it work:** in webhook mode the agency serves a live dashboard at its public URL
(`https://<your-domain>/`) with a **live thought-stream** (each agent's text + tool use,
streamed over SSE as it happens), the issues in flight (with direct GitHub links), and recent
agent runs (role, model, effort). Protect it with `DASHBOARD_PASSWORD` (Basic Auth; `/webhook`
and `/health` stay open). The full conversation also lives on each GitHub issue.

**Redeploys are safe:** the data volume (SQLite memory + watch list) persists, and on startup
the agency re-queues any issue a restart left mid-run (`recoverOrphans`), so nothing gets
stranded.

Handles (config/team.txt): `@dev`/`@agency` (full pipeline), `@plan` (planner only),
`@arch` (quick plan), `@review`, `@test`. Every agent obeys the **engineering harness**
(`memory/central/playbooks/`) and has an editable persona (`memory/central/agents/`).

**Memory:** a SQLite ledger (`node:sqlite`, no native build) records every issue, agent run
(role/model/turns), and plan — the audit + recall layer. Lives on the Docker data volume.

**Model policy** (cheapest that does the job, override per role with `*_MODEL`):
planner = Opus 4.8, architect/developer/reviewer = Sonnet, tester = Haiku.

Companion repo: **`project-template`** — the atomic-design, themeable starting point the
agents build from. Still to come: the SQLite + vector memory and the self-evolving loop.

## Prerequisites

- **Node 20+**, **git**, and the **GitHub CLI (`gh`)** on your PATH (for local runs), or
- **Docker Desktop** (for the containerized run).
- An **Anthropic API key** and a **fine-grained GitHub token** (all-repos; Contents/Issues/PRs/Workflows = read & write).

## Setup

```bash
cd dev-agency
cp .env.example .env      # then edit .env (GITHUB_TOKEN is always required)
```

`.env` is gitignored — your token never gets committed.

### Authenticating the agent brains

You can use either your **Claude subscription** or a **pay-as-you-go API key**:

- **Subscription (recommended for local runs):** leave `ANTHROPIC_API_KEY` blank and log in once:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude            # then type /login and pick your Claude plan
  ```
  The SDK reuses that login. Note: from June 15 2026, Agent SDK usage draws from a separate
  monthly plan credit ($20 Pro / $100 Max 5× / $200 Max 20×), then pauses until refresh.
- **API key:** set `ANTHROPIC_API_KEY` in `.env`. Pay-as-you-go, no monthly ceiling.
- **Docker / headless subscription:** generate a token with `claude setup-token` and put it in
  `.env` as `CLAUDE_CODE_OAUTH_TOKEN` (interactive `/login` won't work inside a container).

The runner prints which auth mode it's using on startup.

## Run it (local)

1. In your `sandbox-project` repo, open an issue describing a small change
   (e.g. "Add a hello() function to a new file src/hello.js that returns 'hello world'").
2. Add the label **`agency:queue`** to that issue.
3. From this folder:

```bash
./scripts/run-local.sh
# or: npm install && npm run dev
```

4. Watch the logs. When it finishes, open the issue on GitHub — there'll be a comment and a
   draft PR. To test locally:

```bash
git fetch origin && git checkout agency/issue-<N>
# run / inspect the change
```

## Deploy always-on (Coolify — recommended)

The recommended home for the agency is a container host running 24/7. On Coolify it
runs as a single long-lived watcher (`RUN_MODE=watch`) that polls issues every minute.
Full steps in **[COOLIFY.md](COOLIFY.md)** — connect the repo, set the env secrets, deploy.

Edit `memory/` and `git push` to update the agents' rules; with Coolify auto-deploy, the
running agency updates itself on push.

## Run it (Docker, locally)

```bash
docker compose build
# one-shot:
docker compose run --rm -e RUN_MODE=once agency
# or the long-running watcher:
docker compose up
```

## Run it always-on (macOS, e.g. a dedicated older Mac)

This turns a Mac into the agency's home: a launchd service checks for queued issues
every minute and processes them. Heavy compute stays in the cloud (LLM inference +
GitHub Actions CI), so even modest hardware is plenty.

```bash
cd dev-agency
claude            # type /login once to use your subscription (or set a token in .env)
./scripts/setup-macos.sh
```

The script installs Node + gh (via Homebrew), builds, installs the background service,
and disables sleep while on power. After that you only ever file issues — the Mac runs
itself. Useful commands:

```bash
tail -f logs/agency.log                                   # watch it work
launchctl unload ~/Library/LaunchAgents/com.devagency.runner.plist   # stop
launchctl load   ~/Library/LaunchAgents/com.devagency.runner.plist   # start
```

### Cloud CI for projects

Copy `templates/github-actions-ci.yml` into a target repo as `.github/workflows/ci.yml`
so tests/builds run on GitHub's runners instead of the local Mac. With branch protection
requiring that check, the agency physically can't merge red.

### Issue labels (the state machine)

`agency:queue` → you mark an issue ready for the agency.
`agency:in-progress` → being worked on.
`agency:ready` → PR opened, ready for your review.
`agency:needs-attention` → stopped without a PR (needs clarification or hit a blocker).

## How behavior is controlled

Everything the agents may and may not do lives in **`memory/central/CONSTITUTION.md`**,
which is loaded into every agent on every task. Edit that file (in prose) to change the
rules — no code change, no restart. Detailed how-tos live in `memory/central/playbooks/`.

## Layout

```
dev-agency/
├── src/
│   ├── runner.ts        # Phase 1 loop: find issue -> clone -> run dev agent
│   ├── config.ts        # env-based configuration
│   ├── github.ts        # gh CLI wrappers
│   ├── memory.ts        # loads Constitution + playbooks
│   └── agents/dev.ts    # the Developer agent definition
├── memory/
│   └── central/
│       ├── CONSTITUTION.md
│       └── playbooks/git-workflow.md
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Safety note

Phase 1 runs the agent with `bypassPermissions` against a **throwaway sandbox repo**, so it
can work without approval prompts. Before pointing the agency at real repositories we add the
reviewer/tester gates, branch protection, and a tighter permission policy (see the architecture doc).
