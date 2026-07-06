// ---------- live markdown composer (MarkdownArea) ----------
// A textarea with a rendered-markdown overlay behind it: the input text is transparent (only the
// caret shows), and a line-preserving preview sits underneath so headers/bullets/links render
// live as you type — no "second copy". One source line == one preview line, identical font
// metrics, so the caret stays aligned with the rendered text.
// mdOverlay keeps the markdown markers (`# `, `- `, `1. ` …) visible so the overlay aligns to the
// raw input char-for-char; it only colours/bolds the content.
//
// NOTE: md, mdOverlay, escHtml, mdInline, continueMarkdownList live in core.js for now. They'll
// move to lib/markdown.js in the next step; until then we import the helpers from there.
import { html, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { mdOverlay, continueMarkdownList } from "../../core.js";

export function MarkdownArea({ value, onInput, onPaste, onKeyDown, placeholder, taRef, rows, maxHeight = 200, class: cls }) {
  const overlayRef = useRef(null);
  // Keep the preview overlay aligned to the textarea: same scroll position, and inset by the
  // textarea's scrollbar width so wrapped lines line up with the caret.
  const sync = (ta) => {
    const ov = overlayRef.current;
    if (!ov || !ta) return;
    ov.scrollTop = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
    const sb = ta.offsetWidth - ta.clientWidth;
    ov.style.right = sb > 0 ? sb + "px" : "0px";
  };
  const autosize = (el) => { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, maxHeight) + "px"; };
  const handleInput = (e) => {
    const el = e.target;
    autosize(el);
    onInput && onInput(el.value);
    sync(el);
  };
  const handleScroll = (e) => sync(e.target);
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !(e.metaKey || e.ctrlKey || e.altKey) && !e.shiftKey) {
      // plain Enter: auto-continue a list (if at line end) and notify parent of the new value
      if (continueMarkdownList(e.target)) { e.preventDefault(); handleInput({ target: e.target }); return; }
    }
    onKeyDown && onKeyDown(e);
  };
  // Autosize on mount and whenever value changes externally (e.g. cleared after send).
  useEffect(() => { if (taRef && taRef.current) { autosize(taRef.current); sync(taRef.current); } }, [value]);
  return html`<div class=${"mdarea" + (cls ? " " + cls : "")}>
    <div class="mdarea-preview" ref=${overlayRef} dangerouslySetInnerHTML=${{ __html: mdOverlay(value) }}></div>
    <textarea ref=${taRef} rows=${rows || 1} placeholder=${placeholder} value=${value} onInput=${handleInput} onScroll=${handleScroll} onPaste=${onPaste} onKeyDown=${handleKeyDown} spellcheck=${false}></textarea>
  </div>`;
}
