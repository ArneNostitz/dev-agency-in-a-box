// Toast system — module-level so anything can call it. The pure halves (toast, setToastFn,
// shapeToastMsg, toastFn) live here; the Toasts component rendering (renderSegs) stays in
// markdown.js. File reader helper (readAttach) is also pure (only side effect: FileReader + toast).
//
// NOTE: circular import with markdown.js is intentional and safe — URL_RE/PATH_RE/shortenPath/
// shortenUrl are only read INSIDE shapeToastMsg (at call time), long after both modules have
// finished evaluating.

import { URL_RE, PATH_RE, shortenPath, shortenUrl } from "./markdown.js";

// ---------- toast (module-level so anything can call it) ----------
// kind: "info" (default, auto-dismiss 2s) | "error" (persists until dismissed)
let toastFn = () => {};

export function toast(t, kind) { toastFn(t, kind || "info"); }
export function setToastFn(fn) { toastFn = fn; }
export { toastFn };

// ---------- toast message shaping (pure) ----------
// Tokenize a message into segments. URLs and file paths become clickable:
//   URLs  → shortened (scheme + host + shortened path) open in a new tab on click
//   paths → shortened (/head/…/tail) copy to clipboard on click
// Everything else is plain text and wraps normally.
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

// ---------- file read ----------
export function readAttach(file, cb) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { toast("Too big (max 25MB)"); return; }
  const r = new FileReader();
  r.onload = () => cb({ d: r.result, name: file.name || "file", img: /^image\//.test(file.type) });
  r.readAsDataURL(file);
}
