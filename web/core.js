// Dev Agency dashboard — core module (split from app.js; Preact + htm, no build step).
import { html, render, useState, useEffect, useLayoutEffect, useRef } from "/web/vendor/standalone.mjs";


// ---------- icons (Lucide line paths) ----------
const ICONS = {
  chevright: '<path d="m9 18 6-6-6-6"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  dollar: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
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
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  chevup: '<path d="m18 15-6-6-6 6"/>',
  chevdown: '<path d="m6 9 6 6 6-6"/>',
  columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  incoming: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
};
export const Icon = ({ name, size = 18, cls }) => html`<svg class=${"lic " + (cls || "")} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" dangerouslySetInnerHTML=${{ __html: ICONS[name] || "" }}></svg>`;

// Real provider/brand logos (@lobehub/icons-static-svg, MIT) vendored under /web/logos. Maps a
// provider/model name to its colored SVG; ProviderLogo renders it as an <img>, falling back to a
// generic icon for anything we don't have a logo for.
const PROVIDER_LOGOS = [
  [/claude|anthropic/i, "claude-color"],
  [/zhipu|chatglm|\bglm\b/i, "chatglm-color"],
  [/deepseek/i, "deepseek-color"],
  [/kimi|moonshot/i, "kimi-color"],
  [/gemini|google/i, "gemini-color"],
  [/mistral/i, "mistral-color"],
  [/qwen/i, "qwen-color"],
  [/openai|gpt|custom/i, "openai"],
];
// The provider name backing the configured DEFAULT model (global default, else Claude subscription)
// — so the "Default model" option can show the real logo instead of a generic icon.
export function defaultModelLogo(data) {
  const gm = data && data.globalModel;
  if (gm && gm.providerId) {
    const p = ((data && data.providers) || []).find((x) => x.id === gm.providerId);
    if (p && p.name) return p.name;
  }
  return "Claude";
}
export function providerLogoSrc(name) {
  const n = String(name || "");
  for (const [re, file] of PROVIDER_LOGOS) if (re.test(n)) return "/web/logos/" + file + ".svg";
  return null;
}
export function ProviderLogo({ name, size = 16 }) {
  const src = providerLogoSrc(name);
  return src
    ? html`<img class="plogo" src=${src} width=${size} height=${size} alt=${name || "model"} loading="lazy"/>`
    : html`<${Icon} name="flask" size=${size}/>`;
}
// Spinning loader to show an action is in flight (blocks "did my click register?" ambiguity).
export const Spinner = ({ size = 18 }) => html`<svg class="lic spin" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>`;

