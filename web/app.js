// Dev Agency — Preact + htm dashboard (no build step). Mounted by the shell at /web/app.js.
// The server's JSON API (/data, /comment, /fix, …) is unchanged; this is just a nicer client.
import { html, render, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";

// ---------- icons (Lucide line paths) ----------
const ICONS = {
  planned: '<circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/>',
  loader: '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.41L12 12l-4.41 4.42A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.41L12 12l4.41-4.42A2 2 0 0 0 17 6.17V2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  messages: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  link: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  arrowleft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  flask: '<path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.52 16h12.96"/>',
  crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91 0z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};
const Icon = ({ name, size = 18, cls }) => html`<svg class=${"lic " + (cls || "")} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML=${{ __html: ICONS[name] || "" }}></svg>`;

// ---------- helpers ----------
const ROLE_ICON = { planner: "layers", developer: "laptop", reviewer: "flask", tester: "flask", architect: "settings", librarian: "history" };
function ago(iso) { if (!iso) return ""; let s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return Math.floor(s) + "s"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h"; return Math.floor(s / 86400) + "d"; }
function hm(d) { try { return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
function fmtTok(n) { n = n || 0; if (n >= 1e6) return (n / 1e6).toFixed(2) + "M"; if (n >= 1e3) return Math.round(n / 1e3) + "k"; return "" + n; }
function ghUrl(repo, n) { return "https://github.com/" + repo + "/issues/" + n; }
function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function mdInline(s) {
  return s
    .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md(src) {
  const lines = escHtml(String(src || "")).split(/\r?\n/), out = []; let inList = false, inCode = false, code = [];
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*```/.test(ln)) { if (inCode) { out.push("<pre><code>" + code.join("\n") + "</code></pre>"); code = []; inCode = false; } else { closeList(); inCode = true; } continue; }
    if (inCode) { code.push(ln); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) { closeList(); out.push("<h4>" + mdInline(h[2]) + "</h4>"); continue; }
    if (/^\s*[-*]\s+/.test(ln)) { if (!inList) { out.push("<ul>"); inList = true; } out.push("<li>" + mdInline(ln.replace(/^\s*[-*]\s+/, "")) + "</li>"); continue; }
    if (ln.trim() === "") { closeList(); continue; }
    closeList(); out.push("<p>" + mdInline(ln) + "</p>");
  }
  if (inCode) out.push("<pre><code>" + code.join("\n") + "</code></pre>");
  closeList();
  return out.join("");
}
function api(url, body) { return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(async (r) => { if (!r.ok) { let msg = "http " + r.status; try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {} throw new Error(msg); } return r.json().catch(() => ({})); }); }
function getJSON(u) { return fetch(u).then((r) => r.json()); }

function isDone(i) { const s = i.state || ""; return s === "merged" || s === "agency:merged" || s === "closed" || s === "done"; }
function classify(i) {
  const s = i.state || "";
  if (isDone(i)) return "done";
  if (i.active || i.queued || s === "agency:in-progress" || s === "agency:rate-limited") return "working";
  if (s === "agency:epic") return i.epic && i.epic.done >= i.epic.total ? "review" : "working";
  if (s === "agency:ready" || s === "agency:needs-attention" || s === "agency:awaiting-approval" || s === "agency:awaiting-answer") return "review";
  return "planned";
}
function statusChip(i) {
  const s = i.state || "";
  if (isDone(i)) return { cls: "s-done", label: s.indexOf("merg") >= 0 ? "merged" : "done", icon: "merge" };
  if (i.active) return { cls: "s-working", label: "working", icon: "loader" };
  if (s === "agency:rate-limited") return { cls: "s-auto", label: i.resumeAt ? "resumes " + hm(new Date(i.resumeAt)) : "auto-resume", icon: "hourglass" };
  if (i.queued) return { cls: "s-working", label: "queued", icon: "clock" };
  if (s === "agency:epic") return { cls: "s-epic", label: i.epic ? i.epic.done + "/" + i.epic.total : "epic", icon: "layers" };
  if (s === "agency:in-progress") return { cls: "s-working", label: "working", icon: "loader" };
  if (s === "agency:ready") return i.review === "changes" ? { cls: "s-changes", label: "changes", icon: "alert" } : { cls: "s-ready", label: "ready", icon: "pr" };
  if (s === "agency:needs-attention") return { cls: "s-attn", label: "needs you", icon: "alert" };
  if (s === "agency:awaiting-approval") return { cls: "s-attn", label: "approve?", icon: "check" };
  if (s === "agency:awaiting-answer") return { cls: "s-attn", label: "reply", icon: "messages" };
  return { cls: "s-planned", label: "planned", icon: "planned" };
}
const COLS = [
  { k: "planned", label: "Planned", icon: "planned" },
  { k: "working", label: "Working", icon: "loader" },
  { k: "review", label: "Review", icon: "alert" },
  { k: "done", label: "Done", icon: "check" },
];

// ---------- toast (module-level so anything can call it) ----------
let toastFn = () => {};
function toast(t) { toastFn(t); }

// Reactive desktop/mobile breakpoint (matches the CSS @media min-width:880px). Computing this
// inline during render is unreliable — matchMedia can report the wrong value on first paint and
// then flip on a later re-render, which made the board's extra columns vanish after a few seconds.
function useIsDesktop() {
  const mq = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width:880px)") : null);
  const [d, setD] = useState(() => { const m = mq(); return m ? m.matches : false; });
  useEffect(() => {
    const m = mq(); if (!m) return; const fn = () => setD(m.matches); fn();
    if (m.addEventListener) m.addEventListener("change", fn); else m.addListener(fn);
    return () => { if (m.removeEventListener) m.removeEventListener("change", fn); else m.removeListener(fn); };
  }, []);
  return d;
}

// ---------- App ----------
function App() {
  const isDesktop = useIsDesktop();
  const [data, setData] = useState({ issues: [], repos: [], active: [], activity: [], session: {}, config: {}, auto: {}, autoRepos: {} });
  const [repoFilter, setRepoFilter] = useState(null);
  const [tab, setTab] = useState("planned");
  const [openKey, setOpenKey] = useState(null); // "repo#number"
  const [sheet, setSheet] = useState(null); // "composer" | "settings"
  const [composerRepo, setComposerRepo] = useState(null);
  const [theme, setTheme] = useState(document.documentElement.getAttribute("data-theme") || "light");
  const [toastMsg, setToastMsg] = useState("");
  const [pending, setPending] = useState([]); // optimistic new issues
  const overridesRef = useRef({}); // "repo#n" -> {state, t}
  const liveRef = useRef([]); // SSE-appended activity since last poll
  const [, forceTick] = useState(0);

  useEffect(() => { toastFn = (t) => { setToastMsg(t); setTimeout(() => setToastMsg(""), 1900); }; }, []);

  function load() {
    getJSON("/data").then((d) => {
      liveRef.current = [];
      // prune stale optimistic overrides (server has caught up after ~10s)
      const ov = overridesRef.current, now = Date.now();
      Object.keys(ov).forEach((k) => { if (now - ov[k].t > 10000) delete ov[k]; });
      setData(d);
      // drop optimistic pendings that now exist on the server
      setPending((ps) => ps.filter((p) => !(d.issues || []).some((i) => i.repo === p.repo && (i.number === p.number || (i.title || "") === p.title))));
    }).catch(() => {});
  }
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let es; try { es = new EventSource("/events"); es.onmessage = (ev) => { try { const a = JSON.parse(ev.data); liveRef.current = liveRef.current.concat(a).slice(-200); forceTick((x) => x + 1); } catch (e) {} }; } catch (e) {}
    return () => { try { es && es.close(); } catch (e) {} };
  }, []);

  function setThemeP(t) { setTheme(t); try { localStorage.setItem("theme", t); } catch (e) {} document.documentElement.setAttribute("data-theme", t); const m = document.getElementById("metatheme"); if (m) m.setAttribute("content", t === "dark" ? "#0e1014" : "#f5f6f8"); }

  // merge server issues with optimistic overrides + pendings
  const repos = data.repos || [];
  const ov = overridesRef.current;
  let issues = (data.issues || []).map((i) => { const o = ov[i.repo + "#" + i.number]; return o ? Object.assign({}, i, o.patch) : i; });
  issues = issues.concat(pending.filter((p) => !issues.some((i) => i.repo === p.repo && i.number === p.number)));
  const shown = issues.filter((i) => !repoFilter || i.repo === repoFilter);
  const activity = (data.activity || []).concat(liveRef.current);

  function override(repo, number, patch) { ov[repo + "#" + number] = { patch, t: Date.now() }; forceTick((x) => x + 1); }

  // actions (optimistic + reconcile)
  const act = {
    start(repo, number) { override(repo, number, { state: "agency:in-progress" }); api("/start", { repo, number }).then(() => toast("Starting…")).catch(() => { toast("Couldn’t start"); delete ov[repo + "#" + number]; }).then(load); },
    approve(repo, number) { override(repo, number, { state: "agency:in-progress" }); api("/approve", { repo, number }).then(() => toast("Approved — building")).catch(() => toast("Couldn’t approve")).then(load); },
    resume(repo, number) { override(repo, number, { state: "agency:in-progress" }); api("/resume", { repo, number }).then(() => toast("Resuming")).catch(() => toast("Couldn’t resume")).then(load); },
    fix(repo, number) { override(repo, number, { state: "agency:in-progress" }); api("/fix", { repo, number }).then(() => toast("Fixing the review")).catch(() => toast("Couldn’t fix")).then(load); },
    merge(repo, number) { return api("/merge", { repo, number }).then((r) => { toast("Merged"); load(); return r; }).catch(() => toast("Couldn’t merge — conflicts?")); },
    del(repo, number) { override(repo, number, { state: "done" }); api("/delete", { repo, number }).then(() => { toast("Deleted"); setOpenKey(null); }).catch(() => toast("Couldn’t delete")).then(load); },
    runChecks(repo, number, title) { api("/run-checks", { repo, number, title }).then(() => toast("Running checks…")); },
    setAuto(kind, value, repo, number) { const b = { kind, value }; if (repo) b.repo = repo; if (number) b.number = number; api("/auto", b).then(() => { toast("auto-" + kind + ": " + value); }).then(load); },
  };

  function openComposer(repo) { setComposerRepo(repo || repoFilter || (repos[0] || null)); setSheet("composer"); }
  function createIssue(repo, role, title, body, start, atts) {
    const tmp = { repo, number: -Date.now(), title, role, state: start ? "agency:in-progress" : "planned", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _tmp: true };
    setPending((ps) => ps.concat(tmp)); setSheet(null); toast(start ? "Creating & starting…" : "Added to Planned");
    Promise.all((atts || []).map((a) => api("/upload-file", { repo, number: 0, dataUrl: a.dataUrl, name: a.name }).then((j) => j && j.md).catch(() => null)))
      .then((mds) => { const full = [body].concat(mds.filter(Boolean)).filter(Boolean).join("\n\n"); return api("/new-issue", { repo, role, title, body: full, start: !!start }); })
      .then((d) => { setPending((ps) => ps.map((p) => (p === tmp ? Object.assign({}, p, { number: d.number || p.number }) : p))); setTimeout(load, 700); })
      .catch((e) => { toast((e && e.message) || "Couldn’t create"); setPending((ps) => ps.filter((p) => p !== tmp)); });
  }

  const open = openKey ? issues.find((i) => i.repo + "#" + i.number === openKey) : null;
  const working = (data.active || []).length;

  return html`
    <div class="app">
      <${TopBar} working=${working} env=${data.env} theme=${theme} setTheme=${setThemeP} onSettings=${() => setSheet("settings")} onNew=${() => openComposer()}/>
      <${RepoSelector} repos=${repos} repoFilter=${repoFilter} setRepoFilter=${setRepoFilter} onAdd=${() => setSheet("addrepo")}/>
      <${StatusLine} working=${working} session=${data.session} spend=${data.spendToday}/>
      <div class="content">
        <${Board} issues=${shown} repos=${repos} repoFilter=${repoFilter} tab=${tab} isDesktop=${isDesktop} onOpen=${(i) => setOpenKey(i.repo + "#" + i.number)} onAddRepo=${() => setSheet("addrepo")} act=${act}/>
      </div>
      ${!isDesktop && html`<${TabBar} issues=${shown} tab=${tab} setTab=${setTab}/>`}
      ${open && html`<${Detail} key=${openKey} issue=${open} activity=${activity} act=${act} isDesktop=${isDesktop} onClose=${() => setOpenKey(null)}/>`}
      ${sheet === "composer" && html`<${Composer} repos=${repos} repo=${composerRepo} setRepo=${setComposerRepo} onClose=${() => setSheet(null)} onCreate=${createIssue}/>`}
      ${sheet === "settings" && html`<${Settings} data=${data} theme=${theme} setTheme=${setThemeP} onClose=${() => setSheet(null)} setAuto=${act.setAuto} reload=${load}/>`}
      ${sheet === "addrepo" && html`<${AddRepo} repos=${repos} onClose=${() => setSheet(null)} reload=${load}/>`}
      ${data.user && data.onboarded === false && html`<${Onboarding} repos=${repos} reload=${load}/>`}
      <div class=${"toast " + (toastMsg ? "on" : "")}>${toastMsg}</div>
    </div>`;
}

function TopBar({ working, env, theme, setTheme, onSettings, onNew }) {
  return html`<div class="topbar">
    <div class="brand"><${Icon} name="crown" size=${18}/> Dev Agency ${env === "development" ? html`<span class="envbadge">DEV</span>` : null} ${working ? html`<span class="dot"></span>` : null}</div>
    <div class="spacer"></div>
    <button class="iconbtn" aria-label="New issue" onClick=${onNew}><${Icon} name="plus"/></button>
    <button class="iconbtn" aria-label="Toggle theme" onClick=${() => setTheme(theme === "dark" ? "light" : "dark")}><${Icon} name=${theme === "dark" ? "sun" : "moon"}/></button>
    <button class="iconbtn" aria-label="Settings" onClick=${onSettings}><${Icon} name="settings"/></button>
  </div>`;
}
function RepoSelector({ repos, repoFilter, setRepoFilter, onAdd }) {
  return html`<div class="reposel">
    <span class=${"chip " + (repoFilter ? "" : "on")} onClick=${() => setRepoFilter(null)}>All</span>
    ${repos.map((r) => html`<span key=${r} class=${"chip " + (repoFilter === r ? "on" : "")} onClick=${() => setRepoFilter(r)}>${r.split("/").pop()}</span>`)}
    <span class="chip dash" onClick=${onAdd}><${Icon} name="plus" size=${13}/> new</span>
  </div>`;
}
function StatusLine({ working, session, spend }) {
  const s = session || {};
  let pct = s.budget > 0 ? Math.min(100, Math.round((100 * s.tokens) / s.budget)) : 0;
  const col = pct >= 90 ? "var(--red)" : pct >= 70 ? "var(--amber)" : "var(--green)";
  return html`<div class="statusline">
    <span>${working ? working + " working now" : "Idle"}</span>
    ${spend && spend.costUsd > 0 ? html`<span>· $${spend.costUsd.toFixed(2)} today</span>` : null}
    ${s.budget > 0 ? html`<span>· <span class="gauge"><i style=${"width:" + pct + "%;background:" + col}></i></span> ${pct}%</span>` : null}
    ${s.resetsAt ? html`<span>· resets ${hm(new Date(s.resetsAt))}</span>` : null}
    <span class="spacer"></span>
    <a href="/classic">classic</a>
  </div>`;
}

function Board({ issues, repos, repoFilter, tab, isDesktop, onOpen, onAddRepo, act }) {
  if (!(repos || []).length) {
    return html`<div class="norepo">
      <div class="obki" style="margin:0 auto 14px"><${Icon} name="pr" size=${28}/></div>
      <div class="obh" style="text-align:center">No repos yet</div>
      <div class="obsub" style="text-align:center;max-width:380px;margin:6px auto 16px">Add a repository for your agency to work in. Use <code>owner/name</code>.</div>
      <button class="btn primary" style="margin:0 auto;min-width:200px" onClick=${onAddRepo}><${Icon} name="plus" size=${16}/> Add your first repo</button>
    </div>`;
  }
  const byCol = {}; COLS.forEach((c) => (byCol[c.k] = []));
  issues.slice().sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).forEach((i) => byCol[classify(i)].push(i));
  const cols = isDesktop ? COLS : COLS.filter((c) => c.k === tab);
  return html`<div class="board">
    ${cols.map((c) => html`<div class="col" key=${c.k}>
      <div class="colhead"><${Icon} name=${c.icon} size=${15}/> ${c.label} <span class="n">${byCol[c.k].length || ""}</span></div>
      <div class="cards">
        ${byCol[c.k].length ? byCol[c.k].map((i) => html`<${Card} key=${i.repo + "#" + i.number} i=${i} multi=${!repoFilter && repos.length > 1} onOpen=${onOpen} act=${act}/>`) : html`<div class="empty">—</div>`}
      </div>
    </div>`)}
  </div>`;
}

function Card({ i, multi, onOpen, act }) {
  const st = statusChip(i);
  const done = isDone(i);
  let quick = null;
  if (i.state === "planned" || (!i.state && !done)) quick = { cls: "play", icon: "play", label: "start", fn: () => act.start(i.repo, i.number) };
  else if (i.state === "agency:awaiting-approval") quick = { cls: "", icon: "check", label: "approve", fn: () => act.approve(i.repo, i.number) };
  else if (i.state === "agency:ready" && i.review === "changes") quick = { cls: "fix", icon: "wrench", label: "fix", fn: () => act.fix(i.repo, i.number) };
  else if (i.state === "agency:needs-attention") quick = { cls: "", icon: "refresh", label: "resume", fn: () => act.resume(i.repo, i.number) };
  const autoOn = i.auto && (i.auto.resume || i.auto.merge) && !done;
  return html`<div class="card" onClick=${() => onOpen(i)}>
    <div class="t">${i.active ? html`<span class="dot"></span> ` : null}${i.title || "#" + i.number}</div>
    <div class="meta">
      <span class=${"statuschip " + st.cls}><${Icon} name=${st.icon} size=${12}/> ${st.label}</span>
      ${autoOn ? html`<span class="statuschip s-auto"><${Icon} name=${i.auto.merge ? "merge" : "refresh"} size=${12}/> auto</span>` : null}
      ${i.pr_number ? html`<a class="tagk" href=${i.pr_url || ghUrl(i.repo, i.pr_number)} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}><${Icon} name="pr" size=${11}/> #${i.pr_number}</a>` : null}
      ${multi ? html`<span class="tagk">${i.repo.split("/").pop()}</span>` : null}
      <span class="spacer" style="margin-left:auto"></span>
      ${quick ? html`<button class=${"cardbtn " + quick.cls} onClick=${(e) => { e.stopPropagation(); quick.fn(); }}><${Icon} name=${quick.icon} size=${13}/> ${quick.label}</button>` : html`<span style="color:var(--ink-3);font-size:12px">${ago(i.updated_at)}</span>`}
    </div>
  </div>`;
}

function TabBar({ issues, tab, setTab }) {
  const counts = {}; COLS.forEach((c) => (counts[c.k] = 0));
  issues.forEach((i) => counts[classify(i)]++);
  return html`<div class="tabbar">
    ${COLS.map((c) => html`<button key=${c.k} class=${"tab " + (tab === c.k ? "on" : "")} onClick=${() => setTab(c.k)}>
      <${Icon} name=${c.icon} size=${20}/>
      <span class="bdg">${c.label}${counts[c.k] ? " · " + counts[c.k] : ""}</span>
    </button>`)}
  </div>`;
}

// ---------- Detail ----------
function Detail({ issue, activity, act, isDesktop, onClose }) {
  const [tab, setTab] = useState("chat"); // mobile sub-tab: chat | stream
  const [thread, setThread] = useState(null);
  const [pr, setPr] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [reply, setReply] = useState("");
  const [atts, setAtts] = useState([]);
  const [busy, setBusy] = useState(false);
  const streamRef = useRef(null);
  const stickRef = useRef(true);
  const repo = issue.repo, number = issue.number;

  function loadThread() { getJSON("/thread?repo=" + encodeURIComponent(repo) + "&number=" + number).then(setThread).catch(() => {}); }
  useEffect(() => {
    setThread(null); setPr(null); setAppInfo(null); stickRef.current = true;
    loadThread();
    if (issue.pr_number) getJSON("/pr-status?repo=" + encodeURIComponent(repo) + "&number=" + number).then(setPr).catch(() => {});
    getJSON("/app-info?repo=" + encodeURIComponent(repo) + "&number=" + number).then(setAppInfo).catch(() => setAppInfo({ kind: "unknown" }));
    const t = setInterval(loadThread, 6000); return () => clearInterval(t);
  }, [repo, number]);

  const stream = activity.filter((a) => a.repo === repo && a.number === number).slice(-60);
  useEffect(() => { const el = streamRef.current; if (el && stickRef.current) el.scrollTop = el.scrollHeight; });

  const review = (pr && pr.review && pr.review.verdict) || issue.review || null;
  const conflict = pr && pr.merge && pr.merge.mergeable === "conflict";
  const needsFix = review === "changes";
  const done = isDone(issue);
  const st = issue.state || "";

  function send() {
    if (!reply.trim() && !atts.length) return; setBusy(true);
    Promise.all(atts.map((a) => api("/upload-file", { repo, number, dataUrl: a.d, name: a.name }).then((j) => j && j.md).catch(() => null)))
      .then((mds) => { const full = [reply].concat(mds.filter(Boolean)).filter(Boolean).join("\n\n"); return api("/comment", { repo, number, body: full }); })
      .then(() => { setReply(""); setAtts([]); toast("Sent"); setTimeout(loadThread, 800); })
      .catch(() => toast("Couldn’t send")).then(() => setBusy(false));
  }
  function pickFiles(e) { const fs = e.target.files || []; for (let i = 0; i < fs.length; i++) readAttach(fs[i], (a) => setAtts((x) => x.concat(a))); e.target.value = ""; }
  function onPaste(e) { const items = (e.clipboardData || {}).items || []; for (let i = 0; i < items.length; i++) if (items[i].kind === "file") readAttach(items[i].getAsFile(), (a) => setAtts((x) => x.concat(a))); }

  // toolbar actions
  const tb = [];
  tb.push(html`<a class="tbtn" data-tip="Open on GitHub" href=${ghUrl(repo, number)} target="_blank" rel="noopener"><${Icon} name="link"/></a>`);
  if (issue.pr_url) tb.push(html`<a class="tbtn" data-tip="Open PR" href=${issue.pr_url} target="_blank" rel="noopener"><${Icon} name="pr"/></a>`);
  if (issue.previewUrl) tb.push(html`<a class="tbtn primary" data-tip="Open preview" href=${issue.previewUrl} target="_blank" rel="noopener"><${Icon} name="globe"/></a>`);
  if (!done) {
    if (st === "planned" || !st) tb.push(html`<button class="tbtn green" data-tip="Start" onClick=${() => { act.start(repo, number); onClose(); }}><${Icon} name="play"/></button>`);
    if (st === "agency:awaiting-approval") tb.push(html`<button class="tbtn primary" data-tip="Approve & build" onClick=${() => { act.approve(repo, number); onClose(); }}><${Icon} name="check"/></button>`);
    if (issue.pr_number && (needsFix || conflict)) tb.push(html`<button class="tbtn primary" data-tip=${conflict ? "Resolve conflicts" : "Fix the review"} onClick=${() => { act.fix(repo, number); onClose(); }}><${Icon} name="wrench"/></button>`);
    tb.push(html`<button class="tbtn" data-tip="Resume" onClick=${() => act.resume(repo, number)}><${Icon} name="refresh"/></button>`);
    tb.push(html`<button class="tbtn" data-tip="Run checks" onClick=${() => act.runChecks(repo, number, issue.title)}><${Icon} name="flask"/></button>`);
    if (issue.pr_number && !conflict) tb.push(html`<button class="tbtn green" data-tip=${needsFix ? "Merge anyway" : "Merge"} onClick=${() => act.merge(repo, number).then(onClose)}><${Icon} name="merge"/></button>`);
  }
  tb.push(html`<button class="tbtn danger" data-tip="Delete" onClick=${() => act.del(repo, number)}><${Icon} name="trash"/></button>`);

  const streamPane = html`<div class="dpane side">
    <div class="sec">Live stream</div>
    <div class="dstream" ref=${streamRef} onScroll=${(e) => { const el = e.target; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50; }}>
      ${stream.length ? stream.map((a, idx) => html`<div key=${idx} class=${"l " + (a.kind === "tool" ? "tool" : a.kind === "start" || a.kind === "done" ? "muted" : "")}>${a.text}</div>`) : html`<div class="l muted">No live activity yet.</div>`}
    </div>
    <${RunApp} repo=${repo} number=${number} appInfo=${appInfo} issue=${issue} done=${done}/>
    <${AutoRow} issue=${issue} act=${act}/>
  </div>`;

  const chatPane = html`<div class="dpane chat">
    ${issue.epic ? html`<div class="sec">Sub-issues ${issue.epic.done}/${issue.epic.total}</div>` : null}
    <div class="sec">Conversation</div>
    ${thread ? html`<div>
      ${thread.body ? html`<${Comment} author=${thread.author} createdAt=${thread.createdAt} body=${thread.body} isAgency=${false}/>` : null}
      ${(thread.comments || []).map((c, idx) => html`<${Comment} key=${idx} author=${c.author} createdAt=${c.createdAt} body=${c.body} isAgency=${c.isAgency}/>`)}
    </div>` : html`<div class="muted">Loading…</div>`}
  </div>`;

  return html`<div class="detail on">
    <div class="dhead">
      <button class="iconbtn" aria-label="Close" onClick=${onClose}><${Icon} name="arrowleft"/></button>
      <div class="tt">${issue.title || "#" + number} <span class="dmeta">· ${repo.split("/").pop()} #${number}${st ? " · " + st.replace("agency:", "") : ""}</span></div>
    </div>
    <div class="dtoolbar">${tb}</div>
    ${!isDesktop ? html`<div class="dtoolbar" style="justify-content:center">
      <button class=${"btn ghost " + (tab === "chat" ? "primary" : "")} onClick=${() => setTab("chat")}>Chat</button>
      <button class=${"btn ghost " + (tab === "stream" ? "primary" : "")} onClick=${() => setTab("stream")}>Stream</button>
    </div>` : null}
    <div class="dpanes">
      ${isDesktop ? html`${chatPane}${streamPane}` : tab === "chat" ? chatPane : streamPane}
    </div>
    <div class="dcompose">
      ${atts.length ? html`<div style="position:absolute;bottom:100%;left:0;padding:0 10px">${atts.map((a, idx) => html`<span class="att" key=${idx}>${a.img ? html`<img src=${a.d}/>` : html`<span><${Icon} name="paperclip" size=${12}/> ${a.name}</span>`}<button class="iconbtn" style="width:18px;height:18px;border:none" onClick=${() => setAtts((x) => x.filter((_, j) => j !== idx))}>×</button></span>`)}</div>` : null}
      <label class="iconbtn" style="cursor:pointer"><${Icon} name="paperclip"/><input type="file" multiple style="display:none" onChange=${pickFiles}/></label>
      <textarea placeholder="Reply…  (paste an image to attach)" value=${reply} onInput=${(e) => setReply(e.target.value)} onPaste=${onPaste}></textarea>
      <button class="btn primary" disabled=${busy} onClick=${send}><${Icon} name="send"/></button>
    </div>
  </div>`;
}
function Comment(c) { return html`<div class=${"cmt " + (c.isAgency ? "ag" : "")}><div class="h">${c.isAgency ? "🤖 " : ""}${c.author || ""} · ${ago(c.createdAt)}</div><div class="b" dangerouslySetInnerHTML=${{ __html: md(c.body) }}></div></div>`; }

function AutoRow({ issue, act }) {
  const a = issue.auto || {};
  function cycle(kind) { const cur = kind === "resume" ? a.resumeRaw : a.mergeRaw; const order = ["", "on", "off"]; const nx = order[(order.indexOf(cur || "") + 1) % 3]; act.setAuto(kind, nx === "" ? "inherit" : nx, issue.repo, issue.number); }
  const pill = (kind) => { const raw = kind === "resume" ? a.resumeRaw : a.mergeRaw; const on = raw === "on", off = raw === "off"; return html`<button class=${"apill " + (on ? "on" : off ? "off" : "")} onClick=${() => cycle(kind)}><${Icon} name=${kind === "resume" ? "refresh" : "merge"} size=${14}/> ${kind}</button>`; };
  return html`<div class="sec">Auto</div><div class="autorow">${pill("resume")}${pill("merge")}<span class="muted" style="font-size:12px">now: resume ${a.resume ? "on" : "off"} · merge ${a.merge ? "on" : "off"}</span></div>`;
}

function RunApp({ repo, number, appInfo, issue, done }) {
  if (!appInfo || appInfo.kind === "unknown" || appInfo.kind === "none") return null;
  const kind = appInfo.kind, app = issue.app;
  function copyRun() {
    const nm = repo.split("/").pop();
    const checkout = done ? "(git checkout main 2>/dev/null || git checkout master) && git pull -q" : "gh pr checkout " + number;
    const cmd = 'd=~/.devagency/' + nm + '; gh repo clone ' + repo + ' "$d" 2>/dev/null; cd "$d" && git fetch -q && ' + checkout + ' && { corepack enable 2>/dev/null; PM=npm; [ -f pnpm-lock.yaml ]&&PM=pnpm; [ -f yarn.lock ]&&PM=yarn; $PM install && ($PM run tauri:dev || $PM tauri dev || $PM run dev); }';
    (navigator.clipboard ? navigator.clipboard.writeText(cmd) : Promise.reject()).then(() => toast("Copied — paste in Terminal & Enter"), () => toast("Copy failed"));
  }
  return html`<div class="sec">Run the app</div><div class="autorow">
    ${kind === "tauri" ? html`<button class="btn" onClick=${copyRun}><${Icon} name="laptop" size=${15}/> Run on my Mac</button>` : null}
    ${app && app.status === "running" ? html`<a class="btn primary" href=${app.url} target="_blank" rel="noopener"><${Icon} name="monitor" size=${15}/> Open app</a><button class="btn" onClick=${() => api("/app-stop", { repo, number }).then(() => toast("Stopped"))}><${Icon} name="stop" size=${15}/></button>`
      : app && (app.status === "installing" || app.status === "starting") ? html`<span class="muted">⏳ ${app.status}…</span>`
      : kind === "web" ? html`<button class="btn" onClick=${() => api("/app-run", { repo, number }).then((r) => toast(r && r.error ? r.error : "Starting preview…")).catch(() => toast("Couldn’t start"))}><${Icon} name="play" size=${15}/> Run preview</button>` : null}
  </div>`;
}

// ---------- Composer ----------
function Composer({ repos, repo, setRepo, onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [role, setRole] = useState("@dev");
  const [atts, setAtts] = useState([]);
  function submit(start) { if (!repo || !title.trim()) { toast("Repo + title needed"); return; } onCreate(repo, role, title.trim(), body.trim(), start, atts.map((a) => ({ dataUrl: a.d, name: a.name }))); }
  function pick(e) { const fs = e.target.files || []; for (let i = 0; i < fs.length; i++) readAttach(fs[i], (a) => setAtts((x) => x.concat(a))); e.target.value = ""; }
  function onPaste(e) { const items = (e.clipboardData || {}).items || []; for (let i = 0; i < items.length; i++) if (items[i].kind === "file") readAttach(items[i].getAsFile(), (a) => setAtts((x) => x.concat(a))); }
  return html`<${Sheet} title="New issue" onClose=${onClose} footer=${html`
      <button class="btn" onClick=${() => submit(false)}>Add to Planned</button>
      <button class="btn primary" onClick=${() => submit(true)}><${Icon} name="play" size=${15}/> Start now</button>`}>
    <label>Repo</label>
    <select value=${repo || ""} onChange=${(e) => setRepo(e.target.value)}>${repos.map((r) => html`<option key=${r} value=${r}>${r}</option>`)}</select>
    <label>Assign to</label>
    <select value=${role} onChange=${(e) => setRole(e.target.value)}>
      <option value="@dev">@dev — full pipeline (plan → build → PR)</option>
      <option value="@plan">@plan — plan only</option>
      <option value="@arch">@arch — architect</option>
      <option value="@review">@review — review</option>
      <option value="@test">@test — run checks</option>
    </select>
    <label>Title</label>
    <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="What should it do?"/>
    <label>Details</label>
    <textarea value=${body} onInput=${(e) => setBody(e.target.value)} onPaste=${onPaste} placeholder="Context, acceptance criteria…  (paste an image to attach)"></textarea>
    ${atts.length ? html`<div style="margin-top:6px">${atts.map((a, idx) => html`<span class="att" key=${idx}>${a.img ? html`<img src=${a.d}/>` : a.name}<button class="iconbtn" style="width:18px;height:18px;border:none" onClick=${() => setAtts((x) => x.filter((_, j) => j !== idx))}>×</button></span>`)}</div>` : null}
    <label class="btn ghost" style="cursor:pointer;margin-top:8px;justify-content:flex-start"><${Icon} name="paperclip" size=${15}/> Attach file<input type="file" multiple style="display:none" onChange=${pick}/></label>
  <//>`;
}

// ---------- Settings ----------
function Settings({ data, theme, setTheme, onClose, setAuto, reload }) {
  const s = data.session || {}, cfg = data.config || {}, auto = data.auto || {}, autoRepos = data.autoRepos || {};
  const [win, setWin] = useState(s.windowHours || 5);
  const [budget, setBudget] = useState(s.budget || 0);
  const [skipArch, setSkipArch] = useState(cfg.skipArchitect !== "off");
  const [gitnexus, setGitnexus] = useState(cfg.gitnexus === "on");
  const [maxTok, setMaxTok] = useState(cfg.maxTokensPerRun || 600000);
  const [revRounds, setRevRounds] = useState(cfg.maxReviseRounds != null ? cfg.maxReviseRounds : 1);
  function save() { api("/settings", { windowHours: Number(win) || 5, budget: Number(budget) || 0, skipArchitect: skipArch ? "on" : "off", gitnexus: gitnexus ? "on" : "off", maxTokensPerRun: Number(maxTok) || 0, maxReviseRounds: Number(revRounds) || 0 }).then(() => { toast("Saved"); onClose(); reload(); }); }
  const gpill = (kind) => { const raw = auto[kind] || ""; const on = raw === "on", off = raw === "off"; const order = ["", "on", "off"]; const nx = order[(order.indexOf(raw) + 1) % 3]; return html`<button class=${"apill " + (on ? "on" : off ? "off" : "")} onClick=${() => setAuto(kind, nx === "" ? "inherit" : nx)}><${Icon} name=${kind === "resume" ? "refresh" : "merge"} size=${14}/> ${kind}</button>`; };
  const rpill = (repo, kind) => { const raw = (autoRepos[repo] || {})[kind] || ""; const on = raw === "on", off = raw === "off"; const order = ["", "on", "off"]; const nx = order[(order.indexOf(raw) + 1) % 3]; return html`<button class=${"apill " + (on ? "on" : off ? "off" : "")} onClick=${() => setAuto(kind, nx === "" ? "inherit" : nx, repo)}><${Icon} name=${kind === "resume" ? "refresh" : "merge"} size=${13}/> ${kind}</button>`; };
  return html`<${Sheet} title="Settings" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button>`}>
    ${data.user ? html`<div class="sec">Account</div>
      <div class="muted">Signed in as <b>${data.user.username}</b> · ${data.user.role}</div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn ghost" onClick=${() => { const np = window.prompt("New password (8+ characters)"); if (np == null) return; if (np.length < 8) { toast("8+ characters"); return; } api("/set-password", { value: np }).then(() => toast("Password changed")).catch((e) => toast((e && e.message) || "Couldn’t change")); }}><${Icon} name="lock" size=${15}/> Change password</button>
        <a class="btn ghost" href="/logout" style="flex:1;justify-content:center"><${Icon} name="arrowleft" size=${15}/> Sign out</a>
      </div>

      <div class="sec">Setup wizard</div>
      <div class="muted" style="font-size:12px;margin-bottom:7px">Re-run the guided walkthrough to add or update your tokens, models, and first repo.</div>
      <button class="btn primary" style="width:100%" onClick=${() => api("/onboarded", { value: "0" }).then(() => { onClose(); reload(); })}><${Icon} name="play" size=${15}/> Run the setup wizard</button>

      <${Credentials} secretKeys=${data.secretKeys || []} reload=${reload}/>
      ${data.user.role === "admin" ? html`<${Admin} users=${data.users || []} invites=${data.invites || []} webhookSecretSet=${data.webhookSecretSet} reload=${reload}/>` : null}` : null}
    <div class="sec">Appearance</div>
    <div class="autorow">
      <button class=${"apill " + (theme === "light" ? "on" : "")} onClick=${() => setTheme("light")}><${Icon} name="sun" size=${14}/> Light</button>
      <button class=${"apill " + (theme === "dark" ? "on" : "")} onClick=${() => setTheme("dark")}><${Icon} name="moon" size=${14}/> Dark</button>
    </div>
    <div class="sec">Automation (global default)</div>
    <div class="autorow">${gpill("resume")}${gpill("merge")}</div>
    <div class="muted" style="font-size:12px;margin-top:4px">Auto-merge only fires when the review is approved, there are no conflicts, and checks pass.</div>
    ${(data.repos || []).length ? html`<div class="sec">Per repo</div>${(data.repos || []).map((r) => html`<div key=${r} style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:5px 2px"><span style="font-size:13px;flex:1;min-width:120px">${r.split("/").pop()}</span>${rpill(r, "resume")}${rpill(r, "merge")}</div>`)}` : null}
    <div class="sec">Token budget</div>
    <label>Session window (hours)</label><input type="number" min="1" value=${win} onInput=${(e) => setWin(e.target.value)}/>
    <label>Budget — tokens per window (0 = off)</label><input type="number" min="0" step="1000" value=${budget} onInput=${(e) => setBudget(e.target.value)}/>
    <div class="sec">Pipeline</div>
    <label class="ckline"><input type="checkbox" checked=${skipArch} onChange=${(e) => setSkipArch(e.target.checked)}/> Skip the architect step (faster, fewer tokens)</label>
    <label class="ckline"><input type="checkbox" checked=${gitnexus} onChange=${(e) => setGitnexus(e.target.checked)}/> Use GitNexus code index</label>
    <label>Max tokens per run (0 = off)</label><input type="number" min="0" step="50000" value=${maxTok} onInput=${(e) => setMaxTok(e.target.value)}/>
    <label>Reviewer revise rounds before it asks you</label><input type="number" min="0" max="3" value=${revRounds} onInput=${(e) => setRevRounds(e.target.value)}/>
    ${(!data.user || data.user.role === "admin") && data.opsMeta ? html`<${Operations} meta=${data.opsMeta} values=${data.ops || {}} reload=${reload}/>` : null}
    <div class="sec">Advanced</div>
    <a class="btn ghost" href="/classic" style="justify-content:flex-start"><${Icon} name="settings" size=${15}/> Models &amp; agents (classic editor)</a>
  <//>`;
}
function Operations({ meta, values, reload }) {
  const [vals, setVals] = useState(() => Object.assign({}, values));
  const set = (k, v) => setVals((o) => Object.assign({}, o, { [k]: v }));
  function save() { api("/settings", { ops: vals }).then(() => { toast("Operations saved"); reload(); }).catch(() => toast("Couldn’t save")); }
  return html`<div class="sec">Operations (advanced)</div>
    <div class="muted" style="font-size:12px;margin-bottom:4px">Global agency settings, moved out of env. Applies on save (a few apply on next restart).</div>
    ${meta.map((m) => html`<div key=${m.key}>
      ${m.type === "bool"
        ? html`<label class="ckline"><input type="checkbox" checked=${!!vals[m.key]} onChange=${(e) => set(m.key, e.target.checked)}/> ${m.label}</label>`
        : html`<label>${m.label}</label>${m.type === "select"
          ? html`<select value=${vals[m.key]} onChange=${(e) => set(m.key, e.target.value)}>${(m.options || []).map((o) => html`<option key=${o} value=${o}>${o}</option>`)}</select>`
          : m.type === "num"
          ? html`<input type="number" value=${vals[m.key]} onInput=${(e) => set(m.key, Number(e.target.value))}/>`
          : html`<input value=${vals[m.key]} onInput=${(e) => set(m.key, e.target.value)}/>`}`}
    </div>`)}
    <button class="btn primary" style="margin-top:12px" onClick=${save}>Save operations</button>`;
}

// ---------- onboarding wizard ----------
const OB_PROVIDERS = [
  { id: "claude_sub", label: "Claude — subscription", note: "Recommended · runs agents on your plan", icon: "crown", kind: "secret", secretKey: "claude_token",
    title: "Claude subscription token", placeholder: "paste the setup-token output",
    how: "Runs the agents on your existing Claude plan — no per-token billing.\n\n1. Install the CLI:\n   npm i -g @anthropic-ai/claude-code\n2. Generate a token:\n   claude setup-token\n3. Log in with your Claude plan when the browser opens.\n4. Paste the token it prints below.",
    link: "https://docs.claude.com/en/docs/claude-code", linkLabel: "Claude Code docs" },
  { id: "claude_api", label: "Claude — API key", note: "Pay-as-you-go", icon: "flask", kind: "secret", secretKey: "anthropic_api_key",
    title: "Claude API key", placeholder: "sk-ant-...",
    how: "Pay-as-you-go billing instead of a subscription.\n\n1. Open platform.claude.com → API keys.\n2. Create a key.\n3. Paste it below.",
    link: "https://platform.claude.com/settings/keys", linkLabel: "Create an API key" },
  { id: "glm", label: "GLM (Zhipu)", note: "Cheap coding model", icon: "globe", kind: "provider",
    preset: { name: "GLM (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/anthropic", models: ["glm-4.6", "glm-4.5"] },
    title: "GLM API key", placeholder: "GLM API key",
    how: "An Anthropic-compatible endpoint, good for the cheaper roles.\n\n1. Get an API key from open.bigmodel.cn (Zhipu).\n2. Paste it below.\n\nAfter setup, assign GLM to specific agents in Settings → Models.",
    link: "https://open.bigmodel.cn", linkLabel: "Get a GLM key" },
  { id: "deepseek", label: "DeepSeek", note: "", icon: "globe", kind: "provider",
    preset: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", models: ["deepseek-chat", "deepseek-reasoner"] },
    title: "DeepSeek API key", placeholder: "DeepSeek API key",
    how: "1. Get an API key from platform.deepseek.com.\n2. Paste it below.\n\nAssign it to agents later in Settings → Models.",
    link: "https://platform.deepseek.com", linkLabel: "Get a DeepSeek key" },
  { id: "kimi", label: "Kimi (Moonshot)", note: "", icon: "globe", kind: "provider",
    preset: { name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/anthropic", models: ["kimi-k2-0905-preview"] },
    title: "Kimi API key", placeholder: "Kimi API key",
    how: "1. Get an API key from platform.moonshot.cn.\n2. Paste it below.\n\nAssign it to agents later in Settings → Models.",
    link: "https://platform.moonshot.cn", linkLabel: "Get a Kimi key" },
  { id: "other", label: "Other (OpenAI, Gemini, Ollama)", note: "Needs a router", icon: "settings", kind: "provider", custom: true,
    title: "Custom provider", placeholder: "API key",
    how: "OpenAI / Gemini / Ollama need an Anthropic-compatible gateway (claude-code-router or LiteLLM). Run one, then enter its base URL + key here.",
    link: "https://github.com/musistudio/claude-code-router", linkLabel: "claude-code-router" },
];
const OB_GH_BOT = { id: "github_bot", title: "GitHub bot token", icon: "pr", kind: "secret", secretKey: "github_bot_token", placeholder: "github_pat_...",
  how: "The account the agency ACTS as — its commits and pull requests. Best practice: a dedicated bot GitHub account.\n\n1. On the bot account: github.com → Settings → Developer settings → Fine-grained tokens → Generate new token.\n2. Repository access: the repos you'll use.\n3. Permissions: Contents, Issues, Pull requests, Workflows = Read & write; Metadata = Read.\n4. Paste the token (github_pat_…) below.",
  link: "https://github.com/settings/tokens?type=beta", linkLabel: "Create a fine-grained token" };
const OB_GH_OWNER = { id: "github_owner", title: "Your GitHub token", optional: true, icon: "link", kind: "secret", secretKey: "github_user_token", placeholder: "github_pat_... (optional)",
  how: "Lets the agency comment and open issues under YOUR name, and auto-invite the bot to repos. Same steps as the bot token, on your own account (add Administration: Read & write for auto-invite).\n\nOptional — skip if you'll invite the bot manually.",
  link: "https://github.com/settings/tokens?type=beta", linkLabel: "Create a fine-grained token" };

function ObTokenStep({ def, existing, onDone, onBack }) {
  const [val, setVal] = useState("");
  const [baseUrl, setBaseUrl] = useState(def.preset?.baseUrl || "");
  const [busy, setBusy] = useState(false);
  function save() {
    if (!val.trim()) { toast(def.optional ? "Paste a token or Skip" : "Paste the token"); return; }
    setBusy(true);
    let pr;
    if (def.kind === "secret") pr = api("/user-secret", { key: def.secretKey, value: val.trim() });
    else {
      const prov = { id: def.id + "-" + Date.now().toString(36), name: def.preset?.name || "Custom", baseUrl: def.custom ? baseUrl.trim() : def.preset.baseUrl, apiKey: val.trim(), models: def.preset?.models || [] };
      pr = api("/models", { providers: (existing || []).concat(prov) });
    }
    pr.then(() => { toast("Saved"); onDone(); }).catch(() => toast("Couldn’t save")).then(() => setBusy(false));
  }
  return html`
    <div class="obki"><${Icon} name=${def.icon || "lock"} size=${26}/></div>
    <div class="obh">${def.title}</div>
    <div class="obsteps">${def.how}</div>
    ${def.link ? html`<a class="oblink" href=${def.link} target="_blank" rel="noopener">${def.linkLabel} <${Icon} name="link" size=${14}/></a>` : null}
    ${def.custom ? html`<label>Base URL (Anthropic-compatible)</label><input placeholder="https://…/anthropic" value=${baseUrl} onInput=${(e) => setBaseUrl(e.target.value)}/>` : null}
    <label>${def.custom ? "API key" : "Token"}</label>
    <input type="password" autocomplete="off" placeholder=${def.placeholder} value=${val} onInput=${(e) => setVal(e.target.value)}/>
    <div class="muted" style="font-size:11px;margin:3px 2px 0">Paste it exactly — no spaces or line breaks (a stray space causes a 401).</div>
    <div class="obnav">
      <button class="btn" onClick=${onBack}>Back</button>
      ${def.optional ? html`<button class="btn ghost" onClick=${onDone}>Skip</button>` : null}
      <button class="btn primary" disabled=${busy} onClick=${save}>Save &amp; continue</button>
    </div>`;
}

function Onboarding({ repos, reload }) {
  const [picked, setPicked] = useState(["claude_sub"]);
  const [i, setI] = useState(0);
  const [existing, setExisting] = useState([]);
  const [repo, setRepo] = useState("");
  useEffect(() => { getJSON("/models").then((d) => setExisting(d.providers || [])).catch(() => {}); }, []);
  const steps = ["welcome", "providers", ...picked.map((id) => "p:" + id), "bot", "owner", "repo", "done"];
  const step = steps[Math.min(i, steps.length - 1)];
  const next = () => setI((x) => Math.min(steps.length - 1, x + 1));
  const back = () => setI((x) => Math.max(0, x - 1));
  const finish = () => api("/onboarded", { value: "1" }).then(() => { toast("You're all set!"); reload(); });
  function toggle(id) { setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.concat(id))); }
  function addRepo() {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) { toast("Use owner/name"); return; }
    api("/add-repo", { repo: repo.trim() }).then(() => { toast("Repo added"); setRepo(""); reload(); next(); }).catch(() => toast("Couldn’t add"));
  }
  const dots = steps.map((_, idx) => html`<div class=${"obdot " + (idx === i ? "on" : idx < i ? "done" : "")}></div>`);

  let body;
  if (step === "welcome") body = html`
    <div class="obki"><${Icon} name="crown" size=${26}/></div>
    <div class="obh">Welcome to your Dev Agency</div>
    <div class="obsub">Three quick things and your AI team is ready: pick your models, give it GitHub access, and add a repo. Takes about 2 minutes — you can change anything later in Settings.</div>
    <div class="obnav"><button class="btn primary" onClick=${next}>Get started</button></div>`;
  else if (step === "providers") body = html`
    <div class="obki"><${Icon} name="flask" size=${26}/></div>
    <div class="obh">Which models do you want to use?</div>
    <div class="obsub">Claude (subscription) is the recommended default. Add others to run cheaper models for some agents — you can assign them per-agent later.</div>
    <div class="obpick">${OB_PROVIDERS.map((p) => html`<div key=${p.id} class=${"obchip " + (picked.includes(p.id) ? "on" : "")} onClick=${() => toggle(p.id)}>
      <${Icon} name=${p.icon} size=${18}/><div>${p.label}${p.note ? html`<small>${p.note}</small>` : null}</div>${picked.includes(p.id) ? html`<span class="ck"><${Icon} name="check" size=${16}/></span>` : null}</div>`)}</div>
    <div class="obnav"><button class="btn" onClick=${back}>Back</button><button class="btn primary" onClick=${next}>Continue</button></div>`;
  else if (step.startsWith("p:")) {
    const def = OB_PROVIDERS.find((p) => p.id === step.slice(2));
    body = html`<${ObTokenStep} key=${step} def=${def} existing=${existing} onDone=${next} onBack=${back}/>`;
  } else if (step === "bot") body = html`<${ObTokenStep} key="bot" def=${OB_GH_BOT} onDone=${next} onBack=${back}/>`;
  else if (step === "owner") body = html`<${ObTokenStep} key="owner" def=${OB_GH_OWNER} onDone=${next} onBack=${back}/>`;
  else if (step === "repo") body = html`
    <div class="obki"><${Icon} name="pr" size=${26}/></div>
    <div class="obh">Add your first repo</div>
    <div class="obsub">The repository the agency will work in. Use <code>owner/name</code>. You can add more anytime from the repo bar.</div>
    <label>Repository</label>
    <div style="display:flex;gap:8px"><input placeholder="owner/name" value=${repo} onInput=${(e) => setRepo(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") addRepo(); }}/><button class="btn primary" onClick=${addRepo}>Add</button></div>
    <div class="obnav"><button class="btn" onClick=${back}>Back</button><button class="btn ghost" onClick=${next}>Skip for now</button></div>`;
  else body = html`
    <div class="obki" style="background:var(--green-weak);color:var(--green)"><${Icon} name="check" size=${28}/></div>
    <div class="obh">You're all set${(repos || []).length ? "" : " — almost"}</div>
    <div class="obsub">Your agency is ready. Open an issue (or use “+ New”) and the agents will plan, build, review, and open a PR. ${(repos || []).length ? "" : "Add a repo from the repo bar to get going."} Manage tokens, models, and automation anytime in Settings.</div>
    <div class="obnav"><button class="btn" onClick=${back}>Back</button><button class="btn primary" onClick=${finish}>Go to my board</button></div>`;

  return html`<div class="onboard"><div class="ob">
    <div class="obdots">${dots}</div>
    ${body}
    ${step !== "done" && step !== "welcome" ? html`<div style="text-align:center;margin-top:16px"><button class="btn ghost" style="font-size:13px" onClick=${finish}>Skip setup</button></div>` : null}
  </div></div>`;
}

// ---------- add a repo ----------
function AddRepo({ repos, onClose, reload }) {
  const [avail, setAvail] = useState(null);
  const [manual, setManual] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { getJSON("/repos-available").then((d) => setAvail(d.repos || [])).catch(() => setAvail([])); }, []);
  function add(full) {
    if (!full || busy) return;
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) { toast("Use owner/name, e.g. acme/app"); return; }
    setBusy(true);
    api("/add-repo", { repo: full }).then(() => { toast("Added " + full); setManual(""); reload(); }).catch(() => toast("Couldn’t add — use owner/name")).then(() => setBusy(false));
  }
  function remove(full) { if (busy) return; setBusy(true); api("/remove-repo", { repo: full }).then(() => { toast("Removed " + full); reload(); }).catch(() => toast("Couldn’t remove")).then(() => setBusy(false)); }
  const q = filter.trim().toLowerCase();
  const matches = (avail || []).filter((r) => !q || r.full_name.toLowerCase().includes(q));
  return html`<${Sheet} title="Repos" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <label>Add a repo (owner/name)</label>
    <div style="display:flex;gap:8px">
      <input placeholder="owner/name" value=${manual} onInput=${(e) => setManual(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") add(manual.trim()); }}/>
      <button class="btn primary" disabled=${busy} onClick=${() => add(manual.trim())}>Add</button>
    </div>
    ${(repos || []).length ? html`<div class="sec">Watching</div>${repos.map((r) => html`<div key=${r} style="display:flex;align-items:center;gap:8px;margin:5px 2px">
      <span style="flex:1">${r}</span><button class="btn danger" disabled=${busy} onClick=${() => remove(r)} aria-label="Remove"><${Icon} name="trash" size=${15}/></button></div>`)}` : null}
    <div class="sec">Your GitHub repos ${avail && avail.length ? html`<span class="muted" style="font-weight:400">${matches.length}/${avail.length}</span>` : null}</div>
    ${avail && avail.length > 6 ? html`<div class="searchrow"><${Icon} name="search" size=${15} cls="searchic"/><input placeholder="Filter repos…" value=${filter} onInput=${(e) => setFilter(e.target.value)} autocomplete="off"/>${filter ? html`<button class="iconbtn" style="width:30px;height:30px;border:none" onClick=${() => setFilter("")} aria-label="Clear"><${Icon} name="x" size=${15}/></button>` : null}</div>` : null}
    ${avail === null ? html`<div class="muted">Loading…</div>`
      : !avail.length ? html`<div class="muted" style="font-size:12px">None to list yet — set a GitHub token (Settings → credentials) or type a repo above.</div>`
      : !matches.length ? html`<div class="muted" style="font-size:12px">No repos match “${filter}”.</div>`
      : html`<div class="repolist">${matches.map((r) => html`<div key=${r.full_name} style="display:flex;align-items:center;gap:8px;margin:5px 2px">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${r.full_name}</span><button class="btn" disabled=${busy} onClick=${() => add(r.full_name)}>Add</button></div>`)}</div>`}
  <//>`;
}

// ---------- per-user credentials (write-only, encrypted server-side) ----------
const CRED_FIELDS = [
  { key: "claude_token", label: "Claude subscription token", hint: "CLAUDE_CODE_OAUTH_TOKEN — runs the Claude roles on your plan" },
  { key: "github_user_token", label: "GitHub token (acts as you)", hint: "comments/issues authored under your account" },
  { key: "github_bot_token", label: "GitHub bot token", hint: "the agency's commits + pull requests" },
];
function Credentials({ secretKeys, reload }) {
  return html`<div class="sec">Your credentials</div>
    <div class="muted" style="font-size:12px;margin-bottom:4px">Stored encrypted (AES-256-GCM). The agency uses them to run on your behalf. Write-only — never shown back.</div>
    ${CRED_FIELDS.map((f) => html`<${SecretField} key=${f.key} field=${f} isSet=${secretKeys.includes(f.key)} reload=${reload}/>`)}
    <div class="muted" style="font-size:12px;margin-top:6px">Other LLM providers (GLM, DeepSeek…) are managed in <a href="/classic">models</a> for now.</div>`;
}
function SecretField({ field, isSet, reload }) {
  const [v, setV] = useState("");
  function save() { if (!v) { toast("Enter a value"); return; } api("/user-secret", { key: field.key, value: v }).then(() => { toast("Saved"); setV(""); reload(); }).catch(() => toast("Couldn’t save")); }
  function clear() { api("/user-secret", { key: field.key, value: "" }).then(() => { toast("Cleared"); reload(); }); }
  return html`<label>${field.label} ${isSet ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> set</span>` : null}</label>
    <div class="muted" style="font-size:11px;margin:0 2px 4px">${field.hint}</div>
    <div style="display:flex;gap:8px">
      <input type="password" autocomplete="off" placeholder=${isSet ? "•••••• saved — type to replace" : "paste token"} value=${v} onInput=${(e) => setV(e.target.value)}/>
      <button class="btn" onClick=${save}>Save</button>
      ${isSet ? html`<button class="btn danger" onClick=${clear} aria-label="Clear"><${Icon} name="trash" size=${15}/></button>` : null}
    </div>`;
}
function Admin({ users, webhookSecretSet, reload }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState("");
  const [wh, setWh] = useState("");
  function invite() { api("/invite-create", { email: email || null, role }).then((d) => { setLink(d.url || ""); setEmail(""); toast("Invite link created"); reload(); }).catch(() => toast("Couldn’t create invite")); }
  function saveWh() { api("/settings", { webhookSecret: wh }).then(() => { toast("Webhook secret saved"); setWh(""); reload(); }).catch(() => toast("Couldn’t save")); }
  return html`<div class="sec">Team (admin)</div>
    ${users.map((u) => html`<div key=${u.id} style="display:flex;gap:8px;align-items:center;margin:4px 2px"><span style="flex:1">${u.username}</span><span class="muted" style="font-size:12px">${u.role}</span>
      <button class="btn ghost" style="padding:3px 8px;font-size:12px" onClick=${() => { const np = window.prompt("New password for " + u.username + " (8+ chars)"); if (np == null) return; if (np.length < 8) { toast("8+ characters"); return; } api("/set-password", { value: np, number: u.id }).then(() => toast("Reset " + u.username)).catch(() => toast("Couldn’t reset")); }}><${Icon} name="lock" size=${13}/></button></div>`)}
    <label>Invite a teammate</label>
    <div style="display:flex;gap:8px">
      <input placeholder="email (optional)" value=${email} onInput=${(e) => setEmail(e.target.value)}/>
      <select value=${role} onChange=${(e) => setRole(e.target.value)} style="width:auto"><option value="member">member</option><option value="admin">admin</option></select>
      <button class="btn" onClick=${invite}>Create</button>
    </div>
    ${link ? html`<div class="cmdbox"><code>${link}</code><button class="btn" onClick=${() => { if (navigator.clipboard) navigator.clipboard.writeText(link); toast("Copied"); }}>Copy</button></div>` : null}
    <label>GitHub webhook secret ${webhookSecretSet ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> set</span>` : null}</label>
    <div class="muted" style="font-size:11px;margin:0 2px 4px">Only if you use GitHub push webhooks. Stored encrypted; use the same value in the repo's webhook settings.</div>
    <div style="display:flex;gap:8px">
      <input type="password" autocomplete="off" placeholder=${webhookSecretSet ? "•••••• saved — type to replace" : "secret"} value=${wh} onInput=${(e) => setWh(e.target.value)}/>
      <button class="btn" onClick=${saveWh}>Save</button>
    </div>`;
}

// ---------- Sheet wrapper ----------
function Sheet({ title, onClose, footer, children }) {
  return html`<div><div class="scrim on" onClick=${onClose}></div>
    <div class="sheet bottom on">
      <div class="sh"><span style="flex:1">${title}</span><button class="iconbtn" aria-label="Close" onClick=${onClose}><${Icon} name="x"/></button></div>
      <div class="sb">${children}</div>
      <div class="sf">${footer}</div>
    </div></div>`;
}

// ---------- file read ----------
function readAttach(file, cb) { if (!file) return; if (file.size > 25 * 1024 * 1024) { toast("Too big (max 25MB)"); return; } const r = new FileReader(); r.onload = () => cb({ d: r.result, name: file.name || "file", img: /^image\//.test(file.type) }); r.readAsDataURL(file); }

export function mount(root) { root.removeAttribute("aria-busy"); render(html`<${App}/>`, root); }
