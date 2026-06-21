// Full-page, flowchart-style workflow builder (Gumloop/Make.com-inspired): a left palette of
// agents/skills/hooks, a canvas of agent step-nodes wired by real SVG connector lines with gate
// badges, and a right inspector for the selected node. Replaces the old form-in-a-sheet editor.
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Avatar, Icon, Modal, Select, ProviderLogo, defaultModelLogo, agentOptions, api, toast, readAttach, Spinner } from "./core.js";

const NODE_W = 216, NODE_H = 158, ROW_GAP = 56, PAD = 28, SIDE = 70, LOOPM = 46;
const STEP_ROLE = { "@plan": "planner", "@arch": "architect", "@dev": "developer", "@review": "reviewer", "@test": "tester" };
const DEFAULT_TASK = { "@plan": "Produce a concrete build plan for this issue.", "@arch": "Turn the plan into a concrete technical design (no code).", "@dev": "Implement the plan; commit and open a PR.", "@review": "Review the PR against the plan and the codebase.", "@test": "Run the project\u2019s checks and fix any failures." };
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
  const [editAgent, setEditAgent] = useState(null); // null | "__new__" | handle
  const [editSkill, setEditSkill] = useState(null);
  const [editHook, setEditHook] = useState(null);
  const canvasRef = useRef(null);
  const flowRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const [cw, setCw] = useState(960);
  useEffect(() => { const el = canvasRef.current; if (!el) return; const m = () => setCw(el.clientWidth || 960); m(); window.addEventListener("resize", m); return () => window.removeEventListener("resize", m); }, [sel]);

  const agentOpts = agentOptions(data && data.agentDefs, []).filter((o) => o.hint !== "workflow");
  const srcFor = (handle) => (agentOpts.find((o) => o.value === handle) || {}).avatarSrc || "";
  const skillOpts = ((data && data.skills) || []).map((s) => ({ value: s.name, label: s.name, desc: s.description || "" }));
  const hookOpts = ((data && data.hooks) || []).map((h) => ({ value: String(h.id), label: (h.target || "hook"), phase: h.phase || "pre" }));

  function open(w) {
    if (!w) { // new — restore an in-progress draft so nothing is lost on close
      let draft = null; try { draft = JSON.parse(localStorage.getItem("wf:draft") || "null"); } catch { draft = null; }
      setForm(draft && draft.form ? draft.form : { id: "", name: "", trigger: "", steps: [blankStep()], gates: [], hooks: [] });
      setSel("__new__"); setStep(draft && Number.isFinite(draft.step) ? draft.step : 0);
      return;
    }
    setForm(JSON.parse(JSON.stringify(w))); setSel(w.id); setStep(0);
  }
  // Persist the working copy of a NEW workflow so leaving the page never loses it.
  useEffect(() => { if (form && !form.id) { try { localStorage.setItem("wf:draft", JSON.stringify({ form, step })); } catch { /* noop */ } } }, [form, step]);
  const clearDraft = () => { try { localStorage.removeItem("wf:draft"); } catch { /* noop */ } };
  function importSkills() {
    const src = window.prompt("Import Claude Code skills from a GitHub repo or marketplace (owner/repo or URL):", "anthropics/skills");
    if (!src) return;
    toast("Importing skills…");
    api("/skill-import", { source: src.trim() }).then((r) => { toast((r && r.imported ? r.imported : 0) + " skill(s) imported"); reload && reload(); }).catch((e) => toast((e && e.message) || "Import failed", "error"));
  }
  const patchStep = (i, p) => setForm((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const addStep = (handle) => setForm((f) => { const steps = f.steps.concat({ ...blankStep(), agent: handle || "@dev" }); setStep(steps.length - 1); return { ...f, steps }; });
  const moveStep = (from, dropSlot) => setForm((f) => {
    const insertAt = dropSlot > from ? dropSlot - 1 : dropSlot;
    if (insertAt === from) return f;
    const idxs = f.steps.map((_, i) => i);
    const [xi] = idxs.splice(from, 1);
    idxs.splice(insertAt, 0, xi);
    const remap = {}; idxs.forEach((old, np) => { remap[old] = np; });
    const steps = idxs.map((old) => f.steps[old]);
    const gates = (f.gates || []).map((g) => { const ng = { ...g, after: remap[g.after] }; if (ng.route && ng.route.startsWith("loop")) { const t = Number(ng.route.split(":")[1]); if (Number.isFinite(t) && remap[t] != null) ng.route = "loop:" + remap[t]; } return ng; }).filter((g) => g.after != null);
    setStep(insertAt);
    return { ...f, steps, gates };
  });
  const dropSlotFromY = (clientY) => { const el = flowRef.current; if (!el) return null; const top = el.getBoundingClientRect().top; const y = clientY - top - PAD; return Math.max(0, Math.min(steps.length, Math.round(y / (NODE_H + ROW_GAP)))); };
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
      const keep = next.route !== "continue" || next.condition === "humanApproval";
      if (!keep) gates = gates.filter((g) => g.after !== i);      // plain continue = no gate
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
      .then(() => { toast("Saved"); clearDraft(); setSel(null); reload && reload(); })
      .catch((e) => toast((e && e.message) || "Couldn’t save", "error"))
      .finally(() => setSaving(false));
  }
  function duplicateWf(w) {
    const base = (w.name || "workflow").replace(/ \(copy.*$/, "");
    const id = (base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "wf") + "-copy-" + Date.now().toString(36).slice(-4);
    api("/workflow-save", { workflow: { id, name: base + " (copy)", trigger: "@" + id, steps: w.steps || [], gates: w.gates || [], hooks: w.hooks || [] } }).then(() => { toast("Duplicated"); reload && reload(); }).catch(() => toast("Couldn’t duplicate", "error"));
  }
  function duplicateAgent(a) {
    const base = (a.name || "agent").replace(/-copy.*$/, "");
    const name = (base + "-copy-" + Date.now().toString(36).slice(-3)).replace(/[^\w-]/g, "");
    api("/agent-def-save", { agentDef: { name, handle: "@" + name, mode: a.mode, model: a.model, tools: a.tools, persona: a.persona, defaultTask: a.defaultTask, avatar: a.avatar, pushesGithub: a.pushesGithub !== false } }).then(() => { toast("Duplicated"); reload && reload(); }).catch(() => toast("Couldn’t duplicate", "error"));
  }
  function delAgent(a) {
    if (!window.confirm("Delete agent " + a.name + "?")) return;
    api("/agent-def-delete", { agentName: a.name }).then(() => { toast("Deleted"); reload && reload(); }).catch(() => toast("Couldn’t delete", "error"));
  }
  function delWf(w) {
    if (!window.confirm("Delete " + (w.name || "workflow") + "?")) return;
    api("/workflow-delete", { workflowId: w.id }).then(() => { toast("Deleted"); reload && reload(); }).catch(() => toast("Couldn’t delete", "error"));
  }
  function del() {
    if (!form.id || !window.confirm("Delete " + (form.name || "workflow") + "?")) return;
    api("/workflow-delete", { workflowId: form.id }).then(() => { toast("Deleted"); clearDraft(); setSel(null); reload && reload(); });
  }

  // ---------- workflow list ----------
  if (!form) {
    return html`<div class="bld">
      <div class="bld-top">
        <button class="iconbtn" onClick=${onClose} aria-label="Close"><${Icon} name="x" size=${18}/></button>
        <div class="bld-title">Workflow & agent manager</div>
        <div style="flex:1"></div>
      </div>
      <div class="bld-listwrap">
        <div class="bld-sec-head"><span>Workflows</span><button class="btn" onClick=${() => open(null)}><${Icon} name="plus" size=${14}/> New workflow</button></div>
        ${wfs.length === 0 ? html`<div class="bld-empty sm">No workflows yet.</div>` : null}
        <div class="bld-grid">
          ${wfs.map((w) => html`<div class="bld-card" key=${w.id} onClick=${() => open(w)}>
            <div class="bld-card-h"><span class="bld-trig">${w.trigger || "@" + w.id}</span>${w.builtin ? html`<span class="bld-builtin">built-in</span>` : null}
              <span class="bld-card-acts" onClick=${(e) => e.stopPropagation()}>
                <button class="iconbtn-sm tip" data-tip="Duplicate" onClick=${() => duplicateWf(w)}><${Icon} name="copy" size=${14}/></button>
                ${w.builtin ? null : html`<button class="iconbtn-sm tip danger" data-tip="Delete" onClick=${() => delWf(w)}><${Icon} name="trash" size=${14}/></button>`}
              </span>
            </div>
            <div class="bld-card-name">${w.name}</div>
            <div class="bld-card-flow">${(w.steps || []).map((s, i) => html`${i ? html`<${Icon} name="chevron" size=${12}/>` : null}<${Avatar} role=${roleFor(agentOf(s))} size=${22} crop="head"/>`)}</div>
            <div class="bld-card-meta">${(w.steps || []).length} step${(w.steps || []).length === 1 ? "" : "s"}${(w.gates || []).length ? ` · ${w.gates.length} gate${w.gates.length === 1 ? "" : "s"}` : ""}</div>
          </div>`)}
        </div>

        <div class="bld-sec-head"><span>Agents</span><button class="btn" onClick=${() => setEditAgent("__new__")}><${Icon} name="plus" size=${14}/> New agent</button></div>
        <div class="bld-grid">
          ${(data && data.agentDefs || []).length === 0 ? html`<div class="bld-empty sm">No custom agents yet. The built-in roles (planner/developer/…) are always available.</div>` : null}
          ${(data && data.agentDefs || []).map((a) => html`<div class="bld-card agent" key=${a.name} onClick=${() => setEditAgent(a.handle || "@" + a.name)}>
            <div class="bld-card-h"><${Avatar} role=${a.name} src=${a.avatar} size=${30} crop="head"/><span class="bld-card-acts" onClick=${(e) => e.stopPropagation()}>
              <button class="iconbtn-sm tip" data-tip="Duplicate" onClick=${() => duplicateAgent(a)}><${Icon} name="copy" size=${14}/></button>
              <button class="iconbtn-sm tip danger" data-tip="Delete" onClick=${() => delAgent(a)}><${Icon} name="trash" size=${14}/></button>
            </span></div>
            <div class="bld-card-name">${a.name}</div>
            <div class="bld-card-meta">${a.handle || "@" + a.name} · ${a.mode || "repo"}</div>
          </div>`)}
        </div>

        <div class="bld-sec-head"><span>Skills</span><span style="display:flex;gap:6px"><button class="btn" onClick=${importSkills}><${Icon} name="download" size=${14}/> Import</button><button class="btn" onClick=${() => setEditSkill("__new__")}><${Icon} name="plus" size=${14}/> New skill</button></span></div>
        <div class="bld-grid">
          ${(data && data.skills || []).length === 0 ? html`<div class="bld-empty sm">No skills yet — import a set or add one.</div>` : null}
          ${(data && data.skills || []).map((sk) => html`<div class="bld-card" key=${sk.name} onClick=${() => setEditSkill(sk.name)}>
            <div class="bld-card-h"><span class="bld-trig sk"><${Icon} name="sparkles" size=${12}/> skill</span><span class="bld-card-acts" onClick=${(e) => e.stopPropagation()}>
              <button class="iconbtn-sm tip" data-tip="Duplicate" onClick=${() => { const name = (sk.name + "-copy").replace(/[^\w-]/g, ""); api("/skill-save", { skill: { name, description: sk.description, body: sk.body } }).then(() => { toast("Duplicated"); reload && reload(); }); }}><${Icon} name="copy" size=${14}/></button>
              <button class="iconbtn-sm tip danger" data-tip="Delete" onClick=${() => { if (window.confirm("Delete skill " + sk.name + "?")) api("/skill-delete", { skillName: sk.name }).then(() => { toast("Deleted"); reload && reload(); }); }}><${Icon} name="trash" size=${14}/></button>
            </span></div>
            <div class="bld-card-name">${sk.name}</div>
            <div class="bld-card-meta">${sk.description || "No description"}</div>
          </div>`)}
        </div>

        <div class="bld-sec-head"><span>Hooks</span><button class="btn" onClick=${() => setEditHook("__new__")}><${Icon} name="plus" size=${14}/> New hook</button></div>
        <div class="bld-grid">
          ${(data && data.hooks || []).length === 0 ? html`<div class="bld-empty sm">No hooks yet.</div>` : null}
          ${(data && data.hooks || []).map((h) => html`<div class="bld-card" key=${h.id} onClick=${() => setEditHook(String(h.id))}>
            <div class="bld-card-h"><span class=${"bld-hk-phase " + (h.phase || "post")}>${h.phase || "post"}</span><span class="bld-card-acts" onClick=${(e) => e.stopPropagation()}>
              <button class="iconbtn-sm tip" data-tip="Duplicate" onClick=${() => api("/hook-save", { hook: { target: (h.target || "hook") + " copy", phase: h.phase, command: h.command, enabled: true } }).then(() => { toast("Duplicated"); reload && reload(); })}><${Icon} name="copy" size=${14}/></button>
              <button class="iconbtn-sm tip danger" data-tip="Delete" onClick=${() => { if (window.confirm("Delete this hook?")) api("/hook-delete", { hookId: h.id }).then(() => { toast("Deleted"); reload && reload(); }); }}><${Icon} name="trash" size=${14}/></button>
            </span></div>
            <div class="bld-card-name">${h.target || "hook"}</div>
            <div class="bld-card-meta" style="font-family:ui-monospace,Menlo,monospace;font-size:11px">${(h.command || "").slice(0, 80)}</div>
          </div>`)}
        </div>
      </div>
      ${editAgent ? html`<${AgentModal} data=${data} which=${editAgent} onClose=${() => setEditAgent(null)} reload=${reload}/>` : null}
      ${editSkill ? html`<${SkillModal} data=${data} which=${editSkill} onClose=${() => setEditSkill(null)} reload=${reload}/>` : null}
      ${editHook ? html`<${HookModal} data=${data} which=${editHook} onClose=${() => setEditHook(null)} reload=${reload}/>` : null}
    </div>`;
  }

  // ---------- canvas editor ----------
  const steps = form.steps || [];
  const cur = steps[step] || steps[0];
  // Vertical layout: a single top-to-bottom column. Pre-hooks sit on the LEFT of each agent, post
  // hooks on the RIGHT; loop-backs arc up the right gutter and point into their target.
  const hookPhase = Object.fromEntries(hookOpts.map((h) => [h.value, h.phase]));
  const slots = steps.length + 1; // +1 for the "add step" tile
  const nLoops = (form.gates || []).filter((g) => g.route && g.route.startsWith("loop")).length;
  const flowW = PAD * 2 + SIDE + NODE_W + SIDE + LOOPM + nLoops * 16;
  const cx = PAD + SIDE + NODE_W / 2;        // node centre x
  const nodeY = (i) => PAD + i * (NODE_H + ROW_GAP);
  const midY = (i) => nodeY(i) + NODE_H / 2;
  const gridW = Math.max(flowW, cw - 4);
  const gridH = PAD * 2 + slots * NODE_H + (slots - 1) * ROW_GAP;
  const ox = (gridW - flowW) / 2;            // centre the column when the canvas is wider
  const C = cx + ox;                          // centred node centre
  const downPath = (i) => { const y1 = nodeY(i) + NODE_H, y2 = nodeY(i + 1); const my = (y1 + y2) / 2; return `M ${C} ${y1} C ${C} ${my}, ${C} ${my}, ${C} ${y2}`; };

  return html`<div class="bld">
    <div class="bld-top">
      <input class="bld-name" value=${form.name} placeholder="Workflow name" onInput=${(e) => { const name = e.target.value; const trig = "@" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24); setForm((f) => ({ ...f, name, trigger: trig })); }}/>
      <span class="bld-trig">${form.trigger || "@" + (form.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "@new"}</span>
      <div style="flex:1"></div>
      <button class="btn" onClick=${() => { clearDraft(); setSel(null); setForm(null); }}>Cancel</button>
      <button class="btn primary" disabled=${saving} onClick=${save}>${saving ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="check" size=${15}/>`} Save</button>
    </div>

    <div class="bld-body">
      <!-- canvas -->
      <div class="bld-canvas" ref=${canvasRef}>
        <div class="bld-flow" ref=${flowRef} style=${"width:" + gridW + "px;height:" + gridH + "px"}
          onDragOver=${(e) => { if (drag == null) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropAt(dropSlotFromY(e.clientY)); }}
          onDrop=${(e) => { if (drag == null) return; e.preventDefault(); const slot = dropSlotFromY(e.clientY); if (slot != null) moveStep(drag, slot); setDrag(null); setDropAt(null); }}
          onDragLeave=${(e) => { if (e.target === flowRef.current) setDropAt(null); }}>
          <svg class="bld-wires" width=${gridW} height=${gridH} aria-hidden="true">
            <defs><marker id="bld-arrow" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--line-2)"/></marker><marker id="bld-loop" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--amber)"/></marker></defs>
            ${steps.slice(0, -1).map((_, i) => html`<path key=${i} d=${downPath(i)} fill="none" stroke="var(--line-2)" stroke-width="2" marker-end="url(#bld-arrow)"/>`)}
            ${steps.length ? html`<path key="toadd" d=${downPath(steps.length - 1)} fill="none" stroke="var(--line)" stroke-width="2" stroke-dasharray="3 4"/>` : null}
            ${(form.gates || []).filter((g) => g.route && g.route.startsWith("loop")).map((g, k) => { const t = Number(g.route.split(":")[1]); if (!Number.isFinite(t) || t === g.after || g.after >= steps.length || t >= steps.length) return null; const rx = C + NODE_W / 2, sy = midY(g.after), ty = midY(t), lx = C + NODE_W / 2 + LOOPM + k * 16; const r = 9, up = ty < sy; const d = `M ${rx} ${sy} H ${lx - r} Q ${lx} ${sy} ${lx} ${sy + (up ? -r : r)} V ${ty + (up ? r : -r)} Q ${lx} ${ty} ${lx - r} ${ty} H ${rx}`; const cond = (CONDITIONS.find((c) => c.value === g.condition) || {}).label || g.condition || "a condition"; const reason = `Loops back to step ${t + 1} if ${cond.toLowerCase()} (max ${g.maxLoops || 2}×)`; return html`<path key=${"loop" + k} d=${d} fill="none" stroke="var(--line-2)" stroke-width="2" stroke-dasharray="5 5" stroke-linejoin="round" marker-end="url(#bld-arrow)"><title>${reason}</title></path>`; })}
          </svg>
          ${drag != null && dropAt != null ? html`<div class="bld-drop" style=${"left:" + (C - NODE_W / 2 - SIDE) + "px;top:" + (PAD + dropAt * (NODE_H + ROW_GAP) - ROW_GAP / 2 - 1) + "px;width:" + (NODE_W + SIDE * 2) + "px"}></div>` : null}
          ${steps.map((s, i) => {
            const y = nodeY(i), left = C - NODE_W / 2;
            const g = gateAfter(i);
            const hrow = (phase) => { const on = (s.hooks || []).filter((h) => (hookPhase[h] || "pre") === phase); const avail = hookOpts.filter((h) => h.phase === phase && !(s.hooks || []).includes(h.value)); return html`<div class=${"bld-hrow " + phase} onClick=${(e) => e.stopPropagation()}>
                <span class="bld-hlbl">${phase}</span>
                ${on.map((h) => { const ho = hookOpts.find((x) => x.value === h); return html`<span class="bld-hk" key=${h} title=${ho ? ho.label : h}>${ho ? ho.label : h}<button onClick=${() => toggleChip(i, "hooks", h)} aria-label="remove"><${Icon} name="x" size=${9}/></button></span>`; })}
                <${Select} value="" options=${avail} menuAlign=${phase === "post" ? "right" : null} onChange=${(v) => v && toggleChip(i, "hooks", v)} btnClass="bld-hadd" trigger=${() => html`<${Icon} name="plus" size=${11}/>`}/>
              </div>`; };
            return html`<div key=${"n" + i}>
              <div class=${"bld-node" + (i === step ? " sel" : "") + (i === drag ? " dragging" : "")} draggable=${true} onDragStart=${(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch (_) {} }} onDragEnd=${() => { setDrag(null); setDropAt(null); }} style=${"left:" + left + "px;top:" + y + "px;width:" + NODE_W + "px"} onClick=${() => setStep(i)}>
                <span class="bld-grip" title="Drag to reorder"><${Icon} name="grip" size=${14}/></span>
                ${hrow("pre")}
                <div class="bld-node-h"><span class="bld-node-num">${i + 1}</span><${Avatar} role=${roleFor(agentOf(s))} src=${srcFor(agentOf(s))} size=${26} crop="head"/><${Select} value=${agentOf(s)} options=${agentOpts} onChange=${(v) => patchStep(i, { agent: v })} btnClass="bld-agentsel" trigger=${(c) => html`<span class="bld-node-name">${c ? c.label : labelFor(agentOf(s), agentOpts)}</span><${Icon} name="chevdown" size=${12} cls="bld-agentsel-c"/>`}/></div>
                <div class="bld-node-task">${(s.instruction || "").split("\n")[0] || html`<span class="ph">describe this step…</span>`}</div>
                <div class="bld-srow" onClick=${(e) => e.stopPropagation()}>
                  <span class="bld-hlbl sk"><${Icon} name="sparkles" size=${9}/></span>
                  ${(s.skills || []).map((sk) => { const so = skillOpts.find((x) => x.value === sk); return html`<span class="bld-hk" key=${sk} title=${so ? so.desc : sk}>${so ? so.label : sk}<button onClick=${() => toggleChip(i, "skills", sk)} aria-label="remove"><${Icon} name="x" size=${9}/></button></span>`; })}
                  <${Select} value="" options=${skillOpts.filter((x) => !(s.skills || []).includes(x.value))} onChange=${(v) => v && toggleChip(i, "skills", v)} btnClass="bld-hadd" trigger=${() => html`<${Icon} name="plus" size=${11}/>`}/>
                </div>
                <div class="bld-node-tags">${s.model ? html`<span class="t"><${ProviderLogo} name="claude" size=${10}/></span>` : null}${g ? html`<span class=${"t " + (g.condition === "humanApproval" ? "approve" : g.route && g.route.startsWith("loop") ? "loop" : "stop")}>${g.condition === "humanApproval" ? html`<${Icon} name="hourglass" size=${10}/> approval` : g.route && g.route.startsWith("loop") ? html`<${Icon} name="refresh" size=${10}/> loop` : html`<${Icon} name="stop" size=${10}/> stop`}</span>` : null}</div>
                ${hrow("post")}
              </div>
            </div>`;
          })}
          ${(form.gates || []).map((g, k) => { const i = g.after; if (i == null || i >= steps.length) return null; const isApproval = g.condition === "humanApproval"; const isStop = g.route === "stop"; if (!isApproval && !isStop) return null; const y = nodeY(i) + NODE_H + ROW_GAP / 2 - 12; return html`<div key=${"mk" + k} class=${"bld-flowmark " + (isApproval ? "approve" : "stop")} style=${"left:" + (C - 64) + "px;top:" + y + "px"}>${isApproval ? html`<${Icon} name="hourglass" size=${12}/> waits for you` : html`<${Icon} name="stop" size=${12}/> ends here`}</div>`; })}
          ${(() => { const y = nodeY(steps.length), left = C - NODE_W / 2; return html`<button class="bld-add" style=${"left:" + left + "px;top:" + y + "px;width:" + NODE_W + "px;height:" + NODE_H + "px"} onClick=${() => addStep("@dev")} title="Add step"><${Icon} name="plus" size=${22}/><span>Add step</span></button>`; })()}
        </div>
      </div>

      <!-- inspector -->
      <div class="bld-insp">
        ${cur ? html`
          <div class="bld-insp-h">
            <${Avatar} role=${roleFor(agentOf(cur))} src=${srcFor(agentOf(cur))} size=${30} crop="head"/>
            <div style="flex:1;min-width:0">
              <div class="bld-insp-name">${labelFor(agentOf(cur), agentOpts)}</div>
              <button class="bld-link" onClick=${() => setEditAgent(agentOf(cur))}>Edit agent profile →</button>
            </div>
            <button class="iconbtn" title="Remove step" onClick=${() => removeStep(step)} disabled=${steps.length <= 1}><${Icon} name="trash" size=${15}/></button>
          </div>
          <label class="bld-lbl">Special instructions <span class="bld-hint">(optional)</span></label>
          <textarea class="bld-ta" rows="3" placeholder=${"Leave blank to use " + labelFor(agentOf(cur), agentOpts) + "’s default task. Add only extra/override instructions for this step."} value=${cur.instruction} onInput=${(e) => patchStep(step, { instruction: e.target.value })}></textarea>
          <label class="bld-lbl">Model</label>
          <${Select} value=${cur.model || ""} options=${[{ value: "", label: "Default", logo: defaultModelLogo(data) }].concat(modelOpts(data))} onChange=${(v) => patchStep(step, { model: v })}/>
          ${html`
            <label class="bld-lbl">When this step finishes</label>
            <${Select} value=${(() => { const g = gateAfter(step); return !g ? "continue" : g.condition === "humanApproval" ? "approve" : g.route && g.route.startsWith("loop") ? "loop" : "stop"; })()} options=${[{ value: "continue", label: "Continue to next →" }, { value: "approve", label: "⏸ Pause for my approval" }, { value: "loop", label: "Loop back if…" }, { value: "stop", label: "Stop the workflow" }]} onChange=${(v) => v === "continue" ? setGate(step, { route: "continue", condition: "review:changes" }) : v === "approve" ? setGate(step, { condition: "humanApproval", route: "continue" }) : v === "stop" ? setGate(step, { route: "stop", condition: "review:changes" }) : setGate(step, { route: "loop:" + Math.max(0, step - 1), condition: ((gateAfter(step) || {}).condition === "humanApproval" ? "review:changes" : (gateAfter(step) || {}).condition) || "review:changes" })}/>
            ${gateAfter(step) && gateAfter(step).route && gateAfter(step).route.startsWith("loop") && gateAfter(step).condition !== "humanApproval" ? html`
              <label class="bld-lbl">…if</label>
              <${Select} value=${gateAfter(step).condition} options=${CONDITIONS} onChange=${(v) => setGate(step, { condition: v })}/>
              <label class="bld-lbl">Loop back to</label>
              <${Select} value=${String(Number(gateAfter(step).route.split(":")[1]))} options=${steps.slice(0, step).map((s2, j) => ({ value: String(j), label: (j + 1) + ". " + labelFor(agentOf(s2), agentOpts) }))} onChange=${(v) => setGate(step, { route: "loop:" + v })}/>
              <label class="bld-lbl">Max revise rounds</label>
              <input type="number" min="1" max="5" class="bld-num" value=${gateAfter(step).maxLoops ?? 2} onInput=${(e) => setGate(step, { maxLoops: Math.max(1, Number(e.target.value) || 1) })}/>
            ` : null}
          `}
        ` : html`<div class="bld-empty">Add a step to begin.</div>`}
        <div class="bld-insp-wf">
          <label class="bld-lbl">Workflow hooks <span class="bld-hint">(whole run)</span></label>
          <div class="bld-chips">
            ${(form.hooks || []).map((h) => { const ho = hookOpts.find((x) => x.value === h); return html`<span class="bld-chip" key=${"wf" + h}>${ho ? ho.phase + " · " + ho.label : h}<button onClick=${() => setForm((f2) => ({ ...f2, hooks: (f2.hooks || []).filter((x) => x !== h) }))} aria-label="remove"><${Icon} name="x" size=${10}/></button></span>`; })}
            <${Select} value="" options=${hookOpts.filter((x) => !(form.hooks || []).includes(x.value))} menuAlign="right" onChange=${(v) => v && setForm((f2) => ({ ...f2, hooks: (f2.hooks || []).concat(v) }))} btnClass="bld-hadd" trigger=${() => html`<${Icon} name="plus" size=${11}/>`}/>
          </div>
        </div>
      </div>
    </div>
    ${editAgent ? html`<${AgentModal} data=${data} which=${editAgent} onClose=${() => setEditAgent(null)} reload=${reload}/>` : null}
  </div>`;
}

function AgentModal({ data, which, onClose, reload }) {
  const defs = (data && data.agentDefs) || [];
  const existing = which === "__new__" ? null : defs.find((d) => (d.handle || ("@" + d.name)) === which || ("@" + d.name) === which || d.name === String(which).replace(/^@/, ""));
  const ROLE_NAMES = { "@plan": "planner", "@arch": "architect", "@dev": "developer", "@review": "reviewer", "@test": "tester" };
  const roleSeed = !existing && ROLE_NAMES[which] ? { name: ROLE_NAMES[which], handle: which, mode: "repo", model: "", tools: ["Read", "Glob", "Grep"], persona: "", defaultTask: DEFAULT_TASK[which] || "", avatar: "", pushesGithub: true } : null;
  const TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"];
  const [f, setF] = useState(existing ? Object.assign({ defaultTask: "", avatar: "", tools: [] }, existing) : roleSeed || { name: "", handle: "", mode: "repo", model: "", tools: ["Read", "Glob", "Grep"], persona: "", defaultTask: "", avatar: "", pushesGithub: true });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => Object.assign({}, o, { [k]: v }));
  const toggleTool = (t) => setF((o) => Object.assign({}, o, { tools: (o.tools || []).includes(t) ? o.tools.filter((x) => x !== t) : (o.tools || []).concat(t) }));
  function pickAvatar(e) { const file = (e.target.files || [])[0]; if (!file) return; readAttach(file, (a) => { api("/upload-file", { repo: "_agents", number: -1, dataUrl: a.d, name: (f.name || "avatar") }).then((j) => { if (j && j.url) set("avatar", j.url); else toast("Upload failed", "error"); }).catch(() => toast("Upload failed", "error")); }); e.target.value = ""; }
  function save() { if (!f.name.trim()) { toast("Name required"); return; } setBusy(true); api("/agent-def-save", { agentDef: { name: f.name.trim(), handle: f.handle || "@" + f.name.trim(), mode: f.mode, model: f.model, tools: f.tools, persona: f.persona, defaultTask: f.defaultTask, avatar: f.avatar, pushesGithub: f.pushesGithub !== false } }).then(() => { toast("Agent saved"); reload && reload(); onClose(); }).catch((e) => toast((e && e.message) || "Couldn’t save", "error")).then(() => setBusy(false)); }
  const footer = html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy} onClick=${save}>${busy ? html`<${Spinner} size=${14}/>` : "Save agent"}</button>`;
  return html`<${Modal} title=${existing ? "Edit agent" : roleSeed ? "Edit " + roleSeed.name : "New agent"} onClose=${onClose} footer=${footer}>
    <div class="agm-top">
      <label class="agm-avatar" title="Upload a custom avatar">
        ${f.avatar ? html`<img src=${f.avatar}/>` : html`<${Avatar} role=${f.name || "agent"} size=${56} crop="head"/>`}
        <span class="agm-avatar-edit"><${Icon} name="upload" size=${13}/></span>
        <input type="file" accept="image/*" style="display:none" onChange=${pickAvatar}/>
      </label>
      <div style="flex:1;min-width:0">
        <label class="bld-lbl">Name</label>
        <input class="bld-num" value=${f.name} disabled=${!!existing || !!roleSeed} placeholder="e.g. spec-creator" onInput=${(e) => set("name", e.target.value.replace(/[^\w-]/g, ""))}/>
        <label class="bld-lbl">Handle</label>
        <input class="bld-num" value=${f.handle} placeholder=${"@" + (f.name || "agent")} onInput=${(e) => set("handle", e.target.value)}/>
      </div>
    </div>
    <label class="bld-lbl">Mode</label>
    <${Select} value=${f.mode} options=${[{ value: "repo", label: "repo — writes code" }, { value: "chat", label: "chat — conversation, no code" }]} onChange=${(v) => set("mode", v)}/>
    <label class="bld-lbl">Model <span class="bld-hint">(blank = default)</span></label>
    <input class="bld-num" value=${f.model} placeholder="e.g. glm-5.1, or blank" onInput=${(e) => set("model", e.target.value)}/>
    <label class="bld-lbl">Default task <span class="bld-hint">— pre-fills a workflow step</span></label>
    <textarea class="bld-ta" rows="2" value=${f.defaultTask} placeholder="e.g. Implement the plan and open a PR." onInput=${(e) => set("defaultTask", e.target.value)}></textarea>
    <label class="bld-lbl">Tools</label>
    <div class="agm-tools">${TOOLS.map((t) => html`<label class=${"agm-tool" + ((f.tools || []).includes(t) ? " on" : "")} key=${t}><input type="checkbox" checked=${(f.tools || []).includes(t)} onChange=${() => toggleTool(t)}/> ${t}</label>`)}</div>
    <label class="bld-lbl">Persona <span class="bld-hint">(markdown)</span></label>
    <textarea class="bld-ta" rows="6" value=${f.persona} placeholder="How this agent thinks and behaves…" onInput=${(e) => set("persona", e.target.value)}></textarea>
  <//>`;
}

