// ---------- atomic Select (custom dropdown) ----------
// A native-select replacement whose menu renders FIXED-positioned (escapes any overflow:auto
// scroll container, so it's never clipped inside a card/column/sheet). options: [{value,label,
// logo?(provider name), icon?(icon name), hint?}]. `trigger(cur)` customises the button content.
import { html, useState, useRef, useLayoutEffect, useEffect } from "/web/vendor/standalone.mjs";
import { Icon } from "./Icon.js";
import { Avatar } from "./Avatar.js";
import { ProviderLogo } from "./ProviderLogo.js";

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
    // On scroll/resize, RE-ANCHOR the menu to its trigger instead of closing it. The live-stream pane
    // auto-scrolls on every delta (a programmatic scroll caught by this capture listener), which used
    // to snap every open dropdown shut every few seconds. Repositioning keeps it open and aligned;
    // outside-click (onDown) is still the way it closes. Scrolling inside the menu's own list is ignored.
    const onScroll = (e) => { if (menuRef.current && menuRef.current.contains(e.target)) return; place(); };
    const onResize = () => place();
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
