// Full-page, flowchart-style workflow builder (Gumloop/Make.com-inspired): a left palette of
// agents/skills/hooks, a canvas of agent step-nodes wired by real SVG connector lines with gate
// badges, and a right inspector for the selected node. Replaces the old form-in-a-sheet editor.
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Avatar, Icon, Select, ProviderLogo, defaultModelLogo, agentOptions, api, toast, Spinner } from "./core.js";

const NODE_W = 150, NODE_H = 92, GAP = 78, PAD_X = 28, ROW_Y = 70, SVG_H = ROW_Y + NODE_H + 60;
const STEP_ROLE = { "@plan": "planner", "@arch": "architect", "@dev": "developer", "@review": "reviewer", "@test": "tester" };
const ROUTES = [
  { value: "continue", label: "Continue →" },
  { value: "stop", label: "Stop here" },
];
const CONDITIONS = [
  { value: "review:changes", label: "Reviewer requests changes" },
  { value: "tests:fail", label: "Tests fail" },
  { value: "conflict", label: "Merge conflict" },
  { value: "humanApproval", label: "Needs human approval" },
];
const blankStep = () => ({ agent: "@dev", instruction: "", model: "", skills: [], hooks: [] });
const agentOf = (s) => (s.agent || "@dev");
const roleFor = (handle) => STEP_ROLE[(handle || "").toLowerCase()] || (handle || "").replace(/^@/, "") || "agent";
const labelFor = (handle, opts) => { const o = (opts || []).find((x) => x.value === handle); return o ? o.label : roleFor(handle); };

