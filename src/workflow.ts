/**
 * Workflow resolution (Phase 1b). GitHub inbound still needs an @trigger; the dashboard sends the
 * selected handle as that trigger (see /new-issue). A workflow's trigger resolves to its LEAD role,
 * which drives the existing, proven run flow — the seeded templates' gates already live in the
 * pipeline. The generic step-by-step engine (forcing per-step skills/hooks + custom gates) lands
 * with the Phase-2 builder, once users can create custom workflows that need it.
 */
import { listWorkflows, type Workflow } from "./store.js";
import type { RoleName } from "./agents/roles.js";

const LEAD_ROLE: Record<string, RoleName> = { "full-build": "planner", "quick-fix": "developer", "plan-only": "planner", "review-only": "reviewer" };
const HANDLE_ROLE: Record<string, RoleName> = { "@dev": "developer", "@plan": "planner", "@split": "decomposer", "@arch": "architect", "@review": "reviewer", "@test": "tester" };
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The role that leads a workflow's run (v1: maps to an existing flow via its first step). */
export function workflowLeadRole(wf: Workflow): RoleName {
  if (LEAD_ROLE[wf.id]) return LEAD_ROLE[wf.id];
  return HANDLE_ROLE[(wf.steps[0]?.agent || "").toLowerCase()] || "developer";
}

/** All workflow trigger handles — added to the GitHub mention scan so they fire. */
export function workflowTriggers(): string[] {
  return listWorkflows().map((w) => w.trigger).filter((t): t is string => Boolean(t));
}

/** Resolve the workflow whose trigger the text mentions (first match), or null. */
export function resolveWorkflow(text: string): Workflow | null {
  const t = text || "";
  for (const w of listWorkflows()) {
    const h = w.trigger || "";
    if (h && new RegExp(esc(h) + "(?![a-zA-Z0-9_-])", "i").test(t)) return w;
  }
  return null;
}
