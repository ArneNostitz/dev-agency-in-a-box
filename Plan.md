# Implementation Plan for Model Selector

## Phase 1: Database & Backend Logic
1. Verify `global_model` storage in settings table.
2. Update `resolveRoute` in [src/agents/roleAgent.ts](file:///Users/arne/_Coding/dev-agency/src/agents/roleAgent.ts) to retrieve `global_model` and apply it if no issue or role-specific override exists.
3. Update [src/webhook.ts](file:///Users/arne/_Coding/dev-agency/src/webhook.ts) GET `/models` to return the `Gemini` preset.
4. Update [src/webhook.ts](file:///Users/arne/_Coding/dev-agency/src/webhook.ts) GET `/data` to return:
   - `providers`: list of configured providers
   - `roleModels`: role model assignments
   - `globalModel`: global default model (`global_model` settings value)
5. Update POST `/models` to save `globalModel` if provided in request body.
6. Update POST `/start`, `/resume`, `/fix`, `/approve`, `/new-issue` in [src/webhook.ts](file:///Users/arne/_Coding/dev-agency/src/webhook.ts) to check for `p.model` and record it using `setIssueModelOverride` before starting the process.

## Phase 2: Frontend Settings (Global Default Model)
1. In `ModelsPanel` / `ModelsModal` in [web/app.js](file:///Users/arne/_Coding/dev-agency/web/app.js):
   - Add a dropdown for "Global Default Model".
   - When submitting, send the selected global default model to the `/models` POST endpoint as `globalModel`.

## Phase 3: New Issue Dialog Model Selector
1. In `Composer` in [web/app.js](file:///Users/arne/_Coding/dev-agency/web/app.js):
   - Retrieve all available models from `data.providers`.
   - Add a `<select>` dropdown for selecting a model override.
   - Default it to the global default model.
   - When creating the issue, pass the selected model in the payload `p.model` to `/new-issue`.

## Phase 4: Issue Detail Page Model Selectors
1. Header / Action Toolbar:
   - Add a model selector dropdown next to the action buttons (Start, Resume, Fix, Approve).
   - Change local state `modelOverride` when a model is selected.
   - When triggering an action (e.g. `act.start(repo, number, selectedModel)`), pass the selected model override.
2. Chatbox composer:
   - Make the model options load immediately (instead of lazy-loading `onFocus`).

## Phase 5: Dashboard Card Model Selectors
1. In `Card` component:
   - Next to the quick action buttons (Start, Resume, Fix, Approve), render a model selector dropdown.
   - Change local card state for the selected model override.
   - When clicking the action button, pass the selected model to the action function.

## Phase 6: Verification & Polish
1. Run `npm run typecheck` to verify code correctness.
2. Confirm the UI matches premium styling.
