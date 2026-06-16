// Dev Agency dashboard — core module (split from app.js; Preact + htm, no build step).
import { html, render, useState, useEffect } from "/web/vendor/standalone.mjs";


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
  chevron: '<path d="m9 18 6-6-6-6"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  incoming: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
};
export const Icon = ({ name, size = 18, cls }) => html`<svg class=${"lic " + (cls || "")} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML=${{ __html: ICONS[name] || "" }}></svg>`;
// Spinning loader to show an action is in flight (blocks "did my click register?" ambiguity).
export const Spinner = ({ size = 18 }) => html`<svg class="lic spin" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>`;

// ---------- agent persona avatars ----------
// One avatar file per role (a mixed-gender team). Swap a value to change who represents a role.
const ROLE_AVATAR = { planner: "planner-f", architect: "architect", developer: "developer-f", reviewer: "reviewer", tester: "tester", librarian: "librarian-f", auditor: "auditor" };
const ROLE_WORDS = ["planner", "architect", "developer", "reviewer", "tester", "librarian", "auditor"];
// crop="head" → the dedicated head-only SVG (dashboard); "full" → the whole figure (detail comments).
function avatarFile(role, crop) { const n = ROLE_AVATAR[role] || "agent"; return crop === "head" ? "/web/avatars/heads/" + n + ".svg" : "/web/avatars/" + n + ".svg"; }
// The author role of an agency comment, read from its leading badge ("🧠 **Planner**", "role: **developer**", …).
export function roleFromComment(body) { const head = (body || "").slice(0, 90).toLowerCase(); for (const r of ROLE_WORDS) if (head.includes(r)) return r; return null; }
// Persona avatar. crop="head" (dashboard: pre-cropped head) | "full" (detail: whole figure).
export const Avatar = ({ role, size = 24, crop = "head" }) => {
  const w = crop === "full" ? Math.round(size * 0.82) : size;
  const h = size;
  return html`<span class=${"avi " + crop} style=${"width:" + w + "px;height:" + h + "px"} title=${(role || "agent") + " agent"}><img src=${avatarFile(role, crop)} alt=${(role || "agent") + " avatar"} loading="lazy"/></span>`;
};

// ---------- helpers ----------
const ROLE_ICON = { planner: "layers", developer: "laptop", reviewer: "flask", tester: "flask", architect: "settings", librarian: "history" };
export function ago(iso) { if (!iso) return ""; let s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return Math.floor(s) + "s"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h"; return Math.floor(s / 86400) + "d"; }
export function hm(d) { try { return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
export function fmtTok(n) { n = n || 0; if (n >= 1e6) return (n / 1e6).toFixed(2) + "M"; if (n >= 1e3) return Math.round(n / 1e3) + "k"; return "" + n; }
export function ghUrl(repo, n) { return "https://github.com/" + repo + "/issues/" + n; }
function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function mdInline(s) {
  return s
    .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
export function md(src) {
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
export function api(url, body) { return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(async (r) => { if (!r.ok) { let msg = "http " + r.status; try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {} throw new Error(msg); } return r.json().catch(() => ({})); }); }
export function getJSON(u) { return fetch(u).then((r) => r.json()); }

export function isDone(i) { const s = i.state || ""; return s === "merged" || s === "agency:merged" || s === "closed" || s === "done"; }
export function classify(i) {
  const s = i.state || "";
  if (isDone(i)) return "done";
  if (i.active || i.queued || i.running) return "working"; // actually executing right now (i.running = live hasActiveRun from server)
  if (i.pr_number) return "review"; // a PR exists → it's waiting on you, even if a restart left a stale "in-progress" label
  if (s === "agency:in-progress" || s === "agency:rate-limited") return "working";
  if (s === "agency:epic") return i.epic && i.epic.done >= i.epic.total ? "review" : "working";
  if (s === "agency:ready" || s === "agency:needs-attention" || s === "agency:awaiting-approval" || s === "agency:awaiting-answer") return "review";
  return "planned";
}
export function statusChip(i) {
  const s = i.state || "";
  if (isDone(i)) return s.indexOf("merg") >= 0 ? { cls: "s-done", label: "merged", icon: "merge" } : { cls: "s-planned", label: s.indexOf("clos") >= 0 ? "closed" : "done", icon: "check" };
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
export const COLS = [
  { k: "planned", label: "Planned", icon: "planned" },
  { k: "working", label: "Working", icon: "loader" },
  { k: "review", label: "Review", icon: "alert" },
  { k: "done", label: "Done", icon: "check" },
];

// ---------- toast (module-level so anything can call it) ----------
// kind: "info" (default, auto-dismiss 2s) | "error" (persists until dismissed)
let toastFn = () => {};
export function toast(t, kind) { toastFn(t, kind || "info"); }
export function setToastFn(fn) { toastFn = fn; }

// ---------- Toasts molecule ----------
export function Toasts({ toasts, onDismiss }) {
  if (!toasts || !toasts.length) return null;
  return html`<div class="toast-stack">${toasts.map((t) => html`<div key=${t.id} class=${"toast-item" + (t.kind === "error" ? " t-error" : "")}><span>${t.msg}</span>${t.kind === "error" ? html`<button class="toast-x" onClick=${() => onDismiss(t.id)} aria-label="Dismiss">✕</button>` : null}</div>`)}</div>`;
}

// Reactive desktop/mobile breakpoint (matches the CSS @media min-width:880px). Computing this
// inline during render is unreliable — matchMedia can report the wrong value on first paint and
// then flip on a later re-render, which made the board's extra columns vanish after a few seconds.
export function useIsDesktop() {
  const mq = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width:880px)") : null);
  const [d, setD] = useState(() => { const m = mq(); return m ? m.matches : false; });
  useEffect(() => {
    const m = mq(); if (!m) return; const fn = () => setD(m.matches); fn();
    if (m.addEventListener) m.addEventListener("change", fn); else m.addListener(fn);
    return () => { if (m.removeEventListener) m.removeEventListener("change", fn); else m.removeListener(fn); };
  }, []);
  return d;
}

export function sortCmp(sort) {
  const s = sort || { key: "time", dir: "desc" };
  const dir = s.dir === "asc" ? 1 : -1;
  if (s.key === "name") return (a, b) => dir * String(a.title || "").localeCompare(String(b.title || ""));
  return (a, b) => dir * (new Date(a.updated_at || 0) - new Date(b.updated_at || 0));
}

export function usageTitle(u) {
  if (!u || !u.tokens) return "No token usage recorded yet";
  return `${fmtTok(u.tokens)} tokens · $${Number(u.costUsd || 0).toFixed(2)}${u.model ? " · " + shortModel(u.model) : ""} · ${u.runs || 0} runs`;
}

// ---------- Sheet wrapper ----------
export function shortModel(m) {
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
export function Sheet({ title, onClose, footer, children }) {
  return html`<div><div class="scrim on" onClick=${onClose}></div>
    <div class="sheet bottom on">
      <div class="sh"><span style="flex:1">${title}</span><button class="iconbtn" aria-label="Close" onClick=${onClose}><${Icon} name="x"/></button></div>
      <div class="sb">${children}</div>
      ${footer ? html`<div class="sf">${footer}</div>` : null}
    </div></div>`;
}

// ---------- file read ----------
export function readAttach(file, cb) { if (!file) return; if (file.size > 25 * 1024 * 1024) { toast("Too big (max 25MB)"); return; } const r = new FileReader(); r.onload = () => cb({ d: r.result, name: file.name || "file", img: /^image\//.test(file.type) }); r.readAsDataURL(file); }
