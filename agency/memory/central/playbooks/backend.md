# Playbook: Backend

The backend is a thin, layered adapter around the logic. HTTP is a delivery mechanism, not
where rules live.

## Layers (dependencies point down)
- **routes / controllers** — parse and validate the request, call a service, shape the
  response. No business rules here. Keep them tiny.
- **services** — the use cases; orchestrate domain logic and repositories. This is shared
  with / mirrors the logic layer ([[logic-separation]]).
- **repositories** — the only place that talks to the database ([[database]]). Expose an
  interface; controllers and services never write SQL/queries directly.

## Rules
- Validate input at the boundary; reuse the same validation rules as the frontend where the
  domain rule is identical (share the domain function).
- Controllers stay dumb: request in, service call, response out.
- Errors are typed and mapped to HTTP at the controller edge, not thrown raw from deep code.
- Reuse before creating: a new endpoint that's "almost like" an existing one usually means
  extend/parameterise the existing service, not copy it.
- Keep it KISS — no framework gymnastics; a clear function beats a clever abstraction.
