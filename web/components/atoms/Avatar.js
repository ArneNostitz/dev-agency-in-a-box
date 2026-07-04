// Persona avatar. crop="head" (dashboard: pre-cropped head) | "full" (detail: whole figure).
// One avatar file per role (a mixed-gender team). Swap a value to change who represents a role.
import { html } from "/web/vendor/standalone.mjs";

const ROLE_AVATAR = { planner: "planner-f", plan: "planner-f", decomposer: "auditor", architect: "architect", arch: "architect", developer: "developer-f", dev: "developer-f", coder: "developer-f", reviewer: "reviewer", review: "reviewer", tester: "tester", test: "tester", librarian: "librarian-f", auditor: "auditor" };
const ROLE_WORDS = ["planner", "decomposer", "architect", "developer", "reviewer", "tester", "librarian", "auditor"];
// crop="head" → the dedicated head-only SVG (dashboard); "full" → the whole figure (detail comments).
// Full pool of persona art (heads + full). Unknown agents get a STABLE distinct one from the pool
// (so every custom/chat agent has its own face), with a couple of fitting named picks.
const AVATAR_POOL = ["planner", "planner-f", "architect", "reviewer", "reviewer-f", "tester", "tester-f", "developer", "developer-f", "librarian", "librarian-f", "auditor", "auditor-f"];
const NAMED_AVATAR = { "grill-me": "auditor", grill: "auditor", "spec-creator": "librarian", spec: "librarian" };
const ROLE_EMOJI = { planner: "🧠", architect: "🏛", developer: "💻", reviewer: "🔍", tester: "🧪", librarian: "📚", auditor: "🔎" };
const ROLE_ICON = { planner: "layers", decomposer: "layers", developer: "laptop", reviewer: "flask", tester: "flask", architect: "settings", librarian: "history" };

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
export function avatarFile(role, crop) {
  let n = ROLE_AVATAR[role];
  if (!n) { const k = String(role || "").toLowerCase(); n = NAMED_AVATAR[k] || (k ? AVATAR_POOL[hashStr(k) % AVATAR_POOL.length] : "agent"); }
  return crop === "head" ? "/web/avatars/heads/" + n + ".svg" : "/web/avatars/" + n + ".svg";
}

export const Avatar = ({ role, size = 24, crop = "head", src }) => {
  const w = src ? size : (crop === "full" ? Math.round(size * 0.82) : size);
  const h = size;
  return html`<span class=${"avi " + crop + (src ? " custom" : "")} style=${"width:" + w + "px;height:" + h + "px"} title=${(role || "agent") + " agent"}><img src=${src || avatarFile(role, crop)} alt=${(role || "agent") + " avatar"} loading="lazy"/></span>`;
};
