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
| `GITHUB_OWNER` | `ArneNostitz` |
| `CLAUDE_CODE_OAUTH_TOKEN` | output of `claude setup-token` (subscription) |
| `ANTHROPIC_API_KEY` | *(only if not using the subscription token)* |
| `RUN_MODE` | `watch` (poll) or `webhook` (instant — see below) |
| `GITHUB_WEBHOOK_SECRET` | a long random string (only for webhook mode) |
| `POLL_INTERVAL_SECONDS` | `60` (watch mode, optional) |
| `AGENT_MODEL` | optional, e.g. `claude-sonnet-4-6` |

Repos are read from **`config/repos.txt`** in the repo (one per line), so you don't
normally set `TARGET_REPO` here.

### Which repos it works in — and adding more

The agency **only** works in repos you explicitly list in **`config/repos.txt`** — never all
your repos. To add one, run:

```bash
./scripts/add-repo.sh my-app        # or: npm run add-repo -- someorg/my-app
```

That appends the repo, commits, and pushes; with auto-deploy on, Coolify redeploys and it
starts watching within a minute. (Your `GITHUB_TOKEN` must have access to that repo.)

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

### Triggering instantly with webhooks (optional)

Polling every 60s is fine, but for instant reaction set `RUN_MODE=webhook` and a
`GITHUB_WEBHOOK_SECRET`, then in GitHub (repo or org **Settings → Webhooks → Add webhook**):

- **Payload URL:** `https://<your-coolify-domain>/webhook`
- **Content type:** `application/json`
- **Secret:** the same `GITHUB_WEBHOOK_SECRET`
- **Events:** select **Issues**

Coolify exposes the service's port 3000 at the domain it assigns the resource. The agency
verifies the signature and processes the issue the moment it's opened. A slow safety poll
still runs so nothing is missed if a delivery is dropped.

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

`RUN_MODE` defaults to `watch` if unset.

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
