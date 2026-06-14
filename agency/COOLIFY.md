# Deploy Dev Agency on Coolify — step by step

Dev Agency runs as one long-lived container that serves a dashboard and works your GitHub issues
24/7. **You don't need to set any environment variables** — it configures itself in the browser
after you deploy.

Follow these in order. The whole thing takes ~10 minutes.

---

## Before you start, you need

1. **A running Coolify instance** and a **(sub)domain** pointing at the server (e.g.
   `agency.yourdomain.com` → an `A` record to the server's IP).
2. **The `dev-agency` repo on GitHub** (this repo). Use the **`main`** branch.
3. **A GitHub bot account + token** — a normal GitHub account the agency acts as (its commits/PRs).
   On that account: Settings → Developer settings → **Fine-grained tokens** → generate one with
   access to your repos and these permissions: *Contents, Issues, Pull requests, Workflows =
   Read & write; Metadata = Read*. You'll paste it in the dashboard later, **not** here.
4. **A way to run the agents — pick ONE:**
   - **Claude subscription** (recommended): install the CLI (`npm i -g @anthropic-ai/claude-code`)
     and run **`claude setup-token`**. It opens a browser, you log in with your Claude plan, and it
     prints a token. Copy that token. *(This is NOT an `sk-ant-…` key — see the 401 fix below.)*
   - **or an API key**: an `sk-ant-…` key from <https://platform.claude.com>.

> ⚠️ **If your friend already tried before:** make sure the Coolify resource is on the **latest
> `main`** and **redeploy** first. Recent versions auto-generate the encryption key and add a
> "Test connection" button that catches the exact 401 problem — older builds don't have these.

---

## 1. Create the resource

In Coolify: **+ New → Resource → Docker Compose**. Source = your `dev-agency` GitHub repo, branch
**`main`**. For a private repo, connect it via Coolify's GitHub App. Coolify auto-detects
`docker-compose.yml`.

## 2. Point the domain at **container port 3000** (this is the #1 cause of errors)

Set your domain on the resource **and make sure Coolify routes it to container port `3000`** — the
app only listens on 3000. If this is wrong you get **`HTTP ERROR 502`**.

In Coolify, set the service's **Ports / "Exposes"** field to `3000`. (If you use Coolify's magic
domain variable instead, name it with the port: `SERVICE_FQDN_AGENCY_3000=https://agency.yourdomain.com`.)

## 3. Keep the data volume

The compose file already mounts a named volume at `/app/data`. **Don't remove it.** It holds the
database *and* the auto-generated encryption key, so your logins and saved tokens survive redeploys.
(If you run a separate staging copy, give it its **own** volume.)

## 4. (Optional) Email + other settings

Nothing is required here. Two optional things you can fill in Coolify's **Environment Variables**:
- **Email password-reset** — set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
  (same SMTP details you'd give Coolify's transactional email). Leave blank to skip.
- `AGENCY_ENV=development` on a staging copy → shows a yellow **DEV** badge.

You do **not** need to set `MASTER_KEY` — it's generated and saved on the volume automatically. (You
*may* set it to a fixed `openssl rand -hex 32` value if you prefer to manage it yourself; just keep
it stable.)

## 5. Deploy

Click **Deploy**. Watch the logs — you want to see it **listening on `:3000`**. The dashboard is
reachable as soon as it boots (it does no GitHub work until you add credentials).

## 6. Finish in the browser

1. Open your domain → **create the admin account** (first-run screen). Add an email if you want
   email-based password resets to work for you.
2. The **onboarding wizard** starts. Pick your model(s), then paste each token with the on-screen
   "where to get it" steps.
3. **On the Claude token step, click "Save & test."** It makes a real call and tells you instantly
   whether the token works — so you don't discover a problem later. ✓ green = you're good.
4. Add your first repo, then open an issue (or **+ New**) and pin **`@dev`**. The agency plans →
   builds → reviews → opens a PR.

---

## Troubleshooting

### ❌ "401 Invalid bearer token" / "Failed to authenticate" (the most common one)

The token the agent sent was rejected. After deploying the latest version, the dashboard shows a
red banner if something's wrong, and the onboarding **"Save & test"** button tells you immediately.
Causes, in order of likelihood:

1. **Wrong token *type* in the wrong field.** The **subscription** option expects the output of
   `claude setup-token` (a long token). The **API key** option expects an `sk-ant-…` key. If you
   paste an `sk-ant-…` key into the *subscription* slot (or vice-versa), you get exactly this 401.
   Re-do onboarding and use the matching option.
2. **A stray space or line break** in the pasted token. Re-copy it cleanly — no leading/trailing
   spaces. (The app trims it, but copy carefully.)
3. **The token is expired or wrong** — run `claude setup-token` again and paste the fresh value, or
   generate a new `sk-ant-…` key.
4. **The encryption key changed** (only if you set `MASTER_KEY` yourself and it isn't stable). The
   red banner will say "can't be decrypted." Fix: keep `MASTER_KEY` fixed (or remove it so the
   auto-generated one is used), then in the container's **Terminal** (Coolify → the resource →
   Terminal) run `node scripts/reset-master-key.mjs`, restart, and re-enter your tokens.

### ❌ HTTP 502 / Bad Gateway

The proxy can't reach the app. Set the service port to **`3000`** (Step 2) and redeploy. The logs
should say it's listening on `:3000`.

### ❌ SSL error / `ERR_SSL_PROTOCOL_ERROR`

The TLS certificate isn't ready yet. Confirm DNS points at the server, wait a minute for Let's
Encrypt, and — if you're behind Cloudflare — use a real origin certificate or set the DNS record to
"DNS only" (grey cloud).

### ❌ Build fails

Make sure you're on the latest `main` and that the server has disk space (`docker system prune -af`
on the host clears old build layers). Then redeploy.

### "GitHub not configured" in the logs

That's normal until you add the bot token in the dashboard. The agency starts the moment you save
one — no redeploy needed.

---

## Updating

Push to `main` and redeploy (or turn on Coolify auto-deploy). Run a separate Coolify app on the
`develop` branch as staging.
