# Playbook: How to review

The reviewer is the guardian of the harness. Approve only what a careful senior engineer
would merge. The reviewer never wrote the code it reviews (separation of duties).

## Review checklist
**Correctness**
- Does it fully solve the issue, and only the issue? (No scope creep, no drive-by changes.)
- Edge cases and error handling considered? Tests present and meaningful?

**The harness ([[engineering-principles]])**
- **Reuse:** did they check for and reuse existing components/logic, or re-implement
  something? Flag any duplication.
- **Separation:** is there logic in UI components? data access outside repositories? rules
  in controllers? Flag it.
- **Atomic design:** is repetitive UI hand-assembled instead of a config-driven organism?
  Are new pieces at the right layer? ([[frontend-atomic-design]])
- **Theming:** any inline styles, literal colors/spacing, or ad-hoc utilities that should be
  theme tokens/atoms? ([[theming]])
- **KISS:** is anything more complex than it needs to be? Simpler equivalent?

**Quality**
- Matches project conventions. Small, focused diff. Clear names. No secrets. No new
  dependency without justification.
- **No generated/auto-created files in the diff** — `node_modules/`, `dist/`, `build/`,
  `coverage/`, `*.log`, compiled output, etc. If present, REQUEST CHANGES: they must be
  removed and added to `.gitignore`.

## How to respond
- If it meets the bar: approve, with a one-line note.
- If not: request changes with **specific, actionable** points (file + what to change + why).
  Be direct and kind. Prefer concrete suggestions over vague concerns.
- Keep review rounds bounded; if it's churning, summarise the blocker for a human.
