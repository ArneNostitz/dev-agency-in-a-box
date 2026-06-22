// Dev Agency dashboard — rich progress table (v4). The list view re-imagined: each row is an issue
// whose hero column is a live WORKFLOW TIMELINE (plan → dev → test → review) showing exactly where
// it is, plus a STATUS field that flags what needs you. Reads the same /data payload as the board.
import { html, useState, useMemo } from "/web/vendor/standalone.mjs";
import { Avatar, Icon, Spinner, ago, classify, isDone, statusChip, filterByTime } from "./core.js";
import { nestedChildKeys } from "./board.js";

// Canonical pipeline steps + the role that owns each (so we can light the right one from i.role).
const STEPS = [["plan", "Plan"], ["dev", "Dev"], ["test", "Test"], ["review", "Review"]];
const ROLE_STEP = { planner: 0, architect: 0, decomposer: 0, spec: 0, "spec-creator": 0, developer: 1, dev: 1, coder: 1, tester: 2, test: 2, reviewer: 3, review: 3, auditor: 0 };

// Derive the timeline model for an issue from the DB-known facts (state, role, running, blocked).
export function timelineModel(i) {
  const s = i.state || "";
  const done = isDone(i);
  if (i.epic || s === "agency:epic") {
    const total = i.epic ? i.epic.total : 0, d = i.epic ? i.epic.done : 0;
    return { epic: true, done: d, total, complete: total > 0 && d >= total };
  }
  let cur;
  if (done) cur = STEPS.length;
  else if (s === "planned" || s === "notPlanned" || !s) cur = -1;
  else if (s === "review") cur = 3;
  else { const r = (i.role || "").toLowerCase(); cur = (r in ROLE_STEP) ? ROLE_STEP[r] : 1; }
  const running = !!(i.active || i.running);
  const blk = i.blocked;
  const attn = blk === "needsAttention" || blk === "awaitingApproval" || blk === "awaitingAnswer" || blk === "conflict" || blk === "budgetExceeded";
  const steps = STEPS.map(([k, label], idx) => {
    let st = "pending";
    if (cur === -1) st = "pending";
    else if (idx < cur) st = "done";
    else if (idx === cur) st = done ? "done" : attn ? "attention" : running ? "running" : "queued";
    return { k, label, st };
  });
  if (s === "review") { steps[0].st = "done"; steps[1].st = "done"; steps[2].st = "done"; steps[3].st = i.review === "approved" ? "done" : "attention"; }
  if (done) steps.forEach((x) => (x.st = "done"));
  return { epic: false, steps, started: cur !== -1 };
}

// The status field: a friendly label + kind (drives the pill colour) built from the status chip.
export function statusField(i) {
  const st = statusChip(i);
  const role = i.role ? " · " + i.role : "";
  switch (st.cls) {
    case "s-done": return { label: i.pr_number ? "Merged" : "Done", kind: "done", icon: i.pr_number ? "merge" : "check" };
    case "s-ready": return { label: "Ready to merge", kind: "ready", icon: "merge" };
    case "s-changes": return { label: st.label === "conflict" ? "Conflict — needs you" : "Changes requested", kind: "attention", icon: "alert" };
    case "s-attn": return { label: st.label === "approve?" ? "Needs you · approve" : st.label === "reply" ? "Needs you · reply" : st.label === "over budget" ? "Over budget" : "Needs you", kind: "attention", icon: "alert" };
    case "s-auto": return { label: "Auto-resume", kind: "queued", icon: "hourglass" };
    case "s-epic": return { label: "Epic " + (i.epic ? i.epic.done + "/" + i.epic.total : ""), kind: i.epic && i.epic.done >= i.epic.total ? "ready" : "running", icon: "layers" };
    case "s-working": return i.queued && !i.active ? { label: "Queued", kind: "queued", icon: "clock" } : { label: "Running" + role, kind: "running", icon: "loader" };
    default: return { label: "Planned", kind: "planned", icon: "planned" };
  }
}

