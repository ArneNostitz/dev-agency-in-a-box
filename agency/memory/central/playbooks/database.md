# Playbook: Database

The database is infrastructure. Only the repository layer touches it; everything else works
through repository interfaces so storage can change without rippling through the app.

## Rules
- **Repository pattern.** Each aggregate/table has a repository exposing intent-revealing
  methods (`findUserByEmail`, `saveOrder`) — not raw queries leaking outward.
- **Migrations, always.** Schema changes are versioned migration files, never manual edits.
  One migration per change, reversible where practical.
- **Schema is explicit and typed.** Use the project's schema/ORM definitions as the single
  source of truth; generate types from it rather than hand-duplicating shapes.
- **No business logic in the DB layer** beyond what the store genuinely owns (constraints,
  uniqueness). Rules live in domain/services ([[logic-separation]]).
- **Reuse queries** via repository methods; don't scatter near-identical queries across the
  codebase.
- Keep it simple: model what the app needs now, not a hypothetical future schema.
