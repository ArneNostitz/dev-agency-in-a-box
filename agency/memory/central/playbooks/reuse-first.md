# Playbook: Reuse first (check before you create)

Re-implementing something that already exists is treated as a defect. Before writing a new
component, function, endpoint, or table, **search** — in this order — and prefer extending
what you find.

## The search order
1. **This project.** Grep the codebase for the concept (component name, function, route,
   table). Check the project's UI library, services, and utilities.
2. **The shared/global library & the project template.** Cross-project reusables and the
   canonical atomic-design structure live there. If the template has a `Form`, `DataTable`,
   a validation helper, or a repository base — use it, don't rebuild it.
3. **Existing dependencies.** If a library already in the project does it well, use that.

## When you do create something
- Put it at the lowest layer where it's reusable (an atom/molecule/organism, a domain
  function, a repository method) — not buried inside a page or controller.
- Name it for what it is, generically, so the next person finds it in step 1.
- If it's reusable beyond this project, note it for promotion into the shared library.

## How to decide extend vs. create
- Same intent, slightly different shape → **parameterise/extend** the existing thing.
- Genuinely new concept → create it, at the right layer, configured for reuse.

> Record notable reusables and decisions in the project memory so future tasks find them.
