// Organism — ProgressTable. Extracted from web/table.js; logic unchanged.
// The List view: dense issue cards with status, agent avatar, heat bar, and a workflow timeline.
//
// NOTE on WorkflowTimeline: the exported WorkflowTimeline is the ORIGINAL {i, labels} renderer
// (WorkflowTimelineImpl below) — it keeps the epic progress-bar branch and the per-step ↻N loop
// badges the unified molecule Timeline dropped. Detail imports it from here.
import { html, useState, useMemo, useRef, useEffect } from "/web/vendor/standalone.mjs";
import { Avatar } from "../atoms/Avatar.js";
import { Icon } from "../atoms/Icon.js";
import { Spinner } from "../atoms/Spinner.js";
import { Breadcrumb } from "../atoms/Breadcrumb.js";
import { ago, fmtTok, tokHeat, usageTitle } from "../../lib/format.js";
// ghUrl hasn't been extracted to lib yet — temporarily pulled from the old core.js.
import { ghUrl } from "../../core.js";
import { isDone, classify, statusChip, filterByTime } from "../../lib/issue-logic.js";
import { nestedChildKeys } from "./Board.js";
export { WorkflowTimelineImpl as WorkflowTimeline };

// Canonical pipeline steps + the role that owns each (lights the right one from i.role).
const STEPS = [["plan", "Plan"], ["dev", "Dev"], ["test", "Test"], ["review", "Review"]];
const ROLE_STEP = { planner: 0, architect: 0, decomposer: 0, spec: 0, "spec-creator": 0, developer: 1, dev: 1, coder: 1, tester: 2, test: 2, reviewer: 3, review: 3, auditor: 0 };

// Derive the timeline model for an issue from DB-known facts (state, role, running, blocked).
export function timelineModel(i) {
  const s = i.state || "";
  const done = isDone(i);
  if (i.epic || s === "agency:epic") {
    const total = i.epic ? i.epic.total : 0, d = i.epic ? i.epic.done : 0;
    return { epic: true, done: d, total, complete: total > 0 && d >= total };
  }
  const running = !!(i.active || i.running);
  const blk = i.blocked;
  const attn = blk === "needsAttention" || blk === "awaitingApproval" || blk === "awaitingAnswer" || blk === "conflict" || blk === "budgetExceeded";
  // WORKFLOW-DRIVEN timeline: one dot per ACTUAL workflow step (e.g. 8 for HolyMoly), each with its
  // own agent (name + avatar). Falls back to the generic plan/dev/test/review when no workflow.
  const wfSteps = Array.isArray(i.wfSteps) && i.wfSteps.length ? i.wfSteps : null;
  if (wfSteps) {
    const cur = done ? wfSteps.length : (typeof i.wfStep === "number" ? i.wfStep : 0);
    const steps = wfSteps.map((ws, idx) => {
      let st = "pending";
      if (done || idx < cur) st = "done";
      else if (idx === cur) st = attn ? "attention" : running ? "running" : "queued";
      return { k: ws.agent || ws.name, label: ws.name, role: ws.role || ws.name, st };
    });
    return { epic: false, steps, started: cur >= 0 && (running || done || cur > 0), current: cur, running, attn, workflow: true };
  }
  let cur;
  if (done) cur = STEPS.length;
  else if (s === "planned" || s === "notPlanned" || !s) cur = -1;
  else if (s === "review") cur = 3;
  else { const r = (i.role || "").toLowerCase(); cur = (r in ROLE_STEP) ? ROLE_STEP[r] : 1; }
  const steps = STEPS.map(([k, label], idx) => {
    let st = "pending";
    if (cur === -1) st = "pending";
    else if (idx < cur) st = "done";
    else if (idx === cur) st = done ? "done" : attn ? "attention" : running ? "running" : "queued";
    return { k, label, role: k === "dev" ? "developer" : k, st };
  });
  if (s === "review") { steps[0].st = "done"; steps[1].st = "done"; steps[2].st = "done"; steps[3].st = i.review === "approved" ? "done" : "attention"; }
  if (done) steps.forEach((x) => (x.st = "done"));
  return { epic: false, steps, started: cur !== -1, current: cur, running, attn };
}

