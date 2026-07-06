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
- When enough new telemetry has accrued, assembles a digest and asks the agency to run the actual
  analysis pass (`POST {AGENCY_URL}/analyzer-analyze`, same Bearer key) — the agency runs the LLM call
  in-process using whatever provider/model is assigned to its "Analyzer" role in Settings → Models,
  and returns plain text. This service holds **no LLM credential of its own**. It parses the result
  and opens an **advisory** GitHub issue (titled from that pass's own biggest finding, not a generic
  string — every issue is distinct in the list) with detailed skill / hook / deterministic-code
  proposals. It carries no DB status and no GitHub label — it surfaces in the agency's Inbox like any
  other untriaged issue, and the dashboard flags it as an Analyzer proposal in its own filter. It
  **never** writes to the agency and **never** auto-merges.
- **Verifies the agency deployment** is up (`GET {AGENCY_URL}/web/version.json`) and reports it on
  its health endpoint.
- Supports a **manual trigger**: `POST /run` (`Authorization: Bearer {AGENCY_API_KEY}`) forces a pass
  immediately, bypassing the min-steps gate. The agency dashboard's "Run now" button calls this
  (proxied through the agency so the key never leaves the server). Returns `202` if started, `409` if a
  pass is already running.

## Security (least privilege)

This service can: **read aggregate metrics** (counts, tool usage, tokens-by-role, recent lessons — no
secrets, no issue bodies), and ask the agency to run **one fixed, server-authored analysis prompt**
over that digest (no arbitrary prompt injection beyond assembling the digest itself). It has **no
write path**: applying any proposed change (agents / skills / hooks) happens through the agency's own
admin-authenticated UI after **you** approve it. Compromising the analyzer yields read-only metrics
and one report-writing call, nothing more. Both endpoints are off unless a strong `ANALYZER_API_KEY`
is set, and use a constant-time token compare.

## What it is NOT

No frontend, no webhook server, no pipeline, no DB access, no access to the agency's secrets.

## Deploy — vendored (this repo's docker-compose)

The root `docker-compose.yml`'s `analyzer` service builds from this directory and talks to the
`agency` service over the compose network (`AGENCY_URL=http://agency:3000` — no public URL or TLS
needed for that hop). `ANALYZER_API_KEY` ships prefilled in the compose file (a real generated
default — see the comment there); both services read the same value (the agency as
`ANALYZER_API_KEY`; the analyzer as `AGENCY_API_KEY`). **Before it can produce reports**, assign a
model to the "Analyzer" role in the agency's Settings → Models — that's the only setup step left.

## Deploy — standalone (its own repo, independent lifecycle)

Create a resource pointing at THIS repo (its own repo → independent deploy lifecycle). It needs **no
shared volume** — it talks to the agency over HTTPS.

Required env:

| var | meaning |
|---|---|
| `AGENCY_URL` | the agency's base URL, e.g. `https://devagency.example.com` |
| `AGENCY_API_KEY` | shared secret matching the agency's `ANALYZER_API_KEY` (≥16 chars; `openssl rand -hex 32`) |

Optional: `PORT` (default 3000).

No LLM credential is configured here — the actual analysis pass runs INSIDE the agency (`POST
/analyzer-analyze`), using whatever model is assigned to its "Analyzer" role in Settings → Models. This
works identically whether the analyzer is standalone (over HTTPS) or vendored (over the internal
compose network) — assign that role a model once, on the agency side, and every deployment mode of
this service picks it up.

The **run thresholds** come from the agency (`/telemetry` config), and the agency opens the issue on
the analyzer's behalf, choosing the repo itself — so there's **no GitHub token or repo to configure
here**. On the **agency** side, just set `ANALYZER_API_KEY` to the same secret (and `ANALYZER_REPO`
in Settings if you want proposals somewhere other than the agency's own repo — its default target).

Optional: `PORT` (default 3000). The run-frequency thresholds (`analyzer_min_steps`, default 15;
`analyzer_interval_hours`, default 1) are agency-side dashboard settings, not env vars here — the
analyzer just reads them back from `/telemetry`'s `config` field each pass.

Because it's its own repo, pushing to the agency never redeploys it — update it only by pushing
here, deliberately.
