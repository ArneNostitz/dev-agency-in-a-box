# Dev Agency — Process Analyzer (standalone watchdog)

A small, independent service that watches the Dev Agency and proposes self-improvements. It is
deliberately separate from the agency codebase so it stays stable and keeps running even when an
agency deploy breaks — which is exactly when you need it to report the breakage.

## What it does

- Pulls **aggregate telemetry** from the agency over an **authenticated, read-only HTTP endpoint**
  (`GET {AGENCY_URL}/telemetry`, `Authorization: Bearer {AGENCY_API_KEY}`). No shared DB, no shared
  volume, no filesystem coupling.
- When enough new telemetry has accrued, runs one LLM pass over a digest and opens an **advisory**
  GitHub issue with detailed skill / hook / deterministic-code proposals (labeled `agency:analyzer` +
  `agency:ignore`). It **never** writes to the agency and **never** auto-merges.
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

## Deploy (Coolify)

Create a resource pointing at THIS repo (its own repo → independent deploy lifecycle). It needs **no
shared volume** — it talks to the agency over HTTPS.

Required env (just three things):

| var | meaning |
|---|---|
| `AGENCY_URL` | the agency's base URL, e.g. `https://devagency.example.com` |
| `AGENCY_API_KEY` | shared secret matching the agency's `ANALYZER_API_KEY` (≥16 chars; `openssl rand -hex 32`) |
| LLM credential | one of `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or `ANTHROPIC_BASE_URL`+`ANTHROPIC_AUTH_TOKEN` (GLM etc.) |

Optional: `ANALYZER_MODEL` (default `claude-sonnet-4-6`), `PORT` (default 3000).

The **repo to post to** and the **run thresholds** come from the agency (`/telemetry` config), and the
agency opens the issue on the analyzer's behalf — so there's **no GitHub token or repo to configure
here**. On the **agency** side, just set `ANALYZER_API_KEY` to the same secret (and `ANALYZER_REPO`
in Settings if you want proposals in a specific repo; otherwise it uses the first watched repo).

Optional: `ANALYZER_MODEL` (default `claude-sonnet-4-6`), `ANALYZER_MIN_STEPS` (default 50),
`ANALYZER_INTERVAL_HOURS` (default 6), `PORT` (default 3000).

Because it's its own repo, pushing to the agency never redeploys it — update it only by pushing
here, deliberately.
