// Dev Agency dashboard — settings module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Icon, Modal, ModelSelect, ProviderLogo, Select, Sheet, Spinner, agentOptions, api, getJSON, md, providerModelOptions, toast } from "./core.js";
import { OB_PROVIDERS } from "./onboarding.js";


// ---------- Settings ----------
export function Settings({ data, onClose, reload, openGithubTokens, openModels, openAgents, openWorkflows }) {
  const cfg = data.config || {};
  const admin = Boolean(data.user && data.user.role === "admin");
  const [maxTok, setMaxTok] = useState(cfg.maxTokensPerRun || 600000);
  const [avatarsOn, setAvatarsOn] = useState(cfg.avatars !== "off");
  const [selfImprove, setSelfImprove] = useState((data.ops || {}).self_improve != null ? !!(data.ops || {}).self_improve : true);
  const [runner, setRunner] = useState(cfg.agentRunner || "claude-sdk");
  const [cliCmd, setCliCmd] = useState(cfg.agentCliCommand || "");
  const [newDefault, setNewDefault] = useState(cfg.newIssueDefault || "@dev");
  function save() { api("/settings", { maxTokensPerRun: Number(maxTok) || 0, avatars: avatarsOn ? "on" : "off", agentRunner: runner, agentCliCommand: cliCmd, newIssueDefault: newDefault, ...(admin ? { ops: { self_improve: selfImprove } } : {}) }).then(() => { toast("Saved"); onClose(); reload(); }); }
  function changePw() { const np = window.prompt("New password (8+ characters)"); if (np == null) return; if (np.length < 8) { toast("8+ characters"); return; } api("/set-password", { value: np }).then(() => toast("Password changed")).catch((e) => toast((e && e.message) || "Couldn’t change", "error")); }
  return html`<${Sheet} title="Settings" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button>`}>

    ${data.user ? html`
      <div class="setgrp">
        <div class="sec">Connections</div>
        <div style="display:flex;gap:8px">
          <button class="btn" style="flex:1;justify-content:center" onClick=${openGithubTokens}><${Icon} name="link" size=${15}/> GitHub</button>
          <button class="btn" style="flex:1;justify-content:center" onClick=${openModels}><${Icon} name="flask" size=${15}/> Models & API keys</button>
        </div>
      </div>

      <div class="setgrp">
        <div class="sec">Agents & workflows</div>
        <div class="muted" style="font-size:12px;margin-bottom:8px"><b>Agents</b> are the roles (planner, developer, reviewer…). <b>Workflows</b> arrange agents into a pipeline with their own instructions.</div>
        <div style="display:flex;gap:8px">
          <button class="btn" style="flex:1;justify-content:center" onClick=${openAgents}><${Icon} name="users" size=${15}/> Edit agents</button>
          <button class="btn" style="flex:1;justify-content:center" onClick=${openWorkflows}><${Icon} name="layers" size=${15}/> Workflows</button>
        </div>
      </div>
    ` : null}

    <div class="setgrp">
      <div class="sec">Appearance</div>
      <label class="ckline"><input type="checkbox" checked=${avatarsOn} onChange=${(e) => setAvatarsOn(e.target.checked)}/> Show agent avatars (cards & comments)</label>
    </div>

    <div class="setgrp">
      <div class="sec">Run defaults</div>
      <div class="muted" style="font-size:12px;margin-bottom:6px">Pipeline steps & revise rounds are now set per workflow in the builder. GitNexus indexing is always on.</div>
      <label>New-issue default</label>
      <div class="muted" style="font-size:12px;margin-bottom:4px">What a new issue is assigned to when you open the composer.</div>
      <${Select} value=${newDefault} options=${agentOptions(data && data.agentDefs, data && data.workflows)} onChange=${setNewDefault}/>
      <label style="margin-top:8px">Max tokens per run (0 = off)</label><input type="number" min="0" step="50000" value=${maxTok} onInput=${(e) => setMaxTok(e.target.value)}/>
      <${RunnerPicker} runner=${runner} setRunner=${setRunner} cliCmd=${cliCmd} setCliCmd=${setCliCmd} admin=${admin}/>
    </div>

    ${admin ? html`<div class="setgrp">
      <div class="sec">Automation</div>
      <label class="ckline"><input type="checkbox" checked=${selfImprove} onChange=${(e) => setSelfImprove(e.target.checked)}/> Allow self-improvement PRs</label>
    </div>` : null}

    ${data.user ? html`
      <div class="setgrp">
        <div class="sec">Setup</div>
        <div class="muted" style="font-size:12px;margin-bottom:7px">Re-run the guided walkthrough to add or update tokens, models, and repos.</div>
        <button class="btn" style="width:100%;justify-content:center" onClick=${() => api("/onboarded", { value: "0" }).then(() => { onClose(); reload(); })}><${Icon} name="play" size=${15}/> Run the setup wizard</button>
      </div>
      ${admin ? html`<div class="setgrp"><${Admin} users=${data.users || []} invites=${data.invites || []} webhookSecretSet=${data.webhookSecretSet} reload=${reload}/></div>` : null}

      <div class="setgrp">
        <div class="sec">Account</div>
        <div class="muted" style="margin-bottom:8px">Signed in as <b>${data.user.username}</b> · ${data.user.role}</div>
        <div style="display:flex;gap:8px">
          <button class="btn ghost" style="flex:1;justify-content:center" onClick=${changePw}><${Icon} name="lock" size=${15}/> Change password</button>
          <a class="btn ghost" href="/logout" style="flex:1;justify-content:center"><${Icon} name="arrowleft" size=${15}/> Sign out</a>
        </div>
      </div>
    ` : null}
  <//>`;
}
/**
 * Inline models panel: global default model + auto-switch toggle + fallback chain.
 * Controlled by ModelsModal (which owns the state + the Save button in the footer).
 * Per-agent model assignment lives in the Agents/Workflow editor, NOT here.
 */
