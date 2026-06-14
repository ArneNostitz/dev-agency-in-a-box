# Playbook: How to write tests

A change is not done until it's verified. Tests prove the change works and keep it working.

## What to test
- **Domain/logic** — unit tests for every non-trivial pure function (rules, calculations,
  validation, data shaping). These are fast and cover most of the risk.
- **Services** — test orchestration with repositories faked/in-memory.
- **UI** — component tests driven by props: given props/config, it renders and emits the
  right events. Test the reusable organism (e.g. `Form` builds fields from config and calls
  `onSubmit` with the values), not one-off markup.
- **Critical paths** — a thin layer of integration/e2e for the happy path of key flows.

## Rules
- Prefer many small, fast unit tests over few slow heavy ones.
- Test behavior and contracts, not implementation details.
- A bug fix starts with a failing test that reproduces it.
- Use the project's existing test runner and conventions; don't introduce a new framework
  without reason ([[reuse-first]]).
- The full check — typecheck + lint + tests + build — must pass before marking work ready.
  We run it ourselves in-container (the Tester), so it does NOT depend on GitHub Actions —
  agency commits carry `[skip ci]` to save Actions minutes. Run the project's documented
  check/test scripts directly.
