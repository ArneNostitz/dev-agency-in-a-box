# Playbook: Engineering principles (the harness)

These are the non-negotiable principles every agent applies to every change, in every
repo. They exist so the codebase stays small, consistent, and reusable as it grows.
When a principle and a quick hack conflict, the principle wins.

## 1. KISS — keep it simple
Prefer the simplest design that fully solves the issue. No speculative abstraction, no
"might need it later". The best change is small, obvious, and easy to delete. If a
solution feels clever, it's probably wrong — make it boring.

## 2. Reuse before you create
**Always check what already exists before writing anything new.** In order:
1. The project's own code (search components, services, utilities).
2. The shared/global library and the project template (see [[reuse-first]]).
3. A well-established dependency already in the project.
Only create something new when none of the above fit, and when you do, put it where it
can be reused next time. Duplicated logic or a re-implemented component is a defect.

## 3. Separation of concerns — three worlds
Code lives in one of three worlds, and they never bleed into each other:
- **UI** — presentation only. It renders props and emits events. No business logic, no
  data fetching, no formatting rules beyond display. See [[frontend-atomic-design]].
- **Logic / domain** — the rules, calculations, validation, orchestration. Pure and
  framework-agnostic where possible. Knows nothing about React or HTTP. See [[logic-separation]].
- **Infrastructure** — HTTP handlers, database, external services. Thin adapters around
  the logic. See [[backend]] and [[database]].
Dependencies point inward: UI → logic, infrastructure → logic. Logic depends on nothing.

## 4. Composition and reuse everywhere
Build things that are configured, not copy-pasted. A consumer should describe *what* they
want and let a reusable component/function assemble it. This applies to UI **and** logic
**and** data access. The litmus test: if you'd write the same shape twice, make it a
parameterised reusable instead. See the Form example in [[frontend-atomic-design]].

## 5. Theme-driven, not hard-coded
Visual values (color, spacing, type, radius, shadow) come from the central theme — never
literal values sprinkled in components, never inline styles, never ad-hoc utility classes
when a theme token or atomic component already expresses it. Changing the theme must be
able to restyle the whole app without touching component structure. See [[theming]].

## 6. Make it testable, then test it
Pure logic is unit-tested. UI is tested at the component level via its props. A change
isn't done until the build, types, lint, and tests are green. See [[how-to-write-tests]].

## 7. Leave it cleaner
Match existing conventions. Don't reformat unrelated code. Keep each change atomic and
focused on its one issue. Small PRs.

> If you're ever unsure whether something already exists or where a piece of code belongs,
> stop and check the project memory and template rather than guessing.