// The status field: a friendly label + kind (drives the pill colour) built from the status chip.
export function statusField(i) {
  const st = statusChip(i);
  const role = i.role ? " · " + i.role : "";
  switch (st.cls) {
    case "s-done": return { label: i.pr_number ? "Merged" : "Done", kind: "done", icon: i.pr_number ? "merge" : "check", chip: "s-done" };
    case "s-ready": return { label: "Ready to merge", kind: "ready", icon: "merge", chip: "s-ready" };
    case "s-changes": return { label: st.label === "conflict" ? "Conflict — needs you" : "Changes requested", kind: "attention", icon: "alert", chip: "s-changes" };
    case "s-attn": return { label: st.label === "approve?" ? "Needs you · approve" : st.label === "reply" ? "Needs you · reply" : st.label === "over budget" ? "Over budget" : "Needs you", kind: "attention", icon: "alert", chip: "s-attn" };
    case "s-auto": return { label: "Auto-resume", kind: "queued", icon: "hourglass", chip: "s-auto" };
    case "s-epic": return { label: "Epic " + (i.epic ? i.epic.done + "/" + i.epic.total : ""), kind: i.epic && i.epic.done >= i.epic.total ? "ready" : "running", icon: "layers", chip: "s-epic" };
    case "s-working": return i.queued && !i.active ? { label: "Queued", kind: "queued", icon: "clock", chip: "s-working" } : { label: "Working" + role, kind: "running", icon: "loader", chip: "s-working", live: true };
    case "s-inbox": return { label: "Inbox", kind: "inbox", icon: "inbox", chip: "s-inbox" };
    default: return { label: "Planned", kind: "planned", icon: "planned", chip: "s-planned" };
  }
}

// Which agent role(s) own each pipeline step — a role running >1 time = a loop-back to that step.
const STEP_ROLES = { plan: ["planner", "architect"], dev: ["developer"], test: ["tester"], review: ["reviewer"] };
function loopsFor(i, k) { const r = (i && i.runs) || {}; let c = 0; for (const role of STEP_ROLES[k] || []) c += r[role] || 0; return Math.max(0, c - 1); }

// Canonical status chip (design-system .da-status). Pulses when live.
function StatusChip({ i }) {
  const sf = statusField(i);
  return html`<span class=${"da-status " + sf.chip + (sf.live ? " da-status--live" : "")}><span class="da-status__dot"></span>${sf.label}</span>`;
}

// Token heat bar: live tokens burned (provider-neutral; no $).
function HeatBar({ i }) {
  const h = tokHeat(i);
  if (!h.tokens) return null;
  return html`<span class="heat tip" data-tip=${usageTitle(i.usage)}>
    <span class="heat__track"><span class="heat__fill" style=${"width:" + h.pct + "%;background:" + h.color}></span></span>
    <span class="heat__lbl" style=${"color:" + (h.over ? "var(--red)" : "var(--ink-2)")}>${fmtTok(h.tokens)}</span>
  </span>`;
}