// ---------- agent persona avatars ----------
// One avatar file per role (a mixed-gender team). Swap a value to change who represents a role.
const ROLE_AVATAR = { planner: "planner-f", decomposer: "auditor", architect: "architect", developer: "developer-f", reviewer: "reviewer", tester: "tester", librarian: "librarian-f", auditor: "auditor" };
const ROLE_WORDS = ["planner", "decomposer", "architect", "developer", "reviewer", "tester", "librarian", "auditor"];
// crop="head" → the dedicated head-only SVG (dashboard); "full" → the whole figure (detail comments).
// Full pool of persona art (heads + full). Unknown agents get a STABLE distinct one from the pool
// (so every custom/chat agent has its own face), with a couple of fitting named picks.
const AVATAR_POOL = ["planner", "planner-f", "architect", "reviewer", "reviewer-f", "tester", "tester-f", "developer", "developer-f", "librarian", "librarian-f", "auditor", "auditor-f"];
const NAMED_AVATAR = { "grill-me": "auditor", grill: "auditor", "spec-creator": "librarian", spec: "librarian" };
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function avatarFile(role, crop) {
  let n = ROLE_AVATAR[role];
  if (!n) { const k = String(role || "").toLowerCase(); n = NAMED_AVATAR[k] || (k ? AVATAR_POOL[hashStr(k) % AVATAR_POOL.length] : "agent"); }
  return crop === "head" ? "/web/avatars/heads/" + n + ".svg" : "/web/avatars/" + n + ".svg";
}
// The author role of an agency comment, read from its leading badge ("🧠 **Planner**", "role: **developer**", …).
export function roleFromComment(body) { const head = (body || "").slice(0, 90).toLowerCase(); for (const r of ROLE_WORDS) if (head.includes(r)) return r; return null; }
// Role badge for an agency comment, rendered inline in the comment header (emoji · Role) so the
// redundant "💻 **Developer** · _dev-agency_" first body line can be stripped (see stripBadge).
const ROLE_EMOJI = { planner: "🧠", architect: "🏛", developer: "💻", reviewer: "🔍", tester: "🧪", librarian: "📚", auditor: "🔎" };
export function commentBadge(body) { const r = roleFromComment(body); return r ? { role: r, emoji: ROLE_EMOJI[r] || "", name: r[0].toUpperCase() + r.slice(1) } : null; }
// Drop the leading "🧠 **Planner** · _dev-agency_" line (now shown in the header) from a comment body.
export function stripBadge(body) { return (body || "").replace(/^\s*[^\n]*·\s*_dev-agency_\s*\r?\n+/, ""); }
// Persona avatar. crop="head" (dashboard: pre-cropped head) | "full" (detail: whole figure).
export const Avatar = ({ role, size = 24, crop = "head", src }) => {
  const w = src ? size : (crop === "full" ? Math.round(size * 0.82) : size);
  const h = size;
  return html`<span class=${"avi " + crop + (src ? " custom" : "")} style=${"width:" + w + "px;height:" + h + "px"} title=${(role || "agent") + " agent"}><img src=${src || avatarFile(role, crop)} alt=${(role || "agent") + " avatar"} loading="lazy"/></span>`;
};

// ---------- helpers ----------
const ROLE_ICON = { planner: "layers", decomposer: "layers", developer: "laptop", reviewer: "flask", tester: "flask", architect: "settings", librarian: "history" };
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

// ---------- live markdown composer (MarkdownArea) ----------
// A textarea with a rendered-markdown overlay behind it: the input text is transparent (only the
// caret shows), and a line-preserving preview sits underneath so headers/bullets/links render
// live as you type — no "second copy". One source line == one preview line, identical font
// metrics, so the caret stays aligned with the rendered text.
// mdOverlay keeps the markdown markers (`# `, `- `, `1. ` …) visible so the overlay aligns to the
// raw input char-for-char; it only colours/bolds the content.
function mdOverlayLine(ln, inCode) {
  if (/^\s*```/.test(ln)) return '<div class="mdc">' + escHtml(ln) + '</div>';
  if (inCode) return '<div class="mdc">' + escHtml(ln) + '</div>';
  let m;
  if ((m = /^(#{1,6})\s+(.*)$/.exec(ln))) return '<div class="mdh mdh' + m[1].length + '">' + m[1] + ' ' + mdInline(escHtml(m[2])) + '</div>';
  if (/^\s*[-*+]\s+/.test(ln)) return '<div class="mdb">' + mdInline(escHtml(ln.replace(/^(\s*)[-*+](\s)/, "$1\u2022$2"))) + '</div>';
  if (/^\d+\.\s+/.test(ln)) return '<div class="mdo">' + mdInline(escHtml(ln)) + '</div>';
  if (/^>\s?/.test(ln)) return '<div class="mdq">' + mdInline(escHtml(ln)) + '</div>';
  if (ln === "") return '<div class="mde">&nbsp;</div>';
  return '<div>' + mdInline(escHtml(ln)) + '</div>';
}
export function mdOverlay(src) {
  if (!src) return "";
  const lines = String(src || "").split(/\r?\n/);
  let inCode = false;
  return lines.map((ln) => { if (/^\s*```/.test(ln)) inCode = !inCode; return mdOverlayLine(ln, inCode); }).join("");
}

