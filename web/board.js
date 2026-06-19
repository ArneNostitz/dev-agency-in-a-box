// Dev Agency dashboard — board module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect } from "/web/vendor/standalone.mjs";
import { Avatar, COLS, Icon, Spinner, ago, api, boardSortCmp, classify, filterByTime, fmtTok, getSetupProgress, ghUrl, isDone, shortModel, statusChip, toast, usageTitle } from "./core.js";

// ---------- sort / group / time options ----------
const SORT_OPTS = [
  { v: "updated_desc", label: "Recently updated" },
  { v: "updated_asc",  label: "Oldest updated" },
  { v: "created_desc", label: "Newest" },
  { v: "created_asc",  label: "Oldest" },
  { v: "number_asc",   label: "Issue # ↑" },
  { v: "number_desc",  label: "Issue # ↓" },
];
const TIME_OPTS = [
  { v: "any", label: "Any time" },
  { v: "24h", label: "Last 24h" },
  { v: "7d",  label: "Last 7 days" },
  { v: "30d", label: "Last 30 days" },
];

function BoardControls({ boardSort, setBoardSort, boardGroup, setBoardGroup, boardTime, setBoardTime }) {
  return html`<div class="bctrl">
    <span class="bctrl-group">
      <span class="bctrl-label">Sort</span>
      <select value=${boardSort} onChange=${(e) => setBoardSort(e.target.value)}>
        ${SORT_OPTS.map((o) => html`<option key=${o.v} value=${o.v}>${o.label}</option>`)}
      </select>
    </span>
    <span class="bctrl-group">
      <span class="bctrl-label">Group</span>
      <select value=${boardGroup} onChange=${(e) => setBoardGroup(e.target.value)}>
        <option value="state">Workflow state</option>
        <option value="repo">Repo</option>
      </select>
    </span>
    <span class="bctrl-group">
      <span class="bctrl-label">Updated</span>
      <select value=${boardTime} onChange=${(e) => setBoardTime(e.target.value)}>
        ${TIME_OPTS.map((o) => html`<option key=${o.v} value=${o.v}>${o.label}</option>`)}
      </select>
    </span>
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

export function Board({ issues, repos, repoFilter, tab, isDesktop, onOpen, onOpenChild, onAddRepo, onAddIssue, onAnalyze, auditRepos, act, data }) {
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

  // The Add Issue / Analyze buttons act on the active repo. With "All" + multiple repos there's no
  // single target: Add Issue still opens the composer (it has a repo picker); Analyze is disabled.
  const target = repoFilter || (repos.length === 1 ? repos[0] : null);
  const analyzing = target && (auditRepos || []).includes(target);

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

  const renderCard = (i) => html`<${Card} key=${i.repo + "#" + i.number} i=${i} subs=${subsFor(i)} multi=${!repoFilter && repos.length > 1} onOpen=${onOpen} onOpenChild=${onOpenChild} act=${act} data=${data}/>`;
  const controls = html`<${BoardControls} boardSort=${boardSort} setBoardSort=${setBoardSort} boardGroup=${boardGroup} setBoardGroup=${setBoardGroup} boardTime=${boardTime} setBoardTime=${setBoardTime}/>`;

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
            <button class="colbtn" disabled=${!target || analyzing} title=${target ? "Analyze " + target.split("/").pop() + "'s codebase health" : "Pick a repo first"} onClick=${() => target && onAnalyze(target)}>${analyzing ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="search" size=${14}/>`} Analyze Repo</button>
          </div>` : null}
          <div class="cards">
            ${allItems.length ? allItems.map(renderCard) : html`<div class="empty">—</div>`}
          </div>
        </div>`;
      })}
    </div>`;
  } else {
    // --- group by repo ---
    const repoList = repos.filter((r) => !repoFilter || r === repoFilter);
    sortedAll
      .filter((i) => !nested.has(i.repo + "#" + i.number))
      .forEach((i) => { if (!repoList.includes(i.repo)) repoList.push(i.repo); });
    boardContent = html`<div class="board group-repo">
      ${repoList.map((r) => {
        const allItems = sortedAll.filter((i) => i.repo === r && !nested.has(i.repo + "#" + i.number));
        const short = r.split("/").pop();
        const rAnalyzing = (auditRepos || []).includes(r);
        return html`<div class="col" key=${r}>
          <div class="colhead"><${Icon} name="pr" size=${15}/> ${short} <span class="n">${allItems.length || ""}</span></div>
          <div class="planned-actions">
            <button class="colbtn primary" onClick=${() => onAddIssue(r)}><${Icon} name="plus" size=${14}/> Add Issue</button>
            <button class="colbtn" disabled=${rAnalyzing} onClick=${() => onAnalyze(r)}>${rAnalyzing ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="search" size=${14}/>`} Analyze</button>
          </div>
          <div class="cards">
            ${allItems.length ? allItems.map(renderCard) : html`<div class="empty">—</div>`}
          </div>
        </div>`;
      })}
    </div>`;
  }

  return html`<div>${controls}${boardContent}</div>`;

}