// The ORIGINAL WorkflowTimeline renderer — kept verbatim so IssueRow's epic + loop behaviour is
// unchanged. (The molecule Timeline is re-exported above for external callers under the same name.)
function WorkflowTimelineImpl({ i, labels = true }) {
  const m = timelineModel(i);
  if (m.epic) {
    const pct = m.total ? Math.round((100 * m.done) / m.total) : 0;
    return html`<div class="tl-epic" title=${m.done + " of " + m.total + " epics done"}>
      <div class="tl-epic-track"><div class="tl-epic-fill" style=${"width:" + pct + "%"}></div></div>
      <span class="tl-epic-lbl"><${Icon} name="layers" size=${12}/> ${m.done}/${m.total} epics</span>
    </div>`;
  }
  if (!m.started) return null;
  // Index of the step the LAST agent ran (so a parked issue still shows who ran last, not just the lead).
  const lastIdx = i.lastRole ? (STEPS.findIndex(([k]) => (STEP_ROLES[k] || []).includes(i.lastRole))) : -1;
  const live = !!(i.active || i.running);
  return html`<div class=${"flow" + (labels ? "" : " flow--compact")}>
    ${m.steps.map((s, idx) => {
      const loops = loopsFor(i, s.k);
      const done = s.st === "done";
      const current = idx === m.current && !done;
      const blocked = s.st === "attention";
      const cls = done ? "done" : current ? (blocked ? "blocked" : "current") : blocked ? "blocked" : "pending";
      // ONLY the current (working / needs-you) step carries an icon: an animated spinner while the
      // agent is actually running, its avatar when parked on it. Every other step is a plain dot —
      // no more row of faces obscuring where the workflow actually is.
      const stepRole = s.role || s.k;
      const showSpin = current && live;
      const faceRole = current && !showSpin ? (m.workflow ? stepRole : (i.role || stepRole)) : null;
      const showFace = !!faceRole;
      return html`
        ${idx ? html`<span class=${"flow__line" + (idx <= m.current ? " on" : "")}></span>` : null}
        <span class=${"flow__step " + cls + (idx === lastIdx && !live ? " lastran" : "")} title=${s.label + " — " + s.st + (idx === lastIdx && i.lastRole ? " · last: " + i.lastRole : "")}>
          <span class=${"flow__dot" + (showSpin ? " pulse" : "") + (showFace ? " flow__dot--face" : "")}>
            ${showSpin ? html`<${Spinner} size=${labels ? 16 : 12}/>` : done ? html`<${Icon} name="check" size=${10}/>` : showFace ? html`<span class="flow__face"><${Avatar} role=${faceRole} size=${labels ? 26 : 20} crop="head"/></span>` : null}
          </span>
          ${labels ? html`<span class="flow__lbl">${current && blocked ? html`<${Icon} name=${statusField(i).icon} size=${11} cls="flow__act"/> ` : null}${s.label}</span>` : null}
          ${loops ? html`<span class="flow__loop" title=${loops + " loop" + (loops > 1 ? "s" : "")}>↻${loops}</span>` : null}
        </span>`;
    })}
  </div>`;
}

// The single primary action for a row (mirrors the board Card CTA logic, compacted).
function rowQuick(i, act) {
  const done = isDone(i);
  if (i.state === "planned" || i.state === "notPlanned" || (!i.state && !done)) return { a: "start", icon: "play", label: i.byAgent ? "Approve" : "Start", cls: "primary", fn: () => i.byAgent ? act.approve(i.repo, i.number) : act.start(i.repo, i.number) };
  if (i.blocked === "awaitingApproval") return { a: "approve", icon: "check", label: "Approve", cls: "primary", fn: () => act.approve(i.repo, i.number) };
  if (i.state === "review" && i.review === "changes") return { a: "fix", icon: "wrench", label: "Fix", cls: "primary", fn: () => act.fix(i.repo, i.number) };
  if (i.state === "review" && i.review === "approved") return { a: "merge", icon: "merge", label: "Merge", cls: "primary", fn: () => act.merge(i.repo, i.number) };
  if (i.blocked === "needsAttention") return { a: "resume", icon: "refresh", label: "Resume", cls: "primary", fn: () => act.resume(i.repo, i.number) };
  if (i.active || i.state === "working") return { a: "stop", icon: "stop", label: "Stop", cls: "danger", fn: () => act.stop(i.repo, i.number) };
  return null;
}

// Inline hover actions shown on the right of a row head.
export function RowActions({ i, act }) {
  const q = rowQuick(i, act);
  const busy = q && act.isBusy(q.a, i.repo, i.number);
  return html`<div class="irow__actions" onClick=${(e) => e.stopPropagation()}>
    ${q ? html`<button class=${"da-btn da-btn--sm" + (q.cls === "primary" ? " da-btn--primary" : q.cls === "danger" ? " da-btn--danger" : "")} disabled=${busy} onClick=${q.fn}>${busy ? html`<${Spinner} size=${13}/>` : null}${q.label}</button>` : null}
    ${i.state !== "done" && !isDone(i) ? html`<button class="da-iconbtn da-iconbtn--sm tip" data-tip="Run checks" onClick=${() => act.runChecks(i.repo, i.number, i.title)}><${Icon} name="flask" size=${14}/></button>` : null}
  </div>`;
}

