// Dev Agency dashboard — usage module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect } from "/web/vendor/standalone.mjs";
import { Sheet, fmtTok, getJSON, shortModel } from "./core.js";


function UsageBar({ label, sub, value, max }) {
  const pct = Math.round((100 * (value || 0)) / (max || 1));
  return html`<div class="useg-row">
    <span class="useg-row-l">${label}${sub ? html` <span class="muted">${sub}</span>` : null}</span>
    <span class="useg-track"><i style=${"width:" + Math.max(2, pct) + "%"}></i></span>
    <span class="useg-row-r">${fmtTok(value)} tok</span>
  </div>`;
}

export function Usage({ onClose, onOpenIssue }) {
  const [range, setRange] = useState("window");
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setD(null); setErr(false);
    getJSON("/usage?range=" + range)
      .then((r) => { if (live) setD(r); })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [range]);
  const RANGES = [["today", "Today"], ["window", "Window"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All"]];
  const maxOf = (arr, k) => Math.max(1, ...(arr || []).map((x) => x[k] || 0));
  return html`<${Sheet} title="Token usage" onClose=${onClose}>
    <div class="useg-tabs">
      ${RANGES.map(([k, l]) => html`<button key=${k} class=${"useg-tab" + (range === k ? " on" : "")} onClick=${() => setRange(k)}>${l}</button>`)}
    </div>
    ${err ? html`<div class="muted">Couldn't load usage.</div>`
      : !d ? html`<div class="muted">Loading…</div>`
      : html`
        <div class="useg-totals">
          <div class="useg-big"><b>${fmtTok(d.total && d.total.tokens)}</b><span>tokens</span></div>
          <div class="useg-big"><b>${(d.total && d.total.runs) || 0}</b><span>runs</span></div>
        </div>
        <div class="useg-sec">By model</div>
        ${(d.byModel && d.byModel.length)
          ? d.byModel.map((m) => html`<${UsageBar} key=${m.model} label=${shortModel(m.model)} value=${m.tokens} max=${maxOf(d.byModel, "tokens")}/>`)
          : html`<div class="muted">No usage in this range.</div>`}
        <div class="useg-sec">By agent role</div>
        ${(d.byRole && d.byRole.length)
          ? d.byRole.map((r) => html`<${UsageBar} key=${r.role || "?"} label=${r.role || "—"} sub=${(r.runs || 0) + " runs"} value=${r.tokens} max=${maxOf(d.byRole, "tokens")}/>`)
          : html`<div class="muted">No role-tagged usage yet.</div>`}
        <div class="useg-sec">Most token-heavy issues</div>
        ${(d.topIssues && d.topIssues.length)
          ? d.topIssues.map((i) => html`<button class="useg-issue" key=${i.repo + "#" + i.number} onClick=${() => { onClose(); onOpenIssue && onOpenIssue(i.repo, i.number); }}>
              <span class="useg-row-l">${String(i.repo || "").split("/").pop()} <b>#${i.number}</b> <span class="muted">${(i.runs || 0) + " runs"}</span></span>
              <span class="useg-track"><i style=${"width:" + Math.max(2, Math.round((100 * i.tokens) / maxOf(d.topIssues, "tokens"))) + "%"}></i></span>
              <span class="useg-row-r">${fmtTok(i.tokens)} tok</span>
            </button>`)
          : html`<div class="muted">No per-issue data yet (older runs weren't tagged).</div>`}
        <div class="useg-sec">Per day</div>
        ${(d.byDay && d.byDay.length)
          ? d.byDay.map((day) => html`<${UsageBar} key=${day.day} label=${String(day.day).slice(5)} value=${day.tokens} max=${maxOf(d.byDay, "tokens")}/>`)
          : html`<div class="muted">No daily data.</div>`}
      `}
  <//>`;
}