function SkillModal({ data, which, onClose, reload }) {
  const skills = (data && data.skills) || [];
  const existing = which === "__new__" ? null : skills.find((sk) => sk.name === which);
  const [f, setF] = useState(existing ? Object.assign({}, existing) : { name: "", description: "", body: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => Object.assign({}, o, { [k]: v }));
  function save() { if (!/^[\w-]+$/.test(f.name || "")) { toast("Name: letters/numbers/-/_"); return; } setBusy(true); api("/skill-save", { skill: { name: f.name, description: f.description, body: f.body } }).then(() => { toast("Skill saved"); reload && reload(); onClose(); }).catch((e) => toast((e && e.message) || "Couldn’t save", "error")).then(() => setBusy(false)); }
  const footer = html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy} onClick=${save}>${busy ? html`<${Spinner} size=${14}/>` : "Save skill"}</button>`;
  return html`<${Modal} title=${existing ? "Edit skill" : "New skill"} onClose=${onClose} footer=${footer}>
    <label class="bld-lbl">Name</label>
    <input class="bld-num" value=${f.name} disabled=${!!existing} placeholder="e.g. conventional-commits" onInput=${(e) => set("name", e.target.value.replace(/[^\w-]/g, "-"))}/>
    <label class="bld-lbl">Description</label>
    <input class="bld-num" value=${f.description} placeholder="What this skill does" onInput=${(e) => set("description", e.target.value)}/>
    <label class="bld-lbl">Body <span class="bld-hint">(markdown — injected into the agent’s context)</span></label>
    <textarea class="bld-ta" rows="8" value=${f.body} onInput=${(e) => set("body", e.target.value)}></textarea>
  <//>`;
}

