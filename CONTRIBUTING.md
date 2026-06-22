# Contributing

- **Extending the agency** (add a role / runner / skill / hook / workflow / provider / MCP server): see [`docs/extending.md`](docs/extending.md).
- **Architecture decisions**: [`docs/adr/`](docs/adr/).
- **Glossary / ubiquitous language**: [`CONTEXT.md`](CONTEXT.md).
- **Tests**: `npm test` (builds, then runs `node --test test/*.test.mjs`). Keep them green.
- **Data model**: DB-first — GitHub is a mirror. New persisted state goes through `src/db/*` (the single engine seam is `getDb()`, see ADR-0002).
