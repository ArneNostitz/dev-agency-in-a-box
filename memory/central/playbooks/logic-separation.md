# Playbook: Logic separation

Logic lives in its own world, independent of UI and of how data arrives. It is the part of
the app you could run without a browser or an HTTP server.

## What counts as logic
Validation, calculations, business rules, state transitions, data shaping/formatting,
orchestration of services. None of this belongs in a component or an HTTP handler.

## How to structure it
- **domain/** — pure functions and types: the rules. No I/O, no framework imports. Easy to
  unit test. Example: `validateSignup(input): Result`, `computeTotal(cart): Money`.
- **services/** — use-case orchestration that may call repositories/external APIs. Depends
  on domain + repository interfaces, not on concrete infrastructure.
- **hooks/ or adapters/** (frontend) — thin glue exposing services/state to UI
  (e.g. a `useSignupForm()` that wires a service to a `Form` organism's `onSubmit`).

## Rules
- UI imports logic; logic never imports UI. Infrastructure imports logic; logic never
  imports infrastructure (depend on interfaces instead).
- Keep domain functions **pure** where possible — same input, same output, no side effects.
  Side effects live at the edges (services/adapters).
- Reuse logic across UI and backend when the rule is the same (e.g. validation shared by a
  form and an API endpoint). Don't re-implement a rule in two places.
- Every non-trivial domain function gets a unit test ([[how-to-write-tests]]).
