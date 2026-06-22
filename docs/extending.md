# Extending the agency

A cookbook for the common extension points. The agency is **DB-first**: skills, hooks, workflows,
and chat agents are data (rows you add via the dashboard or a seeder) and need **no code change**.
A few seams (roles, runners, MCP servers, providers) are code — each is a small, localized edit.

## Add a skill / hook / workflow / chat agent — no code
These are DB rows with idempotent seeders + full CRUD; add them from the dashboard (Workflows /
Agents views) or extend a seeder:
- **Skills** — `src/db/skills_hooks.ts` (`seedLibrary`, `upsertSkill`). Authored prompt snippets injected into an agent's context via `skillsPrompt()`. `/skill-import` clones a repo and ingests its `**/SKILL.md`.
- **Hooks** — same file (`upsertHook`); deterministic pre/post shell steps per agent or per workflow.
- **Workflows** — `src/db/workflows.ts` (`seedWorkflows`, `upsertWorkflow`): ordered steps + gates + hooks, triggered by a handle. Built-ins: `@build`/`@quickfix`/`@planonly`/`@reviewonly`.
- **Chat agents** — `src/db/agent_def.ts` (`seedChatAgents`, `upsertAgentDef`): interactive, non-repo agents (persona/model/tools/skills).

## Add a pipeline role — code (one main file)
Roles drive the build pipeline. They are still code (vs DB chat agents — see ADR/`dev-agency-arc`):
1. `src/agents/roles.ts` — add the name to the `RoleName` union and a `ROLES` entry (`personaFile`, `playbooks`, `defaultModel`, `modelEnv`, `tools`, `maxTurns`).
2. Add the persona file `memory/central/agents/<personaFile>.md`.
3. Map its handle: `STEP_ROLE` in `src/pipeline.ts` and `HANDLE_ROLE`/`LEAD_ROLE` in `src/workflow.ts`.
   `isRole()` already derives from `ROLES`, so `config/team.txt` handles resolve automatically.
(These handle maps are duplicated today; single-sourcing them via a `handle` field on `RoleDef` is a
known cleanup.)

## Add a runner (agent backend) — one registry entry
`src/runners/` has a clean `AgentRunner` interface. To add one:
1. Implement `AgentRunner` (see `sdk-claude.ts` / `cli.ts`).
2. Add its kind to `RunnerKind` in `src/runners/interface.ts`.
3. Add one entry to the `RUNNERS` table in `src/runners/registry.ts`. `getRunner`/`defaultRunnerKind` derive from it — no switch to touch.

## Add an in-process MCP server — copy the wiring pattern
`src/agents/recall.ts` is the template: a `*Wiring(repo)` function returning `{ servers, tools }`
built with `createSdkMcpServer`/`tool`. Wire it into `runRole` (`src/agents/roleAgent.ts`) alongside
`recall`/`gitnexus`: add to the `mcpServers` spread, the `allowedTools` list, and (optionally) append
a prompt note. `gitnexus.ts` shows a subprocess (stdio) MCP server instead of in-process.

## Add a model provider — data + one preset
Providers are DB rows (`src/db/providers.ts`); add them in Settings → Models. The preset list lives
in `web/models.json`. Any Anthropic-compatible endpoint works (base URL + key); per-role routing and
a global default are in the same module.

## Config / env
Runtime knobs prefer the DB (`sStr/sNum/sBool` in `src/settings.ts`) with an env fallback. Add new
operator-facing settings to `OPS_SETTINGS` so they appear in the dashboard automatically. The app
boots with **zero required env** (auto-generates + persists `MASTER_KEY`).

See also: `docs/adr/` (decisions), `CONTEXT.md` (glossary).
