# Playbook: Theming

One central theme is the single source of truth for every visual value. Components read
from it; they never hard-code colors, spacing, type, radius, shadows, or breakpoints.

## The theme tokens
Define and consume these token groups (names are examples; follow the project's):
- **color** — semantic, not literal: `color.bg`, `color.surface`, `color.text`,
  `color.primary`, `color.danger`. Never `#3b82f6` in a component.
- **space** — a scale: `space.xs … space.2xl`. All padding/margins/gaps come from here.
- **font** — `font.family`, `font.size.*`, `font.weight.*`, `font.lineHeight.*`.
- **radius**, **shadow**, **breakpoint**, **zIndex**.

## How components consume the theme
- Atoms map props to theme tokens (e.g. `<Button variant="primary" size="md">` resolves to
  `color.primary` + `space.md`). Consumers pick semantic variants, not raw values.
- Implement tokens as CSS variables (or the project's theming system) so a theme switch is
  a single change with no component edits. Light/dark or rebrands swap the token values only.

## Rules
- Changing the look of the whole app = editing the theme, never the components.
- No literal visual values and no inline styles in components (see [[frontend-atomic-design]]).
- New visual need? Add a **token** to the theme, then use it — don't inline it.
- Keep variants semantic (`primary`, `danger`, `subtle`) so meaning survives a restyle.
