# Playbook: Frontend — atomic design

UI is **only** UI. A component receives data through props and reports interactions
through callbacks. It contains no business logic, no data fetching, no domain rules.
If you find logic in a component, it belongs in the logic layer ([[logic-separation]]).

## The layers (build up, never skip down)

- **Atoms** — the smallest building blocks: `Button`, `Input`, `Text`, `Icon`, `Label`.
  They consume theme tokens and nothing else. No app knowledge.
- **Molecules** — small combinations of atoms with a single purpose: `Field`
  (label + input + error), `SearchBox`, `MenuItem`.
- **Organisms** — self-contained, configurable sections: `Form`, `DataTable`, `NavBar`,
  `Card`. Driven by configuration, not hand-assembled children.
- **Templates** — page layouts that arrange organisms with no real data.
- **Pages** — a template wired to real data/logic via the logic layer.

A component only ever composes things from its own layer or below.

## Configurable organisms — the core rule

Do **not** hand-assemble repetitive UI. Describe it with data and let a reusable organism
build it. This is the single most important frontend rule.

Wrong:
```tsx
<form>
  <input name="email" />
  <input name="password" type="password" />
  <button>Save</button>
</form>
```

Right:
```tsx
<Form
  fields={[
    { name: "email", label: "Email", type: "email", required: true },
    { name: "password", label: "Password", type: "password", required: true },
  ]}
  submitLabel="Save"
  onSubmit={handleSave}
/>
```

The `Form` organism builds the fields, labels, validation wiring, and layout from the
`fields` config, using `Field` molecules and `Input`/`Button` atoms underneath. The same
idea applies to tables (`<DataTable columns={...} rows={...} />`), navigation
(`<NavBar items={...} />`), lists, modals, and so on. If you catch yourself repeating
elements, lift them into a config-driven organism.

## Styling rules

- Style through the **theme** and through atomic components. No inline `style={{...}}`.
- No ad-hoc utility/Tailwind classes for something a theme token or atom already provides
  (spacing, color, typography, radius). Utilities are a last resort for true one-offs, and
  even then prefer extending the theme.
- A component must restyle correctly when the theme changes, with no structural edits.

## Where logic goes instead

Validation rules, submit handling, data shaping, and fetching live in the logic layer and
are passed into the organism as callbacks/props (`onSubmit`, `validate`, `data`). The
organism stays dumb. See [[logic-separation]].
