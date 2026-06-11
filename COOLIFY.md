# Deploy the Dev Agency on Coolify

The agency runs as one long-lived container that serves the dashboard and works your GitHub
issues 24/7. On Coolify you only set **one** environment variable; everything else (your tokens,
models, repos, settings) is configured in the dashboard after first login.

## You need
- A running Coolify instance and a (sub)domain pointing at it.
- This repo on GitHub.
- A way to run the agents: a Claude subscription token (`claude setup-token`) or a Claude/other
  API key. You enter these in the dashboard later — not here.

## 1. Create the resource
**+ New → Resource → Docker Compose**, source = your `dev-agency` repo (branch `main`).
Coolify auto-detects `docker-compose.yml`. For a private repo, connect via Coolify's GitHub App.

## 2. Set the domain and **port 3000** (important)
Give the resource your domain, and make sure Coolify routes it to **container port 3000** — the
app listens there. If the port is wrong you'll get an `HTTP ERROR 502`. In Coolify this is the
service's **Ports / "Exposes"** field (set it to `3000`), or, if you use the magic domain var, name
it with the port: `SERVICE_FQDN_AGENCY_3000=your.domain`.

## 3. Set the one env var + a persistent volume
- **`MASTER_KEY`** — generate with `openssl rand -hex 32`. This encrypts every stored secret and
  turns on the multi-user login. **Keep it stable** — if it changes, stored tokens can't be
  decrypted. (Leave it unset only if you want the old single-user Basic-Auth mode.)
- Optional: `AGENCY_ENV=development` on a staging copy to show a yellow **DEV** badge.
- The compose file already mounts a named volume at `/app/data` for the SQLite database — keep it,
  so your data survives redeploys. Give staging its **own** volume.

That's it for env. The four execution-token vars in the compose file are optional fallbacks — you
normally set tokens in the dashboard instead and can leave them blank.

## 4. Deploy, then finish in the browser
1. Deploy. The container boots and the dashboard is reachable immediately (it does no GitHub work
   until you add credentials).
2. Open your domain → **create the admin account** (first-run screen).
3. The **onboarding wizard** walks you through it: pick your models, paste each token (with
   step-by-step "where to get it" instructions), and add your first repo.
4. Open an issue (or **+ New**) and the agency plans → builds → reviews → opens a PR.

## Updating / releasing
Push to `main` and redeploy (or enable Coolify auto-deploy). Use a separate Coolify app on the
`develop` branch as staging — see `DEPLOY.md`.

## Troubleshooting
- **HTTP 502** — the proxy can't reach the app. Set the service port to **3000** (step 2). Check
  the app logs say `listening on :3000`.
- **SSL / `ERR_SSL_PROTOCOL_ERROR`** — the TLS cert isn't ready. Confirm DNS points at the server,
  wait a minute for Let's Encrypt, and (if behind Cloudflare) use a real origin cert or grey-cloud
  the record.
- **"GitHub not configured" in logs** — expected until you add a bot token in the dashboard; the
  agency starts the moment you save one (no redeploy).
- **Models / agents advanced editor** — the new dashboard links to `/classic` for the full
  provider/agent editors.
