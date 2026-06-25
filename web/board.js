// Dev Agency dashboard — board module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect, useMemo } from "/web/vendor/standalone.mjs";
import { Avatar, COLS, Icon, ProviderLogo, Select, Spinner, ago, api, boardSortCmp, classify, defaultModelLogo, filterByTime, fmtTok, getSetupProgress, ghUrl, isDone, shortModel, statusChip, toast, usageTitle } from "./core.js";
import { Breadcrumb } from "./ui.js";

// ---------- sort / group / time options ----------

const EMPTY_STREAM = [];
function parseBoardSort(v) { const m = /^([a-z]+)_(asc|desc)$/.exec(v || "updated_desc"); return m ? [m[1], m[2]] : ["updated", "desc"]; }
const SORT_FIELDS = [
  { f: "updated", icon: "clock", tip: "Last updated" },
  { f: "created", icon: "hash", tip: "Created (issue #)" },
];
const TIME_CYCLE = [["any", "All"], ["24h", "24h"], ["7d", "7d"], ["30d", "30d"]];

function BoardControls({ boardSort, setBoardSort, boardGroup, setBoardGroup, boardTime, setBoardTime }) {
  const [field, dir] = parseBoardSort(boardSort);
  const defDir = () => "desc"; // newest/last-updated default desc; #1 first
  const clickSort = (f) => setBoardSort(field === f ? f + "_" + (dir === "desc" ? "asc" : "desc") : f + "_" + defDir(f));
  const cycleTime = () => { const i = TIME_CYCLE.findIndex((t) => t[0] === boardTime); setBoardTime(TIME_CYCLE[(i + 1) % TIME_CYCLE.length][0]); };
  const timeLbl = (TIME_CYCLE.find((t) => t[0] === boardTime) || TIME_CYCLE[0])[1];
  const grouped = boardGroup === "repo";
  return html`<div class="bctrl">
    <div class="seg">
      ${SORT_FIELDS.map((srt) => html`<button key=${srt.f} class=${"segbtn tip" + (field === srt.f ? " on" : "")} data-tip=${"Sort by " + srt.tip.toLowerCase() + (field === srt.f ? " — click to reverse" : "")} onClick=${() => clickSort(srt.f)}>
        <${Icon} name=${srt.icon} size=${15}/>${field === srt.f ? html`<${Icon} name=${dir === "asc" ? "chevup" : "chevdown"} size=${12} cls="segdir"/>` : null}
      </button>`)}
    </div>
    <button class=${"segbtn tip" + (boardTime !== "any" ? " on" : "")} data-tip="Filter by last updated — click to cycle" onClick=${cycleTime}><${Icon} name="hourglass" size=${14}/> <span class="segx">${timeLbl}</span></button>
    <button class=${"segbtn tip" + (grouped ? " on" : "")} data-tip=${grouped ? "Grouped by repo — click for workflow columns" : "Group by repo"} onClick=${() => setBoardGroup(grouped ? "state" : "repo")}><${Icon} name="layers" size=${15}/></button>
  </div>`;
}

// Keys ("repo#number") of issues that are a sub-issue of an epic parent also present in the list.
// These are nested inside their epic card (and excluded from column counts) instead of standing alone.
export function nestedChildKeys(issues) {
  const present = new Set(issues.map((i) => i.repo + "#" + i.number));
  const keys = new Set();
  for (const p of issues) {
    if (p.epic && p.epic.children) for (const c of p.epic.children) {
      const k = p.repo + "#" + c.child;
      if (present.has(k)) keys.add(k);
    }
  }
  return keys;
}

