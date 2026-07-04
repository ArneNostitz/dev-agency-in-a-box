// Timeline molecule — ONE unified workflow timeline. Replaces the three near-identical renderers
// (table.js WorkflowTimeline, detail.js DetailTimeline/PlainTimeline, board.js BFlow).
//
// Props:
//   steps        — the step array from `timelineModel(issue).steps` (each: {k, label, role, st})
//   current      — index of the current step (from `timelineModel(issue).current`); -1 = none yet
//   live         — boolean, true while the issue is actively executing (pulses the current dot)
//   statusIcon   — icon name to show on the current dot when live (e.g. statusChip(issue).icon);
//                  pass null/"" to omit
//   labels       — boolean (default true): render the step text labels
//   avatarsOn    — boolean (default true): render agent faces on dots that have a role
//   dotSize      — avatar size in px (default 26; board uses 20, compact uses 20)
//   onStepClick  — optional (step) => void; when provided AND a step has a role (model target), the
//                  dot renders as a <button> that calls onStepClick(step). Otherwise it's a plain span.
//
// CSS classes are unchanged from the originals: flow__step, flow__line, flow__dot, flow__dot--face,
// flow__face, flow__lbl, flow__act, pulse, lastran.
import { html } from "/web/vendor/standalone.mjs";
import { Icon } from "../atoms/Icon.js";
import { Avatar } from "../atoms/Avatar.js";
// timelineModel is the canonical step-model builder (from table.js). Re-exported so callers can
// import both the model builder and the renderer from one place.
export { timelineModel } from "../../table.js";

export function Timeline({ steps, current, live = false, statusIcon = null, labels = true, avatarsOn = true, dotSize = 26, onStepClick = null }) {
  if (!steps || !steps.length) return null;
  const lastIdx = current; // the current step is also the "last ran" for idle issues
  return html`<div class=${"flow" + (labels ? "" : " flow--compact")}>
    ${steps.map((s, idx) => {
      const done = s.st === "done";
      const isCurrent = idx === current && !done;
      const blocked = s.st === "attention";
      const cls = done ? "done" : isCurrent ? (blocked ? "blocked" : "current") : blocked ? "blocked" : "pending";
      // Show a face on a step only when it has a role: every step for workflow timelines, the
      // current/last-run step for generic timelines (driven by callers passing `role` per step).
      const faceRole = s.role || null;
      const showFace = !!faceRole && avatarsOn;
      const clickable = !!(onStepClick && faceRole);
      const dotCls = "flow__dot" + (isCurrent && live ? " pulse" : "") + (showFace ? " flow__dot--face" : "");
      const dotInner = done && !showFace
        ? html`<${Icon} name="check" size=${labels ? 10 : 9}/>`
        : showFace
          ? html`<span class="flow__face"><${Avatar} role=${faceRole} size=${dotSize} crop="head"/></span>`
          : null;
      return html`
        ${idx ? html`<span class=${"flow__line" + (idx <= current ? " on" : "")}></span>` : null}
        <span class=${"flow__step " + cls + (idx === lastIdx && !live ? " lastran" : "")} title=${s.label + " — " + s.st}>
          ${clickable
            ? html`<button class=${dotCls} onClick=${() => onStepClick(s)}>${dotInner}</button>`
            : html`<span class=${dotCls}>${dotInner}</span>`}
          ${labels ? html`<span class="flow__lbl">${(isCurrent && live && statusIcon) ? html`<${Icon} name=${statusIcon} size=${11} cls="flow__act"/> ` : null}${s.label}</span>` : null}
        </span>`;
    })}
  </div>`;
}
