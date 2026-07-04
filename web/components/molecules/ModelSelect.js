// ModelSelect molecule — the one true model picker, built from atoms + model-logic lib functions.
// Round-trips a "providerId/model" ref through a normalized <Select>. Sources options from a
// providers list (either passed directly or read from `data.providers`). All model pickers across
// the app go through this.
import { html } from "/web/vendor/standalone.mjs";
import { Select } from "../atoms/Select.js";
import { Icon } from "../atoms/Icon.js";
import {
  providerModelOptions,
  anyModelSetUp,
  defaultModelLabel,
  parseModelRef,
  toModelRef,
  modelAvailability,
} from "../../lib/model-logic.js";

// The one true model picker.
// Props:
//   providers      — list from /models (falls back to data.providers)
//   data           — /models response; used for defaultHint = defaultModelLabel(data)
//   value          — "providerId/model" string OR {providerId, model} object OR null
//   onChange(ref)  — fires with the string "providerId/model" ("" when cleared)
//   includeDefault — prepend a "Default" option that clears the ref
//   defaultLabel   — label for that Default option ("Default model" by default)
//   defaultHint    — sub-label for the Default option (falls back to defaultModelLabel(data))
//   defaultIcon    — icon name for the Default option ("sparkles" by default)
//   short          — labels are model-only (true) or "provider · model" (false)
//   emit           — "string" (default) or "object": shape of onChange arg
//   extraOptions   — extra <Select> options merged AFTER the Default row and BEFORE the models
//                    (e.g. an "@individual" sentinel). Always emitted as string (emit="object" only
//                    parses provider/model refs; a sentinel comes back verbatim via extraEmit).
//   onSetUp        — called when NO model is set up at all (no providers, no Claude credential).
//                    Renders a "Set up providers and models" button instead of an empty select.
//   trigger, btnClass, menuAlign, placeholder, disabled : passed through to Select
export function ModelSelect({
  providers, data, value, onChange,
  includeDefault = false, defaultLabel = "Default model", defaultHint, defaultIcon = "sparkles",
  short = true, emit = "string", extraOptions, onSetUp,
  trigger, btnClass, menuAlign, placeholder, disabled,
}) {
  const provs = providers || (data && data.providers) || [];
  const strValue = toModelRef(value);
  const dhint = defaultHint !== undefined ? defaultHint : (data ? defaultModelLabel(data) : undefined);
  const baseOpts = providerModelOptions(provs, { short });
  // No models anywhere AND nothing to default to → show the "set up" CTA instead of an empty menu.
  // Only when onSetUp is supplied (the caller knows how to open Settings → Models).
  if (!baseOpts.length && !anyModelSetUp(data) && onSetUp) {
    return html`<button class=${(btnClass || "btn ghost") + " tip"} data-tip="No model is set up yet"
      onClick=${onSetUp}><${Icon} name="flask" size=${14}/> Set up providers and models</button>`;
  }
  const opts = (includeDefault ? [{ value: "", label: defaultLabel, hint: dhint, icon: defaultIcon }] : [])
    .concat(extraOptions || [])
    .concat(baseOpts);
  const emitVal = (v) => {
    if (!onChange) return;
    if (emit === "object") {
      // Sentinels (non-empty non-ref) pass through as-is; refs parse; "" clears.
      if (v && parseModelRef(v)) onChange(parseModelRef(v));
      else if (v) onChange(v);
      else onChange(null);
    } else {
      onChange(v || "");
    }
  };
  // Stale-model warning: the selected model is no longer in its provider's discovered list. Show a
  // warning chip beside the trigger (and a tooltip suggesting the substitute). Never auto-change it.
  const stale = strValue ? modelAvailability(strValue, provs) : { available: true, substitute: null };
  const staleTip = stale.available ? "" : (stale.substitute ? `⚠ ${parseModelRef(strValue).model} no longer available — try ${stale.substitute}` : `⚠ ${parseModelRef(strValue).model} no longer available`);
  const sel = html`<${Select} value=${strValue} options=${opts} onChange=${emitVal}
    trigger=${trigger} btnClass=${btnClass} menuAlign=${menuAlign} placeholder=${placeholder} disabled=${disabled}/>`;
  return stale.available ? sel : html`<span style="display:inline-flex;align-items:center;gap:3px">${sel}<span class="tip" data-tip=${staleTip} style="color:var(--amber);display:inline-flex"><${Icon} name="alert" size=${13}/></span></span>`;
}