// A single issue card row.
export function IssueRow({ i, multi, onOpen, act, avatarsOn, excerpt, open = false, child = false, expandable = false, expanded = false, onToggle }) {
  const live = !!(i.active || i.running);
  const working = live || i.queued;
  const repoName = (i.repo || "").split("/").pop();
  const parent = i.epic && i.epic.parent;
  return html`<div class=${"irow" + (open ? " sel" : "") + (live ? " live" : "") + (child ? " prow-child" : "")} role="button" tabindex="0" onClick=${() => onOpen(i)}>
    <div class="irow__head">
      <div class="irow__crumbs">
        ${expandable ? html`<button class=${"irow__exp" + (expanded ? " open" : "")} aria-label="Toggle sub-issues" onClick=${(e) => { e.stopPropagation(); onToggle && onToggle(); }}><${Icon} name="chevright" size=${13}/></button>` : null}
        <${Breadcrumb} repo=${i.repo} number=${i.number} parent=${i.parentNum ? { number: i.parentNum } : null} dot=${multi}/>
        ${i.workflowId ? html`<span class="wfchip tip" data-tip=${"Workflow: " + i.workflowId}><${Icon} name="sparkles" size=${10}/> ${i.workflowId}</span>` : null}
        ${i.byAgent ? html`<span class="irow__byagent tip" data-tip="Proposed by an agent — review & start"><${Icon} name="rocket" size=${10}/> agent</span>` : null}
        ${i.analyzerProposal ? html`<span class="irow__analyzer tip" data-tip="Process Analyzer — a self-improvement proposal about the agency's own operational health"><${Icon} name="flask" size=${10}/> analyzer</span>` : null}
        ${i.editing && i.editing.length ? html`<span class="irow__lock tip" data-tip=${"Editing now: " + i.editing.join(", ")}><${Icon} name="lock" size=${10}/> ${i.editing.length}</span>` : null}
      </div>
      <div class="irow__headr">
        <${StatusChip} i=${i}/>
        <span class="irow__time">${ago(i.created_at || i.updated_at)}</span>
        <${RowActions} i=${i} act=${act}/>
      </div>
    </div>
    <div class="irow__body">
      ${avatarsOn && i.role && (working || i.state === "review") ? html`<span class="irow__fig"><${Avatar} role=${i.role} size=${44} crop="full"/></span>` : null}
      <div class="irow__main">
        <div class="irow__title" title=${i.title || ""}>${i.title || "#" + i.number}</div>
        ${excerpt ? html`<div class="irow__excerpt">${i.role && working ? html`<span class="irow__act-role">${i.role}</span> ` : null}${excerpt}</div>` : null}
      </div>
    </div>
    ${timelineModel(i).started || i.epic ? html`<div class="irow__flow"><${WorkflowTimelineImpl} i=${i}/></div>` : null}
    <div class="irow__foot">
      <div class="irow__cost"><${HeatBar} i=${i}/></div>
      ${i.pr_number ? html`<a class="irow__pr" href=${i.pr_url || ghUrl(i.repo, i.pr_number)} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}><${Icon} name="pr" size=${11}/> ${i.pr_number}</a>` : null}
      <span class="irow__elapsed"><${Icon} name="clock" size=${12}/> ${ago(i.created_at || i.updated_at)}</span>
    </div>
  </div>`;
}

// A stable category color per repo (breadcrumb dot).
const REPO_HUES = ["var(--accent)", "var(--green)", "var(--amber)", "var(--purple)", "var(--red)", "#0ea5e9"];
function repoColor(repo) { let h = 0; for (let n = 0; n < (repo || "").length; n++) h = (h * 31 + repo.charCodeAt(n)) >>> 0; return REPO_HUES[h % REPO_HUES.length]; }

