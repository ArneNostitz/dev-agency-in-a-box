# Deploy on Coolify

Dev Agency runs as one container. You set **no environment variables** — everything is configured in the browser after deploy.

1. **New resource.** Coolify → **+ New → Resource → Docker Compose**. Source = this repo, branch **`main`**. Coolify auto-detects `docker-compose.yml`.
2. **Route the domain to port 3000.** Set your domain on the resource and point it at container port **`3000`** — the app only listens on 3000.
3. **Keep the data volume.** Leave the named volume mounted at `/app/data`. It holds the database and the auto-generated encryption key, so logins and saved tokens survive redeploys. (A separate staging copy needs its own volume.)
4. **Deploy.** Click **Deploy** and wait for the logs to show `listening on :3000`.
5. **Create the admin account.** Open your domain → the first-run screen creates your admin login.
6. **Onboarding.** Pick your model and paste your token — a Claude subscription token from `claude setup-token`, or an `sk-ant-…` API key — then click **Save & test**.
7. **Add a repo** and open an issue pinning **`@dev`**. The agency plans → builds → reviews → opens a PR.

**Updating:** push to `main` and redeploy (or enable Coolify auto-deploy).
