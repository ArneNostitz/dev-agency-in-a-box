# Dev Agency in a Box

A two-component monorepo for deploying autonomous agents that work your GitHub issues 24/7. The **Dev Agency** is a long-lived dashboard that plans, builds, reviews, and opens PRs — powered by the Anthropic Claude Agent SDK. The optional **Process Analyzer** is an independent watchdog that reads telemetry and proposes self-improvements, staying active even when the agency redeploys.

## What's inside

- **`agency/`** — the Dev Agency: a containerized Node service (port 3000) that serves a browser dashboard and runs agents on GitHub issues. Zero-config deployment; everything is configured in-browser on first visit.
- **`analyzer/`** — (optional) the Process Analyzer: a separate small service that polls the agency's telemetry endpoint and opens advisory GitHub issues with optimization proposals. Deploys independently for resilience.

## Quick start (Coolify)

### The agency

1. In Coolify, create a new **Docker Compose** resource pointing at this repository on the `main` branch.
2. **Critical:** set the resource's **Base Directory** to `/agency` so Coolify finds `agency/docker-compose.yml`.
3. Set your domain and confirm it routes to **container port `3000`** (wrong port = HTTP 502). The app only listens on 3000.
4. Keep the named volume `agency-data` mounted at `/app/data` — it holds the encrypted database and the auto-generated encryption key, so logins and tokens survive redeploys. If you run staging, give it a separate volume.
5. Deploy and wait for logs to show it's listening on `:3000`.
6. Open your domain → create the admin account (first-run screen).
7. Complete the onboarding wizard: pick your LLM, paste a token (Claude subscription via `claude setup-token`, or an `sk-ant-…` API key), and click **"Save & test"** to verify it works instantly.
8. Add your first GitHub repo and start pinning `@dev` on issues.

For full details, see [`agency/COOLIFY.md`](agency/COOLIFY.md).

### The analyzer (optional)

If you want advisory proposals:

1. Create a second Coolify resource pointing at the same repository on `main`, but set **Base Directory** to `/analyzer`.
2. Set three environment variables:
   - `AGENCY_URL`: the agency's base URL (e.g. `https://devagency.example.com`)
   - `AGENCY_API_KEY`: a strong shared secret (≥16 chars; generate with `openssl rand -hex 32`)
   - One LLM credential: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or `ANTHROPIC_BASE_URL`+`ANTHROPIC_AUTH_TOKEN`
3. On the agency side, set `ANALYZER_API_KEY` in Coolify's environment (same value as the analyzer's `AGENCY_API_KEY`) and optionally set `ANALYZER_REPO` in the agency's Settings to choose where advisory issues are opened.
4. Deploy. The agency dashboard footer shows analyzer health and a "Run now" button.

For full details, see [`analyzer/README.md`](analyzer/README.md).

## Environment variables

### Agency (`agency/`)

All environment variables are optional. The agency auto-generates a `MASTER_KEY` on first boot and persists it on the `/app/data` volume; every operational setting and credential is configured in the dashboard (onboarding wizard + Settings).