export function Board({ issues, repos, repoFilter, tab, isDesktop, onOpen, onOpenChild, onAddRepo, onAddIssue, onAnalyze, auditRepos, act, data, statStrip = null }) {
  // Board-owned controls — distinct localStorage keys to avoid collision with the legacy "boardSort" JSON key.
  const [boardSort,  setBoardSort]  = useState(() => { try { return localStorage.getItem("boardCtrlSort")  || "updated_desc"; } catch (e) { return "updated_desc"; } });
  const [boardGroup, setBoardGroup] = useState(() => { try { return localStorage.getItem("boardCtrlGroup") || "state";        } catch (e) { return "state";        } });
  const [boardTime,  setBoardTime]  = useState(() => { try { return localStorage.getItem("boardCtrlTime")  || "any";          } catch (e) { return "any";          } });
  useEffect(() => { try { localStorage.setItem("boardCtrlSort",  boardSort);  } catch (e) {} }, [boardSort]);
  useEffect(() => { try { localStorage.setItem("boardCtrlGroup", boardGroup); } catch (e) {} }, [boardGroup]);
  useEffect(() => { try { localStorage.setItem("boardCtrlTime",  boardTime);  } catch (e) {} }, [boardTime]);


  if (!(repos || []).length) {
    return html`<div class="norepo">
      <div class="obki" style="margin:0 auto 14px"><${Icon} name="pr" size=${28}/></div>
      <div class="obh" style="text-align:center">No repos yet</div>
      <div class="obsub" style="text-align:center;max-width:380px;margin:6px auto 16px">Add a repository for your agency to work in. Use <code>owner/name</code>.</div>
      <button class="btn primary" style="margin:0 auto;min-width:200px" onClick=${onAddRepo}><${Icon} name="plus" size=${16}/> Add your first repo</button>
    </div>`;
  }

  // The Add Issue button acts on the active repo (or opens the composer's repo picker under "All").
  // Analyze/Audit now lives in the Orchestrator chat header, not the board.
  const target = repoFilter || (repos.length === 1 ? repos[0] : null);

  // Epic grouping: a sub-issue is its own open issue, so it normally shows as a standalone card AND
  // its parent epic card — duplicating it. When the parent epic card is on the board we hide the
  // child's standalone card and nest it (with live status) inside the epic's collapsible list.
  const liveBy = new Map(issues.map((i) => [i.repo + "#" + i.number, i]));
  const nested = nestedChildKeys(issues);
  const subsFor = (p) =>
    (p.epic && p.epic.children ? p.epic.children : []).map((c) => ({ ...c, live: liveBy.get(p.repo + "#" + c.child) || null }));

  // Apply time filter then sort using the board controls.
  const filtered = filterByTime(issues, boardTime);
  const sortedAll = filtered.slice().sort(boardSortCmp(boardSort));

  // Group activity by issue ONCE per render (was O(cards × activity) — each card re-filtered the
  // whole ~150-row activity array on every poll).
  const streamByKey = useMemo(() => {
    const m = new Map();
    for (const a of (data && data.activity) || []) { const k = a.repo + "#" + a.number; let arr = m.get(k); if (!arr) { arr = []; m.set(k, arr); } arr.push(a); }
    return m;
  }, [data && data.activity]);
  const renderCard = (i) => html`<${Card} key=${i.repo + "#" + i.number} i=${i} subs=${subsFor(i)} multi=${!repoFilter && repos.length > 1} onOpen=${onOpen} onOpenChild=${onOpenChild} act=${act} data=${data} stream=${streamByKey.get(i.repo + "#" + i.number) || EMPTY_STREAM}/>`;
  const controls = html`<div class="listbar">
    <button class="da-btn da-btn--primary da-btn--sm" onClick=${() => onAddIssue(repoFilter || (repos && repos.length === 1 ? repos[0] : null))}><${Icon} name="plus" size=${15}/> New</button>
    ${statStrip ? html`<div class="listbar__stats">${statStrip}</div>` : null}
    <span style="flex:1"></span>
    <${BoardControls} boardSort=${boardSort} setBoardSort=${setBoardSort} boardGroup=${boardGroup} setBoardGroup=${setBoardGroup} boardTime=${boardTime} setBoardTime=${setBoardTime}/>
  </div>`;

  // --- group by workflow state (default) ---
  let boardContent;
  if (!boardGroup || boardGroup === "state") {
    const byCol = {}; COLS.forEach((c) => (byCol[c.k] = []));
    sortedAll
      .filter((i) => !nested.has(i.repo + "#" + i.number))
      .forEach((i) => byCol[classify(i)].push(i));
    const cols = isDesktop ? COLS : COLS.filter((c) => c.k === tab);
    boardContent = html`<div class="board">
      ${cols.map((c) => {
        const allItems = byCol[c.k];
        return html`<div class="col" key=${c.k}>
          <div class="colhead"><${Icon} name=${c.icon} size=${15}/> ${c.label} <span class="n">${allItems.length || ""}</span></div>
          ${c.k === "planned" ? html`<div class="planned-actions">
            <button class="colbtn primary" onClick=${() => onAddIssue(target)}><${Icon} name="plus" size=${14}/> Add Issue</button>
          </div>` : null}
          <div class="cards">
            ${allItems.length ? allItems.map(renderCard) : html`<div class="empty">—</div>`}
          </div>
        </div>`;
      })}
    </div>`;
  } else {
    // --- group by repo: one horizontal BAND per repo, each with the 4 workflow columns
    // (cards capped at ~4 then scroll) ---
    const repoList = repos.filter((r) => !repoFilter || r === repoFilter);
    sortedAll
      .filter((i) => !nested.has(i.repo + "#" + i.number))
      .forEach((i) => { if (!repoList.includes(i.repo)) repoList.push(i.repo); });
    const bandCols = isDesktop ? COLS : COLS.filter((c) => c.k === tab);
    boardContent = html`<div class="board-bands">
      ${repoList.map((r) => {
        const repoItems = sortedAll.filter((i) => i.repo === r && !nested.has(i.repo + "#" + i.number));
        const byCol = {}; COLS.forEach((c) => (byCol[c.k] = []));
        repoItems.forEach((i) => byCol[classify(i)].push(i));
        const short = r.split("/").pop();
        return html`<div class="band" key=${r}>
          <div class="band-head"><${Icon} name="pr" size=${15}/> <b>${short}</b> <span class="n">${repoItems.length || ""}</span>
            <span style="flex:1"></span>
            <button class="colbtn primary" onClick=${() => onAddIssue(r)}><${Icon} name="plus" size=${14}/> Add Issue</button>
          </div>
          <div class="band-cols">
            ${bandCols.map((c) => html`<div class="col" key=${c.k}>
              <div class="colhead"><${Icon} name=${c.icon} size=${14}/> ${c.label} <span class="n">${byCol[c.k].length || ""}</span></div>
              <div class="cards band-cards">${byCol[c.k].length ? byCol[c.k].map(renderCard) : html`<div class="empty">—</div>`}</div>
            </div>`)}
          </div>
        </div>`;
      })}
    </div>`;
  }

  return html`<div>${controls}${boardContent}</div>`;

}

