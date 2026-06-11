# Deployment — dev / production split

`main` is **production**. `develop` is the **dev/staging** branch where risky work (multi-user
auth, encryption, settings migration) lands first. Nothing reaches production until it's merged
from `develop` into `main`.

## Branches
- `main` → production deploy (https://devagency.mynu.me)
- `develop` → staging deploy (your own subdomain, e.g. https://dev.devagency.mynu.me)

Day-to-day: build on `develop`, deploy + test the staging app, then `git merge develop` into
`main` (or open a PR) to release.

## Set up the staging app in Coolify (one-time)
1. New Resource → same Git repo → **branch: `develop`**.
2. Give it its **own domain** (a subdomain) and its **own named volume** for `/app/data`
   (e.g. `agency-data-dev`) so staging never shares the production database.
3. Set env var **`APP_ENV=development`** — the dashboard then shows a yellow **DEV** badge so the
   two installs are never confused.
4. Use **separate secrets** for staging (its own bot token / webhook secret / data) so an
   experiment can't touch production repos. Point its GitHub webhook (if any) at the staging URL.

## Environment indicator
`APP_ENV` (default `production`) is surfaced in `/data` and rendered as a badge in the top bar.
It has no other behavioural effect, so it's safe to leave unset in production.

## Releasing
```
git checkout main && git merge --no-ff develop && git push origin main
```
Then redeploy the production app. Tag releases on `main` (e.g. `v1.2.0`).
