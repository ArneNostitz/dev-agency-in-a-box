// Molecule — RepoPicker. The "Watching" rows + add-a-repo input + "your GitHub repos" list.
// Shared by the TopBar repo dropdown (showAuto=true → per-repo auto-resume/merge toggles) and by
// onboarding (showAuto=false → add/remove only). Fetches /repos-available on mount; since it only
// mounts when its container opens, that's a fetch-on-open. All add/remove hits the same backend.
import { html, useState, useEffect } from "/web/vendor/standalone.mjs";
import { Icon } from "../atoms/Icon.js";
import { api, getJSON } from "../../lib/api.js";
import { toast } from "../../lib/toast.js";

export function RepoPicker({ repos, reload, showAuto, autoRepos, setAuto, repoFilter, setRepoFilter, onPick, filterable }) {
  const [avail, setAvail] = useState(null);
  const [manual, setManual] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { getJSON("/repos-available").then((d) => setAvail(d.repos || [])).catch(() => setAvail([])); }, []);
  function add(full) {
    if (!full || busy) return;
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) { toast("Use owner/name, e.g. acme/app"); return; }
    setBusy(true);
    api("/add-repo", { repo: full }).then(() => { toast("Added " + full); setManual(""); if (setRepoFilter) setRepoFilter(full); reload(); }).catch(() => toast("Couldn’t add — use owner/name")).then(() => setBusy(false));
  }
  function remove(full) {
    if (busy) return; setBusy(true);
    api("/remove-repo", { repo: full }).then(() => { toast("Removed " + full); if (repoFilter === full && setRepoFilter) setRepoFilter(null); reload(); }).catch(() => toast("Couldn’t remove")).then(() => setBusy(false));
  }
  // Per-repo auto-update toggle (only rendered when showAuto). Green = on, muted = off.
  const rpill = (repo, kind) => { const on = ((autoRepos[repo] || {})[kind] || "") === "on"; const tip = "Auto-" + kind + " — " + (on ? "ON" : "OFF"); return html`<button class=${"apill " + (on ? "on" : "off")} aria-label=${tip} data-tip=${tip} onClick=${(e) => { e.stopPropagation(); setAuto(kind, on ? "off" : "on", repo); }}><${Icon} name=${kind === "resume" ? "refresh" : "merge"} size=${12}/> <span class="apill-label">${kind}</span></button>`; };

  const watching = repos || [];
  const q = filter.trim().toLowerCase();
  const addable = (avail || []).filter((r) => !watching.includes(r.full_name)).filter((r) => !q || r.full_name.toLowerCase().includes(q));
  const cap = filterable ? 100 : 30;
  return html`
    ${watching.length ? html`<div class="dropmenu-h">Watching</div>` : null}
    ${watching.map((r) => html`<div class=${"repodrop-row" + (repoFilter === r ? " sel" : "")} key=${r}>
      <button class="repodrop-pick" disabled=${!onPick} onClick=${() => onPick && onPick(r)}><${Icon} name="pr" size=${13}/> <span class="repodrop-rowner">${r.split("/")[0]}/</span><span class="repodrop-rname">${r.split("/").pop()}</span></button>
      <div class="repodrop-ctl">
        ${showAuto ? html`<div class="autorow" style="margin:0">${rpill(r, "resume")}${rpill(r, "merge")}</div>` : null}
        <button class="repodrop-x" disabled=${busy} aria-label=${"Remove " + r} data-tip="Stop watching" onClick=${() => remove(r)}><${Icon} name="trash" size=${14}/></button>
      </div>
    </div>`)}
    <div class="dropmenu-h">Add a repo</div>
    <div class="repodrop-add">
      <input placeholder="owner/name" value=${manual} onInput=${(e) => setManual(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") add(manual.trim()); }}/>
      <button class="btn primary" disabled=${busy} onClick=${() => add(manual.trim())}>Add</button>
    </div>
    ${filterable && (avail || []).length > 6 ? html`<div class="searchrow"><${Icon} name="search" size=${15} cls="searchic"/><input placeholder="Filter your repos…" value=${filter} onInput=${(e) => setFilter(e.target.value)} autocomplete="off"/>${filter ? html`<button class="iconbtn" style="width:30px;height:30px;border:none" onClick=${() => setFilter("")} aria-label="Clear"><${Icon} name="x" size=${15}/></button>` : null}</div>` : null}
    ${avail === null ? html`<div class="dropmenu-empty">Loading your repos…</div>`
      : addable.length ? html`<div class="repodrop-avail">${addable.slice(0, cap).map((r) => html`<button class="dropmenu-item" key=${r.full_name} disabled=${busy} onClick=${() => add(r.full_name)}><${Icon} name="plus" size=${13}/> ${r.full_name}</button>`)}</div>`
      : q ? html`<div class="dropmenu-empty">No repos match “${filter}”.</div>`
      : null}`;
}
