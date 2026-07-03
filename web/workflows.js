// Dev Agency dashboard — workflow builder (Make.com-style vertical flow). Drag to reorder steps;
// each step picks an agent + instruction + model + forced skills/hooks; gates route between steps.
import { html, useState } from "/web/vendor/standalone.mjs";
import { Icon, ModelSelect, ProviderLogo, Select, Sheet, Spinner, agentOptions, api, toast } from "./core.js";

const CONDITIONS = [
  { value: "review:changes", label: "Review: changes requested" },
  { value: "review:approved", label: "Review: approved" },
  { value: "tests:pass", label: "Tests: pass" },
  { value: "tests:fail", label: "Tests: fail" },
  { value: "conflict", label: "Merge conflict" },
  { value: "humanApproval", label: "Human approval" },
];
const blankStep = () => ({ agent: "@dev", instruction: "", model: "", skills: [], hooks: [] });

export function WorkflowEditor({ data, onClose, reload }) {
  const workflows = data.workflows || [];
  const [sel, setSel] = useState(null); // null = list, "__new__" or an id = editing
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(null);

  const stepAgentOpts = agentOptions(data.agentDefs, []); // role pins + agents (not workflows)
  const skillOpts = (data.skills || []).map((s) => ({ value: s.name, label: s.name }));
  const hookOpts = (data.hooks || []).map((h) => ({ value: String(h.id), label: (h.target || "hook") + " · " + (h.phase || "") }));

  function edit(w) { setForm(w ? JSON.parse(JSON.stringify(w)) : { id: "", name: "", trigger: "", steps: [blankStep()], gates: [] }); setSel(w ? w.id : "__new__"); }
  function setStep(i, patch) { setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })); }
  function addStep() { setForm((f) => ({ ...f, steps: f.steps.concat(blankStep()) })); }
  function removeStep(i) { setForm((f) => ({ ...f, steps: f.steps.filter((_, j) => j !== i), gates: (f.gates || []).filter((g) => g.after !== i) })); }
  function move(from, to) { setForm((f) => { const s = f.steps.slice(); const [x] = s.splice(from, 1); s.splice(to, 0, x); return { ...f, steps: s }; }); }
  function toggleChip(i, key, val) { setStep(i, { [key]: form.steps[i][key].includes(val) ? form.steps[i][key].filter((x) => x !== val) : form.steps[i][key].concat(val) }); }
  function addGate() { setForm((f) => ({ ...f, gates: (f.gates || []).concat({ after: 0, condition: "review:changes", route: "continue", maxLoops: 2 }) })); }
  function setGate(i, patch) { setForm((f) => ({ ...f, gates: f.gates.map((g, j) => (j === i ? { ...g, ...patch } : g)) })); }
  function removeGate(i) { setForm((f) => ({ ...f, gates: f.gates.filter((_, j) => j !== i) })); }

  function save() {
    if (!form.name.trim()) { toast("Name it"); return; }
    const id = (form.id || form.name).toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
    setBusy(true);
    api("/workflow-save", { workflow: { ...form, id } }).then(() => { toast("Saved"); setSel(null); reload(); }).catch((e) => toast((e && e.message) || "Couldn’t save", "error")).then(() => setBusy(false));
  }
  function del() { if (!form.id || !window.confirm("Delete " + form.name + "?")) return; api("/workflow-delete", { workflowId: form.id }).then(() => { toast("Deleted"); setSel(null); reload(); }); }

  // ---- list view ----
  if (sel === null) {
    return html`<${Sheet} title="Workflows" onClose=${onClose} footer=${html`<button class="btn primary" onClick=${() => edit(null)}><${Icon} name="plus" size=${15}/> New workflow</button>`}>
      <div class="muted" style="font-size:12px;margin-bottom:10px">Arrange agents into a pipeline. A workflow's trigger (e.g. <code>@dev</code>) runs it from an issue.</div>
      ${workflows.map((w) => html`<button class="wf-row" key=${w.id} onClick=${() => edit(w)}>
        <span class="wf-name"><b>${w.name}</b> ${w.trigger ? html`<code>${w.trigger}</code>` : null}</span>
        <span class="muted" style="font-size:11px">${(w.steps || []).length} step${(w.steps || []).length === 1 ? "" : "s"}${w.builtin ? " · template" : ""}</span>
        <${Icon} name="chevron" size=${14}/>
      </button>`)}
    <//>`;
  }

  // ---- editor ----
  const f = form;
  return html`<${Sheet} title=${sel === "__new__" ? "New workflow" : "Edit workflow"} onClose=${() => setSel(null)}
    footer=${html`<button class="btn" onClick=${() => setSel(null)}>Back</button>${f.id && !workflows.find((w) => w.id === f.id && w.builtin) ? html`<button class="btn danger" onClick=${del}>Delete</button>` : null}<span style="flex:1"></span><button class="btn primary" disabled=${busy} onClick=${save}>${busy ? html`<${Spinner} size=${15}/>` : "Save"}</button>`}>
    <label>Name</label><input value=${f.name} onInput=${(e) => setForm({ ...f, name: e.target.value })} placeholder="Full build"/>
    <label style="margin-top:8px">Trigger handle</label><input value=${f.trigger} onInput=${(e) => setForm({ ...f, trigger: e.target.value })} placeholder="@ship"/>

    <div class="sec" style="margin-top:14px">Steps</div>
    <div class="wf-flow">
      ${f.steps.map((st, i) => html`<div class="wf-step" key=${i} draggable=${true}
        onDragStart=${() => setDrag(i)} onDragOver=${(e) => e.preventDefault()} onDrop=${() => { if (drag != null && drag !== i) move(drag, i); setDrag(null); }}>
        <div class="wf-step-h"><${Icon} name="dots" size=${15} cls="wf-grip"/> <span class="wf-num">${i + 1}</span>
          <div style="flex:1"><${Select} value=${st.agent} options=${stepAgentOpts} onChange=${(v) => setStep(i, { agent: v })}/></div>
          <${ModelSelect} data=${data} value=${st.model} btnClass="iconbtn-sm" includeDefault=${true} defaultLabel="Default model" defaultIcon="flask" onChange=${(v) => setStep(i, { model: v })} trigger=${(cur) => html`<span class="tip" data-tip=${cur ? cur.label : "Default model"} style="display:inline-flex"><${ProviderLogo} name=${cur && cur.logo ? cur.logo : ""} size=${16}/></span>`}/>
          <button class="iconbtn tip" data-tip="Remove step" style="width:28px;height:28px;border:none" onClick=${() => removeStep(i)}><${Icon} name="trash" size=${14}/></button>
        </div>
        <textarea class="wf-instr" rows="2" placeholder="Instruction for this step…" value=${st.instruction} onInput=${(e) => setStep(i, { instruction: e.target.value })}></textarea>
        <div class="wf-attach">
          <${ChipAdd} label="Skill" opts=${skillOpts} chosen=${st.skills} onToggle=${(v) => toggleChip(i, "skills", v)} cls="b-code"/>
          <${ChipAdd} label="Hook" opts=${hookOpts} chosen=${st.hooks} onToggle=${(v) => toggleChip(i, "hooks", v)} cls="b-role"/>
        </div>
      </div>`)}
      <button class="btn ghost" style="width:100%;justify-content:center" onClick=${addStep}><${Icon} name="plus" size=${14}/> Add step</button>
    </div>

    <div class="sec" style="margin-top:14px">Gates</div>
    <div class="muted" style="font-size:11.5px;margin-bottom:6px">Route the flow after a step based on a signal.</div>
    ${(f.gates || []).map((g, i) => html`<div class="wf-gate" key=${i}>
      <span class="muted" style="font-size:12px">after</span>
      <${Select} value=${String(g.after)} options=${f.steps.map((_, j) => ({ value: String(j), label: "step " + (j + 1) }))} onChange=${(v) => setGate(i, { after: Number(v) })}/>
      <${Select} value=${g.condition} options=${CONDITIONS} onChange=${(v) => setGate(i, { condition: v })}/>
      <span class="muted" style="font-size:12px">→</span>
      <${Select} value=${g.route} options=${[{ value: "continue", label: "continue" }, { value: "stop", label: "stop" }].concat(f.steps.map((_, j) => ({ value: "loop:" + j, label: "loop to step " + (j + 1) })))} onChange=${(v) => setGate(i, { route: v })}/>
      <button class="iconbtn" style="width:28px;height:28px;border:none" onClick=${() => removeGate(i)}><${Icon} name="trash" size=${14}/></button>
    </div>`)}
    <button class="btn ghost" style="margin-top:4px" onClick=${addGate}><${Icon} name="plus" size=${14}/> Add gate</button>
  <//>`;
}

// A compact multi-add: a Select that toggles values into a chosen[] list, shown as removable chips.
function ChipAdd({ label, opts, chosen, onToggle, cls }) {
  if (!opts.length) return html`<span class="muted" style="font-size:11px">No ${label.toLowerCase()}s</span>`;
  return html`<div class="wf-chips">
    ${chosen.map((v) => { const o = opts.find((x) => x.value === v); return html`<span key=${v} class=${"wf-chip " + (cls || "")} onClick=${() => onToggle(v)}>${o ? o.label : v} <${Icon} name="x" size=${11}/></span>`; })}
    <${Select} value="" placeholder=${"+ " + label} options=${opts.filter((o) => !chosen.includes(o.value))} onChange=${onToggle}/>
  </div>`;
}
