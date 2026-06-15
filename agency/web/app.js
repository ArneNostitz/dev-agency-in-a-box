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
  chevup: '<path d="m18 15-6-6-6 6"/>',
  chevdown: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  incoming: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
};
const Icon = ({ name, size = 18, cls }) => html`<svg class=${"lic " + (cls || "")} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML=${{ __html: ICONS[name] || "" }}></svg>`;
// Spinning loader to show an action is in flight (blocks "did my click register?" ambiguity).
const Spinner = ({ size = 18 }) => html`<svg class="lic spin" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>`;

// ---------- agent persona avatars ----------
// One avatar file per role (a mixed-gender team). Swap a value to change who represents a role.
const ROLE_AVATAR = { planner: "planner-f", architect: "architect", developer: "developer-f", reviewer: "reviewer", tester: "tester", librarian: "librarian-f", auditor: "auditor" };
const ROLE_WORDS = ["planner", "architect", "developer", "reviewer", "tester", "librarian", "auditor"];
function avatarFile(role) { return "/web/avatars/" + (ROLE_AVATAR[role] || "agent") + ".svg"; }
// The author role of an agency comment, read from its leading badge ("🧠 **Planner**", "role: **developer**", …).
function roleFromComment(body) { const head = (body || "").slice(0, 90).toLowerCase(); for (const r of ROLE_WORDS) if (head.includes(r)) return r; return null; }
// Circular head-crop of the (full-body) persona SVG.
const Avatar = ({ role, size = 24 }) => html`<span class="avi" style=${"width:" + size + "px;height:" + size + "px"} title=${(role || "agent") + " agent"}><img src=${avatarFile(role)} alt=${(role || "agent") + " avatar"} loading="lazy"/></span>`;

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
  const lines = escHtml(String(src || "")).split(/\r?\n/), out = [];
  let inUL = false, inOL = false, inBQ = false, inCode = false, code = [];
  const closeUL = () => { if (inUL) { out.push("</ul>"); inUL = false; } };
  const closeOL = () => { if (inOL) { out.push("</ol>"); inOL = false; } };
  const closeBQ = () => { if (inBQ) { out.push("</blockquote>"); inBQ = false; } };
  const closeBlocks = () => { closeUL(); closeOL(); closeBQ(); };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*```/.test(ln)) { if (inCode) { out.push("<pre><code>" + code.join("\n") + "</code></pre>"); code = []; inCode = false; } else { closeBlocks(); inCode = true; } continue; }
    if (inCode) { code.push(ln); continue; }
    const h = /^(#{1,6})\s+(.+)$/.exec(ln);
    if (h) { closeBlocks(); const lv = h[1].length; out.push("<h" + lv + ">" + mdInline(h[2]) + "</h" + lv + ">"); continue; }
    if (/^([-*_] *){3,}$/.test(ln.trim())) { closeBlocks(); out.push("<hr>"); continue; }
    if (/^>\s?/.test(ln)) { closeUL(); closeOL(); if (!inBQ) { out.push("<blockquote>"); inBQ = true; } out.push("<p>" + mdInline(ln.replace(/^>\s?/, "")) + "</p>"); continue; }
    if (/^\d+\.\s+/.test(ln)) { closeBQ(); closeUL(); if (!inOL) { out.push("<ol>"); inOL = true; } out.push("<li>" + mdInline(ln.replace(/^\d+\.\s+/, "")) + "</li>"); continue; }
    if (/^\s*[-*+]\s+/.test(ln)) { closeBQ(); closeOL(); if (!inUL) { out.push("<ul>"); inUL = true; } out.push("<li>" + mdInline(ln.replace(/^\s*[-*+]\s+/, "")) + "</li>"); continue; }
    if (ln.trim() === "") { closeBlocks(); continue; }
    closeBlocks(); out.push("<p>" + mdInline(ln) + "</p>");
  }
  if (inCode) out.push("<pre><code>" + code.join("\n") + "</code></pre>");
  closeUL(); closeOL(); closeBQ();
  return out.join("");
}
function api(url, body) { return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(async (r) => { if (!r.ok) { let msg = "http " + r.status; try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {} throw new Error(msg); } return r.json().catch(() => ({})); }); }
function getJSON(u) { return fetch(u).then((r) => r.json()); }

function isDone(i) { const s = i.state || ""; return s === "merged" || s === "agency:merged" || s === "closed" || s === "done"; }
function classify(i) {
  const s = i.state || "";
  if (isDone(i)) return "done";
  if (i.active || i.queued || i.running) return "working"; // actually executing right now (i.running = live hasActiveRun from server)
  if (i.pr_number) return "review"; // a PR exists → it's waiting on you, even if a restart left a stale "in-progress" label
  if (s === "agency:in-progress" || s === "agency:rate-limited") return "working";
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
// kind: "info" (default, auto-dismiss 2s) | "error" (persists until dismissed)
let toastFn = () => {};
function toast(t, kind) { toastFn(t, kind || "info"); }

// ---------- Toasts molecule ----------
function Toasts({ toasts, onDismiss }) {
  if (!toasts || !toasts.length) return null;
  return html`<div class="toast-stack">${toasts.map((t) => html`<div key=${t.id} class=${"toast-item" + (t.kind === "error" ? " t-error" : "")}><span>${t.msg}</span>${t.kind === "error" ? html`<button class="toast-x" onClick=${() => onDismiss(t.id)} aria-label="Dismiss">✕</button>` : null}</div>`)}</div>`;
}

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
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const [pending, setPending] = useState([]); // optimistic new issues
  const [detailError, setDetailError] = useState(null); // inline error for the open detail
  const overridesRef = useRef({}); // "repo#n" -> {state, t}
  const busyRef = useRef({}); // "action:repo#n" -> ts, while a request is in flight
  const openIssueRef = useRef(null); // last-known open issue, so polls don't flicker the detail closed
  const liveRef = useRef([]); // SSE-appended activity since last poll
  const [, forceTick] = useState(0);

  useEffect(() => {
    toastFn = (t, kind) => {
      const id = ++toastIdRef.current;
      setToasts((ts) => ts.concat({ id, msg: t, kind: kind || "info" }));
      if ((kind || "info") !== "error") setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2000);
    };
  }, []);

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
    let es; try { es = new EventSource("/events"); es.onmessage = (ev) => { try { const a = JSON.parse(ev.data); liveRef.current = liveRef.current.concat(a).slice(-200);
      // Surface run failures the user would otherwise only see on GitHub: an agent error is pushed
      // as a "done" line starting with ❌ (e.g. a misconfigured model or a real rate-limit).
      (Array.isArray(a) ? a : [a]).forEach((x) => { if (x && (x.kind === "error" || (x.kind === "done" && typeof x.text === "string" && x.text.trim().startsWith("❌")))) toast(String(x.text || "Run failed").replace(/^❌\s*/, ""), "error"); });
      forceTick((x) => x + 1); } catch (e) {} }; } catch (e) {}
    return () => { try { es && es.close(); } catch (e) {} };
  }, []);

  function setThemeP(t) { setTheme(t); try { localStorage.setItem("theme", t); } catch (e) {} document.documentElement.setAttribute("data-theme", t); const m = document.getElementById("metatheme"); if (m) m.setAttribute("content", t === "dark" ? "#0e1014" : "#f5f6f8"); }

  // merge server issues with optimistic overrides + pendings
  const repos = data.repos || [];
  const ov = overridesRef.current;
  let issues = (data.issues || []).map((i) => { const o = ov[i.repo + "#" + i.number]; return o ? Object.assign({}, i, o.patch) : i; });
  issues = issues.concat(pending.filter((p) => !issues.some((i) => i.repo === p.repo && i.number === p.number)));
  // Repos with a running audit — drives the spinner on the top-bar Audit dropdown. (The audit itself
  // is now a real GitHub tracking issue, so it shows as a normal card + detail.)
  const auditRepos = (data.active || []).filter((a) => a.role === "auditor").map((a) => a.repo);
  const shown = issues.filter((i) => !repoFilter || i.repo === repoFilter);
  const activity = (data.activity || []).concat(liveRef.current);

  function override(repo, number, patch) { ov[repo + "#" + number] = { patch, t: Date.now() }; forceTick((x) => x + 1); }

  // In-flight tracking: while an action waits on the server/GitHub, its button shows a spinner,
  // is disabled, and repeat clicks are ignored — no more "did that register?" multi-clicking.
  const bkey = (action, repo, number) => action + ":" + repo + "#" + number;
  function setBusy(k, on) { if (on) busyRef.current[k] = Date.now(); else delete busyRef.current[k]; forceTick((x) => x + 1); }
  function guard(action, repo, number, run) {
    const k = bkey(action, repo, number);
    if (busyRef.current[k]) return Promise.resolve(); // already running — ignore the extra click
    setBusy(k, true);
    return Promise.resolve().then(run).finally(() => setBusy(k, false));
  }

  // actions (optimistic + reconcile). Each is guarded: spins + blocks until the server responds.
  const act = {
    isBusy: (action, repo, number) => Boolean(busyRef.current[bkey(action, repo, number)]),
    start(repo, number, model) { return guard("start", repo, number, () => { override(repo, number, { state: "agency:in-progress" }); return api("/start", { repo, number, ...(model ? { model } : {}) }).then(() => toast("Starting" + (model ? ` with model ${model.model}` : "") + "…")).catch(() => { toast("Couldn’t start", "error"); delete ov[repo + "#" + number]; }).then(load); }); },
    approve(repo, number, model) { return guard("approve", repo, number, () => { override(repo, number, { state: "agency:in-progress" }); return api("/approve", { repo, number, ...(model ? { model } : {}) }).then(() => toast("Approved" + (model ? ` with model ${model.model}` : "") + " — building")).catch(() => toast("Couldn’t approve", "error")).then(load); }); },
    resume(repo, number, model) { return guard("resume", repo, number, () => { override(repo, number, { state: "agency:in-progress" }); return api("/resume", { repo, number, ...(model ? { model } : {}) }).then(() => toast("Resuming" + (model ? ` with model ${model.model}` : "") + "…")).catch(() => toast("Couldn’t resume", "error")).then(load); }); },
    stop(repo, number) { return guard("stop", repo, number, () => { override(repo, number, { state: "planned" }); return api("/stop", { repo, number }).then(() => toast("Stopped — moved to Planned")).catch(() => toast("Couldn’t stop", "error")).then(load); }); },
    fix(repo, number, model) { return guard("fix", repo, number, () => { override(repo, number, { state: "agency:in-progress", active: true }); return api("/fix", { repo, number, ...(model ? { model } : {}) }).then(() => toast("Fixing the review" + (model ? ` with model ${model.model}` : "") + "…")).catch(() => toast("Couldn’t fix", "error")).then(load); }); },
    merge(repo, number) { return guard("merge", repo, number, () => api("/merge", { repo, number }).then((r) => { toast("Merged"); load(); return r; }).catch(() => toast("Couldn’t merge — conflicts?", "error"))); },
    close(repo, number) { return guard("close", repo, number, () => { override(repo, number, { state: "merged" }); return api("/close", { repo, number }).then(() => { toast("Closed"); setOpenKey(null); }).catch((e) => toast((e && e.message) || "Couldn’t close", "error")).then(load); }); },
    closeNotPlanned(repo, number) { return guard("close-not-planned", repo, number, () => { override(repo, number, { state: "done" }); return api("/close-not-planned", { repo, number }).then(() => { toast("Closed as not planned"); setOpenKey(null); }).catch((e) => toast((e && e.message) || "Couldn’t close", "error")).then(load); }); },
    createPr(repo, number) { return guard("createPr", repo, number, () => { override(repo, number, { state: "agency:ready" }); return api("/create-pr", { repo, number }).then((r) => toast(r && r.url ? "PR opened" : "PR opened")).catch((e) => toast((e && e.message) || "Couldn’t open PR", "error")).then(load); }); },
    del(repo, number) { return guard("del", repo, number, () => { override(repo, number, { state: "done" }); return api("/delete", { repo, number }).then(() => { toast("Deleted"); setOpenKey(null); }).catch(() => toast("Couldn’t delete", "error")).then(load); }); },
    runChecks(repo, number, title) { return guard("runChecks", repo, number, () => api("/run-checks", { repo, number, title }).then(() => toast("Running checks…")).catch(() => toast("Couldn’t run checks", "error"))); },

    setAuto(kind, value, repo, number) { return guard("auto-" + kind, repo || "global", number || 0, () => { const b = { kind, value }; if (repo) b.repo = repo; if (number) b.number = number; return api("/auto", b).then(() => { toast("auto-" + kind + ": " + value); }).then(load); }); },
    audit(repo) { return guard("audit", repo, 0, () => api("/audit", { repo }).then(() => toast("Auditing " + repo.split("/").pop() + " — proposed issues will appear in Planned")).catch((e) => toast((e && e.message) || "Couldn’t start the audit", "error"))); },
  };

  function dismissToast(id) { setToasts((ts) => ts.filter((t) => t.id !== id)); }

  function openComposer(repo) { setComposerRepo(repo || repoFilter || (repos[0] || null)); setSheet("composer"); }
  function createIssue(repo, role, title, body, start, atts, model) {
    const tmpNum = -Date.now();
    const tmp = { repo, number: tmpNum, title, role, state: start ? "agency:in-progress" : "planned", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _tmp: true };
    setPending((ps) => ps.concat(tmp)); setSheet(null); toast(start ? "Creating & starting…" : "Added to Planned");
    if (start) { setOpenKey(repo + "#" + tmpNum); setDetailError(null); }
    Promise.all((atts || []).map((a) => api("/upload-file", { repo, number: 0, dataUrl: a.dataUrl, name: a.name }).then((j) => j && j.md).catch(() => null)))
      .then((mds) => { const full = [body].concat(mds.filter(Boolean)).filter(Boolean).join("\n\n"); return api("/new-issue", { repo, role, title, body: full, start: !!start, ...(model ? { model } : {}) }); })
      .then((d) => {
        if (start && d && d.number) setOpenKey(repo + "#" + d.number);
        setPending((ps) => ps.map((p) => (p === tmp ? Object.assign({}, p, { number: d.number || p.number }) : p)));
        setTimeout(load, 700);
      })
      .catch((e) => {
        const msg = (e && e.message) || "Couldn’t create";
        if (start) { setDetailError(msg); } else { toast(msg, "error"); }
        setPending((ps) => ps.filter((p) => p !== tmp));
      });
  }

  // Keep the open detail mounted across polls. The issue object is re-fetched every 5s; if it's
  // briefly absent from the freshly-polled list, fall back to the last-known copy (scoped to the
  // same openKey) so the panel doesn't flicker/close. Also lets us open a sub-issue that isn't in
  // the polled list via a small stub.
  const foundOpen = openKey ? issues.find((i) => i.repo + "#" + i.number === openKey) : null;
  if (foundOpen) openIssueRef.current = foundOpen;
  const cachedOpen = openIssueRef.current && openIssueRef.current.repo + "#" + openIssueRef.current.number === openKey ? openIssueRef.current : null;
  const open = openKey ? foundOpen || cachedOpen : null;
  // Open any issue's detail by repo+number (used by the sub-issue checklist). Seeds a stub so a
  // child that isn't in the polled list still opens (the detail loads its own thread/PR/app info).
  function openIssue(r, n, title) {
    const key = r + "#" + n;
    if (!issues.some((i) => i.repo + "#" + i.number === key)) openIssueRef.current = { repo: r, number: n, title: title || "#" + n, state: "" };
    setOpenKey(key);
  }
  const working = (data.active || []).length;

  return html`
    <div class="app">
      <${TopBar} working=${working} env=${data.env} theme=${theme} setTheme=${setThemeP} onSettings=${() => setSheet("settings")} onUsage=${() => setSheet("usage")} onAgents=${() => setSheet("agents")} repos=${repos} repoFilter=${repoFilter} setRepoFilter=${setRepoFilter} reload=${load} auto=${data.auto || {}} autoRepos=${data.autoRepos || {}} setAuto=${act.setAuto}/>
      ${data.secretsHealth ? html`<${SecretBanner} h=${data.secretsHealth} onFix=${() => setSheet("settings")}/>` : null}
      <${StatusLine} working=${working} session=${data.session} spend=${data.spendToday} analyzer=${data.analyzer} reload=${load}/>
      <div class="content">
        <${Board} issues=${shown} repos=${repos} repoFilter=${repoFilter} tab=${tab} isDesktop=${isDesktop} onOpen=${(i) => setOpenKey(i.repo + "#" + i.number)} onAddRepo=${() => setSheet("addrepo")} onAddIssue=${(r) => openComposer(r)} onAnalyze=${(r) => act.audit(r)} auditRepos=${auditRepos} act=${act} data=${data}/>
      </div>
      ${!isDesktop && html`<${TabBar} issues=${shown} tab=${tab} setTab=${setTab}/>`}
      ${open && html`<div class="dscrim" onClick=${() => setOpenKey(null)}></div>`}
      ${open && html`<${Detail} key=${openKey} issue=${open} activity=${activity} act=${act} isDesktop=${isDesktop} startError=${detailError} onClose=${() => { setOpenKey(null); setDetailError(null); }} onOpenIssue=${openIssue} data=${data}/>`}
      ${sheet === "composer" && html`<${Composer} repos=${repos} repo=${composerRepo} setRepo=${setComposerRepo} onClose=${() => setSheet(null)} onCreate=${createIssue} data=${data}/>`}
      ${sheet === "settings" && html`<${Settings} data=${data} onClose=${() => setSheet(null)} reload=${load} openGithubTokens=${() => setSheet("github")} openModels=${() => setSheet("models")}/>`}
      ${sheet === "github" && html`<${GithubTokensModal} secretKeys=${data.secretKeys || []} onClose=${() => setSheet("settings")} reload=${load}/>`}
      ${sheet === "models" && html`<${ModelsModal} onClose=${() => setSheet("settings")} reload=${load}/>`}
      ${sheet === "addrepo" && html`<${AddRepo} repos=${repos} onClose=${() => setSheet(null)} reload=${load}/>`}
      ${sheet === "usage" && html`<${Usage} onClose=${() => setSheet(null)} onOpenIssue=${openIssue}/>`}
      ${sheet === "agents" && html`<${AgentEditor} data=${data} onClose=${() => setSheet(null)} onSkills=${() => setSheet("skills")} reload=${load}/>`}
      ${sheet === "skills" && html`<${SkillEditor} data=${data} onClose=${() => setSheet("agents")} reload=${load}/>`}
      ${data.user && data.onboarded === false && html`<${Onboarding} repos=${repos} reload=${load}/>`}
      <${Toasts} toasts=${toasts} onDismiss=${dismissToast}/>
    </div>`;
}

function SecretBanner({ h, onFix }) {
  const msgs = [];
  if (!h.masterKey) msgs.push("MASTER_KEY isn’t configured on the server — stored tokens can’t be encrypted/decrypted, so agents fall back to env credentials (usually a 401). Set a stable MASTER_KEY (openssl rand -hex 32) and re-enter your tokens.");
  const names = { claude_token: "Claude token", anthropic_api_key: "Anthropic API key", github_bot_token: "GitHub bot token", github_user_token: "GitHub user token" };
  const bad = Object.keys(names).filter((k) => h[k] === "undecryptable").map((k) => names[k]);
  if (bad.length) msgs.push("Your stored " + bad.join(", ") + " can’t be decrypted — MASTER_KEY changed since you saved " + (bad.length > 1 ? "them" : "it") + ". Re-enter " + (bad.length > 1 ? "them" : "it") + " (the agency is falling back to env credentials, which usually 401s).");
  if (!msgs.length) return null;
  return html`<div class="secbanner"><b>⚠ Credentials need attention.</b> ${msgs.map((m, i) => html`<div key=${i} style="margin-top:3px">${m}</div>`)} <button class="btn ghost" style="margin-top:7px" onClick=${onFix}>Open Settings</button></div>`;
}

function TopBar({ working, env, theme, setTheme, onSettings, onUsage, onAgents, repos, repoFilter, setRepoFilter, reload, auto, autoRepos, setAuto }) {
  return html`<div class="topbar">
    <div class="brand"><${Icon} name="crown" size=${18}/> <span class="brandname">Dev Agency in a Box</span> ${env === "development" ? html`<span class="envbadge">DEV</span>` : null} ${working ? html`<span class="dot"></span>` : null}</div>
    <div class="spacer"></div>
    <${RepoDropdown} repos=${repos} repoFilter=${repoFilter} setRepoFilter=${setRepoFilter} reload=${reload} auto=${auto} autoRepos=${autoRepos} setAuto=${setAuto}/>
    <div class="spacer"></div>
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
function StatusLine({ working, session, spend, analyzer, reload }) {
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
  const verTitle = ver ? "Build " + (ver.version || "?") + (ver.sha ? " · commit " + ver.sha : "") + (ver.builtAt ? " · built " + new Date(ver.builtAt).toLocaleString() : "") : "Development build (not from a Docker image)";
  const verLabel = ver ? "v" + (ver.version || "?") + (ver.builtAt ? " · " + ago(ver.builtAt) : "") : "dev";

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
    <span class="buildstamp" title=${verTitle}>${verLabel}</span>
  </div>`;
}

function Board({ issues, repos, repoFilter, tab, isDesktop, onOpen, onAddRepo, onAddIssue, onAnalyze, auditRepos, act, data }) {
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
  const byCol = {}; COLS.forEach((c) => (byCol[c.k] = []));
  issues.slice().sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).forEach((i) => byCol[classify(i)].push(i));
  const cols = isDesktop ? COLS : COLS.filter((c) => c.k === tab);
  return html`<div class="board">
    ${cols.map((c) => html`<div class="col" key=${c.k}>
      <div class="colhead"><${Icon} name=${c.icon} size=${15}/> ${c.label} <span class="n">${byCol[c.k].length || ""}</span></div>
      ${c.k === "planned" ? html`<div class="planned-actions">
        <button class="colbtn primary" onClick=${() => onAddIssue(target)}><${Icon} name="plus" size=${14}/> Add Issue</button>
        <button class="colbtn" disabled=${!target || analyzing} title=${target ? "Analyze " + target.split("/").pop() + "'s codebase health" : "Pick a repo first"} onClick=${() => target && onAnalyze(target)}>${analyzing ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="search" size=${14}/>`} Analyze Repo</button>
      </div>` : null}
      <div class="cards">
        ${byCol[c.k].length ? byCol[c.k].map((i) => html`<${Card} key=${i.repo + "#" + i.number} i=${i} multi=${!repoFilter && repos.length > 1} onOpen=${onOpen} act=${act} data=${data}/>`) : html`<div class="empty">—</div>`}
      </div>
    </div>`)}
  </div>`;
}

function usageTitle(u) {
  if (!u || !u.tokens) return "No token usage recorded yet";
  return `${fmtTok(u.tokens)} tokens · $${Number(u.costUsd || 0).toFixed(2)}${u.model ? " · " + shortModel(u.model) : ""} · ${u.runs || 0} runs`;
}

function Card({ i, multi, onOpen, act, data }) {
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

  const engaged = !tmp && (i.active || ["agency:in-progress", "agency:rate-limited", "agency:awaiting-answer", "agency:awaiting-approval", "agency:needs-attention"].includes(i.state) || i.review === "changes");
  return html`<div class=${"card" + (tmp ? " busy" : "") + (i.active ? " active-now" : "")} title=${usageTitle(i.usage)} onClick=${tmp ? null : () => onOpen(i)}>
    <div class="t">${engaged && i.role ? html`<${Avatar} role=${i.role} size=${20}/> ` : null}${(i.active || tmp) ? html`<${Spinner} size=${13}/> ` : null}${i.title || "#" + i.number}</div>
    <div class="meta">
      ${tmp
        ? html`<span class="statuschip s-working"><${Spinner} size=${12}/> ${i.state === "agency:in-progress" ? "creating & starting…" : "creating…"}</span>`
        : html`<span class=${"statuschip " + st.cls}><${Icon} name=${st.icon} size=${12}/> ${st.label}</span>`}
      ${i.active && !tmp ? html`<span class="dot"></span>` : null}
      ${autoOn ? html`<span class="statuschip s-auto"><${Icon} name=${i.auto.merge ? "merge" : "refresh"} size=${12}/> auto</span>` : null}
      ${i.conflict ? html`<span class="statuschip s-conflict" title=${(i.conflict.files || []).join(", ") || "Merge conflicts with main"}><${Icon} name="merge" size=${12}/> conflict</span>` : null}
      ${i.pr_number ? html`<a class="tagk" href=${i.pr_url || ghUrl(i.repo, i.pr_number)} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}><${Icon} name="pr" size=${11}/> #${i.pr_number}</a>` : null}
      ${i.usage && i.usage.tokens ? html`<span class="tagk" title=${usageTitle(i.usage)}><${Icon} name="chart" size=${11}/> ${fmtTok(i.usage.tokens)}${i.usage.model ? " · " + shortModel(i.usage.model) : ""}</span>` : null}
      ${multi ? html`<span class="tagk">${i.repo.split("/").pop()}</span>` : null}
      <span class="spacer" style="margin-left:auto"></span>
      ${tmp ? null : quick ? html`
        <div style="display:inline-flex;gap:4px;align-items:center" onClick=${(e) => e.stopPropagation()}>
          ${i.state === "planned" ? html`<button class="cardbtn" title="Close as not planned" disabled=${act.isBusy("close-not-planned", i.repo, i.number)} onClick=${(e) => { e.stopPropagation(); act.closeNotPlanned(i.repo, i.number); }}>${act.isBusy("close-not-planned", i.repo, i.number) ? html`<${Spinner} size=${13}/>` : html`<${Icon} name="x" size=${13}/>`} not planned</button>` : null}
          ${modelOpts.length && quick.action !== "stop" ? html`
            <select class="modelsel sm" value=${modelSel} onChange=${selectModel}>
              <option value="">Default model</option>
              ${modelOpts.map((o) => html`<option key=${o.value} value=${o.value}>${o.label.split(" / ").pop()}</option>`)}
            </select>
          ` : null}
          <button class=${"cardbtn " + quick.cls + (qBusy ? " busy" : "")} disabled=${qBusy} onClick=${runQuick}>${qBusy ? html`<${Spinner} size=${13}/>` : html`<${Icon} name=${quick.icon} size=${13}/>`} ${qBusy ? "working…" : quick.label}</button>
        </div>
      ` : html`<span style="color:var(--ink-3);font-size:12px">${ago(i.updated_at)}</span>`}
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
function Detail({ issue, activity, act, isDesktop, startError, onClose, onOpenIssue, data }) {
  const [tab, setTab] = useState("chat"); // mobile sub-tab: chat | stream
  const [thread, setThread] = useState(null);
  const [pr, setPr] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [reply, setReply] = useState("");
  const [atts, setAtts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(""); // two-tap confirm: which destructive action is armed
  const [modelOverride, setModelOverride] = useState(
    issue.modelOverride ? issue.modelOverride.providerId + "/" + issue.modelOverride.model : ""
  );
  const providers = data?.providers || [];
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ value: p.id + "/" + m, label: p.name + " / " + m })));
  const [pendingComments, setPendingComments] = useState([]); // optimistic skeleton comments
  const [chatAtBottom, setChatAtBottom] = useState(true);
  const [chatAtTop, setChatAtTop] = useState(true);
  const [streamAtBottom, setStreamAtBottom] = useState(true);
  const armRef = useRef(null);
  const streamRef = useRef(null);
  const stickRef = useRef(true);
  const chatRef = useRef(null);
  const taRef = useRef(null); // compose textarea (auto-grows with content)
  const didScrollRef = useRef(false); // scroll the conversation to the newest message once, on open
  function autosize() { const el = taRef.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }
  const updateModelOverride = (val) => {
    setModelOverride(val);
    let mo = null;
    if (val) {
      const parts = val.split("/");
      mo = { providerId: parts[0], model: parts.slice(1).join("/") };
    }
    issue.modelOverride = mo;
    api("/model-override", { repo, number, model: mo }).catch((err) => {
      toast("Failed to save model override: " + err.message);
    });
  };
  const repo = issue.repo, number = issue.number;
  useEffect(() => {
    if (thread && !didScrollRef.current && chatRef.current) {
      didScrollRef.current = true;
      requestAnimationFrame(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; });
    }
  }, [thread]);
  function confirmAct(key, fn) {
    if (armed === key) { clearTimeout(armRef.current); setArmed(""); fn(); return; }
    setArmed(key); clearTimeout(armRef.current); armRef.current = setTimeout(() => setArmed(""), 3000);
  }
  function onChatScroll(e) {
    const el = e.target;
    setChatAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
    setChatAtTop(el.scrollTop < 60);
  }

  function loadThread() {
    getJSON("/thread?repo=" + encodeURIComponent(repo) + "&number=" + number)
      .then((t) => {
        if (t && Array.isArray(t.comments)) {
          setThread(t);
        } else {
          const errMsg = (t && t.error) || "No thread data received from GitHub — the issue may not exist yet or the token lacks access.";
          setThread({ _err: errMsg });
          toast(errMsg);
        }
      })
      .catch((e) => {
        const errMsg = (e && e.message) || "Couldn't load thread. Check network and GitHub token.";
        setThread((prev) => prev || { _err: errMsg });
        toast(errMsg);
      });
  }
  useEffect(() => {
    setModelOverride(issue.modelOverride ? issue.modelOverride.providerId + "/" + issue.modelOverride.model : "");
  }, [issue.modelOverride?.providerId, issue.modelOverride?.model]);
  useEffect(() => {
    setThread(null); setPr(null); setAppInfo(null); setAtts([]); setPendingComments([]); stickRef.current = true;
    if (issue._audit) return; // the audit has no GitHub thread/PR — stream-only view below
    loadThread();
    if (issue.pr_number) getJSON("/pr-status?repo=" + encodeURIComponent(repo) + "&number=" + number).then(setPr).catch(() => {});
    getJSON("/app-info?repo=" + encodeURIComponent(repo) + "&number=" + number).then(setAppInfo).catch(() => setAppInfo({ kind: "unknown" }));
    const t = setInterval(loadThread, 6000); return () => clearInterval(t);
  }, [repo, number, issue._audit, issue.pr_number]);

  const stream = activity.filter((a) => a.repo === repo && a.number === number).slice(-60);
  useEffect(() => { const el = streamRef.current; if (el && stickRef.current) el.scrollTop = el.scrollHeight; });

  const review = (pr && pr.review && pr.review.verdict) || issue.review || null;
  // Live conflict signal once /pr-status loads; before that, fall back to the stored flag from /data
  // so the box shows immediately on open.
  const conflict = pr ? Boolean(pr.merge && pr.merge.mergeable === "conflict") : Boolean(issue.conflict);
  const conflictFiles = (pr && pr.conflict && pr.conflict.files) || (issue.conflict && issue.conflict.files) || [];
  const needsFix = review === "changes";
  const done = isDone(issue);
  const st = issue.state || "";
  const running = !!(issue.running || issue.active || issue.queued); // a Claude run is executing right now

  function send() {
    if (!reply.trim() && !atts.length) return;
    setBusy(true);
    const mo = modelOverride ? (() => { const parts = modelOverride.split("/"); return { providerId: parts[0], model: parts.slice(1).join("/") }; })() : null;
    // Optimistic skeleton: show the comment immediately before the server confirms
    const skelId = Date.now();
    setPendingComments((ps) => ps.concat({ _skel: true, id: skelId, author: "you", createdAt: new Date().toISOString(), body: reply }));
    // Scroll to bottom so the skeleton is visible
    requestAnimationFrame(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; });
    Promise.all(atts.map((a) =>
      api("/upload-file", { repo, number, dataUrl: a.d, name: a.name })
        .then((j) => ({ md: j && j.md, refId: a.refId }))
        .catch(() => null)
    ))
      .then((results) => {
        // Replace inline [image N] references with their uploaded markdown
        let full = reply;
        const appended = [];
        for (const r of results.filter(Boolean)) {
          if (r.refId && r.md) full = full.split("[" + r.refId + "]").join(r.md);
          else if (r.md) appended.push(r.md);
        }
        if (appended.length) full = [full].concat(appended).filter(Boolean).join("\n\n");
        return api("/comment", { repo, number, body: full, ...(mo ? { model: mo } : {}) });
      })
      .then(() => {
        setReply(""); setAtts([]);
        if (taRef.current) taRef.current.style.height = "auto";
        toast(running ? "Queued — the agent will pick it up when the run finishes" : "Sent");
        setTimeout(() => { setPendingComments((ps) => ps.filter((p) => p.id !== skelId)); loadThread(); }, 800);
      })
      .catch((e) => { toast((e && e.message) || "Couldn’t send", "error"); setPendingComments((ps) => ps.filter((p) => p.id !== skelId)); })
      .finally(() => setBusy(false));
  }
  function editComment(id, body) {
    return api("/comment-edit", { repo, number, commentId: id, body })
      .then(() => { toast("Comment updated"); setTimeout(loadThread, 400); });
  }
  function pickFiles(e) { const fs = e.target.files || []; for (let i = 0; i < fs.length; i++) readAttach(fs[i], (a) => setAtts((x) => x.concat(a))); e.target.value = ""; }
  function onPaste(e) {
    const items = (e.clipboardData || {}).items || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== "file") continue;
      const file = items[i].getAsFile();
      if (!file) continue;
      if (/^image\//.test(file.type)) {
        // Inline image: insert a reference token at the caret so the image lands in context
        const imgNum = atts.filter((a) => a.img).length + 1;
        const refId = "image " + imgNum;
        const ta = taRef.current;
        if (ta) {
          const start = ta.selectionStart || 0, end = ta.selectionEnd || 0;
          const token = "[" + refId + "]";
          setReply((prev) => prev.slice(0, start) + token + prev.slice(end));
          // Restore caret after the inserted token
          requestAnimationFrame(() => { if (ta) { const pos = start + token.length; ta.selectionStart = ta.selectionEnd = pos; ta.focus(); } });
        }
        readAttach(file, (a) => setAtts((x) => x.concat(Object.assign({}, a, { name: refId, refId }))));
      } else {
        readAttach(file, (a) => setAtts((x) => x.concat(a)));
      }
    }
  }

  // toolbar actions. Text labels show on desktop (and on a confirm-armed destructive button).
  const lbl = (t) => isDesktop ? html`<span class="tlabel">${t}</span>` : null;
  const au = issue.auto || {};
  // Obvious ON/OFF toggle switch. Reflects the effective state; clicking flips it (explicit on/off).
  const autoToggle = (kind) => {
    const on = kind === "resume" ? au.resume : au.merge;
    const busy = act.isBusy("auto-" + kind, repo, number);
    return html`<button class=${"autotog" + (on ? " on" : "") + (busy ? " busy" : "")} disabled=${busy} data-tip=${"Auto-" + kind + " is " + (on ? "ON" : "OFF") + " — click to turn " + (on ? "off" : "on")} onClick=${() => act.setAuto(kind, on ? "off" : "on", repo, number)}>
      <span class="autotog-l"><${Icon} name=${kind === "resume" ? "refresh" : "merge"} size=${13}/> auto-${kind}</span>
      <span class="autotog-sw"><span class="autotog-knob"></span></span>
    </button>`;
  };
  const tb = [];
  tb.push(html`<a class="tbtn" data-tip="Open on GitHub" href=${ghUrl(repo, number)} target="_blank" rel="noopener"><${Icon} name="link"/>${lbl("GitHub")}</a>`);
  if (issue.pr_url) tb.push(html`<a class="tbtn" data-tip="Open PR" href=${issue.pr_url} target="_blank" rel="noopener"><${Icon} name="pr"/>${lbl("PR")}</a>`);
  if (issue.previewUrl) tb.push(html`<a class="tbtn primary" data-tip="Open preview" href=${issue.previewUrl} target="_blank" rel="noopener"><${Icon} name="globe"/>${lbl("Preview")}</a>`);
  // A toolbar icon that swaps to a spinner + disables while its action is in flight.
  const bz = (a) => act.isBusy(a, repo, number);
  const tico = (a, name) => bz(a) ? html`<${Spinner} size=${18}/>` : html`<${Icon} name=${name}/>`;
  if (!done) {
    // Decide actions from FACTS, not the (possibly stale) state label:
    //  • running  — something is actually executing right now (live registry), so the only
    //               meaningful action is Stop. A restart can leave the label "in-progress" while
    //               nothing runs — that must NOT show Stop.
    //  • hasPr    — a PR exists → the goal is Merge (or Fix/Resolve if blocked). Never Create PR/Close.
    //  • approved — reviewer approved but no PR yet → Create PR (token-free).
    const hasPr = !!issue.pr_number;
    const parked = !st || st === "planned" || st === "agency:planned";
    const awaiting = st === "agency:awaiting-approval";
    const approved = review === "approved";

    const parts = modelOverride ? modelOverride.split("/") : [];
    const mo = parts.length >= 2 ? { providerId: parts[0], model: parts.slice(1).join("/") } : null;

    const bStop = () => html`<button class=${"tbtn warn" + (bz("stop") ? " busy" : "")} disabled=${bz("stop")} data-tip="Stop the running agent & move to Planned" onClick=${() => act.stop(repo, number)}>${tico("stop", "stop")}${lbl(bz("stop") ? "Stopping…" : "Stop")}</button>`;
    const bToPlanned = () => html`<button class=${"tbtn" + (bz("stop") ? " busy" : "")} disabled=${bz("stop")} data-tip="Move to Planned (park it — no AI until you start it)" onClick=${() => act.stop(repo, number).then(onClose)}>${tico("stop", "planned")}${lbl(bz("stop") ? "Moving…" : "To Planned")}</button>`;
    const bStart = () => html`<button class=${"tbtn green" + (bz("start") ? " busy" : "")} disabled=${bz("start")} data-tip="Start building this" onClick=${() => act.start(repo, number, mo).then(onClose)}>${tico("start", "play")}${lbl("Start")}</button>`;
    const bApprove = () => html`<button class=${"tbtn primary" + (bz("approve") ? " busy" : "")} disabled=${bz("approve")} data-tip="Approve the plan & build" onClick=${() => act.approve(repo, number, mo).then(onClose)}>${tico("approve", "check")}${lbl("Approve")}</button>`;
    const bResume = () => html`<button class=${"tbtn" + (bz("resume") ? " busy" : "")} disabled=${bz("resume")} data-tip="Re-run the agent on this issue" onClick=${() => act.resume(repo, number, mo)}>${tico("resume", "refresh")}${lbl(bz("resume") ? "Resuming…" : "Resume")}</button>`;
    const bFix = () => html`<button class=${"tbtn primary" + (bz("fix") ? " busy" : "")} disabled=${bz("fix")} data-tip=${conflict ? "Resolve merge conflicts" : "Address the review's requested changes"} onClick=${() => act.fix(repo, number, mo).then(onClose)}>${tico("fix", "wrench")}${lbl(conflict ? "Resolve" : "Fix")}</button>`;
    const bCreatePr = () => html`<button class=${"tbtn green" + (bz("createPr") ? " busy" : "")} disabled=${bz("createPr")} data-tip="Open a PR from the approved branch (no AI / no tokens)" onClick=${() => act.createPr(repo, number)}>${tico("createPr", "pr")}${lbl(bz("createPr") ? "Opening PR…" : "Create PR")}</button>`;
    const bMerge = (anyway) => { const ma = armed === "merge", mb = bz("merge"); return html`<button class=${"tbtn green" + (ma ? " armed" : "") + (mb ? " busy" : "")} disabled=${mb} data-tip=${ma ? "Tap again to merge" : anyway ? "Merge despite requested changes" : "Merge the PR & close the issue"} onClick=${() => confirmAct("merge", () => act.merge(repo, number).then(onClose))}>${mb ? html`<${Spinner} size=${18}/>` : html`<${Icon} name="merge"/>`}${(isDesktop || ma) ? html`<span class="tlabel">${mb ? "Merging…" : ma ? "Confirm merge" : anyway ? "Merge anyway" : "Merge"}</span>` : null}</button>`; };
    const bClose = (epic) => { const ca = armed === "close", cb = bz("close"); const epicAllDone = issue.epic && issue.epic.done >= issue.epic.total; const clabel = ca ? "Confirm" : cb ? "Closing…" : epic ? (epicAllDone ? "Complete" : "Close epic") : "Close"; return html`<button class=${"tbtn" + (epic ? " green" : "") + (ca ? " armed" : "") + (cb ? " busy" : "")} disabled=${cb} data-tip=${ca ? "Tap again to close" : epic ? "Merge any remaining sub-PRs & close this epic" : "Close this issue (mark it done, no PR)"} onClick=${() => confirmAct("close", () => act.close(repo, number).then(onClose))}>${cb ? html`<${Spinner} size=${18}/>` : html`<${Icon} name="check"/>`}${(isDesktop || ca) ? html`<span class="tlabel">${clabel}</span>` : null}</button>`; };

    if (running) {
      tb.push(bStop()); // the only meaningful action while it's executing
    } else if (hasPr) {
      // A PR exists → merge it (or unblock it). Never Create PR / Close here.
      if (conflict) tb.push(bFix());
      else if (needsFix) { tb.push(bFix()); tb.push(bMerge(true)); }
      else tb.push(bMerge(false));
      tb.push(bResume());
    } else if (parked) {
      tb.push(bStart());
    } else if (awaiting) {
      tb.push(bApprove());
      tb.push(bToPlanned());
    } else if (issue.epic) {
      tb.push(bClose(true)); // master issue → complete/close (merges remaining sub-PRs)
      tb.push(bResume());
    } else if (approved) {
      tb.push(bCreatePr());
      tb.push(bResume());
    } else {
      // ready / needs-attention / answered, no PR → re-engage, or close, or park
      tb.push(bResume());
      tb.push(bClose(false));
      tb.push(bToPlanned());
    }
    tb.push(html`<span class="tbsep"></span>`);
    tb.push(autoToggle("resume"));
    tb.push(autoToggle("merge"));
  }
  const da = armed === "del", db = bz("del");
  tb.push(html`<span class="tbsep"></span>`);
  tb.push(html`<button class=${"tbtn danger" + (da ? " armed" : "") + (db ? " busy" : "")} disabled=${db} data-tip=${da ? "Tap again to delete" : "Delete"} onClick=${() => confirmAct("del", () => act.del(repo, number))}>${db ? html`<${Spinner} size=${18}/>` : html`<${Icon} name="trash"/>`}${(isDesktop || da) ? html`<span class="tlabel">${db ? "Deleting…" : da ? "Confirm delete" : "Delete"}</span>` : null}</button>`);

  const streamPane = html`<div class="dpane side">
    <div class="sec">Live stream</div>
    ${startError ? html`<div class="secbanner">⚠ ${startError}</div>` : null}
    <div class="dstream" ref=${streamRef} onScroll=${(e) => { const el = e.target; const atB = el.scrollHeight - el.scrollTop - el.clientHeight < 50; stickRef.current = atB; setStreamAtBottom(atB); }}>
      ${stream.length ? stream.map((a, idx) => html`<div key=${idx} class=${"l " + (a.kind === "tool" ? "tool" : a.kind === "start" || a.kind === "done" ? "muted" : "")}>${a.text}</div>`) : html`<div class="l muted">${startError ? "Failed to start." : "No live activity yet."}</div>`}
      ${!streamAtBottom ? html`<div class="scroll-fab-wrap"><button class="iconbtn scroll-fab" title="Scroll to bottom" onClick=${() => { const el = streamRef.current; if (el) el.scrollTop = el.scrollHeight; }}><${Icon} name="chevdown" size=${14}/></button></div>` : null}
    </div>
    ${issue.usage && issue.usage.tokens ? html`<div class="dusage" title=${usageTitle(issue.usage)}>
      <span><${Icon} name="chart" size=${13}/> ${fmtTok(issue.usage.tokens)} tokens</span>
      <span>$${Number(issue.usage.costUsd || 0).toFixed(2)}</span>
      ${issue.usage.model ? html`<span>${shortModel(issue.usage.model)}</span>` : null}
      <span class="muted">${issue.usage.runs || 0} runs</span>
    </div>` : null}
    <${RunApp} repo=${repo} number=${number} appInfo=${appInfo} issue=${issue} done=${done}/>
  </div>`;

  const prBar = issue.pr_url ? (() => {
    const ma = armed === "merge", mb = bz("merge");
    return html`<div class="prbar">
      <span class="prbar-l"><${Icon} name="pr" size=${15}/> PR #${issue.pr_number}${review === "approved" ? html` · <span style="color:var(--green)">approved</span>` : review === "changes" ? html` · <span style="color:var(--red)">changes requested</span>` : ""}</span>
      <a class="btn ghost" href=${issue.pr_url} target="_blank" rel="noopener"><${Icon} name="link" size=${14}/> Open on GitHub</a>
      ${conflict ? html`<span class="muted" style="font-size:12px">conflicts — resolve first</span>`
        : review === "changes" ? html`<button class=${"btn " + (bz("fix") ? "" : "primary")} disabled=${bz("fix")} onClick=${() => act.fix(repo, number).then(onClose)}>${bz("fix") ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="wrench" size=${14}/>`} Fix</button>` : null}
      ${!conflict ? html`<button class=${"btn green" + (mb ? " busy" : "")} disabled=${mb} onClick=${() => confirmAct("merge", () => act.merge(repo, number).then(onClose))}>${mb ? html`<${Spinner} size=${14}/> Merging…` : html`<${Icon} name="merge" size=${14}/> ${ma ? "Confirm merge" : review === "changes" ? "Merge anyway" : "Merge"}`}</button>` : null}
    </div>`;
  })() : null;
  const conflictBox = conflict ? html`<div class="conflictbox">
    <div class="conflictbox-h"><${Icon} name="merge" size=${15}/> Merge conflicts with main</div>
    <div class="conflictbox-b">This PR can't be merged until the conflicts are resolved.${conflictFiles.length ? html` ${conflictFiles.length} conflicting file${conflictFiles.length > 1 ? "s" : ""}:` : ""}</div>
    ${conflictFiles.length ? html`<ul class="conflictbox-files">${conflictFiles.map((f) => html`<li key=${f}><a href=${"https://github.com/" + repo + "/blob/agency/issue-" + number + "/" + f} target="_blank" rel="noopener"><${Icon} name="link" size=${11}/> ${f}</a></li>`)}</ul>` : null}
    <button class=${"btn primary" + (bz("fix") ? " busy" : "")} disabled=${bz("fix")} onClick=${() => act.fix(repo, number)}>${bz("fix") ? html`<${Spinner} size=${14}/> Resolving…` : html`<${Icon} name="wrench" size=${14}/> Fix merge conflicts`}</button>
  </div>` : null;

  const chatPane = html`<div class="dpane chat" ref=${chatRef} onScroll=${onChatScroll}>
    ${!chatAtTop ? html`<div class="scroll-fab-wrap top"><button class="iconbtn scroll-fab" title="Scroll to top" onClick=${() => { chatRef.current.scrollTop = 0; }}><${Icon} name="chevup" size=${16}/></button></div>` : null}
    ${issue.epic ? html`<${EpicChecklist} epic=${issue.epic} repo=${repo} onOpen=${onOpenIssue} onClose=${() => act.close(repo, number).then(onClose)} closing=${act.isBusy("close", repo, number)}/>` : null}
    ${conflictBox}
    <div class="sec">Conversation</div>
    ${thread === null ? html`<div class="muted">Loading…</div>`
      : thread._err ? html`<div class="muted" style="color:var(--red);display:flex;align-items:center;gap:8px">${thread._err} <button class="btn" onClick=${loadThread}>Retry</button></div>`
      : html`<div>
        ${thread.body ? html`<${Comment} author=${thread.author} createdAt=${thread.createdAt} body=${thread.body} isAgency=${false}/>` : null}
        ${(thread.comments || []).map((c) => html`<${Comment} key=${c.localId || c.id || c.createdAt} id=${c.id} author=${c.author} createdAt=${c.createdAt} body=${c.body} isAgency=${c.isAgency} incoming=${c.incoming} onEdit=${editComment}/>`)}
        ${pendingComments.map((p) => html`<${Comment} key=${"skel-" + p.id} author=${p.author} createdAt=${p.createdAt} body=${p.body} isAgency=${false} isSkel=${true}/>`)}
      </div>`}
    ${!chatAtBottom ? html`<div class="scroll-fab-wrap"><button class="iconbtn scroll-fab" title="Scroll to bottom" onClick=${() => { chatRef.current.scrollTop = chatRef.current.scrollHeight; }}><${Icon} name="chevdown" size=${16}/></button></div>` : null}
    ${prBar}
  </div>`;

  return html`<div class="detail on">
    <div class="dhead">
      <button class="iconbtn" aria-label="Close" onClick=${onClose}><${Icon} name="arrowleft"/></button>
      <div class="tt">${issue.title || "#" + number} <span class="dmeta">· ${repo.split("/").pop()} #${number}${st ? " · " + st.replace("agency:", "") : ""}</span></div>
    </div>
    <div class="dtoolbar">
      ${tb}
      ${modelOpts.length ? html`
        <span style="flex:1"></span>
        <select title="Override model for next run" class="modelsel" value=${modelOverride} onChange=${(e) => updateModelOverride(e.target.value)}>
          <option value="">Default model</option>
          ${modelOpts.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
        </select>
      ` : null}
    </div>
    ${!isDesktop ? html`<div class="dtoolbar" style="justify-content:center">
      <button class=${"btn ghost " + (tab === "chat" ? "primary" : "")} onClick=${() => setTab("chat")}>Chat</button>
      <button class=${"btn ghost " + (tab === "stream" ? "primary" : "")} onClick=${() => setTab("stream")}>Stream</button>
    </div>` : null}
    <div class="dpanes">
      ${isDesktop ? html`${chatPane}${streamPane}` : tab === "chat" ? chatPane : streamPane}
    </div>
    <div class="dcompose">
      <div class="composer">
        ${atts.length ? html`<div class="composer-atts">${atts.map((a, idx) => html`<span class="att" key=${idx}>${a.img ? html`<img src=${a.d}/>` : html`<span><${Icon} name="paperclip" size=${12}/> ${a.name}</span>`}<button class="iconbtn" style="width:18px;height:18px;border:none" onClick=${() => setAtts((x) => x.filter((_, j) => j !== idx))}>×</button></span>`)}</div>` : null}
        <textarea ref=${taRef} rows="1" placeholder=${running ? "Message the agent…  (queued until the run finishes)" : "Reply…  (Cmd+Enter sends, paste image to embed)"} value=${reply} onInput=${(e) => { setReply(e.target.value); autosize(); }} onPaste=${onPaste} onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}></textarea>
        <div class="composer-row">
          <label class="composer-icon" title="Attach a file"><${Icon} name="paperclip" size=${18}/><input type="file" multiple style="display:none" onChange=${pickFiles}/></label>
          ${modelOpts && modelOpts.length ? html`<select title="Override model for this run" class="modelsel" value=${modelOverride} onChange=${(e) => updateModelOverride(e.target.value)}>
            <option value="">Default model</option>
            ${modelOpts.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
          </select>` : null}
          <span class="spacer"></span>
          ${running ? html`<button class=${"btn warn" + (bz("stop") ? " busy" : "")} title="Stop the running agent" disabled=${bz("stop")} onClick=${() => act.stop(repo, number)}>${bz("stop") ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="stop" size=${15}/>`} Stop</button>` : null}
          <button class=${"btn primary" + (busy ? " busy" : "")} disabled=${busy} onClick=${send}>${busy ? html`<${Spinner} size=${15}/>` : running ? html`<${Icon} name="clock" size=${15}/>` : html`<${Icon} name="send" size=${15}/>`} ${running ? "Queue" : "Send"}</button>
        </div>
      </div>
    </div>
  </div>`;
}
function Comment({ id, author, createdAt, body, isAgency, isSkel, incoming, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(body || "");
  const [saving, setSaving] = useState(false);
  function startEdit() { setEditVal(body || ""); setEditing(true); }
  function cancelEdit() { setEditing(false); }
  function save() {
    if (!onEdit || !editVal.trim() || saving) return;
    setSaving(true);
    onEdit(id, editVal.trim()).then(() => { setEditing(false); setSaving(false); }).catch(() => setSaving(false));
  }
  return html`<div class=${"cmt " + (isAgency ? "ag" : "") + (isSkel ? " skel" : "") + (incoming ? " incoming" : "")}>
    <div class="h">
      ${isAgency ? html`<${Avatar} role=${roleFromComment(body)} size=${26}/>` : null}
      <span>${incoming ? html`<span class="cmt-in" title="Incoming — posted on GitHub"><${Icon} name="incoming" size=${12}/></span> ` : ""}${author || ""} · ${isSkel ? "just now" : ago(createdAt)}</span>
      ${id && onEdit && !isSkel ? html`<button class="iconbtn cmt-edit-btn" title="Edit comment" onClick=${startEdit}><${Icon} name="edit" size=${13}/></button>` : null}
    </div>
    ${editing ? html`
      <textarea class="cmt-edit-ta" value=${editVal} onInput=${(e) => setEditVal(e.target.value)}></textarea>
      <div class="cmt-edit-row">
        <button class="btn" onClick=${cancelEdit}>Cancel</button>
        <button class="btn primary" disabled=${saving} onClick=${save}>${saving ? html`<${Spinner} size=${13}/>` : "Save"}</button>
      </div>
    ` : html`<div class="b" dangerouslySetInnerHTML=${{ __html: md(body) }}></div>`}
  </div>`;
}

// Epic parent: a checklist of every sub-issue (✓ done / ○ open), each a link to its detail page,
// plus a one-click "Complete & close" once they're all done.
function EpicChecklist({ epic, repo, onOpen, onClose, closing }) {
  const all = epic.total > 0 && epic.done >= epic.total;
  const kids = (epic.children || []).slice().sort((a, b) => (a.closed === b.closed ? a.child - b.child : a.closed ? 1 : -1));
  return html`<div class="epicbox">
    <div class="sec" style="margin:10px 2px 6px">Sub-issues ${epic.done}/${epic.total}${all ? html` · <span class="epicalldone">all done ✓</span>` : null}</div>
    <div class="epiclist">
      ${kids.map((c) => html`<button class="epicrow" key=${c.child} onClick=${() => onOpen(repo, c.child, c.title)} data-tip="Open sub-issue">
        <span class=${"epicck " + (c.closed ? "done" : "open")}><${Icon} name=${c.closed ? "check" : "planned"} size=${14}/></span>
        <span class="epicnum">#${c.child}</span>
        <span class="epictitle">${c.title || "#" + c.child}</span>
      </button>`)}
    </div>
    ${all ? html`<button class="btn green" disabled=${closing} onClick=${onClose} style="margin-top:9px;width:100%;justify-content:center">${closing ? html`<${Spinner} size=${15}/> Closing…` : html`<${Icon} name="check" size=${15}/> Complete & close epic`}</button>` : null}
  </div>`;
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
      : kind === "web" ? html`<button class="btn" onClick=${() => api("/app-run", { repo, number }).then((r) => toast(r && r.error ? r.error : "Starting preview…")).catch(() => toast("Couldn’t start", "error"))}><${Icon} name="play" size=${15}/> Run preview</button>` : null}
  </div>`;
}

// ---------- Composer ----------
function Composer({ repos, repo, setRepo, onClose, onCreate, data }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [role, setRole] = useState("@dev");
  const [atts, setAtts] = useState([]);
  const providers = data?.providers || [];
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ providerId: p.id, model: m, label: p.name + " / " + m })));
  const [model, setModel] = useState(
    data?.globalModel ? data.globalModel.providerId + "/" + data.globalModel.model : ""
  );
  const taRef = useRef(null);
  function autosize() { const el = taRef.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }
  function submit(start) {
    if (!repo || !title.trim()) { toast("Repo + title needed"); return; }
    let modelOverride = null;
    if (model) {
      const [providerId, mName] = model.split("/");
      modelOverride = { providerId, model: mName };
    }
    onCreate(repo, role, title.trim(), body.trim(), start, atts.map((a) => ({ dataUrl: a.d, name: a.name })), modelOverride);
  }
  function pick(e) { const fs = e.target.files || []; for (let i = 0; i < fs.length; i++) readAttach(fs[i], (a) => setAtts((x) => x.concat(a))); e.target.value = ""; }
  function onPaste(e) { const items = (e.clipboardData || {}).items || []; for (let i = 0; i < items.length; i++) if (items[i].kind === "file") readAttach(items[i].getAsFile(), (a) => setAtts((x) => x.concat(a))); }
  return html`<${Sheet} title="New issue" onClose=${onClose}>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <select style="flex:1.5;width:auto" value=${repo || ""} onChange=${(e) => setRepo(e.target.value)}>${repos.map((r) => html`<option key=${r} value=${r}>${r.split("/").pop()}</option>`)}</select>
      <select style="flex:1;width:auto" value=${role} onChange=${(e) => setRole(e.target.value)}>
        <option value="@dev">@dev</option>
        <option value="@plan">@plan</option>
        <option value="@arch">@arch</option>
        <option value="@review">@review</option>
        <option value="@test">@test</option>
      </select>
      ${modelOpts.length ? html`<select style="flex:1.5;width:auto" value=${model} onChange=${(e) => setModel(e.target.value)}>
        <option value="">Default model</option>
        ${modelOpts.map((o) => html`<option key=${o.providerId + "/" + o.model} value=${o.providerId + "/" + o.model}>${o.label}</option>`)}
      </select>` : null}
    </div>
    <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="What should it do?" style="margin-bottom:10px"/>
    <div class="composer">
      ${atts.length ? html`<div class="composer-atts">${atts.map((a, idx) => html`<span class="att" key=${idx}>${a.img ? html`<img src=${a.d}/>` : html`<span><${Icon} name="paperclip" size=${12}/> ${a.name}</span>`}<button class="iconbtn" style="width:18px;height:18px;border:none" onClick=${() => setAtts((x) => x.filter((_, j) => j !== idx))}>×</button></span>`)}</div>` : null}
      <textarea ref=${taRef} rows="1" placeholder="Details, context, acceptance criteria…  (paste an image to attach)" value=${body} onInput=${(e) => { setBody(e.target.value); autosize(); }} onPaste=${onPaste}></textarea>
      <div class="composer-row">
        <label class="composer-icon" title="Attach a file"><${Icon} name="paperclip" size=${18}/><input type="file" multiple style="display:none" onChange=${pick}/></label>
        <span class="spacer"></span>
        <button class="btn ghost" onClick=${() => submit(false)}>Add to Planned</button>
        <button class="btn primary" onClick=${() => submit(true)}><${Icon} name="play" size=${15}/> Start now</button>
      </div>
    </div>
  <//>`;
}

