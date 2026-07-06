// Organism — SettingsShell (issue #139). ONE full settings surface: section list on the LEFT,
// detail on the RIGHT, every control AUTO-SAVES on change (no Save step), a single ✕ closes.
// The old stacked sheet + separate GitHub/Models modals are folded in as sections. Atomic design:
// atoms (Icon/Select/Modal-free), molecules (ModelSelect/SecretField/ProviderSearchSelect), lib.
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Icon } from "../atoms/Icon.js";
import { Spinner } from "../atoms/Spinner.js";
import { Select } from "../atoms/Select.js";
import { ProviderLogo } from "../atoms/ProviderLogo.js";
import { ModelSelect } from "../molecules/ModelSelect.js";
import { ProviderSearchSelect } from "../molecules/ProviderSearchSelect.js";
import { SecretField } from "../molecules/SecretField.js";
import { api, getJSON } from "../../lib/api.js";
import { sortModelsByRecency } from "../../lib/model-recency.js";
import { toast } from "../../lib/toast.js";
import { agentOptions } from "../../lib/agent-options.js";
import { OB_PROVIDERS } from "../../data/providers.js";

// Debounced auto-save for typed inputs: save 600ms after the last keystroke (checkboxes/selects
// save immediately at the call site).
function useAutoSave() {
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  return (fn) => { clearTimeout(t.current); t.current = setTimeout(fn, 600); };
}
const saved = () => toast("Saved");
const failed = (e) => toast((e && e.message) || "Couldn't save", "error");

// ---------- the shell ----------
export function SettingsShell({ data, onClose, reload, section: initial, openWorkflows }) {
  const admin = Boolean(data.user && data.user.role === "admin");
  const [section, setSection] = useState(initial || "general");
  const NAV = [
    { k: "general", label: "General", icon: "sliders" },
    { k: "models", label: "Models & providers", icon: "flask" },
    { k: "github", label: "GitHub", icon: "link" },
    { k: "environments", label: "Environments", icon: "laptop" },
    ...(admin ? [{ k: "team", label: "Team", icon: "users" }] : []),
    { k: "account", label: "Account", icon: "lock" },
  ];
  return html`<div class="setshell">
    <div class="setshell__panel">
      <button class="iconbtn ghost setshell__x" aria-label="Close" data-tip="Close — everything saves as you change it" onClick=${onClose}><${Icon} name="x" size=${18}/></button>
      <div class="setshell__nav">
        <div class="setshell__title"><${Icon} name="sliders" size=${16}/> Settings</div>
        ${NAV.map((n) => html`<button key=${n.k} class=${"setshell__navitem" + (section === n.k ? " on" : "")} onClick=${() => setSection(n.k)}><${Icon} name=${n.icon} size=${15}/> ${n.label}</button>`)}
        <div class="setshell__navsep"></div>
        <button class="setshell__navitem" onClick=${() => { onClose(); openWorkflows && openWorkflows(); }}><${Icon} name="layers" size=${15}/> Workflows & agents <${Icon} name="chevron" size=${12} cls="setshell__navgo"/></button>
        <span style="flex:1"></span>
        <div class="setshell__hint">Changes save automatically</div>
      </div>
      <div class="setshell__body">
        ${section === "general" ? html`<${GeneralSection} data=${data} reload=${reload} admin=${admin}/>` : null}
        ${section === "models" ? html`<${ModelsSection} reload=${reload} secretKeys=${data.secretKeys || []}/>` : null}
        ${section === "github" ? html`<${GithubSection} secretKeys=${data.secretKeys || []} github=${data.github} reload=${reload}/>` : null}
        ${section === "environments" ? html`<${EnvironmentsSection} admin=${admin}/>` : null}
        ${section === "team" && admin ? html`<${TeamSection} users=${data.users || []} webhookSecretSet=${data.webhookSecretSet} reload=${reload}/>` : null}
        ${section === "account" ? html`<${AccountSection} data=${data} reload=${reload} onClose=${onClose}/>` : null}
      </div>
    </div>
  </div>`;
}