export function WorkflowBuilder({ data, onClose, reload, onEditAgent }) {
  const wfs = (data && data.workflows) || [];
  const [sel, setSel] = useState(null);          // workflow id being edited (or "__new__")
  const [form, setForm] = useState(null);        // working copy
  const [step, setStep] = useState(0);           // selected step index
  const [saving, setSaving] = useState(false);

  const agentOpts = agentOptions(data && data.agentDefs, []).filter((o) => o.hint !== "workflow");
  const skillOpts = ((data && data.skills) || []).map((s) => ({ value: s.name, label: s.name, desc: s.description || "" }));
  const hookOpts = ((data && data.hooks) || []).map((h) => ({ value: String(h.id), label: (h.target || "hook"), phase: h.phase || "pre" }));

  function open(w) {
    setForm(w ? JSON.parse(JSON.stringify(w)) : { id: "", name: "", trigger: "", steps: [blankStep()], gates: [] });
    setSel(w ? w.id : "__new__"); setStep(0);
  }
  const patchStep = (i, p) => setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const addStep = (handle) => setForm((f) => { const steps = f.steps.concat({ ...blankStep(), agent: handle || "@dev" }); setStep(steps.length - 1); return { ...f, steps }; });
  const removeStep = (i) => setForm((f) => { const steps = f.steps.filter((_, j) => j !== i); setStep(Math.max(0, Math.min(i, steps.length - 1))); return { ...f, steps, gates: (f.gates || []).filter((g) => g.after !== i).map((g) => (g.after > i ? { ...g, after: g.after - 1 } : g)) }; });
  const toggleChip = (i, key, val) => { const cur = form.steps[i][key] || []; patchStep(i, { [key]: cur.includes(val) ? cur.filter((x) => x !== val) : cur.concat(val) }); };

  // Gate for a given source step (route AFTER finishing step i).
  const gateAfter = (i) => (form.gates || []).find((g) => g.after === i) || null;
  function setGate(i, patch) {
    setForm((f) => {
      let gates = (f.gates || []).slice();
      const idx = gates.findIndex((g) => g.after === i);
      const base = idx >= 0 ? gates[idx] : { after: i, condition: "review:changes", route: "continue", maxLoops: 2 };
      const next = { ...base, ...patch };
      if (next.route === "continue") gates = gates.filter((g) => g.after !== i);      // continue = no gate needed
      else if (idx >= 0) gates[idx] = next; else gates.push(next);
      return { ...f, gates };
    });
  }

  function save() {
    if (!form.name.trim()) return toast("Name your workflow", "error");
    const id = form.id || form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const trigger = (form.trigger || "@" + id).trim();
    setSaving(true);
    api("/workflow-save", { workflow: { ...form, id, trigger } })
      .then(() => { toast("Saved"); setSel(null); reload && reload(); })
      .catch((e) => toast((e && e.message) || "Couldn’t save", "error"))
      .finally(() => setSaving(false));
  }
  function del() {
    if (!form.id || !window.confirm("Delete " + (form.name || "workflow") + "?")) return;
    api("/workflow-delete", { workflowId: form.id }).then(() => { toast("Deleted"); setSel(null); reload && reload(); });
  }

  // ---------- workflow list ----------
  if (!form) {
    return html`<div class="bld">
      <div class="bld-top">
        <button class="iconbtn" onClick=${onClose} aria-label="Close"><${Icon} name="x" size=${18}/></button>
        <div class="bld-title">Workflows</div>
        <button class="btn primary" onClick=${() => open(null)}><${Icon} name="plus" size=${15}/> New workflow</button>
      </div>
      <div class="bld-listwrap">
        ${wfs.length === 0 ? html`<div class="bld-empty">No workflows yet. Create one — chain agents on a canvas.</div>` : null}
        <div class="bld-grid">
          ${wfs.map((w) => html`<button class="bld-card" key=${w.id} onClick=${() => open(w)}>
            <div class="bld-card-h"><span class="bld-trig">${w.trigger || "@" + w.id}</span>${w.builtin ? html`<span class="bld-builtin">built-in</span>` : null}</div>
            <div class="bld-card-name">${w.name}</div>
            <div class="bld-card-flow">${(w.steps || []).map((s, i) => html`${i ? html`<${Icon} name="chevron" size=${12}/>` : null}<${Avatar} role=${roleFor(agentOf(s))} size=${22} crop="head"/>`)}</div>
            <div class="bld-card-meta">${(w.steps || []).length} step${(w.steps || []).length === 1 ? "" : "s"}${(w.gates || []).length ? ` · ${w.gates.length} gate${w.gates.length === 1 ? "" : "s"}` : ""}</div>
          </button>`)}
        </div>
      </div>
    </div>`;
  }

  // ---------- canvas editor ----------
  const steps = form.steps || [];
  const cur = steps[step] || steps[0];
  const svgW = PAD_X * 2 + steps.length * NODE_W + (steps.length - 1) * GAP + 70;

  const connector = (i) => {
    const x1 = PAD_X + i * (NODE_W + GAP) + NODE_W;
    const x2 = PAD_X + (i + 1) * (NODE_W + GAP);
    const y = ROW_Y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return { x1, x2, y, mx, d: `M ${x1} ${y} C ${mx} ${y}, ${mx} ${y}, ${x2} ${y}` };
  };

  return html`<div class="bld">
    <div class="bld-top">
      <button class="iconbtn" onClick=${() => setSel(null) || setForm(null)} aria-label="Back"><${Icon} name="chevron" size=${18}/></button>
      <input class="bld-name" value=${form.name} placeholder="Workflow name" onInput=${(e) => setForm((f) => ({ ...f, name: e.target.value }))}/>
      <span class="bld-trig-edit"><span class="at">@</span><input value=${(form.trigger || "").replace(/^@/, "")} placeholder="trigger" onInput=${(e) => setForm((f) => ({ ...f, trigger: "@" + e.target.value.replace(/[^a-z0-9]/gi, "") }))}/></span>
      <div style="flex:1"></div>
      ${form.id && !((wfs.find((w) => w.id === form.id) || {}).builtin) ? html`<button class="btn ghost danger" onClick=${del}>Delete</button>` : null}
      <button class="btn primary" disabled=${saving} onClick=${save}>${saving ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="check" size=${15}/>`} Save</button>
    </div>

    <div class="bld-body">
      <!-- palette -->
      <div class="bld-rail">
        <div class="bld-rail-sec">Agents</div>
        <div class="bld-pills">
          ${agentOpts.map((o) => html`<button class="bld-pill agent" key=${o.value} title=${"Add " + o.label} onClick=${() => addStep(o.value)}>
            <${Avatar} role=${o.avatar || roleFor(o.value)} size=${18} crop="head"/><span>${o.label}</span><${Icon} name="plus" size=${12}/>
          </button>`)}
          <button class="bld-pill ghost" onClick=${() => onEditAgent && onEditAgent()}><${Icon} name="plus" size=${13}/><span>New agent</span></button>
        </div>
        <div class="bld-rail-sec">Skills ${cur ? html`<span class="bld-hint">→ ${labelFor(agentOf(cur), agentOpts)}</span>` : null}</div>
        <div class="bld-pills">
          ${skillOpts.length === 0 ? html`<div class="bld-empty sm">No skills yet.</div>` : null}
          ${skillOpts.map((s) => { const on = cur && (cur.skills || []).includes(s.value); return html`<button class=${"bld-pill skill" + (on ? " on" : "")} key=${s.value} title=${s.desc} onClick=${() => cur && toggleChip(step, "skills", s.value)}><${Icon} name=${on ? "check" : "plus"} size=${12}/><span>${s.label}</span></button>`; })}
          <button class="bld-pill ghost" onClick=${() => onEditAgent && onEditAgent("skills")}><${Icon} name="plus" size=${13}/><span>Manage skills</span></button>
        </div>
        <div class="bld-rail-sec">Hooks</div>
        <div class="bld-pills">
          ${hookOpts.length === 0 ? html`<div class="bld-empty sm">No hooks yet.</div>` : null}
          ${hookOpts.map((h) => { const on = cur && (cur.hooks || []).includes(h.value); return html`<button class=${"bld-pill hook" + (on ? " on" : "")} key=${h.value} onClick=${() => cur && toggleChip(step, "hooks", h.value)}><span class=${"phase " + h.phase}>${h.phase}</span><span>${h.label}</span></button>`; })}
        </div>
      </div>

      <!-- canvas -->
      <div class="bld-canvas">
        <div class="bld-flow" style=${"width:" + svgW + "px;min-height:" + SVG_H + "px"}>
          <svg class="bld-wires" width=${svgW} height=${SVG_H} aria-hidden="true">
            <defs><marker id="bld-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--line-2)"/></marker></defs>
            ${steps.slice(0, -1).map((_, i) => { const c = connector(i); return html`<path key=${i} d=${c.d} fill="none" stroke="var(--line-2)" stroke-width="2" marker-end="url(#bld-arrow)"/>`; })}
          </svg>
          ${steps.map((s, i) => {
            const x = PAD_X + i * (NODE_W + GAP);
            const g = gateAfter(i);
            return html`<div key=${i}>
              <div class=${"bld-node" + (i === step ? " sel" : "")} style=${"left:" + x + "px;top:" + ROW_Y + "px;width:" + NODE_W + "px"} onClick=${() => setStep(i)}>
                <div class="bld-node-h"><${Avatar} role=${roleFor(agentOf(s))} size=${26} crop="head"/><span class="bld-node-name">${labelFor(agentOf(s), agentOpts)}</span></div>
                <div class="bld-node-task">${(s.instruction || "").split("\n")[0] || html`<span class="ph">describe this step…</span>`}</div>
                <div class="bld-node-tags">${(s.skills || []).length ? html`<span class="t skill"><${Icon} name="sparkles" size=${10}/>${s.skills.length}</span>` : null}${(s.hooks || []).length ? html`<span class="t hook">${s.hooks.length} hook</span>` : null}${s.model ? html`<span class="t"><${ProviderLogo} name="claude" size=${10}/></span>` : null}</div>
              </div>
              ${g ? html`<div class="bld-gate" style=${"left:" + (x + NODE_W + GAP / 2) + "px;top:" + (ROW_Y + NODE_H / 2) + "px"}>${g.route && g.route.startsWith("loop") ? html`<${Icon} name="refresh" size=${11}/>` : html`<${Icon} name="alert" size=${11}/>`} ${g.route && g.route.startsWith("loop") ? "loop" : "branch"}</div>` : null}
            </div>`;
          })}
          <button class="bld-add" style=${"left:" + (PAD_X + steps.length * (NODE_W + GAP)) + "px;top:" + ROW_Y + "px"} onClick=${() => addStep("@dev")} title="Add step"><${Icon} name="plus" size=${20}/></button>
        </div>
      </div>

      <!-- inspector -->
      <div class="bld-insp">
        ${cur ? html`
          <div class="bld-insp-h">
            <${Avatar} role=${roleFor(agentOf(cur))} size=${30} crop="head"/>
            <div style="flex:1;min-width:0">
              <div class="bld-insp-name">${labelFor(agentOf(cur), agentOpts)}</div>
              <button class="bld-link" onClick=${() => onEditAgent && onEditAgent(agentOf(cur))}>Edit agent profile →</button>
            </div>
            <button class="iconbtn" title="Remove step" onClick=${() => removeStep(step)} disabled=${steps.length <= 1}><${Icon} name="trash" size=${15}/></button>
          </div>
          <label class="bld-lbl">Agent</label>
          <${Select} value=${agentOf(cur)} options=${agentOpts} onChange=${(v) => patchStep(step, { agent: v })}/>
          <label class="bld-lbl">Task for this step <span class="bld-hint">(not the agent’s profile)</span></label>
          <textarea class="bld-ta" rows="3" placeholder="What this agent does here…" value=${cur.instruction} onInput=${(e) => patchStep(step, { instruction: e.target.value })}></textarea>
          <label class="bld-lbl">Model</label>
          <${Select} value=${cur.model || ""} options=${[{ value: "", label: "Default", logo: defaultModelLogo(data) }].concat(modelOpts(data))} onChange=${(v) => patchStep(step, { model: v })}/>
          ${(cur.skills || []).length ? html`<label class="bld-lbl">Skills</label><div class="bld-chips">${cur.skills.map((s) => html`<span class="bld-chip skill" key=${s}>${s}<button onClick=${() => toggleChip(step, "skills", s)} aria-label="remove"><${Icon} name="x" size=${10}/></button></span>`)}</div>` : null}
          ${(cur.hooks || []).length ? html`<label class="bld-lbl">Hooks</label><div class="bld-chips">${cur.hooks.map((h) => { const ho = hookOpts.find((x) => x.value === h); return html`<span class="bld-chip hook" key=${h}>${ho ? ho.phase + " · " + ho.label : h}<button onClick=${() => toggleChip(step, "hooks", h)} aria-label="remove"><${Icon} name="x" size=${10}/></button></span>`; })}</div>` : null}
          ${step < steps.length - 1 ? html`
            <label class="bld-lbl">When this step finishes</label>
            <${Select} value=${(gateAfter(step) ? gateAfter(step).route.startsWith("loop") ? "loop" : "stop" : "continue")} options=${[{ value: "continue", label: "Continue to next →" }, { value: "loop", label: "Loop back if…" }, { value: "stop", label: "Stop the workflow" }]} onChange=${(v) => v === "continue" ? setGate(step, { route: "continue" }) : v === "stop" ? setGate(step, { route: "stop" }) : setGate(step, { route: "loop:" + Math.max(0, step - 1), condition: (gateAfter(step) || {}).condition || "review:changes" })}/>
            ${gateAfter(step) && gateAfter(step).route.startsWith("loop") ? html`
              <label class="bld-lbl">…if</label>
              <${Select} value=${gateAfter(step).condition} options=${CONDITIONS} onChange=${(v) => setGate(step, { condition: v })}/>
              <label class="bld-lbl">Loop back to</label>
              <${Select} value=${String(Number(gateAfter(step).route.split(":")[1]))} options=${steps.slice(0, step).map((s2, j) => ({ value: String(j), label: (j + 1) + ". " + labelFor(agentOf(s2), agentOpts) }))} onChange=${(v) => setGate(step, { route: "loop:" + v })}/>
            ` : null}
          ` : null}
        ` : html`<div class="bld-empty">Add a step to begin.</div>`}
      </div>
    </div>
  </div>`;
}

function modelOpts(data) {
  const providers = (data && data.providers) || [];
  return providers.flatMap((p) => (p.models || []).map((m) => ({ value: p.id + "/" + m, label: p.name + " · " + m, logo: p.name })));
}
