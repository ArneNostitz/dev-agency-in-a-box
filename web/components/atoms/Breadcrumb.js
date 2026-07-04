// Breadcrumb — repo › [epic #n ›] #number. One component, used in the detail header, list rows,
// and board cards so the crumb is identical everywhere.
//   repo      "owner/name" (required)
//   number    issue number (optional; omitted → repo only)
//   parent    { number } epic parent (optional)
//   showOwner  also show the owner segment (default false → just the repo name)
//   dot        show the colored repo dot (default true)
//   size       icon size for the chevrons (default 11)
import { html } from "/web/vendor/standalone.mjs";
import { Icon } from "./Icon.js";

// A stable category color per repo (the breadcrumb dot).
const REPO_HUES = ["var(--accent)", "var(--green)", "var(--amber)", "var(--purple)", "var(--red)", "#0ea5e9"];
export function repoColor(repo) { let h = 0; for (let n = 0; n < (repo || "").length; n++) h = (h * 31 + repo.charCodeAt(n)) >>> 0; return REPO_HUES[h % REPO_HUES.length]; }

export function Breadcrumb({ repo, number, parent, showOwner = false, dot = true, size = 11, className = "" }) {
  const owner = (repo || "").split("/")[0];
  const name = (repo || "").split("/").pop();
  return html`<nav class=${"crumbs " + className} aria-label="Breadcrumb">
    <span class="crumbs__repo">${dot ? html`<span class="crumbs__dot" style=${"background:" + repoColor(repo)}></span>` : null}${showOwner && owner ? html`<span class="crumbs__owner">${owner}/</span>` : null}${name}</span>
    ${parent && parent.number ? html`<${Icon} name="chevright" size=${size} cls="crumbs__sep"/><span class="crumbs__epic"><${Icon} name="layers" size=${size}/>#${parent.number}</span>` : null}
    ${number != null ? html`<${Icon} name="chevright" size=${size} cls="crumbs__sep"/><span class="crumbs__num">${number > 0 ? "#" + number : "…"}</span>` : null}
  </nav>`;
}