// Auto-continue markdown lists in a textarea on Enter. Mutates value + caret; returns true if handled.
export function continueMarkdownList(el) {
  if (el.selectionStart !== el.selectionEnd || el.selectionStart !== el.value.length) return false;
  const val = el.value, pos = el.selectionStart;
  const lineStart = val.lastIndexOf("\n", pos - 1) + 1;
  const line = val.slice(lineStart, pos);
  const ul = /^\s*([-*+])\s+/.exec(line);
  const ol = /^(\s*)(\d+)\.\s+/.exec(line);
  if (ul) {
    const prefix = ul[0];
    // empty item → exit the list
    if (line === prefix) { el.value = val.slice(0, lineStart) + val.slice(pos); el.selectionStart = el.selectionEnd = lineStart; return true; }
    el.value = val.slice(0, pos) + "\n" + prefix + val.slice(pos);
    el.selectionStart = el.selectionEnd = pos + 1 + prefix.length;
    return true;
  }
  if (ol) {
    const indent = ol[1], num = parseInt(ol[2], 10), prefix = indent + (num + 1) + ". ";
    if (line === ol[0]) { el.value = val.slice(0, lineStart) + val.slice(pos); el.selectionStart = el.selectionEnd = lineStart; return true; }
    el.value = val.slice(0, pos) + "\n" + prefix + val.slice(pos);
    el.selectionStart = el.selectionEnd = pos + 1 + prefix.length;
    return true;
  }
  return false;
}

export function MarkdownArea({ value, onInput, onPaste, onKeyDown, placeholder, taRef, rows, class: cls }) {
  const overlayRef = useRef(null);
  // Keep the preview overlay aligned to the textarea: same scroll position, and inset by the
  // textarea's scrollbar width so wrapped lines line up with the caret.
  const sync = (ta) => {
    const ov = overlayRef.current;
    if (!ov || !ta) return;
    ov.scrollTop = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
    const sb = ta.offsetWidth - ta.clientWidth;
    ov.style.right = sb > 0 ? sb + "px" : "0px";
  };
  const autosize = (el) => { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; };
  const handleInput = (e) => {
    const el = e.target;
    autosize(el);
    onInput && onInput(el.value);
    sync(el);
  };
  const handleScroll = (e) => sync(e.target);
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !(e.metaKey || e.ctrlKey || e.altKey) && !e.shiftKey) {
      // plain Enter: auto-continue a list (if at line end) and notify parent of the new value
      if (continueMarkdownList(e.target)) { e.preventDefault(); handleInput({ target: e.target }); return; }
    }
    onKeyDown && onKeyDown(e);
  };
  // Autosize on mount and whenever value changes externally (e.g. cleared after send).
  useEffect(() => { if (taRef && taRef.current) { autosize(taRef.current); sync(taRef.current); } }, [value]);
  return html`<div class=${"mdarea" + (cls ? " " + cls : "")}>
    <div class="mdarea-preview" ref=${overlayRef} dangerouslySetInnerHTML=${{ __html: mdOverlay(value) }}></div>
    <textarea ref=${taRef} rows=${rows || 1} placeholder=${placeholder} value=${value} onInput=${handleInput} onScroll=${handleScroll} onPaste=${onPaste} onKeyDown=${handleKeyDown} spellcheck=${false}></textarea>
  </div>`;
}

export function api(url, body) { return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(async (r) => { if (!r.ok) { let msg = "http " + r.status; try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {} throw new Error(msg); } return r.json().catch(() => ({})); }); }
export function getJSON(u) { return fetch(u).then((r) => r.json()); }

