// Spinning loader to show an action is in flight (blocks "did my click register?" ambiguity).
import { html } from "/web/vendor/standalone.mjs";

export const Spinner = ({ size = 18 }) => html`<svg class="lic spin" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>`;