function Card({ i, subs, multi, onOpen, onOpenChild, act, data }) {
  const st = statusChip(i);
  const done = isDone(i);
  const tmp = i._tmp || i.number < 0; // optimistic, not yet confirmed by GitHub
  const [modelSel, setModelSel] = useState(i.modelOverride ? i.modelOverride.providerId + "/" + i.modelOverride.model : "");
  useEffect(() => { setModelSel(i.modelOverride ? i.modelOverride.providerId + "/" + i.modelOverride.model : ""); }, [i.modelOverride?.providerId, i.modelOverride?.model]);

  const providers = data?.providers || [];
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ value: p.id + "/" + m, short: m, provider: p.name, label: p.name + " · " + m })));

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
  const stream = (data && data.activity && data.activity.filter((a) => a.repo === i.repo && a.number === i.number)) || [];
  const excerpt = stream.length ? stream[stream.length - 1].text : "";

  return html`<div class=${"card" + (tmp ? " busy" : "") + (i.active ? " active-now" : "")} onClick=${tmp ? null : () => onOpen(i)}>
    <div class="card-h">
      <span class="statusdot tip" data-tip=${tmp ? "creating…" : st.label} style=${"background:" + dotColor}>${tmp ? html`<${Spinner} size=${10}/>` : html`<${Icon} name=${st.icon} size=${11}/>`}</span>
      <span class="card-repo">${i.repo.split("/").pop()}</span>
      <span class="card-num">#${i.number > 0 ? i.number : "…"}</span>
      <span class="card-hicons">
        ${i.conflict ? html`<span class="card-hicon tip" data-tip=${(i.conflict.files || []).join(", ") || "Merge conflict"} style="color:var(--amber)"><${Icon} name="merge" size=${14}/></span>` : null}
        ${autoOn ? html`<span class="card-hicon tip" data-tip=${"Auto-" + (i.auto.merge ? "merge" : "resume") + " on"} style="color:var(--green)"><${Icon} name=${i.auto.merge ? "merge" : "refresh"} size=${13}/></span>` : null}
        ${i.pr_number ? html`<a class="card-hicon tip" data-tip=${"PR #" + i.pr_number} href=${i.pr_url || ghUrl(i.repo, i.pr_number)} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}><${Icon} name="pr" size=${13}/></a>` : null}
      </span>
    </div>

    <div class="card-m">
      <div class="card-title">${i.title || "#" + i.number}</div>
      <div class="card-meta">
        ${engaged && i.role && avatarsOn ? html`<${Avatar} role=${i.role} size=${20} crop="head"/>` : null}
        ${engaged && i.role ? html`<span class="role">${i.role}</span>` : null}
        <span class="card-excerpt">${excerpt || (i.usage && i.usage.tokens ? fmtTok(i.usage.tokens) + " tok" + (i.usage.model ? " · " + shortModel(i.usage.model) : "") : ago(i.updated_at))}</span>
      </div>
      ${(i.active || tmp) ? (() => {
        const sp = getSetupProgress(stream);
        if (!sp) return null;
        const pct = sp.percent == null ? null : sp.percent;
        return html`<div class="setupbar" title=${sp.phase}><div class="setupbar-track"><div class="setupbar-fill" style=${pct == null ? "width:100%" : "width:" + pct + "%"}></div></div><span class="setupbar-lbl">${pct == null ? html`<${Spinner} size=${11}/> ` : pct + "% · "}${sp.phase}</span></div>`;
      })() : null}
    </div>

    ${!tmp && subs && subs.length ? html`<${SubList} subs=${subs} repo=${i.repo} onOpenChild=${onOpenChild}/>` : null}

    ${tmp ? null : html`<div class="card-f" onClick=${(e) => e.stopPropagation()}>
      ${modelOpts.length && (!quick || quick.action !== "stop") ? html`<${ModelPicker} opts=${modelOpts} value=${modelSel} onPick=${onPickModel}/>` : null}
      ${quick && i.state === "planned" ? html`<button class="iconbtn-sm tip" data-tip="Close as not planned" disabled=${act.isBusy("close-not-planned", i.repo, i.number)} onClick=${(e) => { e.stopPropagation(); act.closeNotPlanned(i.repo, i.number); }}>${act.isBusy("close-not-planned", i.repo, i.number) ? html`<${Spinner} size=${13}/>` : html`<${Icon} name="x" size=${14}/>`}</button>` : null}
      ${quick
        ? html`<button class=${"cardbtn cta " + quick.cls + (qBusy ? " busy" : "")} disabled=${qBusy} onClick=${runQuick}>${qBusy ? html`<${Spinner} size=${13}/>` : html`<${Icon} name=${quick.icon} size=${13}/>`} ${qBusy ? "working…" : quick.label}</button>`
        : html`<span class="card-time">${ago(i.updated_at)}</span>`}
    </div>`}
  </div>`;
}