// Order: needs-you first, then running, then queued/planned, inbox before done — most-actionable on top.
const KIND_ORDER = { attention: 0, ready: 1, running: 2, queued: 3, planned: 4, inbox: 5, done: 6 };
const SORT_OPTS = [
  { v: "smart", label: "Most actionable", short: "Actionable", icon: "alert" },
  { v: "updated", label: "Recently updated", short: "Recent", icon: "clock" },
  { v: "created", label: "Newest first", short: "Newest", icon: "hash" },
];
const TIME_OPTS = [
  { v: "all", label: "Any time", short: "All", icon: "hourglass" },
  { v: "24h", label: "Last 24 hours", short: "24h", icon: "hourglass" },
  { v: "7d", label: "Last 7 days", short: "7d", icon: "hourglass" },
  { v: "30d", label: "Last 30 days", short: "30d", icon: "hourglass" },
];
const GROUP_OPTS = [
  { v: "status", label: "By state", short: "State", icon: "layers" },
  { v: "repo", label: "By repository", short: "Repo", icon: "pr" },
  { v: "none", label: "No grouping", short: "None", icon: "list" },
];
// legacy aliases used by the cyc() helper / defaults
const GROUPS = GROUP_OPTS.map((g) => [g.v, g.short]);
const TIMES = TIME_OPTS.map((g) => [g.v, g.short]);
const KIND_LABEL = { attention: "Needs you", ready: "Ready to merge", running: "Working", queued: "Queued", planned: "Planned", inbox: "Inbox", done: "Done" };
const KIND_ICON = { attention: "alert", ready: "merge", running: "loader", queued: "clock", planned: "planned", inbox: "inbox", done: "check" };

// Overview stats: data drives the UI — surface "what needs me?" before any row is read.
// Most stats bucket by lifecycle `kind`; `analyzer` is orthogonal (a Process Analyzer proposal is
// usually ALSO sitting in Inbox) so it carries its own `match` predicate instead of `kinds`.
export const STAT_DEFS = [
  { k: "needs", label: "Needs you", kinds: ["attention", "ready"], cls: "attention", icon: "alert" },
  { k: "analyzer", label: "Analyzer", kinds: [], cls: "analyzer", icon: "flask", match: (i) => !!i.analyzerProposal },
  { k: "running", label: "Working", kinds: ["running"], cls: "running", icon: "loader" },
  { k: "queued", label: "Queued", kinds: ["queued"], cls: "queued", icon: "clock" },
  { k: "inbox", label: "Inbox", kinds: ["inbox"], cls: "inbox", icon: "inbox" },
  { k: "planned", label: "Planned", kinds: ["planned"], cls: "planned", icon: "planned" },
  { k: "done", label: "Done", kinds: ["done"], cls: "done", icon: "check" },
];
// Shared predicate: a def's own `match` when present, else its lifecycle-kind membership.
export const statMatches = (d, i, kind) => (d.match ? d.match(i) : d.kinds.includes(kind ?? statusField(i).kind));

// At-a-glance status counts + one-click filter. Lives in the view bar.
export function StatStrip({ counts, statFilter, setStatFilter, spend, compact = false }) {
  const allClear = counts.needs === 0 && (counts.running || counts.queued || counts.planned || counts.done);
  return html`<div class=${"pt-overview" + (compact ? " pt-overview-top" : "")}>
    ${STAT_DEFS.map((d) => {
      const clear = d.k === "needs" && counts.needs === 0 && allClear;
      return html`<button key=${d.k} class=${"pt-stat pt-stat-" + d.cls + (statFilter === d.k ? " on" : "") + (counts[d.k] === 0 ? " zero" : "")} data-tip=${(clear ? "All clear" : d.label) + (counts[d.k] ? " · click to filter" : "")} onClick=${() => setStatFilter(statFilter === d.k ? null : d.k)}>
        <span class="pt-stat-ic"><${Icon} name=${clear ? "check" : d.icon} size=${13}/></span>
        <span class="pt-stat-n">${clear ? "" : counts[d.k]}</span>
        <span class="pt-stat-l">${clear ? "All clear" : d.label}</span>
      </button>`;
    })}
  </div>`;
}

function smartCmp(a, b) {
  const ka = KIND_ORDER[statusField(a).kind] ?? 9, kb = KIND_ORDER[statusField(b).kind] ?? 9;
  return ka !== kb ? ka - kb : new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
}

