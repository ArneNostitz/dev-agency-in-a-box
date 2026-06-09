# Deploying the Dev Agency on Coolify

Coolify is the recommended home for the agency: a self-hosted Docker PaaS that
runs it 24/7 on Linux, so `gh`, Node, and the Claude binary all work without the
macOS-version headaches. The agency runs as one long-lived container that polls
your GitHub issues and processes them.

## What you need

- A running Coolify instance.
- This repo (`dev-agency`) on GitHub.
- A GitHub token (fine-grained, all repos: Contents/Issues/PRs/Workflows = read & write).
- A Claude credential: a subscription token from `claude setup-token`, **or** an `ANTHROPIC_API_KEY`.

## Steps

### 1. Create the resource
In Coolify: **+ New → Application**. For the source, pick your `dev-agency` repository.
- Private repo: connect it via Coolify's **GitHub App** (Sources → GitHub) or a deploy key.
- Build pack: **Docker Compose** (Coolify auto-detects `docker-compose.yml` in the repo root).

### 2. Set environment variables (Secrets)
In the resource's **Environment Variables** tab, add these (mark the tokens as secret):

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | your fine-grained GitHub token (ideally the **bot account's** — see below) |
| `GITHUB_OWNER` | your GitHub username or org |
| `CLAUDE_CODE_OAUTH_TOKEN` | output of `claude setup-token` (subscription) |
| `ANTHROPIC_API_KEY` | *(only if not using the subscription token)* |
| `RUN_MODE` | `watch` (poll) or `webhook` (instant — see below) |
| `GITHUB_WEBHOOK_SECRET` | a long random string (only for webhook mode) |
| `POLL_INTERVAL_SECONDS` | `60` (watch mode, optional) |
| `AGENT_MODEL` | optional, e.g. `claude-sonnet-4-6` |

Repos are read from **`config/repos.txt`** in the repo (one per line), so you don't
normally set `TARGET_REPO` here.

### Which repos it works in — and adding more

The agency **only** works in repos you explicitly list — never all your repos. Three ways to
add one (the `GITHUB_TOKEN` must have access to it):

1. **From GitHub, no terminal (easiest):** open an issue in any repo the agency already
   watches with the body `/add-repo <name>` (e.g. `/add-repo reimedy-minimal`). The agency
   adds it, comments confirmation, and closes the issue — no redeploy. `/list-repos` shows the
   current list. (These additions live in the agency's SQLite memory on the data volume.)
2. **Edit `config/repos.txt`** in the `dev-agency` repo (add a line) and push.
3. **`./scripts/add-repo.sh my-app`** from a local clone (edits the file, commits, pushes).

### Triggering: pin a teammate with a short @handle

By default (`TRIGGER_MODE=mention`) the agency acts only when you **mention one of its
handles** in an issue — so you "pin" it, e.g. open an issue and write:

```
@dev add a /health endpoint that returns 200
```

Handles live in **`config/team.txt`** (defaults: `@dev`, `@agency`) — short and easy to type,
and ready to map to specialist roles in Phase 3. It marks issues `agency:in-progress` →
`agency:ready` as it goes, and never re-picks one. Add the **`agency:ignore`** label to mute
any issue. Prefer a different style? Set `TRIGGER_MODE=label` (only `agency:queue` issues) or
`TRIGGER_MODE=any` (every new issue).

### Triggering instantly with webhooks (turnkey)

For instant reaction instead of polling, set these env vars on the resource:

- `RUN_MODE=webhook`
- `GITHUB_WEBHOOK_SECRET=<a long random string>`
- `PUBLIC_URL=https://<your-coolify-domain>` (the domain Coolify assigned this service)

…and make sure the service's port **3000** is exposed at that domain. That's it — on startup
the agency **registers the GitHub webhook on every watched repo itself** (and on any repo you
add later), so there's no manual GitHub webhook setup. It verifies each delivery's signature
and processes the issue the moment it's opened; a slow safety poll still runs as a backstop.

(If you leave `PUBLIC_URL` unset, you can still add the webhook manually in each repo's
**Settings → Webhooks**: payload `https://<domain>/webhook`, content type `application/json`,
the same secret, event **Issues**.)

### Running under a bot identity (so it's not "you")

Right now actions are attributed to whoever owns `GITHUB_TOKEN`. To give the agency its own
identity:

1. Create a second GitHub account, e.g. `arne-agency-bot` (use a `+` email alias like
   `arne+agency@…`).
2. Invite it to your repos as a collaborator (repo **Settings → Collaborators**), or add it
   to a GitHub org.
3. Log in as the bot and create a **fine-grained PAT** for it (all repos it should touch:
   Contents/Issues/PRs/Workflows = read & write).
4. Put that token in `GITHUB_TOKEN`. Commits already use the `dev-agency-bot` git identity;
   now PRs and comments are attributed to the bot account too — and you can revoke it anytime
   without touching your own account.

**Automate the invites.** You don't want to invite the bot to every new repo by hand. Set
`ADMIN_GITHUB_TOKEN` to your **owner** token (the account that owns the repos; needs repo
admin) and the agency invites + accepts the bot automatically on startup and on every
`/add-repo`. So the flow becomes: `/add-repo <name>` → bot auto-added → it starts working —
no manual collaborator step. (Even cleaner: keep projects in a GitHub **org** and add the bot
to a team once; then it has access to all org repos with no invites at all.)

`RUN_MODE` defaults to `watch` if unset.

### 3. Deploy
Hit **Deploy**. Coolify builds the image (installs Node + git + gh, compiles the
TypeScript) and starts the container. Watch the **Logs** tab — you should see:

```
[agency] auth: CLAUDE_CODE_OAUTH_TOKEN (subscription, headless)
[agency] target repo: my-org/sandbox-project (mode: watch, every 60s)
[agency] queue empty; sleeping 60s...
```

### 4. Use it
Open an issue on your target repo, add the **`agency:queue`** label, and within a
minute the agency picks it up, opens a draft PR, and labels the issue `agency:ready`.

## Updating instructions on the fly

The Constitution and playbooks live in `memory/` in this repo. To change how the
agents behave, edit those files and `git push`. Enable **Auto Deploy** on the Coolify
resource (Webhooks) and a push redeploys the container automatically — so editing
prose updates the running agency. This is the "self-contained, evolving via git" model.

## Open a PR preview without merging ("see the app")

The dashboard can show an **Open preview ↗** button on each PR so you can try the running
branch on your phone before merging. The preview itself is deployed by **Coolify's PR preview
deployments** (not by the agency) — set it up once per app:

1. In Coolify, the app repo must be connected via the **GitHub App** integration (not a plain
   deploy key) so Coolify sees PRs.
2. On that application: **Configuration → Preview Deployments → enable**, and set a wildcard
   preview domain (you'll need a `*.preview.example.com` DNS record pointing at the server).
3. Coolify now auto-deploys every PR to a URL following your wildcard pattern.
4. Tell the agency that pattern via `PREVIEW_URL_TEMPLATE` (placeholders `{owner} {repo}
   {repofull} {pr} {branch}`), e.g. `https://{repo}-pr-{pr}.preview.example.com`. The dashboard
   fills it in per PR.

The **Run checks ▶** button needs no setup — it runs the project's tests on the branch and
reports back in the thread.

## Other model providers (GLM, DeepSeek, Gemini, OpenAI, Ollama)

The agents run on the Claude Agent SDK, which speaks the **Anthropic API**. To use other
models you point it at an Anthropic-compatible endpoint and pick model names per role:

```
ANTHROPIC_BASE_URL = https://your-endpoint-or-router
ANTHROPIC_AUTH_TOKEN = <key for that endpoint>
PLANNER_MODEL = …   DEVELOPER_MODEL = …   REVIEWER_MODEL = …   TESTER_MODEL = …
```

Two routes:

- **Providers with a native Anthropic-compatible API** (e.g. DeepSeek, Zhipu **GLM**, Moonshot/
  Kimi): set `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` to theirs and use their model names.
- **OpenAI / Gemini / Ollama / mix-and-match**: run a translating router —
  [claude-code-router](https://github.com/musistudio/claude-code-router) or
  [LiteLLM](https://github.com/BerriAI/litellm) — that exposes an Anthropic endpoint and maps
  model names to any backend. Point `ANTHROPIC_BASE_URL` at the router, then set each role's
  model to whatever the router serves (e.g. `DEVELOPER_MODEL=deepseek-chat`,
  `PLANNER_MODEL=gpt-5`, `TESTER_MODEL=ollama/llama3`).

Per-role models route independently through the gateway, so you can keep Opus on the planner
and run cheaper/local models for the executors. Leave these unset to use Claude directly.

### Simplest path: the dashboard "Models" panel (keeps Claude on your subscription)

Settings → **Models & providers**. Add a provider (GLM/Zhipu, DeepSeek, Kimi presets, or a
custom Anthropic-compatible endpoint) with its API key, then assign it to specific agents
(e.g. **planner = Claude/subscription, developer = GLM**). Each agent runs against its own
endpoint, so your Claude roles keep using your Max subscription while others go to the chosen
provider — no global gateway, no env vars, applies on the next run.

> Providers must expose a **native Anthropic-compatible** endpoint (GLM, DeepSeek, Kimi do).
> For OpenAI/Gemini/Ollama, point a "Custom" provider's base URL at a translating gateway
> (claude-code-router / LiteLLM) you run, and use the model names it serves.

## Notes

- **Persistence:** the named volume `agency-data` at `/app/data` holds the SQLite memory
  (issues, runs+cost, plans, lessons, comment cursors) so it survives redeploys. Markdown
  memory ships in the image and is versioned in git.
- **Many repos, one deployment:** the orchestrator watches every repo in `config/repos.txt`
  plus any added at runtime via a `/add-repo` issue — no need for one deployment per repo.
- **Resources:** the container is lightweight (it mostly waits on the cloud API). A small
  Coolify app allocation is plenty.