// ---------- board card: compact workflow timeline + cost heat (design parity) ----------
// Local copies so board.js doesn't import table.js (table.js already imports board.js → cycle).
const BSTEPS = [["plan", "Plan"], ["dev", "Dev"], ["test", "Test"], ["review", "Review"]];
const BROLE_STEP = { planner: 0, architect: 0, decomposer: 0, spec: 0, "spec-creator": 0, developer: 1, dev: 1, coder: 1, tester: 2, test: 2, reviewer: 3, review: 3, auditor: 0 };
const BSTEP_ROLES = { plan: ["planner", "architect"], dev: ["developer"], test: ["tester"], review: ["reviewer"] };
function bTimeline(i) {
  const sstate = i.state || "", done = isDone(i);
  if (i.epic || sstate === "agency:epic") return { epic: true };
  let cur;
  if (done) cur = BSTEPS.length;
  else if (sstate === "planned" || sstate === "notPlanned" || !sstate) cur = -1;
  else if (sstate === "review") cur = 3;
  else { const r = (i.role || "").toLowerCase(); cur = (r in BROLE_STEP) ? BROLE_STEP[r] : 1; }
  const running = !!(i.active || i.running);
  const attn = i.blocked === "needsAttention" || i.blocked === "awaitingApproval" || i.blocked === "awaitingAnswer" || i.blocked === "conflict" || i.blocked === "budgetExceeded";
  const steps = BSTEPS.map(([k, label], idx) => {
    let stt = "pending";
    if (cur === -1) stt = "pending";
    else if (idx < cur) stt = "done";
    else if (idx === cur) stt = done ? "done" : attn ? "blocked" : running ? "current" : "pending";
    return { k, label, st: stt };
  });
  if (sstate === "review") { steps[0].st = "done"; steps[1].st = "done"; steps[2].st = "done"; steps[3].st = i.review === "approved" ? "done" : "blocked"; }
  if (done) steps.forEach((x) => (x.st = "done"));
  return { epic: false, steps, current: cur, started: cur !== -1, live: running };
}
// Compact, label-less timeline for the board card (reveals on hover via .bcard__flow).
function BFlow({ i, avatarsOn }) {
  const m = bTimeline(i);
  if (m.epic || !m.started) return null;
  const lastIdx = i.lastRole ? BSTEPS.findIndex(([k]) => (BSTEP_ROLES[k] || []).includes(i.lastRole)) : -1;
  return html`<div class="flow flow--compact">
    ${m.steps.map((s, idx) => {
      const current = s.st === "current";
      const faceRole = (current && m.live) ? i.role : (!m.live && idx === lastIdx && i.lastRole) ? i.lastRole : (current ? i.role : null);
      const showFace = !!faceRole && avatarsOn;
      return html`
        ${idx ? html`<span class=${"flow__line" + (idx <= m.current ? " on" : "")}></span>` : null}
        <span class=${"flow__step " + s.st + (idx === lastIdx && !m.live ? " lastran" : "")} title=${s.label + (idx === lastIdx && i.lastRole ? " · last: " + i.lastRole : "")}>
          <span class=${"flow__dot" + (current && m.live ? " pulse" : "") + (showFace ? " flow__dot--face" : "")}>
            ${s.st === "done" && !showFace ? html`<${Icon} name="check" size=${9}/>` : showFace ? html`<span class="flow__face"><${Avatar} role=${faceRole} size=${20} crop="head"/></span>` : null}
          </span>
        </span>`;
    })}
  </div>`;
}
// Cost heat bar: live spend vs estimate (green<80%, amber<100%, red over).
function BHeat({ i }) {
  const real = (i.usage && i.usage.costUsd) || 0, est = (i.estCost && i.estCost.usd) || 0;
  if (!real && !est) return null;
  const max = est || Math.max(real, 1), ratio = max ? real / max : 0;
  const pct = Math.max(4, Math.min(100, Math.round(ratio * 100)));
  const color = ratio >= 1 ? "var(--red)" : ratio >= 0.8 ? "var(--amber)" : "var(--green)";
  return html`<span class="heat tip" data-tip=${"$" + real.toFixed(2) + (est ? " of ~$" + est.toFixed(2) + " est" : "")}>
    <span class="heat__track"><span class="heat__fill" style=${"width:" + pct + "%;background:" + color}></span></span>
    <span class="heat__lbl" style=${"color:" + (ratio >= 1 ? "var(--red)" : "var(--ink-2)")}>${real ? "$" + real.toFixed(2) : "~$" + est.toFixed(2)}</span>
  </span>`;
}

