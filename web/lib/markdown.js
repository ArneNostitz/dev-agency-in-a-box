// Markdown rendering helpers — pure functions, no component deps.
// Imports html from standalone for renderSegs (renders anchor/span elements).

import { html } from "/web/vendor/standalone.mjs";
import { toast, shapeToastMsg } from "./toast.js";

// Stable hash for picking a deterministic avatar from a pool (kept local — only markdown-adjacent
// helpers here need it; preserved verbatim from core.js for parity).
export function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function mdInline(s) {
  // URLs: accept absolute http(s) AND root-relative paths (e.g. /attach/<id> for local-first
  // attachments) — otherwise pasted images render as raw "[image 1](/attach/…)" text in comments.
  return s
    .replace(/!\[([^\]]*)\]\(((?:https?:|\/)[^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(((?:https?:|\/)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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
    // Pipe table: header row + a |---|---| separator + body rows.
    if (/\|/.test(ln) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      closeBlocks();
      const splitRow = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const head = splitRow(ln);
      i++; // skip separator
      const rows = [];
      while (i + 1 < lines.length && /\|/.test(lines[i + 1]) && lines[i + 1].trim() !== "") { i++; rows.push(splitRow(lines[i])); }
      let tbl = "<table><thead><tr>" + head.map((c) => "<th>" + mdInline(c) + "</th>").join("") + "</tr></thead><tbody>";
      tbl += rows.map((r) => "<tr>" + r.map((c) => "<td>" + mdInline(c) + "</td>").join("") + "</tr>").join("");
      tbl += "</tbody></table>";
      out.push(tbl);
      continue;
    }
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

// ---------- live markdown overlay (MarkdownArea) ----------
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

// ---------- toast message shaping (URLs + paths) ----------
// shapeToastMsg lives in toast.js (pure); URL_RE/PATH_RE/shortenPath/shortenUrl are here and
// imported by toast.js. renderSegs (below) imports shapeToastMsg back.
export function shortenPath(p) {
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return parts.slice(0, 2).join("/") + "/…/" + parts[parts.length - 1];
}

export function shortenUrl(u) {
  try { const p = new URL(u); return p.protocol + "//" + (p.host || "") + shortenPath(p.pathname || ""); } catch (e) { return u; }
}

// Regex: http(s) URLs, then unix-like absolute paths (with at least one slash segment).
export const URL_RE = /https?:\/\/[^\s)]+/g;
export const PATH_RE = /(^|\s)((?:\/|[A-Za-z]:[\\/])[\w@.\-/]+)(?=[\s)]|$)/g;

// copyPath is module-level: it has no component state and its only side effect is a clipboard
// write + a toast.
function copyPath(v) { try { navigator.clipboard.writeText(v); } catch (e) {} toast("Copied"); }

// Render the shaped segments: URLs as links, paths as click-to-copy spans, the rest as text.
export function renderSegs(msg) {
  return shapeToastMsg(msg).map((s, i) => {
    if (s.t === "url") return html`<a key=${i} class="toast-msg-link" href=${s.v} target="_blank" rel="noopener" title=${s.v}>${shortenUrl(s.v)}</a>`;
    if (s.t === "path") return html`<span key=${i} class="toast-msg-path" title=${"Copy: " + s.v} onClick=${() => copyPath(s.v)}>${shortenPath(s.v)}</span>`;
    return s.v;
  });
}
