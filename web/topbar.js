// Dev Agency dashboard — topbar module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect } from "/web/vendor/standalone.mjs";
import { Icon, Spinner, ago, api, getJSON, hm, toast } from "./core.js";
import { Settings } from "./settings.js";
import { Usage } from "./usage.js";


export function SecretBanner({ h, onFix }) {
  const msgs = [];
  if (!h.masterKey) msgs.push("MASTER_KEY isn’t configured on the server — stored tokens can’t be encrypted/decrypted, so agents fall back to env credentials (usually a 401). Set a stable MASTER_KEY (openssl rand -hex 32) and re-enter your tokens.");
  const names = { claude_token: "Claude token", anthropic_api_key: "Anthropic API key", github_bot_token: "GitHub bot token", github_user_token: "GitHub user token" };
  const bad = Object.keys(names).filter((k) => h[k] === "undecryptable").map((k) => names[k]);
  if (bad.length) msgs.push("Your stored " + bad.join(", ") + " can’t be decrypted — MASTER_KEY changed since you saved " + (bad.length > 1 ? "them" : "it") + ". Re-enter " + (bad.length > 1 ? "them" : "it") + " (the agency is falling back to env credentials, which usually 401s).");
  if (!msgs.length) return null;
  return html`<div class="secbanner"><b>⚠ Credentials need attention.</b> ${msgs.map((m, i) => html`<div key=${i} style="margin-top:3px">${m}</div>`)} <button class="btn ghost" style="margin-top:7px" onClick=${onFix}>Open Settings</button></div>`;
}

export function TopBar({ working, scanning, env, theme, setTheme, onSettings, onUsage, onAgents, repos, repoFilter, setRepoFilter, reload, auto, autoRepos, setAuto }) {
  const [refreshing, setRefreshing] = useState(false);
  // Spin only while this manual refresh is in flight, and ALWAYS time out — never tie the spinner to
  // the global scan flag (a long/continuous background scan would make it spin forever).
  useEffect(() => { if (!refreshing) return; const t = setTimeout(() => setRefreshing(false), 8000); return () => clearTimeout(t); }, [refreshing]);
  const reloadBusy = refreshing;
  function reloadGithub() { if (refreshing) return; setRefreshing(true); api("/refresh", {}).then(() => toast("Reloading from GitHub…")).catch(() => toast("Couldn’t reach the server", "error")); setTimeout(reload, 1500); setTimeout(reload, 4000); }
  return html`<div class="topbar">
    <div class="brand"><${Icon} name="crown" size=${18}/> <span class="brandname">Dev Agency in a Box</span> ${env === "development" ? html`<span class="envbadge">DEV</span>` : null} ${working ? html`<span class="dot"></span>` : null}</div>
    <div class="spacer"></div>
    <${RepoDropdown} repos=${repos} repoFilter=${repoFilter} setRepoFilter=${setRepoFilter} reload=${reload} auto=${auto} autoRepos=${autoRepos} setAuto=${setAuto}/>
    <div class="spacer"></div>
    <button class="iconbtn" aria-label="Reload from GitHub" title=${reloadBusy ? "Reloading from GitHub…" : "Reload issues from GitHub"} disabled=${reloadBusy} onClick=${reloadGithub}>${reloadBusy ? html`<${Spinner} size=${18}/>` : html`<${Icon} name="refresh"/>`}</button>
    <button class="iconbtn" aria-label="Agents" title="Agents editor" onClick=${onAgents}><${Icon} name="users"/></button>
    <button class="iconbtn" aria-label="Token usage" title="Token usage statistics" onClick=${onUsage}><${Icon} name="chart"/></button>
    <button class="iconbtn" aria-label="Toggle theme" onClick=${() => setTheme(theme === "dark" ? "light" : "dark")}><${Icon} name=${theme === "dark" ? "sun" : "moon"}/></button>
    <button class="iconbtn" aria-label="Settings" onClick=${onSettings}><${Icon} name="settings"/></button>
  </div>`;
}

