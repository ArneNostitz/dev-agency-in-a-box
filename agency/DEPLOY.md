# Deployment

`main` is production. `develop` is staging — build and test there first, then merge to `main` to release.

## Staging (one-time)

Create a second Coolify resource on branch **`develop`** with its **own domain** and its **own** `/app/data` volume, so staging never shares the production database. Optionally set `AGENCY_ENV=development` to show a yellow **DEV** badge.

## Releasing

```
git checkout main && git merge --no-ff develop && git push origin main
```

Then redeploy production and tag the release (e.g. `v1.0.1`).
