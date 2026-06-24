// Dev Agency dashboard — layout primitives. A generic resizable Split with slots, and a Workspace
// resolver that decides which leaf component (Chat / List / Board / Detail) occupies each slot based
// on the viewport tier + state. The leaves themselves never change; only WHERE they're mounted does.
import { html, useState, useRef, useEffect, useCallback } from "/web/vendor/standalone.mjs";

// --- persisted per-layout pane sizes -----------------------------------------
function loadSizes(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem("split:" + key) || "null"); return Array.isArray(v) && v.length === fallback.length ? v : fallback.slice(); }
  catch (e) { return fallback.slice(); }
}
function saveSizes(key, sizes) { try { localStorage.setItem("split:" + key, JSON.stringify(sizes)); } catch (e) {} }

// Split: N children laid out in a row with draggable dividers between them. `sizes` are flex-basis
// fractions (sum ~1). `mins` are per-pane min pixel widths. Sizes persist under `id`. Double-click a
// divider resets that pair to the default ratio.
export function Split({ id, panes, mins, defaults }) {
  const n = panes.length;
  const def = defaults || panes.map(() => 1 / n);
  const minPx = mins || panes.map(() => 280);
  const [sizes, setSizes] = useState(() => loadSizes(id + ":" + n, def));
  const ref = useRef(null);

  // keep sizes array length in sync with pane count (layout changed)
  useEffect(() => { if (sizes.length !== n) setSizes(loadSizes(id + ":" + n, def)); }, [n]);

  const onDown = useCallback((i, e) => {
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    const start = { i, startX: e.clientX, total: rect.width, base: sizes.slice() };
    let latest = sizes.slice();
    const move = (ev) => {
      const dxFrac = (ev.clientX - start.startX) / start.total;
      const next = start.base.slice();
      let a = start.base[start.i] + dxFrac, b = start.base[start.i + 1] - dxFrac;
      const minA = minPx[start.i] / start.total, minB = minPx[start.i + 1] / start.total;
      if (a < minA) { b -= (minA - a); a = minA; }
      if (b < minB) { a -= (minB - b); b = minB; }
      next[start.i] = a; next[start.i + 1] = b;
      latest = next;
      setSizes(next);
    };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; document.body.style.userSelect = ""; saveSizes(id + ":" + n, latest); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sizes, n]);

  const reset = (i) => { const ns = def.slice(); setSizes(ns); saveSizes(id + ":" + n, ns); };

  return html`<div class="splitx" ref=${ref}>
    ${panes.map((pane, i) => html`
      <div class="splitx__pane" key=${"p" + i} style=${"flex: " + sizes[i] + " 1 0; min-width: " + minPx[i] + "px"}>${pane}</div>
      ${i < n - 1 ? html`<div class="splitx__grip" key=${"g" + i} onMouseDown=${(e) => onDown(i, e)} onDblClick=${() => reset(i)} title="Drag to resize · double-click to reset"><span class="splitx__grip-line"></span></div>` : null}
    `)}
  </div>`;
}

// --- Workspace: assign leaf components to split slots by viewport tier + state ----------------
// Leaves are pre-built vnodes passed in: { mainView (List|Board), chat, detail }. The resolver:
//   wide (>=1280):   [chat? | mainView | detail?]  — true triple split when chat is open AND detail
//   medium (880..):  [mainView | detail?]          — chat is a slide-over overlay from the left
//   narrow (<880):   mainView full                 — detail overlay; chat slide-over
// Chat is ALWAYS reachable; on smaller widths it slides in over the list instead of taking a slot.
export function Workspace({ vw, view, mainView, chat, detail, chatOpen, setChatOpen, detailOpen }) {
  const wide = vw >= 1280;
  const medium = vw >= 880;
  const chatDocked = wide && chatOpen;          // chat earns its own slot only when there's room
  const chatOverlay = chatOpen && !chatDocked;  // otherwise it slides over

  // Build the docked slots (left→right): [chat?], mainView, [detail?]
  const slots = [];
  const mins = [];
  const defs = [];
  if (chatDocked) { slots.push(html`<div class="slot slot--chat">${chat}</div>`); mins.push(360); defs.push(0.28); }
  slots.push(html`<div class="slot slot--main">${mainView}</div>`); mins.push(420); defs.push(chatDocked && detailOpen && medium ? 0.40 : 0.6);
  if (detailOpen && medium) { slots.push(html`<div class="slot slot--detail">${detail}</div>`); mins.push(420); defs.push(0.46); }

  const layoutKey = (chatDocked ? "c" : "") + "m" + (detailOpen && medium ? "d" : "");

  return html`<div class="workspace">
    ${slots.length > 1
      ? html`<${Split} id=${"ws-" + layoutKey} panes=${slots} mins=${mins} defaults=${normalize(defs)}/>`
      : html`<div class="workspace__single">${slots[0]}</div>`}
    ${detailOpen && !medium ? html`<div class="overlay overlay--detail"><div class="overlay__scrim" onClick=${() => { const c = document.querySelector(".detail .dclose"); c && c.click(); }}></div><div class="overlay__panel overlay__panel--detail">${detail}</div></div>` : null}
    ${chatOverlay ? html`<div class="overlay overlay--chat"><div class="overlay__scrim" onClick=${() => setChatOpen(false)}></div><div class="overlay__panel overlay__panel--chat">${chat}</div></div>` : null}
  </div>`;
}
function normalize(arr) { const s = arr.reduce((a, b) => a + b, 0) || 1; return arr.map((x) => x / s); }