// A compact icon-button that opens a dropdown to pick one option (replaces cycle-on-click).
function MenuBtn({ icon, label, value, options, onPick, showLabel = false, active = false, className = "" }) {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState("right");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    // Edge-aware: open toward whichever side has room so the menu stays inside the viewport.
    const r = ref.current && ref.current.getBoundingClientRect();
    if (r) { const menuW = 200; setAlign(r.left - menuW < 8 && r.right + menuW < window.innerWidth ? "left" : "right"); }
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const cur = options.find((o) => o.v === value);
  return html`<span class=${"menuwrap " + className} ref=${ref}>
    <button class=${"segbtn tip" + ((active || (value && value !== options[0].v)) ? " on" : "")} data-tip=${label} onClick=${() => setOpen((o) => !o)}>
      <${Icon} name=${cur && cur.icon ? cur.icon : icon} size=${14}/>${showLabel && cur ? html` <span class="segx">${cur.short || cur.label}</span>` : null}
    </button>
    ${open ? html`<div class=${"menu" + (align === "left" ? " menu--left" : "")}>
      <div class="menu__h">${label}</div>
      ${options.map((o) => html`<button key=${o.v} class=${"menu__item" + (o.v === value ? " on" : "")} onClick=${() => { onPick(o.v); setOpen(false); }}>${o.icon ? html`<${Icon} name=${o.icon} size=${14}/>` : null}<span>${o.label}</span>${o.v === value ? html`<${Icon} name="check" size=${14} cls="menu__ck"/>` : null}</button>`)}
    </div>` : null}
  </span>`;
}

// Status filter options (folds in the removed stat-strip click-to-filter).
const STATUS_FILTER_OPTS = [
  { v: "", label: "All statuses", icon: "layers" },
  { v: "needs", label: "Needs you", icon: "alert" },
  { v: "running", label: "Working", icon: "loader" },
  { v: "queued", label: "Queued", icon: "clock" },
  { v: "inbox", label: "Inbox", icon: "inbox" },
  { v: "planned", label: "Planned", icon: "planned" },
  { v: "done", label: "Done", icon: "check" },
];

