// ProviderSearchSelect molecule — searchable provider picker (combobox) for the Add-provider form.
// Type to filter, ↑/↓ to move, Enter to pick, click to select. `options` = [{id, label, logo?}]
// (logo = provider name for the logo lookup). `value` is the selected option id; onChange(id) fires
// on pick ("" clears).
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Icon } from "../atoms/Icon.js";
import { ProviderLogo } from "../atoms/ProviderLogo.js";

export function ProviderSearchSelect({ value, options, onChange, placeholder = "Search providers…" }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0); // highlighted index within the filtered list
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const opts = options || [];
  const cur = opts.find((o) => o.id === value);
  const filtered = q.trim()
    ? opts.filter((o) => (o.label || "").toLowerCase().includes(q.trim().toLowerCase()) || (o.id || "").toLowerCase().includes(q.trim().toLowerCase()))
    : opts;
  // Reset highlight into range whenever the filtered set changes.
  useEffect(() => { setHi(0); }, [q, open]);
  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);
  function pick(id) { onChange && onChange(id || ""); setOpen(false); setQ(""); }
  function onKey(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[hi]) pick(filtered[hi].id); }
    else if (e.key === "Escape") { setOpen(false); }
  }
  const trigger = cur
    ? html`<span style="display:inline-flex;align-items:center;gap:6px">${cur.logo ? html`<${ProviderLogo} name=${cur.logo} size=${15}/>` : null}${cur.label}</span>`
    : html`<span style="color:var(--ink-3)">${placeholder}</span>`;
  return html`<div ref=${wrapRef} class="pss">
    <button type="button" class="pss-btn" onClick=${() => { setOpen((o) => !o); setTimeout(() => inputRef.current && inputRef.current.focus(), 0); }}>${trigger}<${Icon} name="chevdown" size=${13} cls="sel-caret"/></button>
    ${open ? html`<div class="pss-menu">
      <input ref=${inputRef} class="pss-input" placeholder="Type to search…" value=${q} onInput=${(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown=${onKey}/>
      <div class="pss-list">
        ${filtered.length === 0 ? html`<div class="pss-empty muted" style="font-size:12px;padding:8px 10px">No matches</div>` : null}
        ${filtered.map((o, i) => html`<button key=${o.id} type="button" class=${"pss-item" + (i === hi ? " hi" : "") + (o.id === value ? " on" : "")}
          onMouseEnter=${() => setHi(i)} onClick=${() => pick(o.id)}>
          ${o.logo ? html`<${ProviderLogo} name=${o.logo} size=${15}/>` : null}<span>${o.label}</span>
        </button>`)}
      </div>
    </div>` : null}
  </div>`;
}