function Card({ i, subs, multi, onOpen, onOpenChild, act, data, stream = EMPTY_STREAM }) {
  const st = statusChip(i);
  const done = isDone(i);
  const tmp = i._tmp || i.number < 0; // optimistic, not yet confirmed by GitHub
  const [modelSel, setModelSel] = useState(i.modelOverride ? i.modelOverride.providerId + "/" + i.modelOverride.model : "");
  useEffect(() => { setModelSel(i.modelOverride ? i.modelOverride.providerId + "/" + i.modelOverride.model : ""); }, [i.modelOverride?.providerId, i.modelOverride?.model]);

  const providers = data?.providers || [];
  const modelOpts = useMemo(() => providers.flatMap((p) => (p.models || []).map((m) => ({ value: p.id + "/" + m, short: m, provider: p.name, label: p.name + " · " + m }))), [providers]);

  // The canonical IssueState enum + BlockedReason drive the quick (CTA) action (ADR-0001).
  let quick = null;
  if (i.state === "planned" || i.state === "notPlanned" || (!i.state && !done)) quick = { action: "start", cls: "play", icon: "play", label: "Start", fn: () => act.start(i.repo, i.number) };
  else if (i.blocked === "awaitingApproval") quick = { action: "approve", cls: "", icon: "check", label: "Approve", fn: () => act.approve(i.repo, i.number) };
  else if (i.state === "review" && i.review === "changes") quick = { action: "fix", cls: "fix", icon: "wrench", label: "Fix", fn: () => act.fix(i.repo, i.number) };
  else if (i.blocked === "needsAttention") quick = { action: "resume", cls: "", icon: "refresh", label: "Resume", fn: () => act.resume(i.repo, i.number) };
  else if (i.active || i.state === "working") quick = { action: "stop", cls: "stop", icon: "stop", label: "Stop", fn: () => act.stop(i.repo, i.number) };
  const qBusy = quick && act.isBusy(quick.action, i.repo, i.number);
  const autoOn = i.auto && (i.auto.resume || i.auto.merge) && !done;

  const onPickModel = (val) => {
    setModelSel(val);
    const mo = val ? { providerId: val.split("/")[0], model: val.split("/").slice(1).join("/") } : null;
    i.modelOverride = mo;
    api("/model-override", { repo: i.repo, number: i.number, model: mo }).catch((err) => toast("Failed to save model override: " + err.message));
  };
  const runQuick = (e) => {
    e.stopPropagation();
    if (!quick) return;
    const mo = modelSel ? { providerId: modelSel.split("/")[0], model: modelSel.split("/").slice(1).join("/") } : null;
    if (quick.action === "start") act.start(i.repo, i.number, mo);
    else if (quick.action === "approve") act.approve(i.repo, i.number, mo);
    else if (quick.action === "fix") act.fix(i.repo, i.number, mo);
    else if (quick.action === "resume") act.resume(i.repo, i.number, mo);
    else quick.fn();
  };

  const engaged = !tmp && !done && (i.active || i.queued || i.running);
  const avatarsOn = (data && data.config && data.config.avatars) !== "off";
  const dotColor = tmp ? "var(--accent)" : (DOT_COLOR[st.cls] || "var(--ink-3)");
  const excerpt = stream.length ? stream[stream.length - 1].text : "";

  const live = !!(i.active || i.running);
  return html`<div class=${"bcard" + (tmp ? " busy" : "") + (live ? " live" : "")} onClick=${tmp ? null : () => onOpen(i)}>
    <div class="bcard__h">
      <${Breadcrumb} repo=${i.repo} number=${i.number} className="bcard__crumbs"/>${i.workflowId ? html`<span class="wfchip tip" data-tip=${"Workflow: " + i.workflowId}><${Icon} name="sparkles" size=${10}/> ${i.workflowId}</span>` : null}
      <span class=${"statuschip da-status " + st.cls + (live ? " da-status--live" : "")} style="margin-left:auto" data-tip=${tmp ? "creating…" : statusTip(i, st)}><span class="da-status__dot"></span>${tmp ? "creating…" : st.label}</span>
      <span class="card-hicons">
        ${i.byAgent ? html`<span class="card-byagent tip" data-tip="Created by an agent — review &amp; start"><${Icon} name="rocket" size=${11}/></span>` : null}
        ${i.conflict ? html`<span class="card-hicon tip" data-tip=${(i.conflict.files || []).join(", ") || "Merge conflict"} style="color:var(--amber)"><${Icon} name="merge" size=${14}/></span>` : null}
        ${autoOn ? html`<span class="card-hicon tip" data-tip=${"Auto-" + (i.auto.merge ? "merge" : "resume") + " on"} style="color:var(--green)"><${Icon} name=${i.auto.merge ? "merge" : "refresh"} size=${13}/></span>` : null}
        ${i.pr_number ? html`<a class="card-pr tip" data-tip=${"Open PR #" + i.pr_number} href=${i.pr_url || ghUrl(i.repo, i.pr_number)} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}><${Icon} name="pr" size=${12}/> #${i.pr_number}</a>` : null}
        ${(i.state === "planned" || i.state === "notPlanned") && i.number > 0 ? html`<button class="card-del tip" data-tip="Delete permanently" disabled=${act.isBusy("del", i.repo, i.number)} onClick=${(e) => { e.stopPropagation(); if (window.confirm("Permanently delete #" + i.number + "? This can’t be undone.")) act.del(i.repo, i.number); }}>${act.isBusy("del", i.repo, i.number) ? html`<${Spinner} size=${11}/>` : html`<${Icon} name="x" size=${13}/>`}</button>` : null}
      </span>
    </div>

    <div class="bcard__title">${i.title || "#" + i.number}</div>

    ${engaged && excerpt ? html`<div class="card-excerpt">${i.role ? html`<span class="role">${i.role}</span> ` : null}${excerpt}</div>` : null}

    ${(i.active || tmp) ? (() => {
      const sp = getSetupProgress(stream);
      if (!sp) return null;
      const pct = sp.percent == null ? null : sp.percent;
      return html`<div class="setupbar" title=${sp.phase}><div class="setupbar-track"><div class="setupbar-fill" style=${pct == null ? "width:100%" : "width:" + pct + "%"}></div></div><span class="setupbar-lbl">${pct == null ? html`<${Spinner} size=${11}/> ` : pct + "% · "}${sp.phase}</span></div>`;
    })() : null}

    <div class="bcard__flow"><${BFlow} i=${i} avatarsOn=${avatarsOn}/></div>

    ${!tmp && subs && subs.length ? html`<${SubList} subs=${subs} repo=${i.repo} onOpenChild=${onOpenChild}/>` : null}

    ${tmp ? null : (() => {
      const isStop = quick && quick.action === "stop";
      const notPlanned = quick && i.state === "planned";
      const actions = html`<div class="bcard__actions" onClick=${(e) => e.stopPropagation()}>
        ${notPlanned ? html`<button class="iconbtn-sm tip" data-tip="Close as not planned" disabled=${act.isBusy("close-not-planned", i.repo, i.number)} onClick=${(e) => { e.stopPropagation(); act.closeNotPlanned(i.repo, i.number); }}>${act.isBusy("close-not-planned", i.repo, i.number) ? html`<${Spinner} size=${13}/>` : html`<${Icon} name="x" size=${14}/>`}</button>` : null}
        ${modelOpts.length && !isStop ? html`<${ModelPicker} opts=${modelOpts} value=${modelSel} onPick=${onPickModel} defaultLogo=${defaultModelLogo(data)}/>` : null}
        ${isStop
          ? html`<button class=${"cardbtn cta stop" + (qBusy ? " busy" : "")} disabled=${qBusy} onClick=${runQuick}>${qBusy ? html`<${Spinner} size=${13}/>` : html`<${Icon} name="stop" size=${13}/>`} ${qBusy ? "working…" : quick.label}</button>`
          : quick
          ? html`<button class=${"cardbtn cta " + quick.cls + (qBusy ? " busy" : "")} disabled=${qBusy} onClick=${runQuick}>${qBusy ? html`<${Spinner} size=${13}/>` : html`<${Icon} name=${quick.icon} size=${13}/>`} ${qBusy ? "working…" : quick.label}</button>`
          : null}
      </div>`;
      return [
        html`<div class="bcard__f card-f">
          <div class="card-f-l">
            ${engaged && i.role && avatarsOn ? html`<span class="tip" data-tip=${i.role + " agent"} style="display:inline-flex"><span class="barehead" style="width:24px;height:24px"><${Avatar} role=${i.role} size=${24} crop="head"/></span></span>` : null}
            ${(i.usage && i.usage.costUsd) || (i.estCost && i.estCost.usd) ? html`<${BHeat} i=${i}/>` : html`<span class="card-time">${ago(i.updated_at)}</span>`}
          </div>
        </div>`,
        actions
      ];
    })()}
  </div>`
}

// Friendly one-line explanation of a status, for the dot tooltip.
const STATUS_TIP = {
  working: "Working on it now", ready: "Ready to merge — reviewer approved",
  changes: "Changes requested by the reviewer", "needs you": "Needs your attention — stalled",
  "approve?": "Plan posted — approve it to build", reply: "Waiting for your reply",
  planned: "Planned — not started yet", merged: "Merged", done: "Done / closed",
  closed: "Closed", queued: "Queued", "auto-resume": "Rate-limited — auto-resumes",
};
function statusTip(i, st) {
  if (st.cls === "s-epic" && i.epic) return `Epic — ${i.epic.done}/${i.epic.total} sub-issues done`;
  return STATUS_TIP[st.label] || st.label;
}

// Solid status-dot colour per status-chip class (the header dot replaces the old chip).
const DOT_COLOR = { "s-working": "var(--accent)", "s-ready": "var(--green)", "s-changes": "var(--red)", "s-attn": "var(--amber)", "s-auto": "var(--green)", "s-conflict": "var(--amber)", "s-done": "var(--ink-3)", "s-planned": "var(--ink-3)", "s-epic": "var(--purple)" };

// The per-card LLM picker: an icon button (provider logo) + custom Select menu (fixed → unclipped).
function ModelPicker({ opts, value, onPick, defaultLogo }) {
  const cur = opts.find((o) => o.value === value);
  const options = [{ value: "", label: "Default model", logo: defaultLogo || "Claude" }].concat(opts.map((o) => ({ value: o.value, label: o.short, logo: o.provider })));
  return html`<${Select} value=${value} options=${options} onChange=${onPick} btnClass="iconbtn-sm"
    trigger=${() => html`<span class="tip" data-tip=${cur ? cur.label : "Default model"} style="display:inline-flex"><${ProviderLogo} name=${cur ? cur.provider : (defaultLogo || "Claude")} size=${16}/></span>`}/>`;
}

// Collapsible sub-issue list shown on an epic parent's card. Each row carries the child's live
// status (colored dot + label) and opens the child's detail pane. Children are hidden from their
// own columns (Board nests them here) so the board isn't cluttered with the whole epic twice.
const SUB_COLOR = { planned: "var(--ink-3)", working: "var(--accent)", review: "var(--amber)", done: "var(--green)" };
function SubList({ subs, repo, onOpenChild }) {
  const col = (s) => (s.live ? classify(s.live) : s.closed ? "done" : "planned");
  const label = (s) => (s.live ? statusChip(s.live).label : s.closed ? "done" : "open");
  const done = subs.filter((s) => col(s) === "done").length;
  // Default-open when a sub-issue is waiting on you, so it isn't buried in a collapsed list.
  const needsYou = subs.some((s) => col(s) === "review");
  const [open, setOpen] = useState(needsYou);
  return html`<div class="card-subs" onClick=${(e) => e.stopPropagation()}>
    <button class=${"subtoggle" + (open ? " open" : "")} onClick=${() => setOpen((v) => !v)}>
      <span class="chev"><${Icon} name="chevron" size=${13}/></span>
      <span>Sub-issues</span>
      <span class="n">${done}/${subs.length}</span>
    </button>
    ${open ? html`<div class="sublist">
      ${subs.map((s) => html`<button class="subrow" key=${s.child} onClick=${() => onOpenChild(repo, s.child, s.title)} title="Open sub-issue">
        <span class="subdot" style=${"background:" + SUB_COLOR[col(s)]}></span>
        <span class="subnum">#${s.child}</span>
        <span class="subttl">${s.title || "#" + s.child}</span>
        <span class="substate">${label(s)}</span>
      </button>`)}
    </div>` : null}
  </div>`;
}

export function TabBar({ issues, tab, setTab }) {
  const counts = {}; COLS.forEach((c) => (counts[c.k] = 0));
  const nested = nestedChildKeys(issues); // sub-issues are nested in their epic card, not counted alone
  issues.forEach((i) => { if (!nested.has(i.repo + "#" + i.number)) counts[classify(i)]++; });
  return html`<div class="tabbar">
    ${COLS.map((c) => html`<button key=${c.k} class=${"tab " + (tab === c.k ? "on" : "")} onClick=${() => setTab(c.k)}>
      <${Icon} name=${c.icon} size=${20}/>
      <span class="bdg">${c.label}${counts[c.k] ? " · " + counts[c.k] : ""}</span>
    </button>`)}
  </div>`;
}