export function isDone(i) { return i.state === "done"; }
// The issue's lifecycle lane: planned | working | review | done. Derived from the canonical
// IssueState enum in `i.state` + the BlockedReason in `i.blocked` (ADR-0001). `agency:epic`
// is an IssueKind carried in state until the IssueKind module exists — handled as a branch.
export function classify(i) {
  const s = i.state || "";
  if (s === "agency:epic") return i.epic && i.epic.done >= i.epic.total ? "review" : "working";
  if (s === "done") return "done";
  if (i.active || i.queued || i.running) return "working"; // actually executing right now
  if (i.pr_number && s !== "planned" && s !== "notPlanned") return "review"; // a PR is up → waiting on you
  // Waiting on the human shows in Review (needs your 👍 / answer / attention).
  if (i.blocked === "awaitingApproval" || i.blocked === "awaitingAnswer" || i.blocked === "needsAttention") return "review";
  if (s === "working") return "working";
  if (s === "review") return "review";
  return "planned";
}
export function statusChip(i) {
  const s = i.state || "";
  if (s === "done") return { cls: "s-done", label: "done", icon: "merge" };
  if (i.active) return { cls: "s-working", label: "working", icon: "loader" };
  if (i.queued) return { cls: "s-working", label: "queued", icon: "clock" };
  if (i.blocked === "rateLimited") return { cls: "s-auto", label: i.resumeAt ? "resumes " + hm(new Date(i.resumeAt)) : "auto-resume", icon: "hourglass" };
  if (s === "agency:epic") return { cls: "s-epic", label: i.epic ? i.epic.done + "/" + i.epic.total : "epic", icon: "layers" };
  // Distinct chips for each BlockedReason (the payoff of carrying `blocked` in the payload).
  if (i.blocked === "conflict") return { cls: "s-changes", label: "conflict", icon: "alert" };
  if (i.blocked === "budgetExceeded") return { cls: "s-attn", label: "over budget", icon: "alert" };
  if (i.blocked === "needsAttention") return { cls: "s-attn", label: "needs you", icon: "alert" };
  if (i.blocked === "awaitingApproval") return { cls: "s-attn", label: "approve?", icon: "check" };
  if (i.blocked === "awaitingAnswer") return { cls: "s-attn", label: "reply", icon: "messages" };
  if (s === "working") return { cls: "s-working", label: "working", icon: "loader" };
  if (s === "review") return i.review === "changes" ? { cls: "s-changes", label: "changes", icon: "alert" } : { cls: "s-ready", label: "ready", icon: "pr" };
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

// ---------- toast message shaping (pure) ----------
// Tokenize a message into segments. URLs and file paths become clickable:
//   URLs  → shortened (scheme + host + shortened path) open in a new tab on click
//   paths → shortened (/head/…/tail) copy to clipboard on click
// Everything else is plain text and wraps normally.
function shortenPath(p) { const parts = p.split("/"); if (parts.length <= 3) return p; return parts.slice(0, 2).join("/") + "/…/" + parts[parts.length - 1]; }
function shortenUrl(u) { try { const p = new URL(u); return p.protocol + "//" + (p.host || "") + shortenPath(p.pathname || ""); } catch (e) { return u; } }
// Regex: http(s) URLs, then unix-like absolute paths (with at least one slash segment).
const URL_RE = /https?:\/\/[^\s)]+/g;
const PATH_RE = /(^|\s)((?:\/|[A-Za-z]:[\\/])[\w@.\-/]+)(?=[\s)]|$)/g;
export function shapeToastMsg(msg) {
  if (!msg) return [{ t: "text", v: "" }];
  const out = [];
  let i = 0;
  const pushText = (s) => { if (s) out.push({ t: "text", v: s }); };
  while (i < msg.length) {
    URL_RE.lastIndex = i; const um = URL_RE.exec(msg);
    PATH_RE.lastIndex = i; const pm = PATH_RE.exec(msg);
    const uNext = um ? um.index : Infinity;
    const pNext = pm ? pm.index + (pm[1] ? pm[1].length : 0) : Infinity;
    if (uNext === Infinity && pNext === Infinity) { pushText(msg.slice(i)); break; }
    if (uNext <= pNext) {
      pushText(msg.slice(i, uNext));
      out.push({ t: "url", v: um[0] });
      i = uNext + um[0].length;
    } else {
      pushText(msg.slice(i, pNext));
      out.push({ t: "path", v: pm[2] });
      i = pNext + pm[2].length;
    }
  }
  return out;
}

