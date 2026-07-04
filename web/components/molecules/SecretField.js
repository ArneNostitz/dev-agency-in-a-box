// SecretField molecule — a labelled password field with save/clear for a user secret. Built from
// the Icon atom + the api/toast lib helpers.
import { html, useState } from "/web/vendor/standalone.mjs";
import { Icon } from "../atoms/Icon.js";
import { api } from "../../lib/api.js";
import { toast } from "../../lib/toast.js";

export function SecretField({ field, isSet, reload }) {
  const [v, setV] = useState("");
  function save() { if (!v) { toast("Enter a value"); return; } api("/user-secret", { key: field.key, value: v }).then(() => { toast("Saved"); setV(""); reload(); }).catch(() => toast("Couldn’t save")); }
  function clear() { api("/user-secret", { key: field.key, value: "" }).then(() => { toast("Cleared"); reload(); }); }
  return html`<label>${field.label} ${isSet ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> set</span>` : null}</label>
    <div class="muted" style="font-size:11px;margin:0 2px 4px">${field.hint}</div>
    <div style="display:flex;gap:8px">
      <input type="password" autocomplete="off" placeholder=${isSet ? "•••••• saved — type to replace" : "paste token"} value=${v} onInput=${(e) => setV(e.target.value)}/>
      <button class="btn" onClick=${save}>Save</button>
      ${isSet ? html`<button class="btn danger" onClick=${clear} aria-label="Clear"><${Icon} name="trash" size=${15}/></button>` : null}
    </div>`;
}