function ModelsPanel({ providers, globalModel, setGlobalModel, autoSwitch, setAutoSwitch, chain, setChain, onOpenModels }) {
  const modelOpts = providerModelOptions(providers, { short: true });
  const firstOpt = modelOpts[0] ? { providerId: modelOpts[0].value.split("/")[0], model: modelOpts[0].value.split("/").slice(1).join("/") } : null;
  function addFallback() {
    if (!modelOpts.length) { toast("Add a provider first"); return; }
    setChain((c) => c.concat(firstOpt));
  }
  function removeFallback(idx) { setChain((c) => c.filter((_, i) => i !== idx)); }
  function setFallbackEntry(idx, opt) {
    if (!opt) return;
    const parts = opt.split("/");
    setChain((c) => c.map((e, i) => i === idx ? { providerId: parts[0], model: parts.slice(1).join("/") } : e));
  }
  // Global Default label is provider-neutral — only mentions a backend when one is actually set up.
  const globalDefaultLabel = (globalModel && globalModel.model) ? "Default (role defaults)" : "Default (set up a provider first)";
  return html`<div class="sec">Global default & rate limit</div>
    <label style="margin-top:6px;display:block">Global Default Model</label>
    <div style="margin-bottom:12px"><${ModelSelect} providers=${providers} value=${globalModel} includeDefault=${true} defaultLabel=${globalDefaultLabel} defaultIcon="flask" defaultHint=${undefined} emit="object" onSetUp=${onOpenModels} onChange=${(v) => setGlobalModel(v)}/></div>

    <label class="ckline"><input type="checkbox" checked=${autoSwitch} onChange=${(e) => setAutoSwitch(e.target.checked)}/> Auto-switch to fallback model on usage limit</label>
    <div class="muted" style="font-size:12px;margin:3px 2px 7px">When enabled, hitting the primary model's rate/usage limit switches all unassigned roles to the first fallback below and retries — instead of stalling.</div>
    <label>Fallback chain (order of models to try when the primary is rate-limited)</label>
    ${chain.map((entry, idx) => html`<div key=${idx} style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
      <${ModelSelect} providers=${providers} value=${entry} onSetUp=${onOpenModels} onChange=${(v) => setFallbackEntry(idx, v)}/>
      <button class="iconbtn" title="Remove" onClick=${() => removeFallback(idx)}><${Icon} name="trash" size=${15}/></button>
    </div>`)}
    ${modelOpts.length ? html`<button class="btn ghost" style="margin-bottom:4px" onClick=${addFallback}><${Icon} name="plus" size=${14}/> Add fallback</button>` : html`<div class="muted" style="font-size:12px">No alternative providers configured — add one above first.</div>`}`;
}
function Operations({ meta, values, reload }) {
  const [vals, setVals] = useState(() => Object.assign({}, values));
  const set = (k, v) => setVals((o) => Object.assign({}, o, { [k]: v }));
  function save() { api("/settings", { ops: vals }).then(() => { toast("Operations saved"); reload(); }).catch(() => toast("Couldn’t save")); }
  const visibleMeta = meta.filter(m => m.key === "self_improve");
  if (!visibleMeta.length) return null;
  return html`<div class="sec">Automation</div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Let the agency open PRs that improve its own codebase.</div>
    ${visibleMeta.map((m) => html`<div key=${m.key}>
      ${m.type === "bool"
        ? html`<label class="ckline"><input type="checkbox" checked=${!!vals[m.key]} onChange=${(e) => set(m.key, e.target.checked)}/> ${m.label}</label>`
        : html`<label>${m.label}</label>${m.type === "select"
          ? html`<select value=${vals[m.key]} onChange=${(e) => set(m.key, e.target.value)}>${(m.options || []).map((o) => html`<option key=${o} value=${o}>${o}</option>`)}</select>`
          : m.type === "num"
          ? html`<input type="number" value=${vals[m.key]} onInput=${(e) => set(m.key, Number(e.target.value))}/>`
          : html`<input value=${vals[m.key]} onInput=${(e) => set(m.key, e.target.value)}/>`}`}
    </div>`)}
    <button class="btn primary" style="margin-top:12px" onClick=${save}>Save operations</button>`;
}

