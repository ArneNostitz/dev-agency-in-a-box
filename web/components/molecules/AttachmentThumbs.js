// AttachmentThumbs molecule — the pending-attachment row shared by every composer (chat, new-issue,
// …). A pasted/attached image used to render at its native size right in the row, ballooning the
// composer to match a full screenshot; this renders a small square thumbnail instead, click-to-expand
// (via the app's existing image lightbox — see installImageViewer in app.js, which delegates on
// ".att-thumb img" among its other selectors), and drag-to-reorder when there's more than one.
import { html, useState } from "/web/vendor/standalone.mjs";
import { Icon } from "../atoms/Icon.js";

// Props:
//   atts        — [{ d, name, img, refId? }] (d = data URL, img = is-an-image, refId = [token] this
//                 attachment is bound to in the draft text — reordering doesn't touch refId pairing)
//   onReorder(nextAtts)
//   onRemove(idx)
export function AttachmentThumbs({ atts, onReorder, onRemove }) {
  const [drag, setDrag] = useState(null);
  if (!atts || !atts.length) return null;
  function drop(targetIdx) {
    if (drag == null || drag === targetIdx) { setDrag(null); return; }
    const next = atts.slice();
    const [moved] = next.splice(drag, 1);
    next.splice(targetIdx, 0, moved);
    onReorder(next);
    setDrag(null);
  }
  return html`<div class="composer-atts">
    ${atts.map((a, idx) => html`<span
        key=${idx}
        class=${"att att-thumb" + (drag === idx ? " dragging" : "")}
        draggable=${atts.length > 1}
        title=${a.name || ""}
        onDragStart=${(e) => { setDrag(idx); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); } catch (err) {} }}
        onDragOver=${(e) => { if (drag == null) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        onDrop=${(e) => { e.preventDefault(); drop(idx); }}
        onDragEnd=${() => setDrag(null)}
      >
        ${a.img ? html`<img src=${a.d}/>` : html`<span class="att-file"><${Icon} name="paperclip" size=${12}/> ${a.name}</span>`}
        <button class="att-x" aria-label="Remove" onClick=${() => onRemove(idx)}><${Icon} name="x" size=${11}/></button>
      </span>`)}
  </div>`;
}