// ---------- General ----------
function GeneralSection({ data, reload, admin }) {
  const cfg = data.config || {};
  const later = useAutoSave();
  const [maxTok, setMaxTok] = useState(cfg.maxTokensPerRun || 600000);
  const [avatarsOn, setAvatarsOn] = useState(cfg.avatars !== "off");
  const [selfImprove, setSelfImprove] = useState((data.ops || {}).self_improve != null ? !!(data.ops || {}).self_improve : true);
  const [newDefault, setNewDefault] = useState(cfg.newIssueDefault || "@dev");
  const put = (body) => api("/settings", body).then(saved).then(reload).catch(failed);
  return html`<div>
    <div class="sec">Appearance</div>
    <label class="ckline"><input type="checkbox" checked=${avatarsOn} onChange=${(e) => { setAvatarsOn(e.target.checked); put({ avatars: e.target.checked ? "on" : "off" }); }}/> Show agent avatars (cards & comments)</label>

    <div class="sec" style="margin-top:18px">Run defaults</div>
    <label>New-issue default</label>
    <div class="muted" style="font-size:12px;margin-bottom:4px">What a new issue is assigned to when you open the composer.</div>
    <${Select} value=${newDefault} options=${agentOptions(data && data.agentDefs, data && data.workflows)} onChange=${(v) => { setNewDefault(v); put({ newIssueDefault: v }); }}/>
    <label style="margin-top:10px">Max tokens per run (0 = off)</label>
    <input type="number" min="0" step="50000" value=${maxTok} onInput=${(e) => { setMaxTok(e.target.value); later(() => put({ maxTokensPerRun: Number(e.target.value) || 0 })); }}/>

    ${admin ? html`<div class="sec" style="margin-top:18px">Automation</div>
      <label class="ckline"><input type="checkbox" checked=${selfImprove} onChange=${(e) => { setSelfImprove(e.target.checked); put({ ops: { self_improve: e.target.checked } }); }}/> Allow self-improvement PRs</label>` : null}
  </div>`;
}

// ---------- Models & providers ----------
function ModelsSection({ reload, secretKeys }) {
  const [providers, setProvidersState] = useState([]);
  const [autoSwitch, setAutoSwitch] = useState(false);
  const [chain, setChain] = useState([]);
  const [globalModel, setGlobalModel] = useState(null);
  const [open, setOpen] = useState(""); // expanded provider id
  const [adding, setAdding] = useState(false);
  function refresh() {
    getJSON("/models").then((d) => {
      setProvidersState(d.providers || []);
      setAutoSwitch(d.autoSwitchOnLimit || false);
      setChain(d.fallbackChain || []);
      setGlobalModel(d.globalModel || null);
    }).catch(() => {});
  }
  useEffect(refresh, []);
  // Auto-save: any provider-list mutation persists the whole list (the server stores it wholesale).
  function saveProviders(list) {
    setProvidersState(list);
    return api("/models", { providers: list.map(stripAuth) }).then(saved).then(() => { reload(); }).catch(failed);
  }
  const stripAuth = (p) => { const { auth, ...rest } = p; return rest; };
  function patchProvider(id, patch) { saveProviders(providers.map((p) => (p.id === id ? { ...p, ...patch } : p))); }
  function removeProvider(p) {
    if (!window.confirm("Remove " + p.name + "?")) return;
    saveProviders(providers.filter((x) => x.id !== p.id));
  }
  function saveRouting(patch) {
    api("/models", patch).then(saved).catch(failed);
  }
  const globalDefaultLabel = (globalModel && globalModel.model) ? "Default (role defaults)" : "Default (set up a provider first)";
  return html`<div>
    <div class="sec">Providers</div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Every provider — Claude included — carries its full discovered catalog. Tick the models you want offered in pickers; untick to hide. Edits save instantly.</div>
    ${providers.map((p) => html`<${ProviderCard} key=${p.id} p=${p} open=${open === p.id} onToggle=${() => setOpen(open === p.id ? "" : p.id)} onPatch=${(patch) => patchProvider(p.id, patch)} onRemove=${() => removeProvider(p)} onDiscovered=${refresh}/>`)}
    ${!providers.length ? html`<div class="muted" style="font-size:12.5px;padding:8px 2px">No providers yet — add one below (or add a Claude credential under Add provider).</div>` : null}
    ${adding
      ? html`<${AddProvider} existing=${providers} onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); refresh(); reload(); }}/>`
      : html`<button class="btn primary" style="width:100%;justify-content:center;margin:10px 0 4px" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15}/> Add provider</button>`}
    ${secretKeys.includes("claude_token") || secretKeys.includes("anthropic_api_key") ? html`<div class="muted" style="font-size:11px;margin-top:4px">Claude credential: ${secretKeys.includes("claude_token") ? "subscription token" : "API key"} saved — manage it under GitHub? No: remove via Add provider → Claude, or Account.</div>` : null}

    <div class="sec" style="margin-top:20px">Global default & rate limit</div>
    <label style="margin-top:4px;display:block">Global default model</label>
    <div style="margin-bottom:10px"><${ModelSelect} providers=${providers} value=${globalModel} includeDefault=${true} defaultLabel=${globalDefaultLabel} defaultIcon="flask" emit="object" onChange=${(v) => { setGlobalModel(v); saveRouting({ globalModel: v }); }}/></div>
    <label class="ckline"><input type="checkbox" checked=${autoSwitch} onChange=${(e) => { setAutoSwitch(e.target.checked); saveRouting({ autoSwitchOnLimit: e.target.checked }); }}/> Auto-switch to fallback model on usage limit</label>
    <label style="margin-top:8px">Fallback chain (tried in order when the primary is rate-limited)</label>
    ${chain.map((entry, idx) => html`<div key=${idx} style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
      <${ModelSelect} providers=${providers} value=${entry} onChange=${(v) => { if (!v) return; const parts = v.split("/"); const next = chain.map((e, i) => (i === idx ? { providerId: parts[0], model: parts.slice(1).join("/") } : e)); setChain(next); saveRouting({ fallbackChain: next }); }}/>
      <button class="iconbtn" title="Remove" onClick=${() => { const next = chain.filter((_, i) => i !== idx); setChain(next); saveRouting({ fallbackChain: next }); }}><${Icon} name="trash" size=${15}/></button>
    </div>`)}
    <button class="btn ghost" style="margin-bottom:4px" onClick=${() => {
      const first = providers.find((p) => (p.models || []).length);
      if (!first) { toast("Add a provider first"); return; }
      const next = chain.concat({ providerId: first.id, model: (first.activeModels && first.activeModels[0]) || first.models[0] });
      setChain(next); saveRouting({ fallbackChain: next });
    }}><${Icon} name="plus" size=${14}/> Add fallback</button>
  </div>`;
}