// Centered repo selector that doubles as repo add/remove (replaces the pill row + Add modal).
function RepoDropdown({ repos, repoFilter, setRepoFilter, reload, auto, autoRepos, setAuto }) {
  const [open, setOpen] = useState(false);
  const [avail, setAvail] = useState(null);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && avail === null) getJSON("/repos-available").then((d) => setAvail(d.repos || [])).catch(() => setAvail([])); }, [open]);
  function add(full) {
    if (!full || busy) return;
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) { toast("Use owner/name, e.g. acme/app"); return; }
    setBusy(true);
    api("/add-repo", { repo: full }).then(() => { toast("Added " + full); setManual(""); setRepoFilter(full); reload(); }).catch(() => toast("Couldn’t add — use owner/name")).then(() => setBusy(false));
  }
  function remove(full) {
    if (busy) return; setBusy(true);
    api("/remove-repo", { repo: full }).then(() => { toast("Removed " + full); if (repoFilter === full) setRepoFilter(null); reload(); }).catch(() => toast("Couldn’t remove")).then(() => setBusy(false));
  }
  
  const gpill = (kind) => { const raw = auto[kind] || ""; const on = raw === "on", off = raw === "off"; const order = ["", "on", "off"]; const nx = order[(order.indexOf(raw) + 1) % 3]; return html`<button class=${"apill " + (on ? "on" : off ? "off" : "")} onClick=${(e) => { e.stopPropagation(); setAuto(kind, nx === "" ? "inherit" : nx); }}><${Icon} name=${kind === "resume" ? "refresh" : "merge"} size=${12}/> ${kind}</button>`; };
  const rpill = (repo, kind) => { const raw = (autoRepos[repo] || {})[kind] || ""; const on = raw === "on", off = raw === "off"; const order = ["", "on", "off"]; const nx = order[(order.indexOf(raw) + 1) % 3]; return html`<button class=${"apill " + (on ? "on" : off ? "off" : "")} onClick=${(e) => { e.stopPropagation(); setAuto(kind, nx === "" ? "inherit" : nx, repo); }}><${Icon} name=${kind === "resume" ? "refresh" : "merge"} size=${12}/> ${kind}</button>`; };

  const watching = repos || [];
  const addable = (avail || []).filter((r) => !watching.includes(r.full_name));
  const title = repoFilter ? repoFilter.split("/").pop() : "All";
  return html`<div class="dropwrap repodrop">
    <button class="repodrop-btn" onClick=${() => setOpen((o) => !o)}>
      <span class="repodrop-title">${title}</span>${repoFilter ? null : html` <span class="repodrop-sub">(add/remove repos)</span>`}
      <${Icon} name=${open ? "x" : "planned"} size=${15}/>
    </button>
    ${open ? html`<div class="dropscrim" onClick=${() => setOpen(false)}></div>
      <div class="dropmenu repodrop-menu" style="min-width:300px">
        <button class=${"dropmenu-item" + (repoFilter ? "" : " sel")} onClick=${() => { setRepoFilter(null); setOpen(false); }}>
          <div style="flex:1;display:flex;align-items:center"><${Icon} name="layers" size=${14}/> All repos</div>
          <div class="autorow" style="margin:0">${gpill("resume")}${gpill("merge")}</div>
        </button>
        ${watching.length ? html`<div class="dropmenu-h">Watching</div>` : null}
        ${watching.map((r) => html`<div class=${"repodrop-row" + (repoFilter === r ? " sel" : "")} key=${r}>
          <button class="repodrop-pick" onClick=${() => { setRepoFilter(r); setOpen(false); }} style="flex:1;overflow:hidden;text-overflow:ellipsis"><${Icon} name="pr" size=${13}/> ${r}</button>
          <div class="autorow" style="margin:0">${rpill(r, "resume")}${rpill(r, "merge")}</div>
          <button class="repodrop-x" disabled=${busy} aria-label=${"Remove " + r} title="Stop watching" onClick=${() => remove(r)}><${Icon} name="trash" size=${14}/></button>
        </div>`)}
        <div class="dropmenu-h">Add a repo</div>
        <div class="repodrop-add">
          <input placeholder="owner/name" value=${manual} onInput=${(e) => setManual(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") add(manual.trim()); }}/>
          <button class="btn primary" disabled=${busy} onClick=${() => add(manual.trim())}>Add</button>
        </div>
        ${avail === null ? html`<div class="dropmenu-empty">Loading your repos…</div>`
          : addable.length ? html`<div class="repodrop-avail">${addable.slice(0, 30).map((r) => html`<button class="dropmenu-item" key=${r.full_name} disabled=${busy} onClick=${() => add(r.full_name)}><${Icon} name="plus" size=${13}/> ${r.full_name}</button>`)}</div>`
          : null}
      </div>` : null}
  </div>`;
}
// Format a Date for a datetime-local input ("YYYY-MM-DDTHH:MM" in local time).
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
}
function analyzerStatus(an) {
  if (!an || !an.enabled) return null;
  if (!an.lastPull) return { cls: "amber", text: "analyzer connecting…", title: "Telemetry API is enabled but the analyzer hasn't checked in yet." };
  const mins = (Date.now() - new Date(an.lastPull).getTime()) / 60000;
  const seen = "analyzer " + ago(an.lastPull) + " ago";
  // It polls on its own interval (hours); "stale" only if we haven't heard from it in ~half a day.
  const stale = mins > 12 * 60;
  return { cls: stale ? "amber" : "green", text: seen, title: "Analyzer last pulled telemetry " + new Date(an.lastPull).toLocaleString() + (an.lastIssueAt ? "\nLast proposal: " + new Date(an.lastIssueAt).toLocaleString() : "") };
}
export function StatusLine({ working, session, spend, analyzer, reload, sort, setSort, offlineQ, syncing }) {
  const an = analyzerStatus(analyzer);
  const s = session || {};
  const pct = s.budget > 0 ? Math.min(100, Math.round((100 * s.tokens) / s.budget)) : 0;
  const col = pct >= 90 ? "var(--red)" : pct >= 70 ? "var(--amber)" : "var(--green)";
  const [ver, setVer] = useState(null);
  const [pop, setPop] = useState(null); // "usage" | "window" | null
  const [bud, setBud] = useState(s.budget || 0);
  const [pctNow, setPctNow] = useState(pct);
  const [win, setWin] = useState(s.windowHours || 5);
  const [start, setStart] = useState(() => toLocalInput(s.windowStart ? new Date(s.windowStart) : new Date()));
  const [anUrl, setAnUrl] = useState((analyzer && analyzer.url) || "");
  const [anBusy, setAnBusy] = useState(false);

  useEffect(() => { getJSON("/web/version.json").then(setVer).catch(() => setVer(null)); }, []);
  const verTitle = ver ? (ver.label || ("Build " + (ver.version || "?") + (ver.sha ? " · commit " + ver.sha : "") + (ver.builtAt ? " · built " + new Date(ver.builtAt).toLocaleString() : ""))) : "Development build (not from a Docker image)";
  const verLabel = ver ? (ver.label || ("v" + (ver.version || "?") + (ver.builtAt ? " · " + ago(ver.builtAt) : ""))) : "dev";

  function openUsage() { setBud(s.budget || 0); setPctNow(pct); setPop(pop === "usage" ? null : "usage"); }
  function openWindow() { setWin(s.windowHours || 5); setStart(toLocalInput(s.windowStart ? new Date(s.windowStart) : new Date())); setPop(pop === "window" ? null : "window"); }
  function saveUsage() { api("/settings", { budget: Number(bud) || 0, pctNow: Number(pctNow) || 0 }).then(() => { toast("Usage calibrated"); setPop(null); reload(); }).catch(() => toast("Couldn’t save", "error")); }
  function saveWindow() { api("/settings", { windowHours: Number(win) || 5, anchor: new Date(start).toISOString() }).then(() => { toast("Reset window updated"); setPop(null); reload(); }).catch(() => toast("Couldn’t save", "error")); }
  function openAnalyzer() { setAnUrl((analyzer && analyzer.url) || ""); setPop(pop === "analyzer" ? null : "analyzer"); }
  function saveAnUrl() { api("/settings", { analyzerUrl: anUrl.trim() }).then(() => { toast("Analyzer URL saved"); reload(); }).catch(() => toast("Couldn’t save", "error")); }
  function runAnalyzer() {
    setAnBusy(true);
    api("/analyzer-run", {})
      .then(() => { toast("Analyzer pass started — a proposal issue will appear if it has suggestions"); setPop(null); })
      .catch((e) => toast((e && e.message) || "Couldn’t start the analyzer", "error"))
      .finally(() => setAnBusy(false));
  }

  return html`<div class="statusline">
    <span>${working ? working + " working now" : "Idle"}</span>
    ${spend && spend.costUsd > 0 ? html`<span>· $${spend.costUsd.toFixed(2)} today</span>` : null}
    ${syncing ? html`<span>· <${Spinner} size=${13}/> syncing…</span>` : offlineQ && offlineQ.length > 0 ? html`<span title=${"" + offlineQ.length + " action(s) queued while offline"}>· 🔌 ${offlineQ.length} queued offline</span>` : null}
    <span class="statpop">
      ${s.budget > 0
        ? html`<span class="statlink" title="Calibrate usage %" onClick=${openUsage}>· <span class="gauge"><i style=${"width:" + pct + "%;background:" + col}></i></span> ${pct}%</span>`
        : html`<span class="statlink" title="Set a token budget" onClick=${openUsage}>· set token limit</span>`}
      ${pop === "usage" ? html`<div class="dropscrim" onClick=${() => setPop(null)}></div><div class="dropmenu statmenu">
        <div class="dropmenu-h">Usage calibration</div>
        <label>Current usage %</label>
        <input type="number" min="0" max="100" value=${pctNow} onInput=${(e) => setPctNow(e.target.value)}/>
        <label>Budget (tokens / window, 0 = off)</label>
        <input type="number" min="0" step="1000" value=${bud} onInput=${(e) => setBud(e.target.value)}/>
        <div class="dropmenu-foot">Match the gauge to Claude’s real meter; it grows from here and re-bases on reset.</div>
        <button class="btn primary" onClick=${saveUsage}>Save</button>
      </div>` : null}
    </span>
    <span class="statpop">
      <span class="statlink" title="Set when the usage window resets" onClick=${openWindow}>· resets ${s.resetsAt ? hm(new Date(s.resetsAt)) : "—"}</span>
      ${pop === "window" ? html`<div class="dropscrim" onClick=${() => setPop(null)}></div><div class="dropmenu statmenu">
        <div class="dropmenu-h">Reset window</div>
        <label>Window started at</label>
        <input type="datetime-local" value=${start} onInput=${(e) => setStart(e.target.value)}/>
        <label>Window length (hours)</label>
        <input type="number" min="1" value=${win} onInput=${(e) => setWin(e.target.value)}/>
        <div class="dropmenu-foot">Resets roll forward from this start in fixed steps.</div>
        <button class="btn primary" onClick=${saveWindow}>Save</button>
      </div>` : null}
    </span>
    ${an ? html`<span class="statpop">
      <span class="statlink anstat" title=${an.title + "\n\nClick to run a pass now or set the analyzer URL"} onClick=${openAnalyzer}>· <span class=${"andot " + an.cls}></span> ${an.text}</span>
      ${pop === "analyzer" ? html`<div class="dropscrim" onClick=${() => setPop(null)}></div><div class="dropmenu statmenu">
        <div class="dropmenu-h">Process Analyzer</div>
        <label>Analyzer URL</label>
        <input type="text" placeholder="https://analyzer.example.com" value=${anUrl} onInput=${(e) => setAnUrl(e.target.value)}/>
        <div class="dropmenu-foot">Needed so “Run now” can reach the standalone watchdog. The shared key stays on the server.</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn" onClick=${saveAnUrl}>Save URL</button>
          <button class="btn primary" disabled=${anBusy || !(analyzer && analyzer.url)} onClick=${runAnalyzer}>${anBusy ? "Starting…" : "Run now"}</button>
        </div>
      </div>` : null}
    </span>` : null}
    <span class="spacer"></span>
    ${setSort ? html`<span class="statpop">
      <span class="statlink" title="Sort the board cards" onClick=${() => setPop(pop === "sort" ? null : "sort")}>· sort: ${(sort && sort.key) === "name" ? "name" : "time"} ${(sort && sort.dir) === "asc" ? "↑" : "↓"}</span>
      ${pop === "sort" ? html`<div class="dropscrim" onClick=${() => setPop(null)}></div><div class="dropmenu statmenu">
        <div class="dropmenu-h">Sort cards</div>
        <button class="btn ghost" style="width:100%;justify-content:flex-start" onClick=${() => setSort((s) => ({ ...s, key: "time" }))}>${(sort && sort.key) !== "name" ? "✓ " : ""}By time updated</button>
        <button class="btn ghost" style="width:100%;justify-content:flex-start;margin-top:4px" onClick=${() => setSort((s) => ({ ...s, key: "name" }))}>${(sort && sort.key) === "name" ? "✓ " : ""}By name</button>
        <button class="btn" style="width:100%;justify-content:center;margin-top:8px" onClick=${() => setSort((s) => ({ ...s, dir: (s && s.dir) === "asc" ? "desc" : "asc" }))}>${(sort && sort.dir) === "asc" ? "Ascending ↑" : "Descending ↓"} — flip</button>
      </div>` : null}
    </span>` : null}
    <span class="buildstamp" title=${verTitle}>${verLabel}</span>
  </div>`;
}
