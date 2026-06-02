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
| `GITHUB_TOKEN` | your fine-grained GitHub token |
| `GITHUB_OWNER` | `ArneNostitz` |
| `TARGET_REPO` | the repo to work on, e.g. `sandbox-project` |
| `CLAUDE_CODE_OAUTH_TOKEN` | output of `claude setup-token` (subscription) |
| `ANTHROPIC_API_KEY` | *(only if not using the subscription token)* |
| `POLL_INTERVAL_SECONDS` | `60` (optional) |
| `AGENT_MODEL` | optional, e.g. `claude-sonnet-4-6` |

`RUN_MODE=watch` is baked into the image, so you don't need to set it.

### 3. Deploy
Hit **Deploy**. Coolify builds the image (installs Node + git + gh, compiles the
TypeScript) and starts the container. Watch the **Logs** tab — you should see:

```
[agency] auth: CLAUDE_CODE_OAUTH_TOKEN (subscription, headless)
[agency] target repo: ArneNostitz/sandbox-project (mode: watch, every 60s)
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

## Notes

- **Persistence:** a named volume `agency-data` is mounted at `/app/data`, reserved for
  the SQLite + vector memory added in Phase 2. Markdown memory ships in the image and is
  versioned in git.
- **One target repo per deployment** for now. To run several projects, deploy multiple
  copies with different `TARGET_REPO` values, or wait for the orchestrator (Phase 3),
  which will manage multiple repos from one deployment.
- **Resources:** the container is lightweight (it mostly waits on the cloud API). A small
  Coolify app allocation is plenty.