// copyPath is module-level: it has no component state and its only side effect is a clipboard
// write + a toast — keeping it out of the render body lets Toasts stay purely presentational.
function copyPath(v) { try { navigator.clipboard.writeText(v); } catch (e) {} toast("Copied"); }
// Render the shaped segments: URLs as links, paths as click-to-copy spans, the rest as text.
function renderSegs(msg) {
  return shapeToastMsg(msg).map((s, i) => {
    if (s.t === "url") return html`<a key=${i} class="toast-msg-link" href=${s.v} target="_blank" rel="noopener" title=${s.v}>${shortenUrl(s.v)}</a>`;
    if (s.t === "path") return html`<span key=${i} class="toast-msg-path" title=${"Copy: " + s.v} onClick=${() => copyPath(s.v)}>${shortenPath(s.v)}</span>`;
    return s.v;
  });
}

// ---------- Toasts molecule ----------
export function Toasts({ toasts, onDismiss }) {
  if (!toasts || !toasts.length) return null;
  return html`<div class="toast-stack">${toasts.map((t) => html`<div key=${t.id} class=${"toast-item" + (t.kind === "error" ? " t-error" : "")}><button class="toast-x" onClick=${() => onDismiss(t.id)} aria-label="Dismiss">✕</button><span>${renderSegs(t.msg)}</span></div>`)}</div>`;
}

// ---------- workspace setup progress (pure) ----------
// Derive a real clone/setup percentage from the live activity stream. The backend streams
// `📥 cloning <repo>… NN%` (real git progress) and `🧭 …` indexing lines. We walk the stream from
// the end, treating the latest setup-phase line as current. Once a non-setup agent event appears
// (a tool use, a text/model output, or a "started (…)" run start), setup is finished → null.
export function getSetupProgress(stream) {
  if (!stream || !stream.length) return null;
  for (let i = stream.length - 1; i >= 0; i--) {
    const ev = stream[i];
    const text = ev.text || "";
    // A real agent run has started (role start event) or produced model/tool output → setup done.
    if (ev.kind === "start") return null;
    if (ev.kind === "text") return null;
    if (ev.kind === "tool" && !/^📥/.test(text) && !/^🧭/.test(text)) return null;
    // Setup line: parse a real `%` if present, else a phase label without a number.
    if (/^📥/.test(text)) {
      const m = text.match(/(\d+)%/);
      const phase = text.replace(/^📥\s*/, "").replace(/\s*\d+%/, "").replace(/\s*done$/, "").trim();
      if (m) return { percent: Math.min(100, parseInt(m[1], 10)), phase };
      if (/done$/.test(text)) return { percent: 100, phase };
      return { percent: null, phase: phase || "preparing" };
    }
    if (/^🧭/.test(text)) {
      return { percent: null, phase: text.replace(/^🧭\s*/, "").trim() || "indexing" };
    }
  }
  return null;
}

// Reactive desktop/mobile breakpoint (matches the CSS @media min-width:880px). Computing this
// inline during render is unreliable — matchMedia can report the wrong value on first paint and
// then flip on a later re-render, which made the board's extra columns vanish after a few seconds.
// Live viewport width (debounced via rAF) — lets the layout resolver pick narrow/medium/wide tiers.
export function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setW(window.innerWidth)); };
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);
  return w;
}
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

// Board control sort — string key form used by the BoardControls toolbar.
export function boardSortCmp(v) {
  if (v === "updated_asc")  return (a, b) => new Date(a.updated_at || 0) - new Date(b.updated_at || 0);
  // GitHub issue numbers are creation order, and the DB has no created_at — so "created" sorts by number.
  if (v === "created_desc") return (a, b) => (b.number || 0) - (a.number || 0);
  if (v === "created_asc")  return (a, b) => (a.number || 0) - (b.number || 0);
  if (v === "number_asc")   return (a, b) => (a.number || 0) - (b.number || 0);
  if (v === "number_desc")  return (a, b) => (b.number || 0) - (a.number || 0);
  return (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0); // updated_desc default
}