// ---------- Settings ----------
function Settings({ data, onClose, reload, openGithubTokens, openModels }) {
  const s = data.session || {}, cfg = data.config || {};
  const [skipArch, setSkipArch] = useState(cfg.skipArchitect !== "off");
  const [gitnexus, setGitnexus] = useState(cfg.gitnexus === "on");
  const [maxTok, setMaxTok] = useState(cfg.maxTokensPerRun || 600000);
  const [revRounds, setRevRounds] = useState(cfg.maxReviseRounds != null ? cfg.maxReviseRounds : 1);
  function save() { api("/settings", { skipArchitect: skipArch ? "on" : "off", gitnexus: gitnexus ? "on" : "off", maxTokensPerRun: Number(maxTok) || 0, maxReviseRounds: Number(revRounds) || 0 }).then(() => { toast("Saved"); onClose(); reload(); }); }
  return html`<${Sheet} title="Settings" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button>`}>
    ${data.user ? html`<div class="sec">Account</div>
      <div class="muted">Signed in as <b>${data.user.username}</b> · ${data.user.role}</div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn ghost" onClick=${() => { const np = window.prompt("New password (8+ characters)"); if (np == null) return; if (np.length < 8) { toast("8+ characters"); return; } api("/set-password", { value: np }).then(() => toast("Password changed")).catch((e) => toast((e && e.message) || "Couldn’t change", "error")); }}><${Icon} name="lock" size=${15}/> Change password</button>
        <a class="btn ghost" href="/logout" style="flex:1;justify-content:center"><${Icon} name="arrowleft" size=${15}/> Sign out</a>
      </div>

      <div class="sec">Integrations & Credentials</div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn" style="flex:1;justify-content:center" onClick=${openGithubTokens}><${Icon} name="link" size=${15}/> GitHub Tokens</button>
        <button class="btn" style="flex:1;justify-content:center" onClick=${openModels}><${Icon} name="flask" size=${15}/> Models & API Keys</button>
      </div>

      <div class="sec">Setup wizard</div>
      <div class="muted" style="font-size:12px;margin-bottom:7px">Re-run the guided walkthrough to add or update your tokens, models, and first repo.</div>
      <button class="btn primary" style="width:100%" onClick=${() => api("/onboarded", { value: "0" }).then(() => { onClose(); reload(); })}><${Icon} name="play" size=${15}/> Run the setup wizard</button>

      ${data.user.role === "admin" ? html`<${Admin} users=${data.users || []} invites=${data.invites || []} webhookSecretSet=${data.webhookSecretSet} reload=${reload}/>` : null}` : null}
    
    <div class="sec">Pipeline</div>
    <label class="ckline"><input type="checkbox" checked=${skipArch} onChange=${(e) => setSkipArch(e.target.checked)}/> Skip the architect step (faster, fewer tokens)</label>
    <label class="ckline"><input type="checkbox" checked=${gitnexus} onChange=${(e) => setGitnexus(e.target.checked)}/> Use GitNexus code index</label>
    <label>Max tokens per run (0 = off)</label><input type="number" min="0" step="50000" value=${maxTok} onInput=${(e) => setMaxTok(e.target.value)}/>
    <label>Reviewer revise rounds before it asks you</label><input type="number" min="0" max="3" value=${revRounds} onInput=${(e) => setRevRounds(e.target.value)}/>
    ${(!data.user || data.user.role === "admin") && data.opsMeta ? html`<${Operations} meta=${data.opsMeta} values=${data.ops || {}} reload=${reload}/>` : null}
    <div class="sec">Advanced</div>
    <a class="btn ghost" href="/classic" style="justify-content:flex-start"><${Icon} name="settings" size=${15}/> Models & agents (classic editor)</a>
  <//>`;
}
/**
 * Inline models panel in Settings: auto-switch toggle + fallback chain config.
 * Full provider/role management stays in /classic for now; this surfaces the new
 * rate-limit offload settings without requiring a page nav.
 */