// The compact stepper rendered in the timeline column.
function Timeline({ i }) {
  const m = timelineModel(i);
  if (m.epic) {
    const pct = m.total ? Math.round((100 * m.done) / m.total) : 0;
    return html`<div class="tl-epic" title=${m.done + " of " + m.total + " epics done"}>
      <div class="tl-epic-track"><div class="tl-epic-fill" style=${"width:" + pct + "%"}></div></div>
      <span class="tl-epic-lbl"><${Icon} name="layers" size=${12}/> ${m.done}/${m.total} epics</span>
    </div>`;
  }
  if (!m.started) return html`<span class="tl-idle">not started${i.byAgent ? " — awaiting your approval" : ""}</span>`;
  return html`<div class="tl">
    ${m.steps.map((s, idx) => html`
      ${idx ? html`<span class=${"tl-seg " + (s.st === "done" || (idx > 0 && m.steps[idx - 1].st === "done") ? "on" : "")}></span>` : null}
      <span class=${"tl-nd tl-" + s.st} title=${s.label + " — " + s.st}>
        ${s.st === "done" ? html`<${Icon} name="check" size=${11}/>` : s.st === "running" ? html`<${Icon} name="loader" size=${11}/>` : s.st === "attention" ? html`<${Icon} name="alert" size=${11}/>` : html`<span class="tl-num">${idx + 1}</span>`}
      </span>`)}
  </div>`;
}

// The single primary action for a row (mirrors the board Card CTA logic, compacted).
function rowQuick(i, act) {
  const done = isDone(i);
  if (i.state === "planned" || i.state === "notPlanned" || (!i.state && !done)) return { a: "start", icon: "play", label: "Start", cls: "play", fn: () => act.start(i.repo, i.number) };
  if (i.blocked === "awaitingApproval") return { a: "approve", icon: "check", label: "Approve", cls: "", fn: () => act.approve(i.repo, i.number) };
  if (i.state === "review" && i.review === "changes") return { a: "fix", icon: "wrench", label: "Fix", cls: "fix", fn: () => act.fix(i.repo, i.number) };
  if (i.state === "review" && i.review === "approved") return { a: "merge", icon: "merge", label: "Merge", cls: "play", fn: () => act.merge(i.repo, i.number) };
  if (i.blocked === "needsAttention") return { a: "resume", icon: "refresh", label: "Resume", cls: "", fn: () => act.resume(i.repo, i.number) };
  if (i.active || i.state === "working") return { a: "stop", icon: "stop", label: "Stop", cls: "stop", fn: () => act.stop(i.repo, i.number) };
  return null;
}