function HookModal({ data, which, onClose, reload }) {
  const hooks = (data && data.hooks) || [];
  const existing = which === "__new__" ? null : hooks.find((h) => String(h.id) === String(which));
  const [f, setF] = useState(existing ? Object.assign({}, existing) : { target: "", phase: "post", command: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => Object.assign({}, o, { [k]: v }));
  function save() { if (!(f.target || "").trim() || !(f.command || "").trim()) { toast("Name + command required"); return; } setBusy(true); api("/hook-save", { hook: Object.assign(existing ? { id: existing.id } : {}, { target: f.target.trim(), phase: f.phase, command: f.command, enabled: true }) }).then(() => { toast("Hook saved"); reload && reload(); onClose(); }).catch((e) => toast((e && e.message) || "Couldn’t save", "error")).then(() => setBusy(false)); }
  const footer = html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy} onClick=${save}>${busy ? html`<${Spinner} size=${14}/>` : "Save hook"}</button>`;
  return html`<${Modal} title=${existing ? "Edit hook" : "New hook"} onClose=${onClose} footer=${footer}>
    <label class="bld-lbl">Name</label>
    <input class="bld-num" value=${f.target} placeholder="e.g. format (prettier)" onInput=${(e) => set("target", e.target.value)}/>
    <label class="bld-lbl">Phase</label>
    <${Select} value=${f.phase} options=${[{ value: "pre", label: "pre — runs before the step" }, { value: "post", label: "post — runs after the step" }]} onChange=${(v) => set("phase", v)}/>
    <label class="bld-lbl">Command <span class="bld-hint">(shell, runs in the repo)</span></label>
    <textarea class="bld-ta" rows="3" style="font-family:ui-monospace,Menlo,monospace" value=${f.command} placeholder="npx prettier --write . || true" onInput=${(e) => set("command", e.target.value)}></textarea>
  <//>`;
}

function modelOpts(data) {
  const providers = (data && data.providers) || [];
  return providers.flatMap((p) => (p.models || []).map((m) => ({ value: p.id + "/" + m, label: p.name + " · " + m, logo: p.name })));
}
