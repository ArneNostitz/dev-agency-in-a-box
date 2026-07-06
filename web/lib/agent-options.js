// Agent / workflow option builders — pure functions.
// Imports cap + shortModel from format.js.

import { cap, shortModel } from "./format.js";

// Single-agent pins (a workflow is the multi-step path; these run ONE specialist). All single
// agents — built-in roles AND custom agents — carry the same "single" badge; the old chat/code
// distinction was dropped (it confused more than it helped).
// NOTE: this list must stay in sync with the 6 base roles seedBaseAgents() seeds server-side
// (src/db/agent_def.ts) — @dev/Developer was missing here entirely (#152-adjacent bug report:
// "the developer agent is missing"), so any picker built from this list (reply composer, new-issue
// agent picker) had no way to select Developer by name, even though it's the most-used role.
const ROLE_PINS = [
  { value: "@plan", label: "Plan", avatar: "planner", hint: "single", hintCls: "b-role" },
  { value: "@dev", label: "Developer", avatar: "developer", hint: "single", hintCls: "b-role" },
  { value: "@split", label: "Split", avatar: "auditor", hint: "single", hintCls: "b-role" },
  { value: "@arch", label: "Architect", avatar: "architect", hint: "single", hintCls: "b-role" },
  { value: "@review", label: "Review", avatar: "reviewer", hint: "single", hintCls: "b-role" },
  { value: "@test", label: "Test", avatar: "tester", hint: "single", hintCls: "b-role" },
];
const WF_AVATAR = { "full-build": "developer", "quick-fix": "developer", "plan-only": "planner", "review-only": "reviewer" };
// Which canonical role each static pin stands for — so a pin is hidden when an editable agentDef
// already covers that role (the def is richer: persona, model, avatar). @split has no default def.
const PIN_ROLE = { "@plan": "planner", "@dev": "developer", "@split": "decomposer", "@arch": "architect", "@review": "reviewer", "@test": "tester" };

// 🎲 Dealer's choice — hand the issue to the dispatcher, which picks the agent/workflow on start.
// Sentinel handle "@auto"; the backend rolls the route once (see src/agents/dealer.ts).
export const DEALER_OPTION = { value: "@auto", label: "Dealer’s choice", hint: "auto-route", hintCls: "b-wf", icon: "shuffle" };

function customAgentOptions(agentDefs) {
  return (agentDefs || []).map((d) => ({ value: d.handle || ("@" + d.name), label: cap(d.name), avatar: d.name, avatarSrc: d.avatar || "", hint: "single", hintCls: "b-role" }));
}

// Resolve an agent's configured model (agentDef.model / a workflow step's model) to a concrete
// { ref:"providerId/model", short, provider } — or null when it's blank (true default). The stored
// value is "" (default) | a bare tier word high|medium|low (resolved against the global provider's
// tier slots) | a concrete "providerId/model" ref | a free model name (paired with the global provider).
const TIER_WORDS = ["high", "medium", "low"];
export function resolveAgentModel(modelRef, data) {
  const providers = (data && data.providers) || [];
  const g = data && data.globalModel;
  const raw = (modelRef ? String(modelRef) : "").trim();
  if (!raw) return null;
  const lc = raw.toLowerCase();
  if (TIER_WORDS.indexOf(lc) >= 0) {
    const pid = g && g.providerId; if (!pid) return null;
    const p = providers.find((x) => x.id === pid);
    const slot = p && p.tiers && p.tiers[lc];
    const model = (slot && slot.model) || (p && p.models && p.models[0]) || "";
    return model ? { ref: pid + "/" + model, short: shortModel(model), provider: p && p.name } : null;
  }
  if (raw.indexOf("/") >= 0) {
    const i = raw.indexOf("/"); const pid = raw.slice(0, i), model = raw.slice(i + 1);
    const p = providers.find((x) => x.id === pid);
    return { ref: raw, short: shortModel(model), provider: p && p.name };
  }
  const p = g && providers.find((x) => x.id === g.providerId);
  return { ref: (g ? g.providerId + "/" : "") + raw, short: shortModel(raw), provider: p && p.name };
}

// Static role pins MINUS any whose role/handle is already an editable agentDef (avoids the
// Plan↔planner, Architect↔architect, Review↔reviewer, Test↔tester duplicates).
function rolePins(agentDefs) {
  const defs = agentDefs || [];
  const names = new Set(defs.map((d) => (d.name || "").toLowerCase()));
  const handles = new Set(defs.map((d) => (d.handle || ("@" + d.name)).toLowerCase()));
  return ROLE_PINS.filter((p) => {
    const role = PIN_ROLE[p.value];
    return !(role && names.has(role)) && !handles.has(p.value.toLowerCase());
  });
}

// Build the agent picker options: built-in workflow/role pins + chat agents + custom agents,
// each with a persona avatar and a category badge so chat-only vs workflow vs single-role is clear.
export function agentOptions(agentDefs, workflows) {
  const wf = (workflows || []).filter((w) => w.trigger).map((w) => ({ value: w.trigger, label: w.name, avatar: WF_AVATAR[w.id] || "developer", hint: "workflow", hintCls: "b-wf" }));
  return [DEALER_OPTION].concat(wf).concat(rolePins(agentDefs)).concat(customAgentOptions(agentDefs));
}

// AGENTS ONLY — role pins + defined agents, no workflows. Used by the reply composer.
export function agentOnlyOptions(agentDefs) {
  return rolePins(agentDefs).concat(customAgentOptions(agentDefs));
}

// Just the workflows, for the per-issue workflow picker + the toolbar "Run workflow" menu.
export function workflowOptions(workflows) {
  return (workflows || []).filter((w) => w.trigger || w.id).map((w) => ({ value: w.id, trigger: w.trigger || "", label: w.name, avatar: WF_AVATAR[w.id] || "developer", hint: "workflow", hintCls: "b-wf" }));
}