// ---------- per-user credentials (write-only, encrypted server-side) ----------
export function GithubTokensModal({ secretKeys, github, onClose, reload }) {
  const [adv, setAdv] = useState(false);
  return html`<${Sheet} title="GitHub" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <${GitHubConnect} github=${github} reload=${reload}/>
    <button class="btn ghost" style="width:100%;justify-content:center;margin-top:10px" onClick=${() => setAdv((a) => !a)}><${Icon} name=${adv ? "chevdown" : "chevron"} size=${14}/> Advanced — paste tokens manually</button>
    ${adv ? html`<div style="margin-top:10px">
      <div class="muted" style="font-size:11.5px;margin-bottom:10px">Optional fallback to fine-grained PATs (the OAuth connection above covers both). Stored encrypted; write-only.</div>
      <div style="margin-bottom:14px"><${SecretField} field=${{ key: "github_bot_token", label: "GitHub bot token", hint: "The account the agency ACTS as — commits & pull requests." }} isSet=${secretKeys.includes("github_bot_token")} reload=${reload}/></div>
      <div><${SecretField} field=${{ key: "github_user_token", label: "Your GitHub token", hint: "Comment & open issues under YOUR name." }} isSet=${secretKeys.includes("github_user_token")} reload=${reload}/></div>
    </div>` : null}
  <//>`;
}

