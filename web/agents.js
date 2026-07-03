// Dev Agency dashboard — agents module (split from app.js; Preact + htm, no build step).
import { html, useState } from "/web/vendor/standalone.mjs";
import { Icon, Sheet, AgentModelPicker, api, toast } from "./core.js";


const AGENT_TOOLS = ["Read", "Glob", "Grep", "Bash", "Write", "Edit"];
export function AgentEditor({ data, onClose, onSkills, onOpenModels, reload }) {
  const defs = data.agentDefs || [];
  const blank = { name: "", handle: "", mode: "chat", model: "", tools: ["Read", "Glob", "Grep"], pushesGithub: true, persona: "", defaultTask: "", builtin: false };
  const [sel, setSel] = useState(null); // null = list, "__new__" or a name = edit
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
  const toggleTool = (t) => setForm((f) => Object.assign({}, f, { tools: f.tools.includes(t) ? f.tools.filter((x) => x !== t) : f.tools.concat(t) }));
  function save() {
    if (!form.name) { toast("Name required"); return; }
    setBusy(true);
    api("/agent-def-save", { agentDef: { name: form.name, handle: form.handle || "@" + form.name, mode: form.mode, model: form.model, tools: form.tools, pushesGithub: form.pushesGithub, persona: form.persona, defaultTask: form.defaultTask } })
      .then(() => { toast("Saved"); setSel(null); reload(); }).catch(() => toast("Couldn’t save", "error")).then(() => setBusy(false));
  }
  function del() { setBusy(true); api("/agent-def-delete", { agentName: form.name }).then(() => { toast("Deleted"); setSel(null); reload(); }).catch(() => toast("Couldn’t delete", "error")).then(() => setBusy(false)); }
  return html`<${Sheet} title="Agents" onClose=${onClose}>
    ${sel === null ? html`
      <div class="muted" style="font-size:12px;margin-bottom:8px">Chat agents are interactive — mention their @handle in an issue and they hold a conversation without touching code; the result is posted back to GitHub.</div>
      ${defs.map((d) => html`<button class="agentrow" key=${d.name} onClick=${() => { setSel(d.name); setForm(Object.assign({}, blank, d)); }}>
        <span><b>${d.name}</b> <span class="tagk">${d.handle}</span> <span class="tagk">${d.mode}</span>${d.builtin ? html` <span class="tagk">built-in</span>` : null}</span>
      </button>`)}
      <div class="row" style="margin-top:10px">
        <button class="btn primary" onClick=${() => { setSel("__new__"); setForm(blank); }}><${Icon} name="plus" size=${14}/> New agent</button>
        <button class="btn ghost" onClick=${onSkills}>Manage skills</button>
      </div>
    ` : html`
      <button class="btn ghost" style="margin-bottom:8px" onClick=${() => setSel(null)}><${Icon} name="arrowleft" size=${14}/> Back</button>
      <label>Name</label><input value=${form.name} disabled=${sel !== "__new__"} onInput=${(e) => set("name", e.target.value.replace(/[^\w-]/g, ""))}/>
      <label>Handle</label><input value=${form.handle} placeholder=${"@" + (form.name || "agent")} onInput=${(e) => set("handle", e.target.value)}/>
      <label>Mode</label>
      <select class="modelsel" style="max-width:none;width:100%" value=${form.mode} onChange=${(e) => set("mode", e.target.value)}><option value="chat">chat — interactive, no code changes</option><option value="repo">repo — writes code (advanced)</option></select>
      <label>Model (blank = default / global)</label>
      <${AgentModelPicker} data=${data} value=${form.model || ""} onSetUp=${onOpenModels} onChange=${(v) => set("model", v)}/>
      <label>Tools</label>
      <div class="toolchips">${AGENT_TOOLS.map((t) => html`<label class="toolchip" key=${t}><input type="checkbox" checked=${form.tools.includes(t)} onChange=${() => toggleTool(t)}/> ${t}</label>`)}</div>
      <label class="ckline"><input type="checkbox" checked=${form.pushesGithub} onChange=${(e) => set("pushesGithub", e.target.checked)}/> Post the result to GitHub</label>
      ${(data.skills || []).length ? html`<label>Skills</label>
        <div class="toolchips">${(data.skills || []).map((sk) => html`<label class="toolchip" key=${sk.name} title=${sk.description}><input type="checkbox" checked=${(form.skills || []).includes(sk.name)} onChange=${() => set("skills", (form.skills || []).includes(sk.name) ? (form.skills || []).filter((x) => x !== sk.name) : (form.skills || []).concat(sk.name))}/> ${sk.name}</label>`)}</div>` : null}
      <label>Default task <span class="muted" style="font-weight:400">— pre-fills "what this agent does" when added to a workflow step</span></label>
      <textarea rows="2" style="width:100%" placeholder="e.g. Implement the plan and open a PR." value=${form.defaultTask || ""} onInput=${(e) => set("defaultTask", e.target.value)}></textarea>
      <label>Persona (markdown)</label>
      <textarea rows="10" style="width:100%;font:13px ui-monospace,Menlo,monospace" value=${form.persona} onInput=${(e) => set("persona", e.target.value)}></textarea>
      <div class="row">
        <button class="btn primary" disabled=${busy} onClick=${save}>Save</button>
        ${form.builtin ? null : html`<button class="btn danger" disabled=${busy} onClick=${del}>Delete</button>`}
      </div>
    `}
  <//>`;
}
export function SkillEditor({ data, onClose, reload }) {
  const skills = data.skills || [];
  const blank = { name: "", description: "", body: "" };
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
  function save() { if (!form.name) { toast("Name required"); return; } setBusy(true); api("/skill-save", { skill: form }).then(() => { toast("Saved"); setSel(null); reload(); }).catch(() => toast("Couldn’t save", "error")).then(() => setBusy(false)); }
  function del() { setBusy(true); api("/skill-delete", { skillName: form.name }).then(() => { toast("Deleted"); setSel(null); reload(); }).catch(() => toast("Couldn’t delete", "error")).then(() => setBusy(false)); }
  return html`<${Sheet} title="Skills" onClose=${onClose}>
    ${sel === null ? html`
      <div class="muted" style="font-size:12px;margin-bottom:8px">Reusable skills (Claude Code Agent Skill format: name + description + markdown body). Attach them to agents; the description decides when they apply. The Process Analyzer can author these automatically.</div>
      ${skills.map((sk) => html`<button class="agentrow" key=${sk.name} onClick=${() => { setSel(sk.name); setForm(Object.assign({}, blank, sk)); }}><span><b>${sk.name}</b> <span class="muted" style="font-size:12px">${(sk.description || "").slice(0, 60)}</span></span></button>`)}
      <button class="btn primary" style="margin-top:10px" onClick=${() => { setSel("__new__"); setForm(blank); }}><${Icon} name="plus" size=${14}/> New skill</button>
    ` : html`
      <button class="btn ghost" style="margin-bottom:8px" onClick=${() => setSel(null)}><${Icon} name="arrowleft" size=${14}/> Back</button>
      <label>Name</label><input value=${form.name} disabled=${sel !== "__new__"} onInput=${(e) => set("name", e.target.value.replace(/[^\w-]/g, ""))}/>
      <label>Description (when to use it)</label><input value=${form.description} onInput=${(e) => set("description", e.target.value)}/>
      <label>Body (markdown)</label><textarea rows="12" style="width:100%;font:13px ui-monospace,Menlo,monospace" value=${form.body} onInput=${(e) => set("body", e.target.value)}></textarea>
      <div class="row"><button class="btn primary" disabled=${busy} onClick=${save}>Save</button><button class="btn danger" disabled=${busy} onClick=${del}>Delete</button></div>
    `}
  <//>`;
}
