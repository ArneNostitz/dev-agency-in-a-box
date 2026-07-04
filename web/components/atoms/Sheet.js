// ---------- Sheet wrapper ----------
import { html } from "/web/vendor/standalone.mjs";
import { Icon } from "./Icon.js";

export function Sheet({ title, onClose, footer, children }) {
  return html`<div><div class="scrim on" onClick=${onClose}></div>
    <div class="sheet bottom on">
      <div class="sh"><span style="flex:1">${title}</span><button class="iconbtn" aria-label="Close" onClick=${onClose}><${Icon} name="x"/></button></div>
      <div class="sb">${children}</div>
      ${footer ? html`<div class="sf">${footer}</div>` : null}
    </div></div>`;
}
