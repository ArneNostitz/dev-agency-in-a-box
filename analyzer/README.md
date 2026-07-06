# Dev Agency — Process Analyzer (standalone watchdog)

> **Vendored copy.** This directory mirrors [ArneNostitz/dev-agency-analyzer](https://github.com/ArneNostitz/dev-agency-analyzer)
> so the root `docker-compose.yml` can build and run it as a second service alongside the agency —
> one `docker compose up` for dev, storage, and the analyzer. It is still a genuinely separate
> **process** (own container, no shared volume, talks to the agency only over HTTP) — just no longer
> a separate **repo** to redeploy independently. That trades away the "analyzer survives even when
> an agency deploy breaks" guarantee the standalone repo was built for (see below): a broken build of
> this compose stack takes both services down together. If you want that isolation back, deploy
> `dev-agency-analyzer` as its own Coolify resource instead and drop this directory + the `analyzer`
> service in `docker-compose.yml`.
>
> Keep this copy in sync with the source repo by hand (or treat the source repo as legacy and edit
> only here — your call). They will drift if edited independently in both places.

A small, independent service that watches the Dev Agency and proposes self-improvements. It is
deliberately separate from the agency codebase so it stays stable and keeps running even when an
agency deploy breaks — which is exactly when you need it to report the breakage.

## What it does

- Pulls **aggregate telemetry** from the agency over an **authenticated, read-only HTTP endpoint**
  (`GET {AGENCY_URL}/telemetry`, `Authorization: Bearer {AGENCY_API_KEY}`). No shared DB, no shared
  volume, no filesystem coupling.
- When enough new telemetry has accrued, runs one LLM pass over a digest and opens an **advisory**
  GitHub issue (titled from that pass's own biggest finding, not a generic string — every issue is
  distinct in the list) with detailed skill / hook / deterministic-code proposals. It carries no DB
  status and no GitHub label — it surfaces in the agency's Inbox like any other untriaged issue, and
  the dashboard flags it as an Analyzer proposal in its own filter. It **never** writes to the agency
  and **never** auto-merges.
- **Verifies the agency deployment** is up (`GET {AGENCY_URL}/web/version.json`) and reports it on
  its health endpoint.
- Supports a **manual trigger**: `POST /run` (`Authorization: Bearer {AGENCY_API_KEY}`) forces a pass
  immediately, bypassing the min-steps gate. The agency dashboard's "Run now" button calls this
  (proxied through the agency so the key never leaves the server). Returns `202` if started, `409` if a
  pass is already running.

## Security (least privilege)

The only thing this service can do to the agency is **read aggregate metrics** (counts, tool usage,
tokens-by-role, recent lessons — no secrets, no issue bodies). It has **no write path**: applying any
proposed change (agents / skills / hooks) happens through the agency's own admin-authenticated UI
after **you** approve it. Compromising the analyzer yields read-only metrics and nothing else. The
telemetry endpoint is off unless a strong `ANALYZER_API_KEY` is set, and uses a constant-time token
compare.

## What it is NOT

No frontend, no webhook server, no pipeline, no DB access, no access to the agency's secrets.

## Deploy — vendored (this repo's docker-compose)

The root `docker-compose.yml`'s `analyzer` service builds from this directory and talks to the
`agency` service over the compose network (`AGENCY_URL=http://agency:3000` — no public URL or TLS
needed for that hop). Set `ANALYZER_API_KEY` once in your `.env`; both services read the same value
(the agency as `ANALYZER_API_KEY`, matching its own `ANALYZER_API_KEY` setting; the analyzer as
`AGENCY_API_KEY`). One LLM credential (see the table below) and you're done.

## Deploy — standalone (its own repo, independent lifecycle)

Create a resource pointing at THIS repo (its own repo → independent deploy lifecycle). It needs **no
shared volume** — it talks to the agency over HTTPS.

Required env (just three things):

| var | meaning |
|---|---|
| `AGENCY_URL` | the agency's base URL, e.g. `https://devagency.example.com` |
| `AGENCY_API_KEY` | shared secret matching the agency's `ANALYZER_API_KEY` (≥16 chars; `openssl rand -hex 32`) |
| LLM credential | one of `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or `ANTHROPIC_BASE_URL`+`ANTHROPIC_AUTH_TOKEN` (GLM etc.) |

Optional: `ANALYZER_MODEL` (default `claude-sonnet-4-6`), `PORT` (default 3000).

The **run thresholds** come from the agency (`/telemetry` config), and the agency opens the issue on
the analyzer's behalf, choosing the repo itself — so there's **no GitHub token or repo to configure
here**. On the **agency** side, just set `ANALYZER_API_KEY` to the same secret (and `ANALYZER_REPO`
in Settings if you want proposals somewhere other than the agency's own repo — its default target).

Optional: `ANALYZER_MODEL` (default `claude-sonnet-4-6`), `ANALYZER_MIN_STEPS` (default 50),
`ANALYZER_INTERVAL_HOURS` (default 6), `PORT` (default 3000).

Because it's its own repo, pushing to the agency never redeploys it — update it only by pushing
here, deliberately.
