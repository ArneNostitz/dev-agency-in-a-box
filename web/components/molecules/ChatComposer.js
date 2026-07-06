// ChatComposer molecule (#104) — THE one chat input. Every chatbox (issue detail, orchestrator,
// …) uses this same component: markdown textarea, paste-an-image / attach-a-file (25MB cap),
// inline [image N] reference tokens, sequential upload to /upload-file (local /attach/<id>
// storage), Cmd/Ctrl+Enter send. Parents own the TEXT draft (so it can persist) and the send
// action; the composer owns attachments + upload + token replacement.
//
// Props:
//   value, onInput(text)       — controlled draft text
//   onSend(fullText) → Promise — called with the final text (attachment markdown folded in);
//                                 attachments clear when it resolves
//   uploadCtx {repo, number?}  — where uploads are stored (number 0 / absent = repo-level chat)
//   placeholder, busy, disabled, sendLabel, sendIcon
//   extras                     — optional nodes rendered LEFT of the spacer (agent/model selects…)
//   actions                    — optional nodes rendered RIGHT, before the send button (Interrupt…)
//   taRef                      — optional textarea ref (parents that need caret control)
//   onBefore(text)             — optional: fires before uploads start (optimistic skeletons)
import { html, useState, useRef } from "/web/vendor/standalone.mjs";
import { Icon } from "../atoms/Icon.js";
import { Spinner } from "../atoms/Spinner.js";
import { MarkdownArea } from "../atoms/MarkdownArea.js";
import { AttachmentThumbs } from "./AttachmentThumbs.js";
import { api } from "../../lib/api.js";
import { toast, readAttach } from "../../lib/toast.js";

export function ChatComposer({ value, onInput, onSend, uploadCtx, placeholder, busy = false, disabled = false, sendLabel = "Send", sendIcon = "send", extras = null, actions = null, taRef: taRefProp = null, onBefore = null }) {
  const [atts, setAtts] = useState([]);
  const [sending, setSending] = useState(false);
  const taRefLocal = useRef(null);
  const taRef = taRefProp || taRefLocal;

  function pickFiles(e) {
    const fs = e.target.files || [];
    for (let i = 0; i < fs.length; i++) readAttach(fs[i], (a) => setAtts((x) => x.concat(a)));
    e.target.value = "";
  }
  function onPaste(e) {
    const items = (e.clipboardData || {}).items || [];
    const files = [];
    for (let i = 0; i < items.length; i++) if (items[i].kind === "file") { const f = items[i].getAsFile(); if (f) files.push(f); }
    if (!files.length) return; // plain text paste — the browser handles it
    e.preventDefault(); // don't ALSO paste the clipboard's text/plain (file paths corrupt the caret)
    for (const file of files) {
      if (/^image\//.test(file.type)) {
        // Inline image: insert a reference token at the caret so the image lands in context.
        const imgNum = atts.filter((a) => a.img).length + 1;
        const refId = "image " + imgNum;
        const ta = taRef.current;
        if (ta) {
          const start = ta.selectionStart || 0, end = ta.selectionEnd || 0;
          const token = "[" + refId + "]";
          const next = (value || "").slice(0, start) + token + (value || "").slice(end);
          onInput(next);
          requestAnimationFrame(() => { try { ta.selectionStart = ta.selectionEnd = start + token.length; ta.focus(); } catch (err) {} });
        }
        readAttach(file, (a) => setAtts((x) => x.concat(Object.assign({}, a, { name: refId, refId }))));
      } else {
        readAttach(file, (a) => setAtts((x) => x.concat(a)));
      }
    }
  }
  function send() {
    const text = (value || "").trim();
    if ((!text && !atts.length) || sending || busy || disabled) return;
    if (onBefore) onBefore(text);
    setSending(true);
    // Upload attachments SEQUENTIALLY (concurrent writes used to collide), then fold the returned
    // markdown into the text: [image N] tokens are replaced in place, the rest is appended.
    atts.reduce((chain, a) => chain.then(async (acc) => {
      const j = await api("/upload-file", { repo: (uploadCtx && uploadCtx.repo) || "", number: (uploadCtx && uploadCtx.number) || 0, dataUrl: a.d, name: a.name }).catch(() => null);
      acc.push(j && j.md ? { md: j.md, refId: a.refId } : null);
      return acc;
    }), Promise.resolve([]))
      .then((results) => {
        let full = text;
        const appended = [];
        for (const r of results.filter(Boolean)) {
          if (r.refId && r.md) full = full.split("[" + r.refId + "]").join(r.md);
          else if (r.md) appended.push(r.md);
        }
        if (appended.length) full = [full].concat(appended).filter(Boolean).join("\n\n");
        return Promise.resolve(onSend(full));
      })
      .then(() => {
        setAtts([]);
        if (taRef.current) taRef.current.style.height = "auto";
      })
      .catch((e) => toast((e && e.message) || "Couldn't send", "error"))
      .finally(() => setSending(false));
  }
  const isBusy = busy || sending;
  return html`<div class="composer">
    <${AttachmentThumbs} atts=${atts} onReorder=${setAtts} onRemove=${(idx) => setAtts((x) => x.filter((_, j) => j !== idx))}/>
    <${MarkdownArea} value=${value} taRef=${taRef} placeholder=${placeholder} onInput=${onInput} onPaste=${onPaste} onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}/>
    <div class="composer-row">
      <label class="composer-icon tip" data-tip="Attach a file"><${Icon} name="paperclip" size=${18}/><input type="file" multiple style="display:none" onChange=${pickFiles}/></label>
      ${extras}
      <span class="spacer"></span>
      ${actions}
      <button class=${"btn primary" + (isBusy ? " busy" : "")} disabled=${isBusy || disabled} title=${sendLabel} onClick=${send}>${isBusy ? html`<${Spinner} size=${15}/>` : html`<${Icon} name=${sendIcon} size=${15}/>`} ${sendLabel}</button>
    </div>
  </div>`;
}
