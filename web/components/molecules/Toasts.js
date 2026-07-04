// Toasts molecule — purely presentational toast stack. renderSegs (from lib/markdown) shapes each
// message into clickable URL/path/text segments. The dismiss button uses a literal ✕.
import { html } from "/web/vendor/standalone.mjs";
import { renderSegs } from "../../lib/markdown.js";

export function Toasts({ toasts, onDismiss }) {
  if (!toasts || !toasts.length) return null;
  return html`<div class="toast-stack">${toasts.map((t) => html`<div key=${t.id} class=${"toast-item" + (t.kind === "error" ? " t-error" : "")}><button class="toast-x" onClick=${() => onDismiss(t.id)} aria-label="Dismiss">✕</button><span>${renderSegs(t.msg)}</span></div>`)}</div>`;
}
