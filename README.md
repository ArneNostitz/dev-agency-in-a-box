# Dev Agency

A self-contained, self-evolving developer agency of AI agents, driven by GitHub issues.
You file an issue, the agency does the work on a branch and opens a linked pull request,
and you test it locally. Built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).

See [`../dev-agency-architecture.md`](../dev-agency-architecture.md) for the full design and roadmap.

## Status: Phase 1

One **Developer agent** that picks up a single queued issue and drives it to a draft PR:

```
issue (label: agency:queue)  ->  branch  ->  commit  ->  draft PR (Closes #N)  ->  comment back
```

Later phases add the orchestrator, the architect/reviewer/tester agents, the SQLite +
vector memory, and the self-evolving loop.

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

## Run it (Docker)

```bash
docker compose build
docker compose run --rm agency
```

The `memory/` folder is mounted into the container, so edits to the Constitution or
playbooks take effect on the next run with no rebuild.

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