// One-click GitHub login via the OAuth device flow: click → authorize on github.com → done. The
// single token is both the bot and the owner (commits attributed to the connected account), so
// there's no separate bot to invite. The client ID is public; the device flow needs no secret.
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
    }).catch((e) => { setErr((e && e.message) || "Couldn’t start login"); setBusy(false); });
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
    <div class="muted" style="font-size:12px;margin-bottom:8px">Connect once — replaces the bot + owner tokens. This instance uses <b>your own</b> GitHub OAuth App, so the GitHub screen shows <b>your</b> app name, not anyone else’s.</div>
    ${needClientId ? html`<div class="cmdbox" style="flex-direction:column;align-items:flex-start;gap:6px;margin-bottom:10px">
      <div style="font-weight:600">First time? Create your GitHub OAuth App (≈1 min)</div>
      <div class="muted" style="font-size:11.5px">The <b>Application name</b> you pick is what users see on the Authorize screen — name it whatever you want (e.g. “Dev in a Box”).</div>
      <ol style="margin:4px 0 0;padding-left:18px;font-size:12px;line-height:1.6">
        <li><a class="oblink" href="https://github.com/settings/applications/new" target="_blank" rel="noopener">Open the GitHub form <${Icon} name="link" size=${13}/></a> (register under an <b>org</b> to show a brand instead of your username)</li>
        <li>Homepage URL: this dashboard’s URL. Callback URL: same (unused by device flow, but required)</li>
        <li>Create it, then on the app page tick <b>“Enable Device Flow”</b> and Save</li>
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

export function ModelsModal({ onClose, reload }) {
  const [providers, setProvidersState] = useState([]);
  const [secretKeys, setSecretKeys] = useState([]);
  const [status, setStatus] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // the provider being edited in the full editor
  // Model-routing settings owned here (so the Save button can live in the footer). Fetched from /models.
  const [autoSwitch, setAutoSwitch] = useState(false);
  const [chain, setChain] = useState([]); // [{providerId, model}]
  const [globalModel, setGlobalModel] = useState(null); // {providerId, model} | null
  const [busy, setBusy] = useState(false);
  function refresh() {
    getJSON("/models").then((d) => {
      setProvidersState(d.providers || []);
      setAutoSwitch(d.autoSwitchOnLimit || false);
      setChain(d.fallbackChain || []);
      setGlobalModel(d.globalModel || null);
    }).catch(() => {});
    getJSON("/data").then((d) => setSecretKeys(d.secretKeys || [])).catch(() => {});
    getJSON("/runner-status").then(setStatus).catch(() => {});
  }
  useEffect(refresh, []);
  function saveProviders(list) { return api("/models", { providers: list }).then(() => { reload(); refresh(); }).catch(() => toast("Couldn’t save", "error")); }
  function saveSettings() {
    setBusy(true);
    api("/models", { fallbackChain: chain, autoSwitchOnLimit: autoSwitch, globalModel })
      .then(() => toast("Saved")).catch(() => toast("Couldn't save")).then(() => setBusy(false));
  }
  function removeProvider(id, name) { if (window.confirm("Remove " + name + "?")) saveProviders(providers.filter((p) => p.id !== id)); }
  function clearSecret(key, name) { if (window.confirm("Remove " + name + "?")) api("/user-secret", { key, value: "" }).then(() => { toast("Removed"); reload(); refresh(); }); }
  // Dedupe: a Claude-native provider (no key, no/anthropic base URL) IS the subscription secret below.
  const isClaudeNative = (p) => !p.apiKey && (!p.baseUrl || /anthropic\.com/i.test(p.baseUrl));
  const thirdParty = providers.filter((p) => !isClaudeNative(p));
  const claudeSub = secretKeys.includes("claude_token"), claudeApi = secretKeys.includes("anthropic_api_key");
  const empty = !thirdParty.length && !claudeSub && !claudeApi;
  const claudeRow = (label, key) => html`<div class="modelrow"><div class="modelrow-main"><${ProviderLogo} name="claude" size=${16}/> <b>Claude</b> <span class="muted" style="font-size:11px">${label}</span></div>
    <button class="iconbtn tip" data-tip="Remove" style="width:30px;height:30px;border:none" onClick=${() => clearSecret(key, "Claude " + label)}><${Icon} name="trash" size=${15}/></button></div>`;
  const footer = html`<button class="btn" onClick=${onClose}>Close</button><button class="btn primary" disabled=${busy} onClick=${saveSettings}>${busy ? html`<${Spinner} size=${14}/> Saving…` : "Save settings"}</button>`;
  return html`<${Modal} title="Models & runners" onClose=${onClose} footer=${footer}>
    <div class="muted" style="font-size:12px;margin-bottom:10px">Providers you’ve added. The runner is auto-resolved (Claude-native for Claude, pi for everything else) — <b>Edit</b> opens the full config (key, URL, models, tiers).</div>
    ${claudeSub ? claudeRow("subscription", "claude_token") : null}
    ${claudeApi ? claudeRow("API key", "anthropic_api_key") : null}
    ${thirdParty.map((p) => html`<div class="modelrow" key=${p.id}>
      <div class="modelrow-main"><${ProviderLogo} name=${p.name} size=${16}/> <b>${p.name}</b> <span class="muted" style="font-size:11px">${(p.models || []).length} model${(p.models || []).length === 1 ? "" : "s"}</span></div>
      <button class="da-iconbtn da-iconbtn--sm tip" data-tip="Edit provider" onClick=${() => setEditing(p)}><${Icon} name="pencil" size=${14}/></button>
      <button class="iconbtn tip" data-tip="Remove" style="width:30px;height:30px;border:none" onClick=${() => removeProvider(p.id, p.name)}><${Icon} name="trash" size=${15}/></button>
    </div>`)}
    ${empty ? html`<div class="muted" style="font-size:12.5px;padding:10px 2px">No models added yet — add one below.</div>` : null}
    <button class="btn primary" style="width:100%;justify-content:center;margin:14px 0 6px" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15}/> Add provider</button>
    <${ModelsPanel} providers=${providers} globalModel=${globalModel} setGlobalModel=${setGlobalModel} autoSwitch=${autoSwitch} setAutoSwitch=${setAutoSwitch} chain=${chain} setChain=${setChain} onOpenModels=${() => setAdding(true)}/>
    ${adding ? html`<${AddProvider} existing=${providers} onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); refresh(); reload(); }}/>` : null}
    ${editing ? html`<${ProviderEditor} provider=${editing} all=${providers} onClose=${() => setEditing(null)} onSave=${(list) => { setEditing(null); saveProviders(list); }}/>` : null}
  <//>`;
}

