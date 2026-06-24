// Dev Agency dashboard — repo Orchestrator chat (v4). The conversational front door: think out loud
// with an agent that knows the repo; when an idea is ready it proposes scoped work you confirm into
// PLANNED, by-agent issues. The user stays in control — nothing starts without your say-so.
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Avatar, Icon, Spinner, api, getJSON, md, toast } from "./core.js";
import { statusField } from "./table.js";

const WF_LABEL = { "quick-fix": "Quick fix", "full-build": "Full build", "plan-only": "Plan only", "split": "Split into epics" };
const WF_HINT = { "quick-fix": "one developer pass", "full-build": "plan → dev → test → review", "plan-only": "a plan to review, no code", "split": "several ordered epics" };

// The confirmable handoff card attached to an orchestrator message. The workflow is editable here —
// that's the manual override: accept the agent's pick, or choose exactly how it should run.
function ProposalCard({ repo, proposal, reload, onOpenIssue }) {
  const [wf, setWf] = useState(proposal.workflow || "full-build");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const issues = proposal.issues || [];
  if (created) {
    return html`<div class="oprop oprop-done">
      <div class="oprop-h"><${Icon} name="check" size=${15}/> Created ${created.length} issue${created.length > 1 ? "s" : ""} in Planned</div>
      <div class="oprop-created">${created.map((c) => html`<button class="oprop-link" key=${c.number} onClick=${() => onOpenIssue && onOpenIssue(repo, c.number, c.title)}>#${c.number} ${c.title}</button>`)}</div>
      <div class="oprop-foot">Review each and press ▶ Start in the List when you're ready.</div>
    </div>`;
  }
  function create() {
    if (busy) return; setBusy(true);
    api("/orch-handoff", { repo, workflow: wf, issues }).then((r) => {
      setCreated(r.created || []);
      toast("Created " + ((r.created || []).length) + " issue(s) in Planned");
      reload && reload();
    }).catch((e) => toast((e && e.message) || "Couldn't create the issues", "error")).finally(() => setBusy(false));
  }
  return html`<div class="oprop">
    <div class="oprop-h"><${Icon} name="sparkles" size=${15}/> Proposed work</div>
    <div class="oprop-wf">
      <label>Workflow</label>
      <select value=${wf} onChange=${(e) => setWf(e.target.value)}>
        ${Object.keys(WF_LABEL).map((k) => html`<option key=${k} value=${k}>${WF_LABEL[k]} — ${WF_HINT[k]}</option>`)}
      </select>
    </div>
    <ol class="oprop-list">
      ${issues.map((it, n) => html`<li key=${n}><span class="oprop-t">${it.title}</span>${it.scope ? html`<span class="oprop-s">${it.scope}</span>` : null}</li>`)}
    </ol>
    <div class="oprop-actions">
      <button class="btn primary" disabled=${busy} onClick=${create}>${busy ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="rocket" size=${14}/>`} Create ${issues.length} issue${issues.length > 1 ? "s" : ""} in Planned</button>
    </div>
    <div class="oprop-foot">They land as <b>Planned</b> (tagged <i>by agent</i>) — nothing runs until you start it.</div>
  </div>`;
}

function Bubble({ m, repo, reload, onOpenIssue }) {
  const isUser = m.role === "user";
  const proposal = m.meta && m.meta.proposal ? m.meta.proposal : null;
  return html`<div class=${"obub " + (isUser ? "obub-user" : "obub-orch")}>
    ${isUser ? null : html`<span class="obub-av"><${Avatar} role="auditor" size=${26} crop="head"/></span>`}
    <div class="obub-body">
      <div class="obub-txt" dangerouslySetInnerHTML=${isUser ? undefined : { __html: md(m.text || "") }}>${isUser ? m.text : null}</div>
      ${proposal ? html`<${ProposalCard} repo=${repo} proposal=${proposal} reload=${reload} onOpenIssue=${onOpenIssue}/>` : null}
    </div>
  </div>`;
}

export function Orchestrator({ repos, repoFilter, setRepoFilter, reload, onOpenIssue, issues = [], onAnalyze, auditRepos = [] }) {
  const repo = repoFilter || "*"; // "*" = agency-wide chat across all repos
  const isAgency = repo === "*";
  const repoLabel = isAgency ? "all repositories" : repo.split("/").pop();
  const [thread, setThread] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    if (!repo) return;
    setLoading(true);
    getJSON("/orch?repo=" + encodeURIComponent(repo)).then((d) => setThread(d.thread || [])).catch(() => setThread([])).finally(() => setLoading(false));
  }, [repo]);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread, busy]);

  function send() {
    const text = draft.trim();
    if (!text || busy || !repo) return;
    setDraft("");
    if (taRef.current) taRef.current.style.height = "auto";
    setThread((t) => t.concat({ id: "tmp-" + Date.now(), role: "user", text }));
    setBusy(true);
    api("/orch-chat", { repo, body: text })
      .then((r) => setThread(r.thread || []))
      .catch((e) => { toast((e && e.message) || "Orchestrator failed", "error"); setThread((t) => t.concat({ id: "err" + Date.now(), role: "orchestrator", text: "⚠ " + ((e && e.message) || "Something went wrong.") })); })
      .finally(() => setBusy(false));
  }
  function clear() {
    if (!repo || !window.confirm("Start a new conversation? This clears the current chat.")) return;
    api("/orch-clear", { repo }).then(() => setThread([])).catch(() => toast("Couldn't clear", "error"));
  }
  function onKey(e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }

  // Live run-state for this repo — so the chat reflects where things are (a handoff's issues, once
  // started, and anything needing you), refreshed by the dashboard poll.
  const live = (issues || []).filter((i) => (isAgency || i.repo === repo) && (i.active || i.running || i.queued || i.state === "working" || i.blocked));

  if (!repos || !repos.length) return html`<div class="empty" style="padding:40px;text-align:center">Add a repo to start a conversation.</div>`;

  return html`<div class="orch">
    <div class="orch-head">
      <div class="orch-title"><${Icon} name="sparkles" size=${16}/> Orchestrator <span class="orch-repo">${repoLabel}</span></div>
      <span style="flex:1"></span>
      ${onAnalyze && !isAgency ? html`<button class="colbtn tip" data-tip=${"Analyze " + repoLabel + "'s codebase health — proposes refactor issues"} disabled=${auditRepos.includes(repo)} onClick=${() => onAnalyze(repo)}>${auditRepos.includes(repo) ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="search" size=${14}/>`} <span class="segx">Analyze</span></button>` : null}
      <button class="iconbtn ghost" data-tip="New conversation" aria-label="New conversation" onClick=${clear}><${Icon} name="trash" size=${16}/></button>
    </div>
    ${live.length ? html`<div class="orch-live">
      <div class="orch-live-h"><span class="orch-live-dot"></span> Working now · ${live.length}</div>
      <div class="orch-live-rows">${live.map((i) => { const sf = statusField(i); return html`<button class="orch-live-row" key=${i.number} onClick=${() => onOpenIssue && onOpenIssue(repo, i.number, i.title)}>
        <span class=${"pstat pstat-" + sf.kind}><${Icon} name=${sf.icon} size=${11}/> ${sf.label}</span>
        <span class="orch-live-ttl">#${i.number} ${i.title || ""}</span>
      </button>`; })}</div>
    </div>` : null}
    <div class="orch-scroll" ref=${scrollRef}>
      ${loading ? html`<div class="empty" style="padding:30px;text-align:center"><${Spinner} size=${18}/></div>`
        : thread.length ? thread.map((m) => html`<${Bubble} key=${m.id} m=${m} repo=${repo} reload=${reload} onOpenIssue=${onOpenIssue}/>`)
        : html`<div class="orch-empty">
            <div class="obki"><${Icon} name="sparkles" size=${26}/></div>
            <div class="obh">What can I help with in ${repoLabel}?</div>
            <div class="obsub">Describe an idea, ask what's feasible, or sketch a feature. When it's ready, I'll propose scoped issues you can create with one click — or just say “quick fix: …” for a one-liner.</div>
          </div>`}
      ${busy ? html`<div class="obub obub-orch"><span class="obub-av"><${Avatar} role="auditor" size=${26} crop="head"/></span><div class="obub-body"><div class="obub-txt obub-think"><${Spinner} size=${13}/> thinking…</div></div></div>` : null}
    </div>
    <div class="orch-compose">
      <textarea ref=${taRef} placeholder=${"Message the " + repoLabel + " orchestrator…  (⌘/Ctrl+Enter to send)"} value=${draft} onInput=${(e) => { setDraft(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(160, e.target.scrollHeight) + "px"; }} onKeyDown=${onKey} rows=${1}></textarea>
      <button class="btn primary orch-send" disabled=${busy || !draft.trim()} onClick=${send}>${busy ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="send" size=${15}/>`}</button>
    </div>
  </div>`;
}
