import { getDb, now } from "./connection.js";
import { getSetting, setSetting } from "./settings.js";

/** A single agent step in a workflow. Forces skills/hooks; optional model + budget + parallelism. */
export interface WorkflowStep {
  agent: string; // "@dev" | "@plan" | a custom handle
  instruction: string; // initial instruction for this step
  model?: string; // "providerId/model" | "" = default
  skills: string[]; // forced skills for this step
  hooks: string[]; // forced hooks (by id/name)
  budget?: number; // optional per-step USD cap
  parallel?: boolean; // may run in parallel with the NEXT step (file-lock permitting)
}

export type GateCondition =
  | "review:changes" | "review:approved" | "tests:pass" | "tests:fail"
  | "conflict" | "budgetExceeded" | "humanApproval";

/** A condition evaluated AFTER step `after` that routes the flow. route: "continue" | "stop" | "loop:<idx>". */
export interface WorkflowGate {
  after: number; // step index
  condition: GateCondition;
  route: string;
  maxLoops?: number;
}

export interface Workflow {
  id: string;
  name: string;
  trigger: string; // "@ship"
  steps: WorkflowStep[];
  gates: WorkflowGate[];
  hooks: string[]; // workflow-level hook ids — run pre (before step 1) / post (after the last step)
  builtin: boolean;
  updatedAt: string;
}

function parse<T>(s: string | null, fallback: T): T { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } }
function rowToWorkflow(r: { id: string; name: string; trigger: string | null; steps: string | null; gates: string | null; hooks: string | null; builtin: number; updated_at: string | null }): Workflow {
  return {
    id: r.id, name: r.name, trigger: r.trigger ?? "",
    steps: parse<WorkflowStep[]>(r.steps, []), gates: parse<WorkflowGate[]>(r.gates, []), hooks: parse<string[]>(r.hooks, []),
    builtin: !!r.builtin, updatedAt: r.updated_at ?? "",
  };
}

export function upsertWorkflow(w: Partial<Workflow> & { id: string; name: string }): void {
  const d = getDb(); if (!d) return;
  try {
    d.prepare(
      `INSERT INTO workflows (id, name, trigger, steps, gates, hooks, builtin, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, trigger=excluded.trigger, steps=excluded.steps, gates=excluded.gates, hooks=excluded.hooks, updated_at=excluded.updated_at`,
    ).run(w.id, w.name, w.trigger ?? "", JSON.stringify(w.steps ?? []), JSON.stringify(w.gates ?? []), JSON.stringify(w.hooks ?? []), w.builtin ? 1 : 0, now());
  } catch { /* best effort */ }
}

export function getWorkflow(id: string): Workflow | null {
  const d = getDb(); if (!d) return null;
  try { const r = d.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as Parameters<typeof rowToWorkflow>[0] | undefined; return r ? rowToWorkflow(r) : null; } catch { return null; }
}

export function listWorkflows(): Workflow[] {
  const d = getDb(); if (!d) return [];
  try { return (d.prepare(`SELECT * FROM workflows ORDER BY builtin DESC, name`).all() as Array<Parameters<typeof rowToWorkflow>[0]>).map(rowToWorkflow); } catch { return []; }
}

/** Resolve a workflow by its trigger handle (e.g. "@ship"), case-insensitive. */
export function getWorkflowByTrigger(handle: string): Workflow | null {
  const h = (handle || "").toLowerCase();
  return listWorkflows().find((w) => (w.trigger || "").toLowerCase() === h) || null;
}

export function deleteWorkflow(id: string): void {
  const d = getDb(); if (!d) return;
  try { d.prepare(`DELETE FROM workflows WHERE id = ? AND builtin = 0`).run(id); } catch { /* best effort */ }
}

/** Seed the built-in workflow templates once. Users clone + edit these. */
export function seedWorkflows(): void {
  const existing = getWorkflow("full-build");
  if (existing) {
    let trigger = existing.trigger;
    let steps = existing.steps;
    let gates = existing.gates;
    let changed = false;
    // Migration: the old @dev trigger collided with the developer/code agent (which should run a
    // SOLO developer, not the full build). Move Full build onto @build.
    if (trigger === "@dev") { trigger = "@build"; changed = true; }
    // Migration: this metadata never drove full-build's actual execution (it runs the proven
    // pipeline, never the step engine — see runner.ts), but it DOES drive the dashboard timeline's
    // step order/labels. The original seed listed @review before @test while the pipeline (build()
    // in pipeline.ts) always runs the tester, then the reviewer — so every full-build card showed
    // Review and Test swapped (#152). Reorder existing rows to match reality.
    if (steps.length === 4 && (steps[2]?.agent || "").toLowerCase() === "@review" && (steps[3]?.agent || "").toLowerCase() === "@test") {
      steps = [steps[0], steps[1], steps[3], steps[2]];
      gates = gates.map((g) => (g.after === 2 ? { ...g, after: 3 } : g.after === 3 ? { ...g, after: 2 } : g));
      changed = true;
    }
    if (changed) upsertWorkflow({ ...existing, trigger, steps, gates });
    return;
  }
  const S = (agent: string, instruction: string, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({ agent, instruction, skills: [], hooks: [], ...extra });
  upsertWorkflow({
    id: "full-build", name: "Full build", trigger: "@build", builtin: true,
    steps: [
      S("@plan", "Produce a concrete build plan for this issue."),
      S("@dev", "Implement the plan; commit and open a PR."),
      S("@test", "Run the project's checks and fix any failures."),
      S("@review", "Review the PR against the plan and the codebase."),
    ],
    gates: [
      { after: 2, condition: "tests:fail", route: "loop:1", maxLoops: 2 },
      { after: 3, condition: "review:changes", route: "loop:1", maxLoops: 2 },
    ],
  });
  upsertWorkflow({
    id: "quick-fix", name: "Quick fix", trigger: "@quickfix", builtin: true,
    steps: [S("@dev", "Make the smallest correct change and open a PR — no planning step.")], gates: [],
  });
  upsertWorkflow({
    id: "plan-only", name: "Plan only", trigger: "@planonly", builtin: true,
    steps: [S("@plan", "Produce a plan and post it for approval. Do NOT build.")], gates: [],
  });
  upsertWorkflow({
    id: "review-only", name: "Review only", trigger: "@reviewonly", builtin: true,
    steps: [S("@review", "Review the open PR for this issue and leave actionable feedback.")], gates: [],
  });
}

// Global DEFAULT workflow — what an issue runs when its per-issue workflow is unset ("Default").
// Configurable in the workflow manager; the built-in Full build ("full-build") is the default-default.
export function getDefaultWorkflowId(): string {
  const v = getSetting("default_workflow_id");
  // Fall back to full-build if unset or pointing at a deleted workflow.
  if (v && getWorkflow(v)) return v;
  return "full-build";
}
export function setDefaultWorkflowId(id: string): void {
  setSetting("default_workflow_id", id || "");
}
