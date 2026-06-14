# Dev Agency in a Box 📦

A supercharger for GitHub issues. It sits on top of the issues and pull requests you already use and turns them into a self-driving development workflow — powered by AI, run from a clean dashboard that works just as well on your phone as on your laptop.

Think of it as a power layer over GitHub: you describe what you want in an issue, and a small AI team plans it, writes the code, reviews itself, and opens a pull request for you to approve. Everything stays in your repo — real issues, real branches, real PRs.

## How it works

Two ways to kick off work:

- **From GitHub** — open or comment on an issue and mention `@dev`. The agency picks it up automatically.
- **From the dashboard** — drop a card on the kanban board and development starts on its own.

Either way, you watch it happen live — plan → build → review → PR — from the web or your phone, and approve the pull request when it's ready.

Drop it on a server, open it in your browser, paste a couple of keys, and you're off. No config files to wrestle with.

## What's in the box

- **`agency/`** — the main act. One container that runs the dashboard and does the actual work on your repos.
- **`analyzer/`** — an optional sidekick. A tiny watchdog that quietly watches how the agency is doing and opens friendly "here's how to improve" suggestions. It runs on its own, so it keeps working even if the agency is mid-redeploy.

You can run just the agency and add the analyzer later — it's completely optional.

> **Deploying?** This `main` branch holds the docs and full source. For Coolify, point each resource at the matching deploy branch — **`agency`** or **`analyzer`** — where the `docker-compose.yml` lives at the root.

---

## Get the agency running (Coolify)

About 10 minutes, start to finish.

1. **Add it.** In Coolify: **+ New → Resource → Docker Compose**. Point it at this repo and select the **`agency`** branch — its `docker-compose.yml` sits at the root, so there's nothing else to configure.
2. **Give it a web address.** Add your domain to the resource and make sure it routes to **port `3000`** (that's the only port the app uses).
3. **Leave the storage alone.** The compose file mounts a data volume at `/app/data` — keep it. That's where your logins and saved keys live, so they survive every redeploy.
4. **Deploy.** Hit deploy and wait for the logs to say it's listening on `:3000`.
5. **Make your account.** Open your domain in a browser — the first screen lets you create your admin login.
6. **Follow the wizard.** It walks you through pasting your keys (next section). That's it.

Need the long version with troubleshooting? See [`agency/COOLIFY.md`](agency/COOLIFY.md).

## The two keys you'll paste

The wizard asks for these in the browser — you don't put them in any config file.

**1. A GitHub token** (so the agency can read issues, push code, and open PRs)

Use a GitHub account you want the work to come from (many people make a dedicated "bot" account). On that account go to **Settings → Developer settings → Fine-grained tokens → Generate new token**, give it access to the repos you want, and set these permissions:

- **Contents, Issues, Pull requests, Workflows** → Read & write
- **Metadata** → Read

Copy the token and paste it into the wizard.

**2. A way to run the AI** — pick one:

- **Claude subscription (recommended).** On your computer run `npm i -g @anthropic-ai/claude-code`, then `claude setup-token`. It opens a browser, you log in with your Claude plan, and it prints a token. Copy that. *(This is not an `sk-ant-…` key.)*
- **A Claude API key.** Grab an `sk-ant-…` key from [platform.claude.com](https://platform.claude.com).
- **Another provider.** Paste a provider base URL + token (e.g. GLM) if that's what you use.

After pasting the Claude key, click **Save & test** — it makes a real call and tells you right away if it's good. ✅

Now add a repo, open an issue, mention `@dev`, and watch it go.

---

## Add the analyzer (optional)

Want the agency to suggest its own improvements? Deploy the analyzer as a **second** Coolify resource.

1. **+ New → Resource → Docker Compose**, same repo, but select the **`analyzer`** branch.
2. Set its three environment variables (see the table below): the agency's URL, a shared password, and one AI key.
3. Back on the **agency**, add one environment variable — `ANALYZER_API_KEY` — set to the **same shared password** you gave the analyzer. That's what lets the two talk.
4. Deploy. The agency dashboard footer now shows the analyzer's status and a **Run now** button.

The analyzer never touches your code or secrets directly — it just reads stats and opens suggestion issues for you to approve. Full details in [`analyzer/README.md`](analyzer/README.md).

### Make the shared password

Any long random string works. An easy way:

```
openssl rand -hex 32
```

Use that same value for the analyzer's `AGENCY_API_KEY` and the agency's `ANALYZER_API_KEY`.

---

## What it runs on

You don't install any of this yourself — the container ships with the whole toolbox so the agents have everything they need:

- **[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)** (`@anthropic-ai/claude-agent-sdk`) — the engine. Each agent runs as its own Claude session.
- **Node.js, git, and the [GitHub CLI](https://cli.github.com) (`gh`)** — for cloning repos, branching, committing, and opening pull requests.
- **[GitNexus](https://www.npmjs.com/package/gitnexus)** — optional code intelligence that maps a repo's structure so agents can research the code using far fewer tokens (turns on with `GITNEXUS=true`).
- **[Graphify](https://github.com/safishamsi/graphify)** — a knowledge-graph engine the Auditor uses to spot architectural hot spots and dead code. Optional; the audit gracefully falls back without it.
- **SQLite** (built into Node) — stores your settings, run history, and encrypted keys on the data volume.
- **[Preact](https://preactjs.com) + htm** — the dashboard UI, served with no build step.

The analyzer stays deliberately lean: just Node and one AI key.

## Environment variables

### Agency

**None are required** — the agency configures itself in the browser. The only ones you might add:

| Variable | What it does |
|----------|--------------|
| `ANALYZER_API_KEY` | Turns on the analyzer connection. Set it to the shared password (same value as the analyzer's `AGENCY_API_KEY`). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional — enables "email me a reset link" on the login page. Skip them and password reset still works via your recovery key. |

### Analyzer

Three things to set, plus a couple of optional knobs.

| Variable | Required? | Default | What it does |
|----------|-----------|---------|--------------|
| `AGENCY_URL` | Yes | — | Your agency's web address, e.g. `https://agency.yourdomain.com`. |
| `AGENCY_API_KEY` | Yes | — | The shared password — must match the agency's `ANALYZER_API_KEY`. |
| one AI key | Yes | — | `CLAUDE_CODE_OAUTH_TOKEN`, or `ANTHROPIC_API_KEY`, or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`. |
| `ANALYZER_MODEL` | No | `claude-sonnet-4-6` | Which model the analyzer uses. |
| `ANALYZER_INTERVAL_HOURS` | No | `6` | How often it checks in. |

---

## Run it on your own machine

Each folder stands alone:

```bash
cd agency && npm install && npm run build && npm start   # dashboard on http://localhost:3000
cd analyzer && npm install && npm start                  # needs AGENCY_URL + AGENCY_API_KEY
```

## License

Open and free to use, self-host, modify, and contribute to — under the **MIT License with the [Commons Clause](https://commonsclause.com/)**. The one limit: you may not **sell** it (no reselling the software or offering it as a paid product/hosted service). Everything else is fair game. See [`LICENSE`](LICENSE).

## A note on safety

The analyzer is deliberately powerless: it can only read aggregate stats over an authenticated link, and it can only *suggest* changes by opening issues. Applying anything always goes through your approval in the dashboard. The connection stays off entirely until you set a strong `ANALYZER_API_KEY`.