function Row({ i, multi, onOpen, act, avatarsOn, child = false, expandable = false, expanded = false, onToggle }) {
  const sf = statusField(i);
  const q = rowQuick(i, act);
  const qBusy = q && act.isBusy(q.a, i.repo, i.number);
  return html`<tr class=${"prow prow-" + sf.kind + (child ? " prow-child" : "")} onClick=${() => onOpen(i)}>
    <td class=${"pt-issue" + (child ? " pt-issue-child" : "")}>
      <div class="pt-title-row">
        ${expandable ? html`<button class=${"pt-exp" + (expanded ? " open" : "")} aria-label=${expanded ? "Collapse sub-issues" : "Expand sub-issues"} onClick=${(e) => { e.stopPropagation(); onToggle && onToggle(); }}><${Icon} name="chevron" size=${14}/></button>` : null}
        ${avatarsOn && (i.active || i.queued) && i.role ? html`<span class="pt-av"><${Avatar} role=${i.role} size=${18} crop="head"/></span>` : null}
        <span class="pt-title">${i.title || "#" + i.number}</span>
        ${i.byAgent ? html`<span class="pt-byagent tip" data-tip="Proposed by an agent — review & start"><${Icon} name="rocket" size=${10}/> agent</span>` : null}
      </div>
      <div class="pt-sub">${multi ? html`<span class="pt-repo">${i.repo.split("/").pop()}</span> · ` : null}<span class="pt-num">#${i.number > 0 ? i.number : "…"}</span>${i.pr_number ? html` · <span class="pt-pr"><${Icon} name="pr" size=${10}/> #${i.pr_number}</span>` : null}${i.editing && i.editing.length ? html` · <span class="pt-lock tip" data-tip=${"Editing now (file lock): " + i.editing.join(", ")}><${Icon} name="lock" size=${10}/> ${i.editing.length}</span>` : null}</div>
    </td>
    <td class="pt-timeline"><${Timeline} i=${i}/></td>
    <td class="pt-status"><span class=${"pstat pstat-" + sf.kind}><${Icon} name=${sf.icon} size=${12}/> ${sf.label}</span><span class="pt-when">${ago(i.updated_at)}</span></td>
    <td class="pt-act" onClick=${(e) => e.stopPropagation()}>
      ${sf.kind === "done"
        ? html`<button class="iconbtn-sm tip" data-tip="Archive — remove from the list" disabled=${act.isBusy("archive", i.repo, i.number)} onClick=${(e) => { e.stopPropagation(); act.archive(i.repo, i.number); }}>${act.isBusy("archive", i.repo, i.number) ? html`<${Spinner} size=${12}/>` : html`<${Icon} name="archive" size=${14}/>`}</button>`
        : q ? html`<button class=${"cardbtn cta " + q.cls + (qBusy ? " busy" : "")} disabled=${qBusy} onClick=${(e) => { e.stopPropagation(); q.fn(); }}>${qBusy ? html`<${Spinner} size=${12}/>` : html`<${Icon} name=${q.icon} size=${12}/>`} <span class="pt-act-lbl">${qBusy ? "…" : q.label}</span></button>` : null}
    </td>
  </tr>`;
}

// Order: needs-you first, then running, then queued/planned, then done — most-actionable on top.
const KIND_ORDER = { attention: 0, ready: 1, running: 2, queued: 3, planned: 4, done: 5 };

const SORTS = [
  { k: "smart", icon: "alert", tip: "most actionable first" },
  { k: "updated", icon: "clock", tip: "last updated" },
  { k: "created", icon: "hash", tip: "created (issue #)" },
];
const TIMES = [["all", "All"], ["24h", "24h"], ["7d", "7d"], ["30d", "30d"]];
const GROUPS = [["none", "—"], ["repo", "Repo"], ["status", "Status"]];
const KIND_LABEL = { attention: "Needs you", ready: "Ready to merge", running: "Running", queued: "Queued", planned: "Planned", done: "Done" };
function smartCmp(a, b) {
  const ka = KIND_ORDER[statusField(a).kind] ?? 9, kb = KIND_ORDER[statusField(b).kind] ?? 9;
  return ka !== kb ? ka - kb : new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
}

export function ProgressTable({ issues, repos, repoFilter, onOpen, onAddIssue, onAnalyze, auditRepos, act, data }) {
  const ls = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const [sort, setSort] = useState(() => ls("ptSort", "smart"));
  const [group, setGroup] = useState(() => ls("ptGroup", "none"));
  const [time, setTime] = useState(() => ls("ptTime", "all"));
  const save = (k, v, set) => { set(v); try { localStorage.setItem(k, v); } catch (e) {} };
  const cyc = (arr, cur) => arr[(arr.findIndex((x) => x[0] === cur) + 1) % arr.length][0];

  const multi = !repoFilter && (repos || []).length > 1;
  const target = repoFilter || (repos.length === 1 ? repos[0] : null);
  const analyzing = target && (auditRepos || []).includes(target);
  const nested = nestedChildKeys(issues);
  const liveBy = useMemo(() => new Map(issues.map((i) => [i.repo + "#" + i.number, i])), [issues]);
  // Epics unfold their sub-issues by default; track collapsed ones.
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (key) => setCollapsed((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const { sections, needsYou, total } = useMemo(() => {
    let base = issues.filter((i) => !nested.has(i.repo + "#" + i.number) && !i.archived);
    base = filterByTime(base, time === "all" ? "any" : time);
    const cmp = sort === "smart" ? smartCmp : sort === "created" ? (a, b) => (b.number || 0) - (a.number || 0) : (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    const need = base.filter((i) => statusField(i).kind === "attention").length;
    let secs;
    if (group === "repo") {
      const m = new Map();
      for (const i of base) { let a = m.get(i.repo); if (!a) { a = []; m.set(i.repo, a); } a.push(i); }
      secs = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([r, items]) => ({ label: r.split("/").pop(), items: items.slice().sort(cmp) }));
    } else if (group === "status") {
      const m = new Map();
      for (const i of base) { const k = statusField(i).kind; let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(i); }
      secs = Object.keys(KIND_ORDER).filter((k) => m.has(k)).map((k) => ({ label: KIND_LABEL[k] || k, items: m.get(k).slice().sort(cmp) }));
    } else {
      secs = [{ label: null, items: base.slice().sort(cmp) }];
    }
    return { sections: secs, needsYou: need, total: base.length };
  }, [issues, sort, group, time]);

  const avatarsOn = (data && data.config && data.config.avatars) !== "off";
  const renderRows = (items) => items.flatMap((i) => {
    const key = i.repo + "#" + i.number;
    const kids = i.epic && i.epic.children ? i.epic.children : null;
    const isEpic = kids && kids.length > 0;
    const open = isEpic && !collapsed.has(key);
    const out = [html`<${Row} key=${key} i=${i} multi=${multi} onOpen=${onOpen} act=${act} avatarsOn=${avatarsOn} expandable=${!!isEpic} expanded=${open} onToggle=${() => toggle(key)}/>`];
    if (open) for (const c of kids) {
      const ck = i.repo + "#" + c.child;
      const ci = liveBy.get(ck) || { repo: i.repo, number: c.child, title: c.title, state: c.closed ? "done" : (c.state || "planned"), updated_at: i.updated_at };
      out.push(html`<${Row} key=${ck} i=${ci} multi=${multi} onOpen=${onOpen} act=${act} avatarsOn=${avatarsOn} child=${true}/>`);
    }
    return out;
  });

  return html`<div class="ptable-wrap">
    <div class="ptable-bar">
      <button class="colbtn primary" onClick=${() => onAddIssue(target)}><${Icon} name="plus" size=${14}/> New issue</button>
      <button class="colbtn" disabled=${!target || analyzing} title=${target ? "Analyze " + target.split("/").pop() : "Pick a repo first"} onClick=${() => target && onAnalyze(target)}>${analyzing ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="search" size=${14}/>`} Analyze</button>
      <span style="flex:1"></span>
      ${needsYou ? html`<span class="pt-needsyou"><${Icon} name="alert" size=${13}/> ${needsYou} need${needsYou > 1 ? "" : "s"} you</span>` : null}
      <div class="seg">
        ${SORTS.map((srt) => html`<button key=${srt.k} class=${"segbtn tip" + (sort === srt.k ? " on" : "")} data-tip=${"Sort: " + srt.tip} onClick=${() => save("ptSort", srt.k, setSort)}><${Icon} name=${srt.icon} size=${14}/></button>`)}
      </div>
      <button class=${"segbtn tip" + (time !== "all" ? " on" : "")} data-tip="Filter by last updated — click to cycle" onClick=${() => save("ptTime", cyc(TIMES, time), setTime)}><${Icon} name="hourglass" size=${14}/> <span class="segx">${(TIMES.find((t) => t[0] === time) || TIMES[0])[1]}</span></button>
      <button class=${"segbtn tip" + (group !== "none" ? " on" : "")} data-tip="Group — click to cycle" onClick=${() => save("ptGroup", cyc(GROUPS, group), setGroup)}><${Icon} name="layers" size=${14}/> <span class="segx">${(GROUPS.find((g) => g[0] === group) || GROUPS[0])[1]}</span></button>
    </div>
    ${total ? html`<table class="ptable">
      <thead><tr><th>Issue</th><th class="pt-h-tl">Workflow timeline</th><th>Status</th><th></th></tr></thead>
      <tbody>${sections.flatMap((sec) => [
        sec.label != null ? html`<tr class="pt-group" key=${"g-" + sec.label}><td colspan="4"><span class="pt-group-l">${sec.label}</span> <span class="pt-group-n">${sec.items.length}</span></td></tr>` : null,
        ...renderRows(sec.items),
      ])}</tbody>
    </table>` : html`<div class="empty" style="padding:40px;text-align:center">No issues ${time !== "all" ? "in this time range." : "yet — start one with “New issue” or the Chat."}</div>`}
  </div>`;
}
