// Dev Agency dashboard — board module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect } from "/web/vendor/standalone.mjs";
import { Avatar, COLS, Icon, Spinner, ago, api, classify, fmtTok, ghUrl, isDone, shortModel, sortCmp, statusChip, toast, usageTitle } from "./core.js";

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

export function Board({ issues, repos, repoFilter, tab, sort, isDesktop, onOpen, onOpenChild, onAddRepo, onAddIssue, onAnalyze, auditRepos, act, data }) {
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

  const byCol = {}; COLS.forEach((c) => (byCol[c.k] = []));
  issues
    .filter((i) => !nested.has(i.repo + "#" + i.number)) // nested under its epic instead
    .slice()
    .sort(sortCmp(sort))
    .forEach((i) => byCol[classify(i)].push(i));
  const cols = isDesktop ? COLS : COLS.filter((c) => c.k === tab);
  return html`<div class="board">
    ${cols.map((c) => html`<div class="col" key=${c.k}>
      <div class="colhead"><${Icon} name=${c.icon} size=${15}/> ${c.label} <span class="n">${byCol[c.k].length || ""}</span></div>
      ${c.k === "planned" ? html`<div class="planned-actions">
        <button class="colbtn primary" onClick=${() => onAddIssue(target)}><${Icon} name="plus" size=${14}/> Add Issue</button>
        <button class="colbtn" disabled=${!target || analyzing} title=${target ? "Analyze " + target.split("/").pop() + "'s codebase health" : "Pick a repo first"} onClick=${() => target && onAnalyze(target)}>${analyzing ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="search" size=${14}/>`} Analyze Repo</button>
      </div>` : null}
      <div class="cards">
        ${byCol[c.k].length ? byCol[c.k].map((i) => html`<${Card} key=${i.repo + "#" + i.number} i=${i} subs=${subsFor(i)} multi=${!repoFilter && repos.length > 1} onOpen=${onOpen} onOpenChild=${onOpenChild} act=${act} data=${data}/>`) : html`<div class="empty">—</div>`}
      </div>
    </div>`)}
  </div>`;
}

function Card({ i, subs, multi, onOpen, onOpenChild, act, data }) {
  const st = statusChip(i);
  const done = isDone(i);
  const tmp = i._tmp || i.number < 0; // optimistic, not yet confirmed by GitHub
  const [modelSel, setModelSel] = useState(
    i.modelOverride ? i.modelOverride.providerId + "/" + i.modelOverride.model : ""
  );
  useEffect(() => {
    setModelSel(i.modelOverride ? i.modelOverride.providerId + "/" + i.modelOverride.model : "");
  }, [i.modelOverride?.providerId, i.modelOverride?.model]);

  const providers = data?.providers || [];
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ value: p.id + "/" + m, label: p.name + " / " + m })));

  let quick = null;
  if (i.state === "planned" || (!i.state && !done)) quick = { action: "start", cls: "play", icon: "play", label: "start", fn: () => act.start(i.repo, i.number) };
  else if (i.state === "agency:awaiting-approval") quick = { action: "approve", cls: "", icon: "check", label: "approve", fn: () => act.approve(i.repo, i.number) };
  else if (i.state === "agency:ready" && i.review === "changes") quick = { action: "fix", cls: "fix", icon: "wrench", label: "fix", fn: () => act.fix(i.repo, i.number) };
  else if (i.state === "agency:needs-attention") quick = { action: "resume", cls: "", icon: "refresh", label: "resume", fn: () => act.resume(i.repo, i.number) };
  else if (i.active || i.state === "agency:in-progress" || i.state === "agency:rate-limited") quick = { action: "stop", cls: "stop", icon: "stop", label: "stop", fn: () => act.stop(i.repo, i.number) };
  const qBusy = quick && act.isBusy(quick.action, i.repo, i.number);
  const autoOn = i.auto && (i.auto.resume || i.auto.merge) && !done;

  const selectModel = (e) => {
    e.stopPropagation();
    const val = e.target.value;
    setModelSel(val);
    let mo = null;
    if (val) {
      const parts = val.split("/");
      mo = { providerId: parts[0], model: parts.slice(1).join("/") };
    }
    i.modelOverride = mo;
    api("/model-override", { repo: i.repo, number: i.number, model: mo }).catch((err) => {
      toast("Failed to save model override: " + err.message);
    });
  };

  const runQuick = (e) => {
    e.stopPropagation();
    if (!quick) return;
    let mo = null;
    if (modelSel) {
      const parts = modelSel.split("/");
      mo = { providerId: parts[0], model: parts.slice(1).join("/") };
    }
    if (quick.action === "start") act.start(i.repo, i.number, mo);
    else if (quick.action === "approve") act.approve(i.repo, i.number, mo);
    else if (quick.action === "fix") act.fix(i.repo, i.number, mo);
    else if (quick.action === "resume") act.resume(i.repo, i.number, mo);
    else quick.fn();
  };

  // Avatar shows ONLY while an agent is actively executing on this issue (same signal as the Working
  // column) — never on review / needs-you / planned / done. A parked issue's last role is stale
  // (e.g. it sat in "developer" before going to review), so showing it there is misleading.
  const engaged = !tmp && !done && (i.active || i.queued || i.running);
  const avatarsOn = (data && data.config && data.config.avatars) !== "off";
  return html`<div class=${"card" + (tmp ? " busy" : "") + (i.active ? " active-now" : "")} title=${usageTitle(i.usage)} onClick=${tmp ? null : () => onOpen(i)}>
    <div class="card-h">
      <span class="card-repo">${i.repo.split("/").pop()}</span>
      <span class="spacer" style="margin-left:auto"></span>
      ${engaged && i.role && avatarsOn ? html`<${Avatar} role=${i.role} size=${28} crop="head"/>` : null}
    </div>
    <div class="card-title">${(i.active || tmp) ? html`<${Spinner} size=${13}/> ` : null}${i.title || "#" + i.number}</div>
    <div class="card-chips">
      ${tmp
        ? html`<span class="statuschip s-working"><${Spinner} size=${12}/> ${i.state === "agency:in-progress" ? "creating & starting…" : "creating…"}</span>`
        : html`<span class=${"statuschip " + st.cls}><${Icon} name=${st.icon} size=${12}/> ${st.label}</span>`}
      ${i.active && !tmp ? html`<span class="dot"></span>` : null}
      ${autoOn ? html`<span class="statuschip s-auto"><${Icon} name=${i.auto.merge ? "merge" : "refresh"} size=${12}/> auto</span>` : null}
      ${i.conflict ? html`<span class="statuschip s-conflict" title=${(i.conflict.files || []).join(", ") || "Merge conflicts with main"}><${Icon} name="merge" size=${12}/> conflict</span>` : null}
      ${i.pr_number ? html`<a class="tagk" href=${i.pr_url || ghUrl(i.repo, i.pr_number)} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}><${Icon} name="pr" size=${11}/> #${i.pr_number}</a>` : null}
      ${i.usage && i.usage.tokens ? html`<span class="tagk" title=${usageTitle(i.usage)}><${Icon} name="chart" size=${11}/> ${fmtTok(i.usage.tokens)}${i.usage.model ? " · " + shortModel(i.usage.model) : ""}</span>` : null}
    </div>
    ${!tmp && subs && subs.length ? html`<${SubList} subs=${subs} repo=${i.repo} onOpenChild=${onOpenChild}/>` : null}
    ${tmp ? null : html`<div class="card-f" onClick=${(e) => e.stopPropagation()}>
      ${quick ? html`
        ${i.state === "planned" ? html`<button class="cardbtn" title="Close as not planned" disabled=${act.isBusy("close-not-planned", i.repo, i.number)} onClick=${(e) => { e.stopPropagation(); act.closeNotPlanned(i.repo, i.number); }}>${act.isBusy("close-not-planned", i.repo, i.number) ? html`<${Spinner} size=${13}/>` : html`<${Icon} name="x" size=${13}/>`} not planned</button>` : null}
        ${modelOpts.length && quick.action !== "stop" ? html`
          <select class="modelsel sm" value=${modelSel} onChange=${selectModel}>
            <option value="">Default model</option>
            ${modelOpts.map((o) => html`<option key=${o.value} value=${o.value}>${o.label.split(" / ").pop()}</option>`)}
          </select>
        ` : null}
        <button class=${"cardbtn " + quick.cls + (qBusy ? " busy" : "")} disabled=${qBusy} onClick=${runQuick}>${qBusy ? html`<${Spinner} size=${13}/>` : html`<${Icon} name=${quick.icon} size=${13}/>`} ${qBusy ? "working…" : quick.label}</button>
      ` : html`<span style="color:var(--ink-3);font-size:12px">${ago(i.updated_at)}</span>`}
    </div>`}
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
