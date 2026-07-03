/**
 * Dealer's-choice dispatch (phase 2). When a new issue is created with the 🎲 "Dealer's choice"
 * option instead of a concrete agent/workflow, the dispatcher asks a small LLM to pick the single
 * best route for the work — a workflow trigger (multi-step) or a single agent/role handle — from the
 * handles that actually exist on this install. The pick is then fed through the SAME deterministic
 * resolution every other start uses (resolveWorkflow / roleForText), so dealer's choice only decides
 * WHICH handle; it never invents a new run path. Deterministic dispatch (an explicit dropdown pick)
 * skips this entirely — no LLM hop.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkflows, listAgentDefs, recordRun } from "../store.js";
import type { Issue } from "../github.js";
import { resolveChatExec, chatBaseEnv } from "./chat.js";
import { runLLM } from "../runners/exec.js";
import type { Provider } from "../db/providers.js";

/** Built-in single-role pins, always available regardless of custom agents. */
const ROLE_PINS: Array<{ handle: string; what: string }> = [
  { handle: "@dev", what: "implement the change and open a PR (just the developer, no plan/review loop)" },
  { handle: "@plan", what: "produce a build plan only — no code" },
  { handle: "@arch", what: "turn a plan into a technical design — no code" },
  { handle: "@review", what: "review an existing PR/branch against the codebase" },
  { handle: "@test", what: "run the project's checks and fix failures" },
  { handle: "@split", what: "decompose a large issue into smaller planned sub-issues" },
];

/** Build the menu of routes the dealer may choose from (workflows first, then agents/roles). */
function choices(): { lines: string[]; valid: Set<string> } {
  const valid = new Set<string>();
  const lines: string[] = [];
  for (const w of listWorkflows()) {
    if (!w.trigger) continue;
    valid.add(w.trigger.toLowerCase());
    const steps = (w.steps || []).map((s) => s.agent).filter(Boolean).join(" → ");
    lines.push(`- WORKFLOW ${w.trigger} — "${w.name}"${steps ? ` (${steps})` : ""}`);
  }
  for (const r of ROLE_PINS) { valid.add(r.handle.toLowerCase()); lines.push(`- AGENT ${r.handle} — ${r.what}`); }
  for (const d of listAgentDefs()) {
    if (d.builtin) continue; // built-ins are already covered by the role pins above
    const h = (d.handle || `@${d.name}`);
    valid.add(h.toLowerCase());
    const persona = (d.persona || "").replace(/\s+/g, " ").trim().slice(0, 120);
    lines.push(`- AGENT ${h} — ${d.name}${persona ? `: ${persona}` : ""}`);
  }
  return { lines, valid };
}

/**
 * Pick the best route handle for an issue, or null if the model can't decide (caller then falls
 * back to its own default). Returns a handle string like "@build" (workflow) or "@dev" (role).
 */
export async function pickDealerDispatch(repo: string, issue: Issue): Promise<string | null> {
  const { lines, valid } = choices();
  if (!lines.length) return null;
  let model = "", provider = null as Provider | null, authKind = "subscription" as "subscription" | "apiKey";
  const workdir = mkdtempSync(join(tmpdir(), "dealer-wd-"));
  const systemPrompt =
    `You are the dispatcher for a coding agency. Read the issue and pick the SINGLE best route to run it ` +
    `from the menu. Prefer a multi-step WORKFLOW for substantial features; pick a single AGENT for small, ` +
    `well-scoped work (a one-file fix → @dev; a question/plan → @plan). Reply with ONLY the chosen handle ` +
    `(e.g. "@build" or "@dev") on one line — no explanation.\n\n## Routes\n${lines.join("\n")}`;
  let text = "";
  let turns = 0;
  try {
    // resolveChatExec throws when no model is configured — dealer is best-effort, so treat that as
    // "can't decide" and let the caller fall back to its default route.
    const resolved = resolveChatExec(process.env.DEALER_MODEL || process.env.ORCHESTRATOR_MODEL || "");
    model = resolved.model; provider = resolved.provider; authKind = resolved.authKind;
    const r = await runLLM(
      {
        task: `### Issue #${issue.number}: ${issue.title}\n\n${(issue.body || "").slice(0, 4000) || "(no description)"}\n\nWhich route? Reply with one handle from the menu.`,
        cwd: workdir,
        model,
        provider,
        authKind,
        allowedTools: [],
        env: chatBaseEnv(),
        systemPrompt,
        abort: new AbortController(),
        maxTurns: 1,
        tokenCap: 0,
      },
      (message) => {
        if ((message as { type?: string }).type === "assistant") {
          const content = (message as { message?: { content?: Array<{ type?: string; text?: string }> } }).message?.content;
          if (Array.isArray(content)) for (const b of content) if (b.type === "text" && b.text?.trim()) text += b.text.trim() + " ";
        }
      },
    );
    turns = r.turns;
  } catch {
    return null; // dealer is best-effort; caller falls back to its default
  } finally {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  if (turns) try { recordRun(repo, issue.number, "orchestrator", model, turns, "dealer", 0); } catch { /* telemetry best-effort */ }
  // Pull the first handle token that's actually on the menu (tolerant of stray prose/quotes).
  for (const tok of text.split(/[\s"'`.,;:!?()]+/)) {
    const h = tok.toLowerCase();
    if (h.startsWith("@") && valid.has(h)) return tok;
  }
  return null;
}
