// Comment molecule — a conversation comment (agency or human), with edit-in-place. Built from
// atoms + lib functions. `commentBadge`/`roleFromComment`/`stripBadge` are temporarily imported
// from core.js (not yet extracted to lib); md from lib/markdown, ago from lib/format.
import { html, useState } from "/web/vendor/standalone.mjs";
import { Avatar } from "../atoms/Avatar.js";
import { Icon } from "../atoms/Icon.js";
import { Spinner } from "../atoms/Spinner.js";
import { md } from "../../lib/markdown.js";
import { ago } from "../../lib/format.js";
import { commentBadge, roleFromComment, stripBadge } from "../../core.js";

export function Comment({ id, author, createdAt, body, isAgency, isSkel, incoming, avatars = true, onEdit, editable = false, agentsAfter = 0, onStopAgent = null }) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(body || "");
  const [saving, setSaving] = useState(false);
  function startEdit() { setEditVal(body || ""); setEditing(true); }
  function cancelEdit() { setEditing(false); }
  function save() {
    if (!onEdit || !editVal.trim() || saving) return;
    setSaving(true);
    onEdit(id, editVal.trim()).then(() => { setEditing(false); setSaving(false); if (agentsAfter >= 1 && onStopAgent) onStopAgent(); }).catch(() => setSaving(false));
  }
  return html`<div class=${"cmt " + (isAgency ? "ag" : "") + (isSkel ? " skel" : "") + (incoming ? " incoming" : "")}>
    <div class="h">
      ${isAgency && avatars ? html`<span class="cmt-av"><${Avatar} role=${roleFromComment(body)} size=${28} crop="head"/></span>` : null}
      <span>${incoming ? html`<span class="cmt-in" title="Incoming — posted on GitHub"><${Icon} name="incoming" size=${12}/></span> ` : ""}${(() => { const bd = isAgency ? commentBadge(body) : null; return bd ? html`<span class="cmt-role">${bd.emoji} ${bd.name}</span> · ` : ""; })()}${author || ""} · ${isSkel ? "just now" : ago(createdAt)}</span>
      ${id && !isSkel && editable && onEdit ? html`<button class="iconbtn cmt-edit-btn tip" data-tip=${agentsAfter === 1 ? "Edit — this halts the agent that replied" : "Edit comment"} onClick=${startEdit}><${Icon} name="edit" size=${13}/></button>` : null}
      ${id && !isSkel && !editable && onStopAgent ? html`<button class="iconbtn cmt-edit-btn tip" data-tip="An agent has already replied — can't edit. Stop the agent instead." onClick=${onStopAgent}><${Icon} name="stop" size=${13}/></button>` : null}
    </div>
    ${editing ? html`
      <textarea class="cmt-edit-ta" value=${editVal} onInput=${(e) => setEditVal(e.target.value)}></textarea>
      <div class="cmt-edit-row">
        <button class="btn" onClick=${cancelEdit}>Cancel</button>
        <button class="btn primary" disabled=${saving} onClick=${save}>${saving ? html`<${Spinner} size=${13}/>` : "Save"}</button>
      </div>
    ` : html`<div class="b" dangerouslySetInnerHTML=${{ __html: md(isAgency ? stripBadge(body) : body) }}></div>`}
  </div>`;
}