// Filter issues by updated_at recency.
export function filterByTime(arr, v) {
  if (!v || v === "any") return arr;
  const ms = v === "24h" ? 86400000 : v === "7d" ? 7 * 86400000 : 30 * 86400000;
  const cut = Date.now() - ms;
  return arr.filter((i) => new Date(i.updated_at || 0).getTime() >= cut);
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

// ---------- atomic Select (custom dropdown) ----------
// A native-select replacement whose menu renders FIXED-positioned (escapes any overflow:auto
// scroll container, so it's never clipped inside a card/column/sheet). options: [{value,label,
// logo?(provider name), icon?(icon name), hint?}]. `trigger(cur)` customises the button content.
export function Select({ value, options, onChange, trigger, btnClass, menuAlign, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const cur = (options || []).find((o) => o.value === value);
  function place() {
    const el = btnRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
    const w = Math.max(r.width, 168);
    // For a narrow icon trigger, hang the menu from the trigger's left but clamp into the viewport;
    // align right when asked or when a left-anchored menu would overflow.
    let left = menuAlign === "right" ? r.right - w : r.left;
    if (left + w > vw - 8) left = r.right - w;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const below = vh - r.bottom;
    const up = below < 260 && r.top > below; // flip up near the bottom edge
    // position:fixed anchors to the nearest TRANSFORMED ancestor (sheets/modals/detail use a
    // transform), not the viewport — so offset our viewport coords by that ancestor's box.
    let cb = null, node = el.parentElement;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      if (cs.transform !== "none" || cs.perspective !== "none" || cs.filter !== "none") { cb = node.getBoundingClientRect(); break; }
      node = node.parentElement;
    }
    const ox = cb ? cb.left : 0, cbBottom = cb ? cb.bottom : vh;
    const oy = cb ? cb.top : 0;
    const avail = up ? (r.top - 12) : (vh - r.bottom - 12);
    const maxH = Math.max(160, Math.min(Math.round(avail), Math.round(vh * 0.72)));
    setPos({ left: Math.round(left - ox), width: w, up, maxH, top: up ? null : Math.round(r.bottom + 5 - oy), bottom: up ? Math.round(cbBottom - r.top + 5) : null });
  }
  function toggle(e) { e.stopPropagation(); if (disabled) return; if (!open) place(); setOpen((o) => !o); }
  // After the menu renders we know its REAL width (labels/badges can be wider than the estimate);
  // re-clamp its left so it never spills past the right (or left) viewport edge.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !pos) return;
    const m = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth || 1200;
    let shift = 0;
    if (m.right > vw - 8) shift = (vw - 8) - m.right;
    if (m.left + shift < 8) shift = 8 - m.left;
    if (Math.abs(shift) > 1) setPos((p) => (p ? { ...p, left: p.left + shift } : p));
  }, [open, pos && pos.width, pos && pos.maxH]);
  function pick(e, v) { e.stopPropagation(); setOpen(false); onChange(v); }
  // Close on a click/tap OUTSIDE (without a blocking scrim — the underlying click still lands), and
  // on scroll/resize (the fixed menu would otherwise detach from its trigger).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if ((menuRef.current && menuRef.current.contains(e.target)) || (btnRef.current && btnRef.current.contains(e.target))) return;
      setOpen(false);
    };
    // Close on scroll of the page/container BEHIND the menu — but NOT when scrolling inside the
    // menu's own list (that was closing it the moment you tried to scroll the options).
    const onScroll = (e) => { if (menuRef.current && menuRef.current.contains(e.target)) return; setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);
  const itemInner = (o) => html`${o.avatar ? html`<${Avatar} role=${o.avatar} src=${o.avatarSrc} crop="head" size=${18}/>` : o.logo ? html`<${ProviderLogo} name=${o.logo} size=${15}/>` : o.icon ? html`<${Icon} name=${o.icon} size=${14}/>` : null}<span class="sel-itxt">${o.label}</span>${o.hint ? html`<span class=${"sel-badge" + (o.hintCls ? " " + o.hintCls : "")}>${o.hint}</span>` : null}`;
  return html`<div class="sel">
    <button ref=${btnRef} class=${"sel-btn " + (btnClass || "")} disabled=${disabled} onClick=${toggle}>
      ${trigger ? trigger(cur) : html`<span class="sel-cur">${cur && cur.avatar ? html`<${Avatar} role=${cur.avatar} crop="head" size=${16}/>` : cur && cur.logo ? html`<${ProviderLogo} name=${cur.logo} size=${15}/>` : null}${cur ? cur.label : (placeholder || "Select…")}</span><${Icon} name="chevdown" size=${13} cls="sel-caret"/>`}
    </button>
    ${open && pos ? html`<div ref=${menuRef} class="sel-menu" style=${"left:" + pos.left + "px;min-width:" + pos.width + "px;max-height:" + pos.maxH + "px;" + (pos.up ? "bottom:" + pos.bottom + "px" : "top:" + pos.top + "px")}>
        ${(options || []).map((o) => html`<button key=${o.value} class=${"sel-item" + (o.value === value ? " on" : "")} onClick=${(e) => pick(e, o.value)}>${itemInner(o)}</button>`)}
      </div>` : null}
  </div>`;
}

