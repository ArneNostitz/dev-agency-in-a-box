// AgentModelPicker molecule — the per-agent model picker used in BOTH the Agents page and the
// Workflow builder (one shared copy). Built from atoms + model-logic lib functions.
// `value` is a model-ref string — one of:
//   ""                        → Default (inherit the global/role default)
//   "high"|"medium"|"low"     → a tier, resolved against the run's provider at run time
//   "providerId/model"        → a concrete model (a tier pinned to a provider, or any specific model)
// Emits the same string shape via onChange. Renders one <Select>:
//   [Default] [High · model] [Medium · model] [Low · model] ---- all concrete models ----
// so tiers sit on top (with their resolved model as a hint) and every available model follows.
import { html } from "/web/vendor/standalone.mjs";
import { Select } from "../atoms/Select.js";
import { Icon } from "../atoms/Icon.js";
import {
  providerModelOptions,
  anyModelSetUp,
  tierProviderFor,
  parseModelRef,
  modelAvailability,
} from "../../lib/model-logic.js";
import { shortModel } from "../../lib/format.js";

export function AgentModelPicker({ value, onChange, data, onSetUp, btnClass }) {
  const providers = (data && data.providers) || [];
  const tp = tierProviderFor(data);
  const tiers = (tp && tp.tiers) || {};
  const modelOpts = providerModelOptions(providers, { short: true });
  // No models anywhere AND nothing configured → "set up" CTA (consistent with ModelSelect).
  if (!modelOpts.length && !anyModelSetUp(data) && onSetUp) {
    return html`<button class=${(btnClass || "btn ghost") + " tip"} data-tip="No model is set up yet"
      onClick=${onSetUp}><${Icon} name="flask" size=${14}/> Set up providers and models</button>`;
  }
  const tierLabel = (t) => {
    const slot = tiers[t];
    const m = slot && slot.model ? shortModel(slot.model) : "—";
    const cap = t.charAt(0).toUpperCase() + t.slice(1);
    return cap + " · " + m;
  };
  const opts = [{ value: "", label: "Default — inherit", icon: "sparkles" }]
    .concat(["high", "medium", "low"]
      .map((t) => ({ value: t, label: tierLabel(t), icon: "layer", logo: tp ? tp.name : "" })))
    .concat(modelOpts.map((o) => ({ value: o.value, label: o.label, logo: o.logo })));
  // Stale warning only for concrete refs (tier words resolve at run time, so they're never "stale").
  const isRef = value && value.indexOf("/") > 0;
  const stale = isRef ? modelAvailability(value, providers) : { available: true, substitute: null };
  const staleTip = stale.available ? "" : (stale.substitute ? `⚠ ${parseModelRef(value).model} no longer available — try ${stale.substitute}` : `⚠ ${parseModelRef(value).model} no longer available`);
  const sel = html`<${Select} value=${value || ""} options=${opts} btnClass=${btnClass}
    onChange=${(v) => onChange && onChange(v || "")}/>`;
  return stale.available ? sel : html`<span style="display:inline-flex;align-items:center;gap:3px">${sel}<span class="tip" data-tip=${staleTip} style="color:var(--amber);display:inline-flex"><${Icon} name="alert" size=${13}/></span></span>`;
}
