# Handoff 001 — 2026-06-28 — Agency reliability sweep

## State
- Worktree branch: `claude/charming-mcnulty-d23d1d` → **PR #91** (draft): https://github.com/ArneNostitz/dev-agency/pull/91
- All work committed + pushed. Typecheck clean; 234 tests pass (`npm run typecheck`, `npm test`).
- 8 commits `a72f750..4a0cdfa` (see `git log main..HEAD` / PR #91 for full content — do not re-summarize here).

## What shipped (per PR #91 — reference it, don't duplicate)
Resume checkout, model-override precedence, turn-cap rethink + graceful max-turns stop, 60s re-park loop fix, paste preventDefault + `/attach` render, solo-run display, dropdown-collapse fix + SSE coalescing, default-model icon, tokens-only metrics, workflow-pin on new-issue, per-repo base branch (`repoBaseBranch`). One deploy-hook commit was reverted.

## Closed investigations (don't re-open)
- **#3 merge/redeploy**: NOT a code bug. main is unprotected → squash-merge always lands. Only repo webhook is the dev-agency app's own (`devagency.mynu.me/webhook`). Coolify deploys via its **GitHub-App** (account-level). Redeploy gap = Coolify auto-deploy for the resource went off/disconnected after `756797a` (06-26). User fixes in Coolify, not code.

## Pending — next focus: #4 phase-2
Full detail in memory `issue-creation-phase2.md`. Three parts, all decided with the user:
1. **Dealer's-choice** dropdown option → orchestrator (`/orch-chat`, `/orch-handoff`) picks agent/workflow on start; else deterministic dispatch.
2. **Settings default** for what a new issue holds (Composer default is hardcoded `@dev`).
3. **Per-agent model pickers** for workflows (store already exists: `setIssueAgentModel`/`getIssueAgentModels`, endpoint `/issue-agent-model`).

Smaller follow-ups: UI to set the `repo_base.<repo>` override; remove now-unused server-side `estimateCost`.

## Gotchas
- A subagent earlier read the WRONG worktree (line numbers ~130 off; falsely claimed `getIssueWorkflow`/per-agent-models don't exist — they DO). **Verify any subagent file:line claims against real files before editing.**
- Tokens-only is the metric policy (memory `metrics-tokens-only.md`); budgets stay USD.

## Context source
- Project memory auto-loads: `MEMORY.md` + `session-state-2026-06-28.md`, `issue-creation-phase2.md`, `metrics-tokens-only.md` at `/Users/arne/.claude/projects/-Users-arne--Coding-dev-agency/memory/`.
- CLAUDE.md mandates `gitnexus_impact` before editing symbols + `detect_changes` before commit (index was stale this session — pointed at other worktrees; verify freshness).

## Suggested skills for the next session
- `/handoff` — read this doc to resume.
- `/code-review` or `/review` — review PR #91 diff before merge.
- `/verify` — run the app to confirm fixes (dropdown collapse, tokens-only, solo display) behave.
- GitNexus skills (`gitnexus-impact-analysis`, `gitnexus-refactoring`) — for #4 phase-2 edits to `runner.ts`/`pipeline.ts`/`webhook.ts`.