// Solid status-dot colour per status-chip class (the header dot replaces the old chip).
const DOT_COLOR = { "s-working": "var(--accent)", "s-ready": "var(--green)", "s-changes": "var(--red)", "s-attn": "var(--amber)", "s-auto": "var(--green)", "s-conflict": "var(--amber)", "s-done": "var(--ink-3)", "s-planned": "var(--ink-3)", "s-epic": "var(--purple)" };

// A rough provider logo (we don't ship brand SVGs) for the model picker icon button.
function providerLogo(name) {
  const n = (name || "").toLowerCase();
  if (!n) return "flask";
  if (n.includes("claude") || n.includes("anthropic")) return "crown";
  if (n.includes("custom")) return "settings";
  return "globe";
}

// The per-card LLM picker: an icon button (provider logo) that opens a custom dropdown of models.
function ModelPicker({ opts, value, onPick }) {
  const [open, setOpen] = useState(false);
  const cur = opts.find((o) => o.value === value);
  return html`<div class="mp">
    <button class="iconbtn-sm tip" data-tip=${cur ? cur.label : "Default model"} onClick=${(e) => { e.stopPropagation(); setOpen((o) => !o); }}><${Icon} name=${providerLogo(cur ? cur.provider : null)} size=${15}/></button>
    ${open ? html`<div class="mpscrim" onClick=${(e) => { e.stopPropagation(); setOpen(false); }}></div>
      <div class="mpmenu">
        <button class=${"mpitem" + (!value ? " on" : "")} onClick=${(e) => { e.stopPropagation(); onPick(""); setOpen(false); }}><${Icon} name="flask" size=${13}/> Default model</button>
        ${opts.map((o) => html`<button key=${o.value} class=${"mpitem" + (o.value === value ? " on" : "")} onClick=${(e) => { e.stopPropagation(); onPick(o.value); setOpen(false); }}><${Icon} name=${providerLogo(o.provider)} size=${13}/> ${o.short}</button>`)}
      </div>` : null}
  </div>`;
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