export function ProgressTable({ issues, repos, repoFilter, onOpen, onAddIssue, onAnalyze, auditRepos, act, data, openKey, compact = false, statFilter = null, setStatFilter = () => {}, toolbarExtra = null }) {
  const ls = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const [sort, setSort] = useState(() => ls("ptSort", "smart"));
  const [group, setGroup] = useState(() => ls("ptGroup", "status"));
  const [time, setTime] = useState(() => ls("ptTime", "all"));
  const save = (k, v, set) => { set(v); try { localStorage.setItem(k, v); } catch (e) {} };
  const cyc = (arr, cur) => arr[(arr.findIndex((x) => x[0] === cur) + 1) % arr.length][0];

  const multi = !repoFilter && (repos || []).length > 1;
  const target = repoFilter || (repos.length === 1 ? repos[0] : null);
  const analyzing = target && (auditRepos || []).includes(target);
  const nested = nestedChildKeys(issues);
  const liveBy = useMemo(() => new Map(issues.map((i) => [i.repo + "#" + i.number, i])), [issues]);
  const streamByKey = useMemo(() => { const m = new Map(); for (const a of (data && data.activity) || []) m.set(a.repo + "#" + a.number, a.text); return m; }, [data && data.activity]);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (key) => setCollapsed((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const { sections, needsYou, total, counts } = useMemo(() => {
    let base = issues.filter((i) => !nested.has(i.repo + "#" + i.number) && !i.archived);
    base = filterByTime(base, time === "all" ? "any" : time);
    const cmp = sort === "smart" ? smartCmp : sort === "created" ? (a, b) => (b.number || 0) - (a.number || 0) : (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    const cnt = {}; STAT_DEFS.forEach((d) => (cnt[d.k] = 0));
    for (const i of base) { const k = statusField(i).kind; for (const d of STAT_DEFS) if (statMatches(d, i, k)) cnt[d.k]++; }
    const need = cnt.needs;
    const fdef = statFilter && STAT_DEFS.find((d) => d.k === statFilter);
    if (fdef) base = base.filter((i) => statMatches(fdef, i));
    let secs;
    if (group === "repo") {
      const m = new Map();
      for (const i of base) { let a = m.get(i.repo); if (!a) { a = []; m.set(i.repo, a); } a.push(i); }
      secs = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([r, items]) => ({ key: r, label: r.split("/").pop(), sub: r.split("/")[0], icon: "pr", items: items.slice().sort(cmp) }));
    } else if (group === "none") {
      secs = [{ key: "all", label: null, items: base.slice().sort(cmp) }];
    } else {
      const m = new Map();
      for (const i of base) { const k = statusField(i).kind; let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(i); }
      secs = Object.keys(KIND_ORDER).filter((k) => m.has(k)).map((k) => ({ key: k, label: KIND_LABEL[k] || k, icon: KIND_ICON[k], items: m.get(k).slice().sort(cmp) }));
    }
    return { sections: secs, needsYou: need, total: base.length, counts: cnt };
  }, [issues, sort, group, time, statFilter]);

  const avatarsOn = (data && data.config && data.config.avatars) !== "off";
  const renderRows = (items) => items.flatMap((i) => {
    const key = i.repo + "#" + i.number;
    const kids = i.epic && i.epic.children ? i.epic.children : null;
    const isEpic = kids && kids.length > 0;
    const open = isEpic && !collapsed.has(key);
    const out = [html`<${IssueRow} key=${key} i=${i} multi=${multi} onOpen=${onOpen} act=${act} avatarsOn=${avatarsOn} excerpt=${streamByKey.get(key)} open=${openKey === key} expandable=${!!isEpic} expanded=${open} onToggle=${() => toggle(key)}/>`];
    if (open) for (const c of kids) {
      const ck = i.repo + "#" + c.child;
      const ci = liveBy.get(ck) || { repo: i.repo, number: c.child, title: c.title, state: c.closed ? "done" : (c.state || "planned"), updated_at: i.updated_at, parentNum: i.number };
      out.push(html`<${IssueRow} key=${ck} i=${Object.assign({ parentNum: i.number }, ci)} multi=${multi} onOpen=${onOpen} act=${act} avatarsOn=${avatarsOn} excerpt=${streamByKey.get(ck)} open=${openKey === ck} child=${true}/>`);
    }
    return out;
  });

  return html`<div class="pane">
    <div class="listbar">
      <button class="da-btn da-btn--primary da-btn--sm listbar__new" data-tip="New issue" onClick=${() => onAddIssue(target)}><${Icon} name="plus" size=${15}/> <span class="listbar__new-txt">New</span></button>
      <span class="listbar__sp"></span>
      ${toolbarExtra ? html`<div class="listbar__stats">${toolbarExtra}</div>` : null}
      <span class="listbar__sp"></span>
      <div class="listbar__filters">
        <${MenuBtn} icon="alert" label="Filter by status" value=${statFilter || ""} options=${STATUS_FILTER_OPTS} onPick=${(v) => setStatFilter(v || null)} active=${!!statFilter} className="filter-collapse"/>
        <${MenuBtn} icon="sort" label="Sort" value=${sort} options=${SORT_OPTS} onPick=${(v) => save("ptSort", v, setSort)}/>
        <${MenuBtn} icon="layers" label="Group" value=${group} options=${GROUP_OPTS} onPick=${(v) => save("ptGroup", v, setGroup)}/>
        <${MenuBtn} icon="hourglass" label="Time range" value=${time} options=${TIME_OPTS} onPick=${(v) => save("ptTime", v, setTime)}/>
      </div>
    </div>
    <div class="pane__body">
      ${total ? html`<div class="pane-list">
        ${sections.map((sec) => html`<div class="listsec" key=${sec.key}>
          ${sec.label != null ? html`<div class="listsec__h">${sec.icon ? html`<span class="ic"><${Icon} name=${sec.icon} size=${14}/></span>` : null}${sec.label}${sec.sub ? html`<span class="listsec__sub">${sec.sub}</span>` : null}<span class="n">${sec.items.length}</span></div>` : null}
          <div class="rows">${renderRows(sec.items)}</div>
        </div>`)}
      </div>` : html`<div class="da-empty">
        <span class="da-empty__icon"><${Icon} name="inbox" size=${22}/></span>
        <div class="da-empty__title">Nothing here yet</div>
        <div class="da-empty__desc">${time !== "all" ? "No issues in this time range." : "Open a new issue and pin a teammate to put the agency to work."}</div>
        <button class="da-btn da-btn--primary" onClick=${() => onAddIssue(target)}>New issue</button>
      </div>`}
    </div>
  </div>`;
}