// One provider row: header (logo, name, active/total counts) + expandable detail with the API key,
// the model CHECKMARK list (activate/deactivate per model), tier slots, and live re-discovery.
function ProviderCard({ p, open, onToggle, onPatch, onRemove, onDiscovered }) {
  const later = useAutoSave();
  const [discovering, setDiscovering] = useState(false);
  const [newModel, setNewModel] = useState("");
  const models = sortModelsByRecency(p.models || []); // newest first
  const active = p.activeModels || null; // null = all active, [] = none ("Untick all")
  const isActive = (m) => !active || active.indexOf(m) >= 0;
  const claudeNative = !p.apiKey && !p.piKey;
  function toggleModel(m) {
    const cur = active || models.slice();
    const next = isActive(m) ? cur.filter((x) => x !== m) : cur.concat(m);
    // All ticked → store nothing (= all), so newly discovered models arrive active by default.
    onPatch({ activeModels: next.length >= models.length ? undefined : next });
  }
  function addModel() {
    const m = newModel.trim();
    if (!m || models.indexOf(m) >= 0) { setNewModel(""); return; }
    onPatch({ models: models.concat(m), ...(active ? { activeModels: active.concat(m) } : {}) });
    setNewModel("");
  }
  function discover() {
    if (discovering) return;
    setDiscovering(true);
    api("/discover-models", { id: p.id }).then((r) => {
      if (r && r.ok) { toast("Discovered " + (r.models || []).length + " models"); onDiscovered(); }
      else toast((r && r.error) || "Couldn't discover models", "error");
    }).catch(() => toast("Couldn't discover models", "error")).finally(() => setDiscovering(false));
  }
  const tiers = p.tiers || {};
  const TIER_OPTS = [{ value: "", label: "(none)" }].concat(models.map((m) => ({ value: m, label: m })));
  const setTier = (t, v) => {
    const next = { ...(p.tiers || {}) };
    if (v) next[t] = { model: v }; else delete next[t];
    onPatch({ tiers: Object.keys(next).length ? next : undefined });
  };
  const activeCount = active ? active.length : models.length;
  return html`<div class="provcard">
    <button class="provcard__h" onClick=${onToggle}>
      <${ProviderLogo} name=${p.name} size=${16}/> <b>${p.name}</b>
      <span class="muted" style="font-size:11px">${activeCount}/${models.length} model${models.length === 1 ? "" : "s"} active${claudeNative ? " · subscription" : ""}</span>
      <span style="flex:1"></span>
      <${Icon} name="chevdown" size=${14} cls=${open ? "rot180" : ""}/>
    </button>
    ${open ? html`<div class="provcard__body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label>Name</label><input value=${p.name || ""} onInput=${(e) => later(() => onPatch({ name: e.target.value }))}/></div>
        ${claudeNative
          ? html`<div><label>Credential</label><div class="muted" style="font-size:12px;padding-top:9px">Claude subscription / Anthropic key (Account section)</div></div>`
          : html`<div><label>API key</label><input type="password" autocomplete="off" placeholder=${p.apiKey ? "•••••• saved — type to replace" : "paste key"} onInput=${(e) => later(() => onPatch({ apiKey: e.target.value }))}/></div>`}
      </div>
      <div class="sec" style="margin-top:14px;display:flex;align-items:center;gap:8px"><span>Models</span>
        <span class="muted" style="text-transform:none;font-weight:400;font-size:11px">tick = offered in pickers · newest first</span>
        <button class="btn ghost" style="padding:3px 10px;font-size:12px;margin-left:auto" disabled=${!activeCount} onClick=${() => onPatch({ activeModels: [] })}>Untick all</button>
        <button class="btn ghost" style="padding:3px 10px;font-size:12px" disabled=${activeCount >= models.length} onClick=${() => onPatch({ activeModels: undefined })}>Tick all</button>
        <button class="btn ghost" style="padding:3px 10px;font-size:12px" disabled=${discovering} onClick=${discover}>${discovering ? html`<${Spinner} size=${12}/> Discovering…` : html`<${Icon} name="refresh" size=${12}/> Refresh catalog`}</button>
      </div>
      <div class="provmodels">
        ${models.map((m) => html`<label key=${m} class=${"ckline provmodel" + (isActive(m) ? "" : " off")}>
          <input type="checkbox" checked=${isActive(m)} onChange=${() => toggleModel(m)}/> <span class="provmodel__id">${m}</span>
          <button class="iconbtn provmodel__del tip" data-tip="Delete from the list" onClick=${(e) => { e.preventDefault(); onPatch({ models: models.filter((x) => x !== m), ...(active ? { activeModels: active.filter((x) => x !== m) } : {}) }); }}><${Icon} name="x" size=${11}/></button>
        </label>`)}
        ${!models.length ? html`<div class="muted" style="font-size:12px;padding:4px 2px">No models yet — Refresh catalog, or add one below.</div>` : null}
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input style="flex:1" placeholder="add a model id manually…" value=${newModel} onInput=${(e) => setNewModel(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") addModel(); }}/>
        <button class="btn" onClick=${addModel}><${Icon} name="plus" size=${13}/> Add</button>
      </div>
      <div class="sec" style="margin-top:14px">Tiers <span class="muted" style="text-transform:none;font-weight:400">— High / Medium / Low slots for the per-agent picker</span></div>
      ${["high", "medium", "low"].map((t) => html`<div key=${t} style="display:grid;grid-template-columns:64px 1fr;gap:8px;align-items:center;margin-bottom:6px">
        <span style="text-transform:capitalize;font-size:13px;color:var(--ink-2)">${t}</span>
        <${Select} value=${(tiers[t] || {}).model || ""} options=${TIER_OPTS} onChange=${(v) => setTier(t, v)}/>
      </div>`)}
      <button class="btn ghost" style="margin-top:10px;color:var(--red)" onClick=${onRemove}><${Icon} name="trash" size=${14}/> Remove provider</button>
    </div>` : null}
  </div>`;
}

// Add a provider inline (no nested modal): search-pick it, paste its key. Claude credentials are
// stored as secrets; the Claude provider row then appears automatically with the full catalog.
function AddProvider({ existing, onClose, onSaved }) {
  const [pid, setPid] = useState("");
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const def = OB_PROVIDERS.find((p) => p.id === pid);
  const opts = OB_PROVIDERS.map((p) => ({ id: p.id, label: p.label, logo: p.label }));
  function save() {
    if (!def || busy) return;
    setBusy(true);
    if (def.kind === "secret") {
      if (!val.trim()) { toast("Paste the token"); setBusy(false); return; }
      api("/user-secret", { key: def.secretKey, value: val.trim() }).then(() => { toast("Saved " + def.label); onSaved(); }).catch(() => toast("Couldn't save", "error")).finally(() => setBusy(false));
      return;
    }
    if (!def.piKey || !val.trim()) { toast("Pick a provider and paste its key"); setBusy(false); return; }
    const prov = { id: def.id + "-" + Date.now().toString(36), name: def.label, piKey: def.piKey, apiKey: val.trim(), models: [] };
    api("/models", { providers: (existing || []).map(({ auth, ...r }) => r).concat(prov) }).then(() => {
      toast("Added " + prov.name + " — discovering models…");
      api("/discover-models", { id: prov.id })
        .then((r) => toast(r && r.ok ? "Discovered " + (r.models || []).length + " models" : (r && r.error) || "No models discovered", r && r.ok ? "" : "error"))
        .catch(() => toast("Couldn't discover models", "error"))
        .finally(() => { setBusy(false); onSaved(); });
    }).catch(() => { toast("Couldn't save", "error"); setBusy(false); });
  }
  return html`<div class="provcard" style="padding:12px">
    <div class="sec" style="margin-top:0">Add provider</div>
    <${ProviderSearchSelect} value=${pid} options=${opts} onChange=${(v) => { setPid(v); setVal(""); }}/>
    ${def ? html`
      <label style="margin-top:10px">${def.kind === "secret" ? "Token" : "API key"}</label>
      <div style="display:flex;gap:8px">
        <input type="password" autocomplete="off" style="flex:1" placeholder=${def.placeholder || "key"} value=${val} onInput=${(e) => setVal(e.target.value)}/>
        ${def.link ? html`<button class="btn" onClick=${() => window.open(def.link, "_blank", "noopener")}><${Icon} name="link" size=${14}/> Get key</button>` : null}
      </div>
      ${def.how ? html`<div class="muted" style="font-size:11px;margin-top:8px;white-space:pre-wrap">${def.how}</div>` : null}` : html`<div class="muted" style="font-size:12px;margin-top:8px">Search for a provider (Claude, Gemini, GLM, DeepSeek, OpenAI…).</div>`}
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn" style="flex:1;justify-content:center" onClick=${onClose}>Cancel</button>
      <button class="btn primary" style="flex:1;justify-content:center" disabled=${!def || busy} onClick=${save}>${busy ? html`<${Spinner} size=${14}/>` : "Add"}</button>
    </div>
  </div>`;
}

// ---------- GitHub ----------
function GithubSection({ secretKeys, github, reload }) {
  const [adv, setAdv] = useState(false);
  return html`<div>
    <${GitHubConnect} github=${github} reload=${reload}/>
    <button class="btn ghost" style="width:100%;justify-content:center;margin-top:12px" onClick=${() => setAdv((a) => !a)}><${Icon} name=${adv ? "chevdown" : "chevron"} size=${14}/> Advanced — paste tokens manually</button>
    ${adv ? html`<div style="margin-top:10px">
      <div class="muted" style="font-size:11.5px;margin-bottom:10px">Optional fallback to fine-grained PATs (the OAuth connection above covers both). Stored encrypted; write-only.</div>
      <div style="margin-bottom:14px"><${SecretField} field=${{ key: "github_bot_token", label: "GitHub bot token", hint: "The account the agency ACTS as — commits & pull requests." }} isSet=${secretKeys.includes("github_bot_token")} reload=${reload}/></div>
      <div><${SecretField} field=${{ key: "github_user_token", label: "Your GitHub token", hint: "Comment & open issues under YOUR name." }} isSet=${secretKeys.includes("github_user_token")} reload=${reload}/></div>
    </div>` : null}
  </div>`;
}

// One-click GitHub login via the OAuth device flow (unchanged behaviour; used by Onboarding too).
export function GitHubConnect({ github, reload }) {
  const [clientId, setClientId] = useState("");
  const [flow, setFlow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pollRef = useRef(null);
  const connected = github && github.connected;
  const user = github && github.user;
  const needClientId = github && !github.clientIdSet;
  function stop() { if (pollRef.current) clearTimeout(pollRef.current); pollRef.current = null; }
  useEffect(() => stop, []);
  function poll(interval) {
    let secs = interval || 5;
    const tick = () => api("/gh-connect-poll", {}).then((r) => {
      if (r.ok) { stop(); setFlow(null); setBusy(false); toast("GitHub connected" + (r.user ? " as @" + r.user.login : "")); reload(); return; }
      if (r.error) { stop(); setFlow(null); setBusy(false); setErr(r.error); return; }
      if (r.interval) secs = r.interval;
      pollRef.current = setTimeout(tick, secs * 1000);
    }).catch(() => { pollRef.current = setTimeout(tick, secs * 1000); });
    pollRef.current = setTimeout(tick, secs * 1000);
  }
  function connect() {
    setErr(""); setBusy(true);
    api("/gh-connect", needClientId ? { value: clientId.trim() } : {}).then((d) => {
      if (d.error) { setErr(d.error); setBusy(false); return; }
      setFlow(d);
      try { window.open(d.verification_uri, "_blank", "noopener"); } catch (e) {}
      poll(d.interval);
    }).catch((e) => { setErr((e && e.message) || "Couldn't start login"); setBusy(false); });
  }
  function disconnect() { api("/gh-disconnect", {}).then(() => { toast("Disconnected"); reload(); }); }
  if (connected) return html`<div>
    <div class="sec">GitHub</div>
    <div style="display:flex;align-items:center;gap:8px">
      <span class="statuschip s-ready"><${Icon} name="check" size=${12}/> Connected${user ? " as @" + user.login : ""}</span>
      <button class="btn ghost" style="margin-left:auto;padding:3px 10px;font-size:12px" onClick=${disconnect}>Disconnect</button>
    </div>
    <div class="muted" style="font-size:11.5px;margin-top:6px">One login runs everything — commits, PRs and issues are authored by this account. No separate bot needed.</div>
  </div>`;
  return html`<div>
    <div class="sec">GitHub</div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Connect once — replaces the bot + owner tokens. This instance uses <b>your own</b> GitHub OAuth App, so the GitHub screen shows <b>your</b> app name, not anyone else's.</div>
    ${needClientId ? html`<div class="cmdbox" style="flex-direction:column;align-items:flex-start;gap:6px;margin-bottom:10px">
      <div style="font-weight:600">First time? Create your GitHub OAuth App (≈1 min)</div>
      <div class="muted" style="font-size:11.5px">The <b>Application name</b> you pick is what users see on the Authorize screen — name it whatever you want (e.g. "Dev in a Box").</div>
      <ol style="margin:4px 0 0;padding-left:18px;font-size:12px;line-height:1.6">
        <li><a class="oblink" href="https://github.com/settings/applications/new" target="_blank" rel="noopener">Open the GitHub form <${Icon} name="link" size=${13}/></a> (register under an <b>org</b> to show a brand instead of your username)</li>
        <li>Homepage URL: this dashboard's URL. Callback URL: same (unused by device flow, but required)</li>
        <li>Create it, then on the app page tick <b>"Enable Device Flow"</b> and Save</li>
        <li>Copy the <b>Client ID</b> and paste it below</li>
      </ol>
    </div>
    <label>OAuth App client ID</label>
      <input placeholder="Iv1.… or Ov23… (your own GitHub OAuth App)" value=${clientId} onInput=${(e) => setClientId(e.target.value)}/>` : null}
    ${flow ? html`<div class="cmdbox" style="flex-direction:column;align-items:flex-start;gap:6px">
      <div>1 · Open <a href=${flow.verification_uri} target="_blank" rel="noopener">${flow.verification_uri}</a></div>
      <div>2 · Enter code <code style="font-size:16px;letter-spacing:2px">${flow.user_code}</code></div>
      <div class="muted" style="font-size:11px;display:flex;align-items:center;gap:6px"><${Spinner} size=${12}/> waiting for you to authorize…</div>
    </div>` : html`<button class="btn primary" style="width:100%;justify-content:center" disabled=${busy || (needClientId && !clientId.trim())} onClick=${connect}>${busy ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="link" size=${15}/>`} Connect GitHub</button>`}
    ${err ? html`<div class="testres bad" style="margin-top:6px">✗ ${err}</div>` : null}
  </div>`;
}

// ---------- Environments (language toolchains) ----------
// Install SDKs (Flutter, Rust…) persistently so agents can verify those app types in-agency. Agents
// that hit a missing toolchain pause their issue and raise a request that shows up here.
function EnvironmentsSection({ admin }) {
  const [tc, setTc] = useState(null);
  const [busy, setBusy] = useState({});
  const [live, setLive] = useState({}); // id -> { pct, phase, log:[] } from the SSE stream
  const load = () => getJSON("/toolchains").then((d) => {
    setTc(d);
    // Seed the bar from the snapshot so opening the tab mid-install shows progress at once.
    setLive((prev) => {
      const next = { ...prev };
      (d.toolchains || []).forEach((t) => { if (t.progress && !next[t.id]) next[t.id] = { pct: t.progress.pct, phase: t.progress.phase, log: t.progress.log || [] }; });
      return next;
    });
  }).catch(() => setTc({ toolchains: [], dir: "" }));
  useEffect(() => { load(); }, []);
  // Live install stream: progress %, log lines, and the terminal status (→ reload for version).
  useEffect(() => {
    let es;
    try {
      es = new EventSource("/toolchain-events");
      es.onmessage = (ev) => {
        try {
          const e = JSON.parse(ev.data);
          if (!e || !e.id) return;
          if (e.kind === "progress") setLive((p) => ({ ...p, [e.id]: { ...(p[e.id] || { log: [] }), pct: e.pct, phase: e.phase } }));
          else if (e.kind === "log") setLive((p) => { const cur = p[e.id] || { pct: 0, phase: "", log: [] }; return { ...p, [e.id]: { ...cur, log: cur.log.concat(e.line).slice(-120) } }; });
          else if (e.kind === "status" && (e.status === "ready" || e.status === "failed")) { if (e.status === "ready") toast(e.id + " installed"); load(); }
        } catch (err) {}
      };
    } catch (err) {}
    return () => { try { es && es.close(); } catch (err) {} };
  }, []);
  const install = (id) => {
    setBusy((b) => ({ ...b, [id]: true }));
    setLive((p) => ({ ...p, [id]: { pct: 0, phase: "Starting…", log: [] } }));
    api("/install-toolchain", { id })
      .then(() => toast("Installing " + id + "…"))
      .then(load)
      .catch(failed)
      .finally(() => setBusy((b) => ({ ...b, [id]: false })));
  };
  if (!tc) return html`<div class="muted" style="display:flex;align-items:center;gap:6px"><${Spinner} size=${12}/> Loading…</div>`;
  return html`<div>
    <div class="sec">Toolchains</div>
    <div class="muted" style="font-size:12px;margin-bottom:12px">Install language SDKs so agents can run checks for these app types in-agency. When a run needs one that isn't here, it pauses the issue and asks — no PR until the checks actually run. Installed to <code>${tc.dir}</code>; point <code>TOOLCHAINS_DIR</code> at a mounted volume to survive redeploys.</div>
    ${(tc.toolchains || []).map((t) => TcRow({ t, admin, busy: busy[t.id], live: live[t.id], onInstall: () => install(t.id) }))}
    ${!admin ? html`<div class="muted" style="font-size:12px;margin-top:10px">Only an admin can install toolchains.</div>` : null}
  </div>`;
}
function TcRow({ t, admin, busy, live, onInstall }) {
  const ready = t.status === "ready", installing = t.status === "installing", failed = t.status === "failed";
  const prog = installing ? (live || t.progress) : null;
  const chip = ready
    ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> ready</span>`
    : installing
    ? html`<span class="statuschip" style="display:inline-flex;align-items:center;gap:5px"><${Spinner} size=${12}/> installing…</span>`
    : failed
    ? html`<span class="statuschip s-changes"><${Icon} name="alert" size=${12}/> failed</span>`
    : html`<span class="statuschip s-attn">not installed</span>`;
  const reqs = t.requestedBy || [];
  return html`<div key=${t.id} style="display:flex;align-items:flex-start;gap:10px;padding:11px 0;border-top:1px solid var(--line,rgba(128,128,128,.18))">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;font-weight:600">${t.label} ${chip}</div>
      <div class="muted" style="font-size:12px;margin-top:2px">${t.note}</div>
      ${ready && t.version ? html`<div class="muted" style="font-size:11px;margin-top:2px">${t.version}</div>` : null}
      ${failed && t.error ? html`<div style="font-size:11px;margin-top:3px;color:var(--bad,#c33)">${t.error}</div>` : null}
      ${reqs.length ? html`<div style="font-size:11.5px;margin-top:5px">⏸ Requested by ${reqs.map((r) => (r.repo.split("/").pop()) + " #" + r.number).join(", ")}</div>` : null}
      ${prog ? html`<div style="margin-top:8px">
        <div class="muted" style="display:flex;justify-content:space-between;font-size:11px"><span>${prog.phase || "Working…"}</span><span>${prog.pct || 0}%</span></div>
        <div style="height:5px;border-radius:3px;background:var(--line,rgba(128,128,128,.2));overflow:hidden;margin-top:3px"><div style=${"height:100%;width:" + (prog.pct || 0) + "%;background:var(--accent,#3b82f6);transition:width .3s"}></div></div>
        ${prog.log && prog.log.length ? html`<pre style="margin:6px 0 0;max-height:110px;overflow:auto;font-size:10.5px;line-height:1.45;background:var(--code-bg,rgba(128,128,128,.08));border-radius:5px;padding:6px 8px;white-space:pre-wrap;word-break:break-all">${prog.log.slice(-8).join("\n")}</pre>` : null}
      </div>` : null}
    </div>
    ${admin ? html`<button class=${"btn" + (ready ? " ghost" : " primary")} style="padding:4px 12px;font-size:12px;white-space:nowrap" disabled=${busy || installing} onClick=${onInstall}>${installing ? "Installing…" : ready ? "Reinstall" : reqs.length ? "Install now" : "Install"}</button>` : null}
  </div>`;
}

// ---------- Team (admin) ----------
function TeamSection({ users, webhookSecretSet, reload }) {
  const later = useAutoSave();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState("");
  function invite() { api("/invite-create", { email: email || null, role }).then((d) => { setLink(d.url || ""); setEmail(""); toast("Invite link created"); reload(); }).catch(() => toast("Couldn't create invite")); }
  return html`<div>
    <div class="sec">Team</div>
    ${users.map((u) => html`<div key=${u.id} style="display:flex;gap:8px;align-items:center;margin:4px 2px"><span style="flex:1">${u.username}</span><span class="muted" style="font-size:12px">${u.role}</span>
      <button class="btn ghost" style="padding:3px 8px;font-size:12px" onClick=${() => { const np = window.prompt("New password for " + u.username + " (8+ chars)"); if (np == null) return; if (np.length < 8) { toast("8+ characters"); return; } api("/set-password", { value: np, number: u.id }).then(() => toast("Reset " + u.username)).catch(() => toast("Couldn't reset")); }}><${Icon} name="lock" size=${13}/></button></div>`)}
    <label style="margin-top:10px">Invite a teammate</label>
    <div style="display:flex;gap:8px">
      <input placeholder="email (optional)" value=${email} onInput=${(e) => setEmail(e.target.value)}/>
      <select value=${role} onChange=${(e) => setRole(e.target.value)} style="width:auto"><option value="member">member</option><option value="admin">admin</option></select>
      <button class="btn" onClick=${invite}>Create</button>
    </div>
    ${link ? html`<div class="cmdbox"><code>${link}</code><button class="btn" onClick=${() => { if (navigator.clipboard) navigator.clipboard.writeText(link); toast("Copied"); }}>Copy</button></div>` : null}
    <label style="margin-top:14px">GitHub webhook secret ${webhookSecretSet ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> set</span>` : null}</label>
    <div class="muted" style="font-size:11px;margin:0 2px 4px">Only if you use GitHub push webhooks. Stored encrypted; saves as you type.</div>
    <input type="password" autocomplete="off" placeholder=${webhookSecretSet ? "•••••• saved — type to replace" : "secret"} onInput=${(e) => { const v = e.target.value; later(() => { if (v.trim()) api("/settings", { webhookSecret: v.trim() }).then(saved).then(reload).catch(failed); }); }}/>
  </div>`;
}

// ---------- Account ----------
function AccountSection({ data, reload, onClose }) {
  function changePw() { const np = window.prompt("New password (8+ characters)"); if (np == null) return; if (np.length < 8) { toast("8+ characters"); return; } api("/set-password", { value: np }).then(() => toast("Password changed")).catch((e) => toast((e && e.message) || "Couldn't change", "error")); }
  return html`<div>
    <div class="sec">Account</div>
    ${data.user ? html`<div class="muted" style="margin-bottom:8px">Signed in as <b>${data.user.username}</b> · ${data.user.role}</div>` : null}
    <div style="display:flex;gap:8px">
      <button class="btn ghost" style="flex:1;justify-content:center" onClick=${changePw}><${Icon} name="lock" size=${15}/> Change password</button>
      <a class="btn ghost" href="/logout" style="flex:1;justify-content:center"><${Icon} name="arrowleft" size=${15}/> Sign out</a>
    </div>
    <div class="sec" style="margin-top:18px">Setup</div>
    <div class="muted" style="font-size:12px;margin-bottom:7px">Re-run the guided walkthrough to add or update tokens, models, and repos.</div>
    <button class="btn" style="width:100%;justify-content:center" onClick=${() => api("/onboarded", { value: "0" }).then(() => { onClose(); reload(); })}><${Icon} name="play" size=${15}/> Run the setup wizard</button>
  </div>`;
}