function ModelsPanel() {
  const [md, setMd] = useState(null); // /models response
  const [autoSwitch, setAutoSwitch] = useState(false);
  const [chain, setChain] = useState([]); // [{providerId, model}]
  const [globalModel, setGlobalModel] = useState(null); // {providerId, model} | null
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getJSON("/models").then((d) => {
      setMd(d);
      setAutoSwitch(d.autoSwitchOnLimit || false);
      setChain(d.fallbackChain || []);
      setGlobalModel(d.globalModel || null);
    }).catch(() => {});
  }, []);
  if (!md) return null;
  const providers = md.providers || [];
  // Flat list of {providerId, model, label} choices for the fallback select
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ providerId: p.id, model: m, label: p.name + " / " + m })));
  function addFallback() {
    if (!modelOpts.length) { toast("Add a provider in Models & agents first"); return; }
    setChain((c) => c.concat(modelOpts[0]));
  }
  function removeFallback(idx) { setChain((c) => c.filter((_, i) => i !== idx)); }
  function setFallbackEntry(idx, opt) {
    const m = modelOpts.find((o) => o.providerId + "/" + o.model === opt);
    if (m) setChain((c) => c.map((e, i) => i === idx ? { providerId: m.providerId, model: m.model } : e));
  }
  function save() {
    setBusy(true);
    api("/models", { fallbackChain: chain, autoSwitchOnLimit: autoSwitch, globalModel })
      .then(() => toast("Saved")).catch(() => toast("Couldn't save")).then(() => setBusy(false));
  }
  return html`<div class="sec">Models & rate limit</div>
    <label style="margin-top:6px;display:block">Global Default Model</label>
    <select style="width:100%;margin-bottom:12px" value=${globalModel ? globalModel.providerId + "/" + globalModel.model : ""} onChange=${(e) => {
      const val = e.target.value;
      if (!val) {
        setGlobalModel(null);
      } else {
        const [providerId, model] = val.split("/");
        setGlobalModel({ providerId, model });
      }
    }}>
      <option value="">Default (Claude subscription / role defaults)</option>
      ${modelOpts.map((o) => html`<option key=${o.providerId + "/" + o.model} value=${o.providerId + "/" + o.model}>${o.label}</option>`)}
    </select>
    <label class="ckline"><input type="checkbox" checked=${autoSwitch} onChange=${(e) => setAutoSwitch(e.target.checked)}/> Auto-switch to fallback model on Claude usage limit</label>
    <div class="muted" style="font-size:12px;margin:3px 2px 7px">When enabled, hitting the Claude credit/session limit switches all unassigned roles to the first fallback below and retries — instead of stalling.</div>
    <label>Fallback chain (order of models to try when primary is rate-limited)</label>
    ${chain.map((entry, idx) => html`<div key=${idx} style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
      <select style="flex:1" value=${entry.providerId + "/" + entry.model} onChange=${(e) => setFallbackEntry(idx, e.target.value)}>
        ${modelOpts.map((o) => html`<option key=${o.providerId + "/" + o.model} value=${o.providerId + "/" + o.model}>${o.label}</option>`)}
      </select>
      <button class="iconbtn" title="Remove" onClick=${() => removeFallback(idx)}><${Icon} name="trash" size=${15}/></button>
    </div>`)}
    ${modelOpts.length ? html`<button class="btn ghost" style="margin-bottom:4px" onClick=${addFallback}><${Icon} name="plus" size=${14}/> Add fallback</button>` : html`<div class="muted" style="font-size:12px">No alternative providers configured — add one in <a href="/classic">Models & agents</a> first.</div>`}
    <button class="btn primary" style="margin-top:8px" disabled=${busy} onClick=${save}>${busy ? html`<${Spinner} size=${14}/> Saving…` : "Save model settings"}</button>`;
}
function Operations({ meta, values, reload }) {
  const [vals, setVals] = useState(() => Object.assign({}, values));
  const set = (k, v) => setVals((o) => Object.assign({}, o, { [k]: v }));
  function save() { api("/settings", { ops: vals }).then(() => { toast("Operations saved"); reload(); }).catch(() => toast("Couldn’t save")); }
  const visibleMeta = meta.filter(m => m.key === "self_improve");
  if (!visibleMeta.length) return null;
  return html`<div class="sec">Operations</div>
    ${visibleMeta.map((m) => html`<div key=${m.key}>
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
let modelsConfig = {
  "Gemini": ["gemini-3.5-flash", "gemini-3.5-pro", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro", "gemini-1.5-flash"],
  "GLM (Zhipu)": ["glm-5.2", "glm-5.1", "glm-4.6", "glm-4.5"],
  "DeepSeek": ["deepseek-chat", "deepseek-reasoner"],
  "Kimi (Moonshot)": ["kimi-k2-0905-preview"]
};
getJSON("/web/models.json").then((m) => { if (m) modelsConfig = m; }).catch(() => {});

const OB_PROVIDERS = [
  { id: "claude_sub", label: "Claude — subscription", note: "Recommended · runs agents on your plan", icon: "crown", kind: "secret", secretKey: "claude_token",
    title: "Claude subscription token", placeholder: "paste the setup-token output",
    how: "Runs the agents on your existing Claude plan — no per-token billing.\n\n1. Install the CLI:\n   npm i -g @anthropic-ai/claude-code\n2. Generate a token:\n   claude setup-token\n3. Log in with your Claude plan when the browser opens.\n4. Paste the token it prints below.",
    link: "https://docs.claude.com/en/docs/claude-code", linkLabel: "Claude Code docs" },
  { id: "claude_api", label: "Claude — API key", note: "Pay-as-you-go", icon: "flask", kind: "secret", secretKey: "anthropic_api_key",
    title: "Claude API key", placeholder: "sk-ant-...",
    how: "Pay-as-you-go billing instead of a subscription.\n\n1. Open platform.claude.com → API keys.\n2. Create a key.\n3. Paste it below.",
    link: "https://platform.claude.com/settings/keys", linkLabel: "Create an API key" },
  { id: "gemini", label: "Gemini", note: "needs an Anthropic-compatible proxy", icon: "globe", kind: "provider",
    preset: { name: "Gemini (via proxy)", baseUrl: "", get models() { return modelsConfig["Gemini"] || []; } },
    title: "Gemini base URL + key", placeholder: "AIza...",
    how: "Google has no native Anthropic-format endpoint, so the agent SDK can't call Gemini directly. Run an Anthropic-compatible gateway (e.g. LiteLLM) and paste its base URL in Settings → Models. GLM, DeepSeek and Kimi work without a proxy.",
    link: "https://aistudio.google.com/app/apikey", linkLabel: "Get a Gemini key" },
  { id: "glm", label: "GLM (Zhipu)", note: "Cheap coding model", icon: "globe", kind: "provider",
    preset: { name: "GLM (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/anthropic", get models() { return modelsConfig["GLM (Zhipu)"] || []; } },
    title: "GLM API key", placeholder: "GLM API key",
    how: "An Anthropic-compatible endpoint, good for the cheaper roles.\n\n1. Get an API key from open.bigmodel.cn (Zhipu).\n2. Paste it below.\n\nAfter setup, assign GLM to specific agents in Settings → Models.",
    link: "https://open.bigmodel.cn", linkLabel: "Get a GLM key" },
  { id: "deepseek", label: "DeepSeek", note: "", icon: "globe", kind: "provider",
    preset: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", get models() { return modelsConfig["DeepSeek"] || []; } },
    title: "DeepSeek API key", placeholder: "DeepSeek API key",
    how: "1. Get an API key from platform.deepseek.com.\n2. Paste it below.\n\nAssign it to agents later in Settings → Models.",
    link: "https://platform.deepseek.com", linkLabel: "Get a DeepSeek key" },
  { id: "kimi", label: "Kimi (Moonshot)", note: "", icon: "globe", kind: "provider",
    preset: { name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/anthropic", get models() { return modelsConfig["Kimi (Moonshot)"] || []; } },
    title: "Kimi API key", placeholder: "Kimi API key",
    how: "1. Get an API key from platform.moonshot.cn.\n2. Paste it below.\n\nAssign it to agents later in Settings → Models.",
    link: "https://platform.moonshot.cn", linkLabel: "Get a Kimi key" },
  { id: "other", label: "Other (Custom)", note: "Needs a router", icon: "settings", kind: "provider", custom: true,
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
  const [test, setTest] = useState(null); // null | "testing" | {ok, via, error}
  const isClaude = def.secretKey === "claude_token" || def.secretKey === "anthropic_api_key";
  const v = val.trim();
  // Catch the most common 401 cause: pasting the wrong token TYPE into the wrong option.
  const shapeWarn = def.secretKey === "claude_token" && /^sk-ant-api/.test(v)
    ? "That looks like an API key (sk-ant-api…). Use the “Claude — API key” option instead, or it will 401."
    : def.secretKey === "anthropic_api_key" && /^sk-ant-oat/.test(v)
    ? "That looks like a subscription token (sk-ant-oat…). Use the “Claude — subscription” option instead."
    : def.secretKey === "anthropic_api_key" && v && !/^sk-ant-/.test(v)
    ? "An Anthropic API key usually starts with “sk-ant-”. If this is a subscription token, use the “Claude — subscription” option."
    : "";
  function storeVal() {
    if (def.kind === "secret") return api("/user-secret", { key: def.secretKey, value: v });
    const prov = { id: def.id + "-" + Date.now().toString(36), name: def.preset?.name || "Custom", baseUrl: def.custom ? baseUrl.trim() : def.preset.baseUrl, apiKey: v, models: def.preset?.models || [] };
    return api("/models", { providers: (existing || []).concat(prov) });
  }
  function save() {
    if (!v) { toast(def.optional ? "Paste a token or Skip" : "Paste the token"); return; }
    setBusy(true);
    storeVal().then(() => { toast("Saved"); onDone(); }).catch(() => toast("Couldn’t save")).then(() => setBusy(false));
  }
  function saveTest() {
    if (!v) { toast("Paste the token first"); return; }
    setTest("testing");
    storeVal().then(() => api("/test-claude", {})).then((r) => setTest(r)).catch((e) => setTest({ ok: false, error: (e && e.message) || "failed" }));
  }
  return html`
    <div class="obki"><${Icon} name=${def.icon || "lock"} size=${26}/></div>
    <div class="obh">${def.title}</div>
    <div class="obsteps">${def.how}</div>
    ${def.link ? html`<a class="oblink" href=${def.link} target="_blank" rel="noopener">${def.linkLabel} <${Icon} name="link" size=${14}/></a>` : null}
    ${def.custom ? html`<label>Base URL (Anthropic-compatible)</label><input placeholder="https://…/anthropic" value=${baseUrl} onInput=${(e) => setBaseUrl(e.target.value)}/>` : null}
    <label>${def.custom ? "API key" : "Token"}</label>
    <input type="password" autocomplete="off" placeholder=${def.placeholder} value=${val} onInput=${(e) => { setVal(e.target.value); setTest(null); }}/>
    <div class="muted" style="font-size:11px;margin:3px 2px 0">Paste it exactly — no spaces or line breaks (a stray space causes a 401).</div>
    ${shapeWarn ? html`<div class="testres bad">⚠ ${shapeWarn}</div>` : null}
    ${isClaude ? html`<div class="muted" style="font-size:11px;margin:4px 2px 0">Tip: “Save & test” makes a real call so you know it works before any agent runs.</div>` : null}
    ${test && test !== "testing" ? html`<div class=${"testres " + (test.ok ? "ok" : "bad")}>${test.ok ? "✓ Authenticated via " + (test.via || "Claude") : "✗ " + (test.error || "Failed")}</div>` : null}
    <div class="obnav">
      <button class="btn" onClick=${onBack}>Back</button>
      ${def.optional ? html`<button class="btn ghost" onClick=${onDone}>Skip</button>` : null}
      ${isClaude ? html`<button class="btn ghost" disabled=${test === "testing"} onClick=${saveTest}>${test === "testing" ? html`<${Spinner} size=${15}/> Testing…` : "Save & test"}</button>` : null}
      <button class="btn primary" disabled=${busy} onClick=${save}>Save & continue</button>
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
    <div class="obh">Welcome to Dev Agency in a Box</div>
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
function GithubTokensModal({ secretKeys, onClose, reload }) {
  return html`<${Sheet} title="GitHub Tokens" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <div class="muted" style="font-size:12px;margin-bottom:12px">Stored encrypted (AES-256-GCM). The agency uses them to run on your behalf. Write-only — never shown back.</div>
    <div style="margin-bottom:16px">
      <${SecretField} field=${{key: "github_bot_token", label: "GitHub bot token", hint: "The account the agency ACTS as — its commits and pull requests."}} isSet=${secretKeys.includes("github_bot_token")} reload=${reload}/>
    </div>
    <div style="margin-bottom:16px">
      <${SecretField} field=${{key: "github_user_token", label: "Your GitHub token", hint: "Lets the agency comment and open issues under YOUR name."}} isSet=${secretKeys.includes("github_user_token")} reload=${reload}/>
    </div>
  <//>`;
}

function ModelsModal({ onClose, reload }) {
  const [existing, setExisting] = useState([]);
  const [secretKeys, setSecretKeys] = useState([]);
  function refresh() { 
    getJSON("/models").then((d) => setExisting(d.providers || [])).catch(() => {}); 
    getJSON("/data").then((d) => setSecretKeys(d.secretKeys || [])).catch(() => {});
  }
  useEffect(refresh, []);

  return html`<${Sheet} title="Models & API Keys" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <div class="muted" style="font-size:12px;margin-bottom:12px">Configure your API keys for various AI models. Keys are stored securely.</div>
    
    <div class="sec">Claude</div>
    <div style="margin-bottom:12px">
      <${SecretField} field=${{key: "claude_token", label: "Claude subscription token", hint: "CLAUDE_CODE_OAUTH_TOKEN — runs the Claude roles on your plan"}} isSet=${secretKeys.includes("claude_token")} reload=${() => {reload(); refresh();}}/>
    </div>
    <div style="margin-bottom:12px">
      <${SecretField} field=${{key: "anthropic_api_key", label: "Claude API key", hint: "Pay-as-you-go billing"}} isSet=${secretKeys.includes("anthropic_api_key")} reload=${() => {reload(); refresh();}}/>
    </div>

    <div class="sec">Other Providers</div>
    ${OB_PROVIDERS.filter(p => p.kind === "provider" && !p.custom).map(p => {
      const isSet = existing.some(ex => ex.name === p.preset.name && ex.apiKey);
      return html`<div key=${p.id} style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--ink-2)">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><${Icon} name=${p.icon} size=${14}/> <b>${p.label}</b> ${isSet ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> set</span>` : null}</div>
        <div class="muted" style="font-size:11px;margin-bottom:8px">${p.how}</div>
        <${ProviderField} providerDef=${p} existing=${existing} reload=${() => {reload(); refresh();}}/>
      </div>`
    })}

    <div class="sec">Custom Provider</div>
    <div style="margin-bottom:16px">
      <div class="muted" style="font-size:11px;margin-bottom:8px">Add an Anthropic-compatible gateway (e.g. LiteLLM, claude-code-router).</div>
      <${ProviderField} providerDef=${OB_PROVIDERS.find(p => p.custom)} existing=${existing} reload=${() => {reload(); refresh();}} custom=${true}/>
    </div>

    <${ModelsPanel}/>
  <//>`;
}

function ProviderField({ providerDef, existing, reload, custom }) {
  const [val, setVal] = useState("");
  const [baseUrl, setBaseUrl] = useState(providerDef.preset?.baseUrl || "");
  function save() {
    if (!val) { toast("Paste an API key"); return; }
    const prov = { id: providerDef.id + "-" + Date.now().toString(36), name: providerDef.preset?.name || "Custom", baseUrl: custom ? baseUrl.trim() : providerDef.preset.baseUrl, apiKey: val.trim(), models: providerDef.preset?.models || [] };
    api("/models", { providers: (existing || []).concat(prov) }).then(() => { toast("Saved"); setVal(""); reload(); }).catch(() => toast("Couldn’t save"));
  }
  return html`
    ${custom ? html`<input placeholder="Base URL (https://...)" value=${baseUrl} onInput=${(e) => setBaseUrl(e.target.value)} style="margin-bottom:8px"/>` : null}
    <div style="display:flex;gap:8px">
      <input type="password" autocomplete="off" placeholder=${providerDef.placeholder || "API Key"} value=${val} onInput=${(e) => setVal(e.target.value)}/>
      <button class="btn" onClick=${save}>Save</button>
    </div>
  `;
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
function shortModel(m) {
  if (!m) return "?";
  const s = String(m);
  if (/opus/i.test(s)) return "Opus";
  if (/sonnet/i.test(s)) return "Sonnet";
  if (/haiku/i.test(s)) return "Haiku";
  if (/gemini/i.test(s)) return "Gemini";
  if (/deepseek/i.test(s)) return "DeepSeek";
  if (/glm/i.test(s)) return "GLM";
  if (/kimi/i.test(s)) return "Kimi";
  return s.replace(/^claude-/, "");
}

function UsageBar({ label, sub, value, max, cost }) {
  const pct = Math.round((100 * (value || 0)) / (max || 1));
  return html`<div class="useg-row">
    <span class="useg-row-l">${label}${sub ? html` <span class="muted">${sub}</span>` : null}</span>
    <span class="useg-track"><i style=${"width:" + Math.max(2, pct) + "%"}></i></span>
    <span class="useg-row-r">${fmtTok(value)}${cost != null ? " · $" + Number(cost).toFixed(2) : ""}</span>
  </div>`;
}

function Usage({ onClose, onOpenIssue }) {
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
          <div class="useg-big"><b>$${Number((d.total && d.total.costUsd) || 0).toFixed(2)}</b><span>est. cost</span></div>
        </div>
        <div class="useg-sec">By model</div>
        ${(d.byModel && d.byModel.length)
          ? d.byModel.map((m) => html`<${UsageBar} key=${m.model} label=${shortModel(m.model)} value=${m.tokens} max=${maxOf(d.byModel, "tokens")} cost=${m.costUsd}/>`)
          : html`<div class="muted">No usage in this range.</div>`}
        <div class="useg-sec">By agent role</div>
        ${(d.byRole && d.byRole.length)
          ? d.byRole.map((r) => html`<${UsageBar} key=${r.role || "?"} label=${r.role || "—"} sub=${(r.runs || 0) + " runs"} value=${r.tokens} max=${maxOf(d.byRole, "tokens")} cost=${r.costUsd}/>`)
          : html`<div class="muted">No role-tagged usage yet.</div>`}
        <div class="useg-sec">Most expensive issues</div>
        ${(d.topIssues && d.topIssues.length)
          ? d.topIssues.map((i) => html`<button class="useg-issue" key=${i.repo + "#" + i.number} onClick=${() => { onClose(); onOpenIssue && onOpenIssue(i.repo, i.number); }}>
              <span class="useg-row-l">${String(i.repo || "").split("/").pop()} <b>#${i.number}</b> <span class="muted">${(i.runs || 0) + " runs"}</span></span>
              <span class="useg-track"><i style=${"width:" + Math.max(2, Math.round((100 * i.tokens) / maxOf(d.topIssues, "tokens"))) + "%"}></i></span>
              <span class="useg-row-r">${fmtTok(i.tokens)} · $${Number(i.costUsd || 0).toFixed(2)}</span>
            </button>`)
          : html`<div class="muted">No per-issue data yet (older runs weren't tagged).</div>`}
        <div class="useg-sec">Per day</div>
        ${(d.byDay && d.byDay.length)
          ? d.byDay.map((day) => html`<${UsageBar} key=${day.day} label=${String(day.day).slice(5)} value=${day.tokens} max=${maxOf(d.byDay, "tokens")} cost=${day.costUsd}/>`)
          : html`<div class="muted">No daily data.</div>`}
      `}
  <//>`;
}

const AGENT_TOOLS = ["Read", "Glob", "Grep", "Bash", "Write", "Edit"];
function AgentEditor({ data, onClose, onSkills, reload }) {
  const defs = data.agentDefs || [];
  const blank = { name: "", handle: "", mode: "chat", model: "", tools: ["Read", "Glob", "Grep"], pushesGithub: true, persona: "", builtin: false };
  const [sel, setSel] = useState(null); // null = list, "__new__" or a name = edit
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
  const toggleTool = (t) => setForm((f) => Object.assign({}, f, { tools: f.tools.includes(t) ? f.tools.filter((x) => x !== t) : f.tools.concat(t) }));
  function save() {
    if (!form.name) { toast("Name required"); return; }
    setBusy(true);
    api("/agent-def-save", { agentDef: { name: form.name, handle: form.handle || "@" + form.name, mode: form.mode, model: form.model, tools: form.tools, pushesGithub: form.pushesGithub, persona: form.persona } })
      .then(() => { toast("Saved"); setSel(null); reload(); }).catch(() => toast("Couldn’t save", "error")).then(() => setBusy(false));
  }
  function del() { setBusy(true); api("/agent-def-delete", { agentName: form.name }).then(() => { toast("Deleted"); setSel(null); reload(); }).catch(() => toast("Couldn’t delete", "error")).then(() => setBusy(false)); }
  return html`<${Sheet} title="Agents" onClose=${onClose}>
    ${sel === null ? html`
      <div class="muted" style="font-size:12px;margin-bottom:8px">Chat agents are interactive — mention their @handle in an issue and they hold a conversation without touching code; the result is posted back to GitHub.</div>
      ${defs.map((d) => html`<button class="agentrow" key=${d.name} onClick=${() => { setSel(d.name); setForm(Object.assign({}, blank, d)); }}>
        <span><b>${d.name}</b> <span class="tagk">${d.handle}</span> <span class="tagk">${d.mode}</span>${d.builtin ? html` <span class="tagk">built-in</span>` : null}</span>
      </button>`)}
      <div class="row" style="margin-top:10px">
        <button class="btn primary" onClick=${() => { setSel("__new__"); setForm(blank); }}><${Icon} name="plus" size=${14}/> New agent</button>
        <button class="btn ghost" onClick=${onSkills}>Manage skills</button>
      </div>
    ` : html`
      <button class="btn ghost" style="margin-bottom:8px" onClick=${() => setSel(null)}><${Icon} name="arrowleft" size=${14}/> Back</button>
      <label>Name</label><input value=${form.name} disabled=${sel !== "__new__"} onInput=${(e) => set("name", e.target.value.replace(/[^\w-]/g, ""))}/>
      <label>Handle</label><input value=${form.handle} placeholder=${"@" + (form.name || "agent")} onInput=${(e) => set("handle", e.target.value)}/>
      <label>Mode</label>
      <select class="modelsel" style="max-width:none;width:100%" value=${form.mode} onChange=${(e) => set("mode", e.target.value)}><option value="chat">chat — interactive, no code changes</option><option value="repo">repo — writes code (advanced)</option></select>
      <label>Model (blank = default / global)</label><input value=${form.model} placeholder="e.g. glm-5.1, or blank" onInput=${(e) => set("model", e.target.value)}/>
      <label>Tools</label>
      <div class="toolchips">${AGENT_TOOLS.map((t) => html`<label class="toolchip" key=${t}><input type="checkbox" checked=${form.tools.includes(t)} onChange=${() => toggleTool(t)}/> ${t}</label>`)}</div>
      <label class="ckline"><input type="checkbox" checked=${form.pushesGithub} onChange=${(e) => set("pushesGithub", e.target.checked)}/> Post the result to GitHub</label>
      ${(data.skills || []).length ? html`<label>Skills</label>
        <div class="toolchips">${(data.skills || []).map((sk) => html`<label class="toolchip" key=${sk.name} title=${sk.description}><input type="checkbox" checked=${(form.skills || []).includes(sk.name)} onChange=${() => set("skills", (form.skills || []).includes(sk.name) ? (form.skills || []).filter((x) => x !== sk.name) : (form.skills || []).concat(sk.name))}/> ${sk.name}</label>`)}</div>` : null}
      <label>Persona (markdown)</label>
      <textarea rows="10" style="width:100%;font:13px ui-monospace,Menlo,monospace" value=${form.persona} onInput=${(e) => set("persona", e.target.value)}></textarea>
      <div class="row">
        <button class="btn primary" disabled=${busy} onClick=${save}>Save</button>
        ${form.builtin ? null : html`<button class="btn danger" disabled=${busy} onClick=${del}>Delete</button>`}
      </div>
    `}
  <//>`;
}
function SkillEditor({ data, onClose, reload }) {
  const skills = data.skills || [];
  const blank = { name: "", description: "", body: "" };
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
  function save() { if (!form.name) { toast("Name required"); return; } setBusy(true); api("/skill-save", { skill: form }).then(() => { toast("Saved"); setSel(null); reload(); }).catch(() => toast("Couldn’t save", "error")).then(() => setBusy(false)); }
  function del() { setBusy(true); api("/skill-delete", { skillName: form.name }).then(() => { toast("Deleted"); setSel(null); reload(); }).catch(() => toast("Couldn’t delete", "error")).then(() => setBusy(false)); }
  return html`<${Sheet} title="Skills" onClose=${onClose}>
    ${sel === null ? html`
      <div class="muted" style="font-size:12px;margin-bottom:8px">Reusable skills (Claude Code Agent Skill format: name + description + markdown body). Attach them to agents; the description decides when they apply. The Process Analyzer can author these automatically.</div>
      ${skills.map((sk) => html`<button class="agentrow" key=${sk.name} onClick=${() => { setSel(sk.name); setForm(Object.assign({}, blank, sk)); }}><span><b>${sk.name}</b> <span class="muted" style="font-size:12px">${(sk.description || "").slice(0, 60)}</span></span></button>`)}
      <button class="btn primary" style="margin-top:10px" onClick=${() => { setSel("__new__"); setForm(blank); }}><${Icon} name="plus" size=${14}/> New skill</button>
    ` : html`
      <button class="btn ghost" style="margin-bottom:8px" onClick=${() => setSel(null)}><${Icon} name="arrowleft" size=${14}/> Back</button>
      <label>Name</label><input value=${form.name} disabled=${sel !== "__new__"} onInput=${(e) => set("name", e.target.value.replace(/[^\w-]/g, ""))}/>
      <label>Description (when to use it)</label><input value=${form.description} onInput=${(e) => set("description", e.target.value)}/>
      <label>Body (markdown)</label><textarea rows="12" style="width:100%;font:13px ui-monospace,Menlo,monospace" value=${form.body} onInput=${(e) => set("body", e.target.value)}></textarea>
      <div class="row"><button class="btn primary" disabled=${busy} onClick=${save}>Save</button><button class="btn danger" disabled=${busy} onClick=${del}>Delete</button></div>
    `}
  <//>`;
}
function Sheet({ title, onClose, footer, children }) {
  return html`<div><div class="scrim on" onClick=${onClose}></div>
    <div class="sheet bottom on">
      <div class="sh"><span style="flex:1">${title}</span><button class="iconbtn" aria-label="Close" onClick=${onClose}><${Icon} name="x"/></button></div>
      <div class="sb">${children}</div>
      ${footer ? html`<div class="sf">${footer}</div>` : null}
    </div></div>`;
}

// ---------- file read ----------
function readAttach(file, cb) { if (!file) return; if (file.size > 25 * 1024 * 1024) { toast("Too big (max 25MB)"); return; } const r = new FileReader(); r.onload = () => cb({ d: r.result, name: file.name || "file", img: /^image\//.test(file.type) }); r.readAsDataURL(file); }

export function mount(root) { root.removeAttribute("aria-busy"); render(html`<${App}/>`, root); }
