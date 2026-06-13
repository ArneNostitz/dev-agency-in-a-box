# Inventory of Model Selection Feature

## Backend Files

1. [src/store.ts](file:///Users/arne/_Coding/dev-agency/src/store.ts)
   - Store settings, providers, role models, and issue overrides.
   - We need to verify/support getting the global default model from settings.
   - Let's make sure we have a function to get/set `global_model` in the database.

2. [src/webhook.ts](file:///Users/arne/_Coding/dev-agency/src/webhook.ts)
   - Route `/data` needs to return `providers`, `roleModels`, and `globalModel`.
   - Route `/models` needs to return `presets` including `Gemini`.
   - Route `/model-override` added to set/clear per-issue model overrides immediately on the backend.
   - Routes `/start`, `/resume`, `/fix`, `/approve`, `/new-issue` need to accept `p.model` (containing `providerId` and `model` name) and set the issue model override BEFORE invoking their respective actions (and clear it if model property is empty).

3. [src/agents/roleAgent.ts](file:///Users/arne/_Coding/dev-agency/src/agents/roleAgent.ts)
   - Route resolution logic: `resolveRoute` needs to fall back to `global_model` if no issue override or role assignment is set, before falling back to session fallback or Claude default.
   - Logs details of every LLM call (model, provider name, and base URL) to the console and appends status updates to the live activity stream.

## Frontend Files

1. [web/app.js](file:///Users/arne/_Coding/dev-agency/web/app.js)
   - Global App state (load providers / models and pass to components).
   - `Composer` component: add a model selector below the role selector. Default to global default model.
   - `Detail` component:
     - Header bar (actions bar): add a model selector next to the actions. Changing it updates the local model selection. Running an action (Start, Resume, Fix, etc.) sends the selected model.
     - Chatbox reply bar: load `modelOpts` immediately (instead of onFocus lazily) or use the passed providers, and display the model selector properly.
   - `Card` component (on the main dashboard):
     - Show a model selector next to the quick action button (e.g. Start, Resume, Fix, Approve) on the card itself so the user can overwrite the model when triggering it from the dashboard.
   - `ModelsModal` / `ModelsPanel` / `Settings`:
     - Add a "Global Default Model" selector to the "Models & API Keys" panel, which allows setting a default model across all roles when no explicit role model is assigned.
