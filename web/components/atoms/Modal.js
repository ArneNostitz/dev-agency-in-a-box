// Centered dialog with a unified header (title, no ✕), scrollable body, and a footer for CTA
// buttons. Esc and backdrop-click close it. `footer` is the CTA row (e.g. Close + Save).
import { html, useEffect } from "/web/vendor/standalone.mjs";

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
