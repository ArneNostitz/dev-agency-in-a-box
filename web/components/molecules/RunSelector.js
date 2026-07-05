// RunSelector molecule — the ONE combined "route › model › play" control:
//   [ Workflow OR single agent ] › [ model ] › [ ▶ ]
// Replaces the old split layout (play+workflow on the left, a lone model picker far right).
// The route select lists every workflow AND every single agent (built-in role pins + custom
// agents) — a single agent can own an issue end-to-end. Selection persists via /issue-workflow
// ({workflowId} or {agent}, mutually exclusive); Play pins the route then starts/resumes.
import { html, useState, useEffect } from "/web/vendor/standalone.mjs";
import { Select } from "../atoms/Select.js";
import { Icon } from "../atoms/Icon.js";
import { ModelSelect } from "./ModelSelect.js";
import { api } from "../../lib/api.js";
import { toast } from "../../lib/toast.js";
import { workflowOptions, agentOnlyOptions } from "../../lib/agent-options.js";
import { defaultModelLabel } from "../../lib/model-logic.js";

export function RunSelector({ issue, data, act, running, modelOverride, onModelChange, onOpenModels }) {
  const repo = issue.repo, number = issue.number;
  const wfOpts = workflowOptions(data && data.workflows);
  const agOpts = agentOnlyOptions(data && data.agentDefs);
  const defWfId = (data && data.defaultWorkflowId) || "full-build";
  const defWf = wfOpts.find((w) => w.value === defWfId);
  // "" = Default workflow; "wf:<id>" = a pinned workflow; "@handle" = a pinned single agent.
  const routeOpts = [{ value: "", label: "Default" + (defWf ? " · " + defWf.label : ""), icon: "sparkles" }]
    .concat(wfOpts.map((w) => ({ value: "wf:" + w.value, label: w.label, avatar: w.avatar, hint: "workflow", hintCls: "b-wf" })))
    .concat(agOpts);
  const current = issue.workflowId ? "wf:" + issue.workflowId : (issue.rolePin || "");
  const [sel, setSel] = useState(current);
  useEffect(() => { setSel(current); }, [current]);
  const curOpt = routeOpts.find((o) => o.value === sel);
  const routeName = (curOpt && curOpt.label) || (issue.soloRole ? issue.soloRole : "Default");

  const pinRoute = (v) => {
    setSel(v);
    if (v && v.indexOf("wf:") === 0) { issue.workflowId = v.slice(3); issue.rolePin = null; }
    else { issue.workflowId = null; issue.rolePin = v || null; }
    const body = v && v.indexOf("wf:") === 0 ? { workflowId: v.slice(3) } : v ? { agent: v } : {};
    api("/issue-workflow", { repo, number, ...body }).catch((err) => toast("Couldn't set the route: " + ((err && err.message) || ""), "error"));
  };
  const play = () => {
    pinRoute(sel); // make sure the visible selection is what actually runs
    const planned = issue.state === "planned" || issue.state === "notPlanned" || !issue.state;
    (planned ? act.start(repo, number) : act.resume(repo, number));
  };

  const defModelLabel = defaultModelLabel(data);

  if (running) {
    return html`<span class="wfctl wfctl--running tip" data-tip="Running — stop the issue to switch route or model">
      <${Icon} name="loader" size=${14} cls="spin"/> <span class="wfctl__name">${routeName}</span>
    </span>`;
  }
  // One enclosure, three flat segments: [route field ▾] [model field ▾] [▶]. Both dropdowns are
  // plain fields (label + chevron, model name visible) — no nested icon-buttons.
  return html`<span class="wfctl">
    <${Select} value=${sel} options=${routeOpts} onChange=${pinRoute} menuAlign="left" btnClass="wfctl__sel wfctl__route" placeholder="Default"/>
    <span class="wfctl__div"></span>
    <${ModelSelect} providers=${data && data.providers} data=${data} value=${modelOverride} emit="object" onChange=${onModelChange} includeDefault=${true} defaultLabel="Default model" defaultHint=${defModelLabel} onSetUp=${onOpenModels} menuAlign="left" btnClass="wfctl__sel wfctl__model"/>
    <button class="wfctl__play tip" data-tip=${"Run " + (sel ? (sel.indexOf("wf:") === 0 ? "this workflow" : "this agent") : "the default workflow") + " on this issue" + (modelOverride ? "" : " · default model")} onClick=${play}><${Icon} name="play" size=${15}/></button>
  </span>`;
}