| Variable | Required? | Default | What it does |
|----------|-----------|---------|--------------|
| `MASTER_KEY` | No | auto-generated | 32-byte hex encryption key for stored secrets (GitHub tokens, Claude credentials). Must stay stable; changing it makes all stored secrets undecryptable. |
| `RUN_MODE` | No | `watch` | Agent polling mode: `watch` (polls GitHub), `webhook` (event-driven), or `once` (one-shot). |
| `ADMIN_USERNAME` | No | `admin` | Username for the first admin account seeded on startup (used once). |
| `ADMIN_PASSWORD` | No | none | Password for the first admin account (used once). |
| `ADMIN_EMAIL` | No | none | Email for the first admin account (optional). |
| `RESET_ADMIN_PASSWORD` | No | none | Set a temporary password to regain access if you forgot the admin password. Remove it after logging in. |
| `AGENCY_ENV` | No | `production` | Set to `development` on staging to show a yellow **DEV** badge. |
| `GITHUB_WEBHOOK_SECRET` | No | none | (webhook mode only) Shared secret for verifying GitHub webhook signatures. |
| `SMTP_HOST` | No | none | Email password-reset feature: SMTP server hostname. Omit to disable. |
| `SMTP_PORT` | No | `587` | SMTP port (`465` = implicit TLS, `587`/`25` = STARTTLS). |
| `SMTP_USER` | No | none | SMTP username. |
| `SMTP_PASS` | No | none | SMTP password. |
| `SMTP_FROM` | No | none | Email sender address, e.g. `"Dev Agency <no-reply@example.com>"`. |
| `SMTP_SECURE` | No | auto | `true` or `false` to override TLS detection (defaults: `true` on 465, else `false`). |
| `DB_PATH` | No | `/app/data/agency.db` | SQLite database location (Docker default shown; local dev uses `./data/agency.db`). |
| `ANALYZER_API_KEY` | No | none | Enable the `/telemetry` endpoint for the analyzer (set to the same value as the analyzer's `AGENCY_API_KEY`). If omitted, `/telemetry` returns 503. |

**Note:** `ANALYZER_REPO` (which repo to post analyzer proposals to) is configured in Settings, not via environment variable.

### Analyzer (`analyzer/`)

Required variables: `AGENCY_URL`, `AGENCY_API_KEY`, and **one** LLM credential.

| Variable | Required? | Default | What it does |
|----------|-----------|---------|--------------|
| `AGENCY_URL` | Yes | none | Base URL of the Dev Agency, e.g. `https://devagency.example.com`. |
| `AGENCY_API_KEY` | Yes | none | Shared secret matching the agency's `ANALYZER_API_KEY` (≥16 chars). Generated with `openssl rand -hex 32`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | No* | none | Claude subscription token from `claude setup-token`. *Use this OR `ANTHROPIC_API_KEY` OR (`ANTHROPIC_BASE_URL`+`ANTHROPIC_AUTH_TOKEN`). |
| `ANTHROPIC_API_KEY` | No* | none | API key from https://platform.claude.com (`sk-ant-…`). *Use this OR `CLAUDE_CODE_OAUTH_TOKEN` OR (`ANTHROPIC_BASE_URL`+`ANTHROPIC_AUTH_TOKEN`). |
| `ANTHROPIC_BASE_URL` | No* | none | Base URL for alternative LLM providers (GLM, etc.). *Requires `ANTHROPIC_AUTH_TOKEN`. Use this pair OR `CLAUDE_CODE_OAUTH_TOKEN` OR `ANTHROPIC_API_KEY`. |
| `ANTHROPIC_AUTH_TOKEN` | No* | none | Auth token for alternative LLM provider. *Requires `ANTHROPIC_BASE_URL`. Use this pair OR `CLAUDE_CODE_OAUTH_TOKEN` OR `ANTHROPIC_API_KEY`. |
| `ANALYZER_MODEL` | No | `claude-sonnet-4-6` | Model name for LLM calls (e.g. `claude-opus-4-1`, or your provider's model name). |
| `PORT` | No | `3000` | Port the analyzer listens on. |
| `ANALYZER_MIN_STEPS` | No | `50` | Minimum telemetry steps accrued before triggering an analysis run (excludes manual `/run` requests). |
| `ANALYZER_INTERVAL_HOURS` | No | `6` | Minimum hours between automatic analysis runs. |

## Local development

Each component is independent.

### Agency

```bash
cd agency
npm install
npm run build      # TypeScript → JavaScript
npm run dev        # or: npm start for production build
```

The agency listens on port 3000 and uses SQLite at `./data/agency.db`.

### Analyzer

```bash
cd analyzer
npm install
npm start          # Node ESM; no build step
```

The analyzer listens on port 3000 by default. Set `AGENCY_URL` and `AGENCY_API_KEY` in a `.env` file to point at a running agency.

## Security model

The analyzer is **read-only, least-privilege**. It has no write access to the agency database, no filesystem coupling, and no secrets of its own. It pulls only aggregate telemetry (tool usage counts, token metrics, lessons — no credential values) over an authenticated HTTPS endpoint (`GET /telemetry`, constant-time token comparison). When it detects improvement opportunities, it opens an **advisory GitHub issue** with proposals; applying any change requires the agency admin to review and approve it in the dashboard. Even if the analyzer's deployment is compromised, an attacker gains read access to metrics only. The telemetry endpoint is disabled unless `ANALYZER_API_KEY` is set to a strong value, preventing enumeration.