// Full per-provider editor: name, baseUrl, apiKey, models list, High/Medium/Low tiers (+ each tier's
// fallback), runner, piProvider, cliCommand. The whole Provider row round-trips through /models
// (setProviders stores it wholesale), so a Save here just rewrites the provider in the list.
function ProviderEditor({ provider, all, onClose, onSave }) {
  const [f, setF] = useState(() => ({ ...provider }));
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState("");
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  // tiers = { high:{model}, medium:{model}, low:{model} } — model-only slots the per-agent picker
  // uses. The runner / pi-provider / cliCommand are auto-resolved (pi is the only non-Claude path),
  // so they're not exposed here.
  const tiers = f.tiers || {};
  const setTierModel = (tier, v) => setF((o) => {
    const next = { ...(o.tiers || {}) };
    if (v) next[tier] = { model: v }; else delete next[tier];
    return { ...o, tiers: Object.keys(next).length ? next : undefined };
  });
  const modelList = (f.models || []);
  const TIER_OPTS = [{ value: "", label: "(none)" }].concat(modelList.map((m) => ({ value: m, label: m })));
  function cleanedForm() {
    // Drop empty tiers entirely so we don't persist {model:""} noise.
    const cleanTiers = {};
    for (const t of ["high", "medium", "low"]) { const s = (f.tiers || {})[t]; if (s && s.model) cleanTiers[t] = { model: s.model }; }
    return { ...f, models: modelList.filter(Boolean), tiers: Object.keys(cleanTiers).length ? cleanTiers : undefined };
  }
  function save() {
    onSave(all.map((p) => (p.id === provider.id ? cleanedForm() : p)));
  }
  // Save the current form, then run live model discovery against the saved provider and pull the
  // refreshed models back into the form. Shows where the list came from (live/pi) or the error.
  function refreshModels() {
    if (discovering) return;
    if (!f.baseUrl || !f.apiKey) { setDiscoverMsg("Enter a base URL + API key first."); return; }
    setDiscovering(true); setDiscoverMsg("Saving & discovering…");
    const cleaned = cleanedForm();
    api("/models", { providers: all.map((p) => (p.id === provider.id ? cleaned : p)) }).then(() =>
      api("/discover-models", { id: provider.id }),
    ).then((r) => {
      if (r && r.ok) {
        setF((o) => ({ ...o, models: r.models || [] }));
        setDiscoverMsg("Discovered " + (r.models || []).length + " models (via " + r.via + ").");
      } else {
        setDiscoverMsg(r && r.error ? "Couldn't discover: " + r.error : "No models discovered.");
      }
    }).catch(() => setDiscoverMsg("Couldn't discover models.")).then(() => setDiscovering(false));
  }
  return html`<${Modal} title=${"Edit " + (provider.name || "provider")} size="lg" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button>`}>
    <div><label>Name</label><input value=${f.name || ""} onInput=${(e) => set("name", e.target.value)}/></div>
    <div style="margin-top:10px"><label>Base URL <span class="muted" style="font-weight:400">(Anthropic-compatible endpoint)</span></label><input value=${f.baseUrl || ""} placeholder="https://open.bigmodel.cn/api/anthropic" onInput=${(e) => set("baseUrl", e.target.value)}/></div>
    <div style="margin-top:10px"><label>API key</label><input type="password" autocomplete="off" value=${f.apiKey || ""} placeholder=${f.apiKey ? "•••••• saved — type to replace" : "paste key"} onInput=${(e) => set("apiKey", e.target.value)}/></div>

    <div class="sec" style="margin-top:16px;display:flex;align-items:center;gap:8px"><span>Models</span>
      <button class="btn ghost" style="padding:3px 10px;font-size:12px;margin-left:auto" disabled=${discovering} onClick=${refreshModels}>${discovering ? html`<${Spinner} size=${12}/> Discovering…` : html`<${Icon} name="refresh" size=${12}/> Refresh from provider`}</button>
    </div>
    <div class="muted" style="font-size:11px;margin:0 0 6px">Discovered live via <code>pi --list-models</code>. Editable below — one id per line.</div>
    ${discoverMsg ? html`<div class=${"testres " + (/discovered/i.test(discoverMsg) ? "good" : "bad")} style="margin-bottom:6px">${discoverMsg}</div>` : null}
    <textarea style="min-height:80px;font-family:inherit" value=${modelList.join("\n")} onInput=${(e) => set("models", e.target.value.split("\n"))}></textarea>

    <div class="sec" style="margin-top:16px">Tiers <span class="muted" style="text-transform:none;font-weight:400">— the High / Medium / Low model slots the per-agent picker offers</span></div>
    ${["high", "medium", "low"].map((t) => html`<div key=${t} style="display:grid;grid-template-columns:64px 1fr;gap:8px;align-items:end;margin-bottom:6px">
      <span style="text-transform:capitalize;font-size:13px;color:var(--ink-2);padding-bottom:9px">${t}</span>
      <div><label style="margin:0 2px 3px">model</label><${Select} value=${(tiers[t] || {}).model || ""} options=${TIER_OPTS} onChange=${(v) => setTierModel(t, v)}/></div>
    </div>`)}
  <//>`;
}