// ---------- atomic Modal/Dialog ----------
// Centered dialog with a unified header (title, no ✕), scrollable body, and a footer for CTA
// buttons. Esc and backdrop-click close it. `footer` is the CTA row (e.g. Close + Save).
export function Modal({ title, onClose, footer, children, size }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose && onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  return html`<div class="modal-scrim" onClick=${() => onClose && onClose()}>
    <div class=${"modal " + (size === "lg" ? "modal-lg" : size === "sm" ? "modal-sm" : "")} onClick=${(e) => e.stopPropagation()}>
      <div class="modal-h">${title}</div>
      <div class="modal-b">${children}</div>
      ${footer ? html`<div class="modal-f">${footer}</div>` : null}
    </div>
  </div>`;
}


// Build the agent picker options: built-in workflow/role pins + chat agents + custom agents,
// each with a persona avatar and a category badge so chat-only vs workflow vs single-role is clear.
// Single-role pins (a workflow is the multi-step path; these run one specialist).
const ROLE_PINS = [
  { value: "@plan", label: "Plan", avatar: "planner", hint: "role", hintCls: "b-role" },
  { value: "@split", label: "Split", avatar: "auditor", hint: "role", hintCls: "b-role" },
  { value: "@arch", label: "Architect", avatar: "architect", hint: "role", hintCls: "b-role" },
  { value: "@review", label: "Review", avatar: "reviewer", hint: "role", hintCls: "b-role" },
  { value: "@test", label: "Test", avatar: "tester", hint: "role", hintCls: "b-role" },
];
const WF_AVATAR = { "full-build": "developer", "quick-fix": "developer", "plan-only": "planner", "review-only": "reviewer" };
export function agentOptions(agentDefs, workflows) {
  const wf = (workflows || []).filter((w) => w.trigger).map((w) => ({ value: w.trigger, label: w.name, avatar: WF_AVATAR[w.id] || "developer", hint: "workflow", hintCls: "b-wf" }));
  const defs = agentDefs || [];
  const agents = defs.map((d) => ({ value: d.handle || ("@" + d.name), label: d.name, avatar: d.name, avatarSrc: d.avatar || "", hint: d.mode === "chat" ? "chat" : "code", hintCls: d.mode === "chat" ? "b-chat" : "b-code" }));
  return wf.concat(ROLE_PINS).concat(agents);
}
// AGENTS ONLY — role pins + defined agents, no workflows. Used by the reply composer (chat = talk to
// a teammate; starting a workflow is a separate explicit action in the detail toolbar).
export function agentOnlyOptions(agentDefs) {
  const defs = agentDefs || [];
  const agents = defs.map((d) => ({ value: d.handle || ("@" + d.name), label: d.name, avatar: d.name, avatarSrc: d.avatar || "", hint: d.mode === "chat" ? "chat" : "code", hintCls: d.mode === "chat" ? "b-chat" : "b-code" }));
  return ROLE_PINS.concat(agents);
}
// Just the workflows, for the per-issue workflow picker + the toolbar "Run workflow" menu.
export function workflowOptions(workflows) {
  return (workflows || []).filter((w) => w.trigger || w.id).map((w) => ({ value: w.id, trigger: w.trigger || "", label: w.name, avatar: WF_AVATAR[w.id] || "developer", hint: "workflow", hintCls: "b-wf" }));
}