// Add a provider: pick it first (logo dropdown), then paste its key — with a single "Get key" button
// that opens the right page. Runs on the SDK by default (best for Anthropic-compatible providers);
// change the per-provider CLI later in the list. Claude subscription/API are stored as secrets.
function AddProvider({ existing, onClose, onSaved }) {
  const [pid, setPid] = useState(OB_PROVIDERS[0].id);
  const [val, setVal] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const def = OB_PROVIDERS.find((p) => p.id === pid);
  const opts = OB_PROVIDERS.map((p) => ({ value: p.id, label: p.label, logo: p.preset && p.preset.name ? p.preset.name : p.label }));
  function save() {
    if (!def) return;
    if (def.kind === "secret") {
      if (!val.trim()) { toast("Paste the token"); return; }
      api("/user-secret", { key: def.secretKey, value: val.trim() }).then(() => { toast("Saved " + def.label); onSaved(); }).catch(() => toast("Couldn’t save", "error"));
      return;
    }
    if (def.custom && !baseUrl.trim()) { toast("Enter the base URL"); return; }
    if (!val.trim()) { toast("Paste the API key"); return; }
    const prov = { id: def.id + "-" + Date.now().toString(36), name: def.preset && def.preset.name ? def.preset.name : "Custom", baseUrl: def.custom ? baseUrl.trim() : def.preset.baseUrl, apiKey: val.trim(), models: [] };
    api("/models", { providers: (existing || []).concat(prov) }).then(() => {
      toast("Added " + prov.name + " — discovering models…");
      // Live discovery: fetch the provider's /v1/models (or pi --list-models) and persist the list.
      api("/discover-models", { id: prov.id })
        .then((r) => { toast(r && r.ok ? "Discovered " + (r.models || []).length + " models (via " + r.via + ")" : (r && r.error ? "Couldn't discover models: " + r.error : "No models discovered"), r && r.ok ? "" : "error"); })
        .catch(() => toast("Couldn't discover models", "error"))
        .then(onSaved);
    }).catch(() => toast("Couldn’t save", "error"));
  }
  return html`<${Modal} title="Add provider" size="sm" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Add</button>`}>
    <label>Provider</label>
    <${Select} value=${pid} options=${opts} onChange=${(v) => { setPid(v); setVal(""); setBaseUrl(""); }}/>
    ${def && def.custom ? html`<label style="margin-top:10px">Base URL (Anthropic-compatible)</label><input placeholder="https://…/anthropic" value=${baseUrl} onInput=${(e) => setBaseUrl(e.target.value)}/>` : null}
    <label style="margin-top:10px">${def && def.kind === "secret" ? "Token" : "API key"}</label>
    <div style="display:flex;gap:8px">
      <input type="password" autocomplete="off" style="flex:1" placeholder=${def ? def.placeholder : "key"} value=${val} onInput=${(e) => setVal(e.target.value)}/>
      ${def && def.link ? html`<button class="btn" onClick=${() => window.open(def.link, "_blank", "noopener")}><${Icon} name="link" size=${14}/> Get key</button>` : null}
    </div>
    <div class="muted" style="font-size:11px;margin-top:8px">Runs on the built-in SDK by default — change the CLI per provider in the list after adding.</div>
  <//>`;
}

function RunnerPicker({ runner, setRunner, cliCmd, setCliCmd, admin }) {
  const [status, setStatus] = useState(null);
  const [installing, setInstalling] = useState("");
  const [pkg, setPkg] = useState("");
  const [log, setLog] = useState("");
  function refresh() { getJSON("/runner-status").then(setStatus).catch(() => {}); }
  useEffect(refresh, []);
  const byKind = {}; (status && status.runners || []).forEach((r) => (byKind[r.kind] = r));
  const sel = byKind[runner];
  function doInstall(kind, value) {
    setInstalling(kind); setLog("");
    api("/install-cli", { kind, value }).then((r) => {
      setLog(r.log || "");
      toast(r.available ? "Installed " + (r.pkg || kind) : "Install ran but the binary still isn't found", r.available ? "info" : "error");
      refresh();
    }).catch((e) => toast((e && e.message) || "Install failed", "error")).finally(() => setInstalling(""));
  }
  return html`
    <label>Agent runner — how roles execute</label>
    <${Select} value=${runner} onChange=${setRunner} options=${[
      { value: "claude-sdk", label: "Claude SDK (default — in-process)" },
      { value: "pi-cli", label: "pi CLI (subprocess)" },
      { value: "claude-cli", label: "claude CLI (subprocess)" },
      { value: "custom-cli", label: "Custom CLI" },
    ]}/>
    ${sel && sel.binary ? html`<div style="display:flex;align-items:center;gap:8px;margin:7px 2px;flex-wrap:wrap">
      ${sel.available
        ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> ${sel.binary} installed</span>`
        : html`<span class="statuschip s-attn"><${Icon} name="alert" size=${12}/> ${sel.binary} not installed</span>
            ${admin ? html`<button class="btn" style="padding:2px 10px;font-size:12px" disabled=${installing === runner} onClick=${() => doInstall(runner)}>${installing === runner ? html`<${Spinner} size=${13}/> Installing…` : html`<${Icon} name="plus" size=${13}/> Install ${sel.binary}`}</button>` : null}`}
    </div>` : null}
    ${runner === "custom-cli" && admin ? html`<div style="display:flex;gap:8px;margin:7px 0">
      <input placeholder="npm package to install (e.g. @org/some-cli)" value=${pkg} onInput=${(e) => setPkg(e.target.value)}/>
      <button class="btn" disabled=${installing === "custom-cli" || !pkg} onClick=${() => doInstall("custom-cli", pkg)}>${installing === "custom-cli" ? html`<${Spinner} size=${13}/>` : "Install"}</button>
    </div>` : null}
    ${log ? html`<pre class="cmdbox" style="white-space:pre-wrap;max-height:120px;overflow:auto;font-size:11px;margin:4px 0">${log}</pre>` : null}
    ${runner === "custom-cli" || runner === "pi-cli" || runner === "claude-cli" ? html`<label>CLI command template — <code>{model}</code> <code>{systemPrompt}</code> <code>{task}</code> <code>{workdir}</code> (blank = built-in default)</label><input type="text" value=${cliCmd} placeholder=${runner === "pi-cli" ? "pi --mode print --model {model} --system-prompt {systemPrompt} {task}" : runner === "claude-cli" ? "claude -p {task}" : ""} onInput=${(e) => setCliCmd(e.target.value)}/>` : null}
  `;
}

function SecretField({ field, isSet, reload }) {
  const [v, setV] = useState("");
  function save() { if (!v) { toast("Enter a value"); return; } api("/user-secret", { key: field.key, value: v }).then(() => { toast("Saved"); setV(""); reload(); }).catch(() => toast("Couldn’t save")); }
  function clear() { api("/user-secret", { key: field.key, value: "" }).then(() => { toast("Cleared"); reload(); }); }
  return html`<label>${field.label} ${isSet ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> set</span>` : null}</label>
    <div class="muted" style="font-size:11px;margin:0 2px 4px">${field.hint}</div>
    <div style="display:flex;gap:8px">
      <input type="password" autocomplete="off" placeholder=${isSet ? "•••••• saved — type to replace" : "paste token"} value=${v} onInput=${(e) => setV(e.target.value)}/>
      <button class="btn" onClick=${save}>Save</button>
      ${isSet ? html`<button class="btn danger" onClick=${clear} aria-label="Clear"><${Icon} name="trash" size=${15}/></button>` : null}
    </div>`;
}
function Admin({ users, webhookSecretSet, reload }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState("");
  const [wh, setWh] = useState("");
  function invite() { api("/invite-create", { email: email || null, role }).then((d) => { setLink(d.url || ""); setEmail(""); toast("Invite link created"); reload(); }).catch(() => toast("Couldn’t create invite")); }
  function saveWh() { api("/settings", { webhookSecret: wh }).then(() => { toast("Webhook secret saved"); setWh(""); reload(); }).catch(() => toast("Couldn’t save")); }
  return html`<div class="sec">Team (admin)</div>
    ${users.map((u) => html`<div key=${u.id} style="display:flex;gap:8px;align-items:center;margin:4px 2px"><span style="flex:1">${u.username}</span><span class="muted" style="font-size:12px">${u.role}</span>
      <button class="btn ghost" style="padding:3px 8px;font-size:12px" onClick=${() => { const np = window.prompt("New password for " + u.username + " (8+ chars)"); if (np == null) return; if (np.length < 8) { toast("8+ characters"); return; } api("/set-password", { value: np, number: u.id }).then(() => toast("Reset " + u.username)).catch(() => toast("Couldn’t reset")); }}><${Icon} name="lock" size=${13}/></button></div>`)}
    <label>Invite a teammate</label>
    <div style="display:flex;gap:8px">
      <input placeholder="email (optional)" value=${email} onInput=${(e) => setEmail(e.target.value)}/>
      <select value=${role} onChange=${(e) => setRole(e.target.value)} style="width:auto"><option value="member">member</option><option value="admin">admin</option></select>
      <button class="btn" onClick=${invite}>Create</button>
    </div>
    ${link ? html`<div class="cmdbox"><code>${link}</code><button class="btn" onClick=${() => { if (navigator.clipboard) navigator.clipboard.writeText(link); toast("Copied"); }}>Copy</button></div>` : null}
    <label>GitHub webhook secret ${webhookSecretSet ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> set</span>` : null}</label>
    <div class="muted" style="font-size:11px;margin:0 2px 4px">Only if you use GitHub push webhooks. Stored encrypted; use the same value in the repo's webhook settings.</div>
    <div style="display:flex;gap:8px">
      <input type="password" autocomplete="off" placeholder=${webhookSecretSet ? "•••••• saved — type to replace" : "secret"} value=${wh} onInput=${(e) => setWh(e.target.value)}/>
      <button class="btn" onClick=${saveWh}>Save</button>
    </div>`;
}
