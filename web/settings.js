// Dev Agency dashboard — settings module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Icon, Sheet, Spinner, api, getJSON, md, toast } from "./core.js";
import { OB_PROVIDERS } from "./onboarding.js";


// ---------- Settings ----------
export function Settings({ data, onClose, reload, openGithubTokens, openModels }) {
  const cfg = data.config || {};
  const admin = Boolean(data.user && data.user.role === "admin");
  const [skipArch, setSkipArch] = useState(cfg.skipArchitect !== "off");
  const [gitnexus, setGitnexus] = useState(cfg.gitnexus === "on");
  const [maxTok, setMaxTok] = useState(cfg.maxTokensPerRun || 600000);
  const [revRounds, setRevRounds] = useState(cfg.maxReviseRounds != null ? cfg.maxReviseRounds : 1);
  const [avatarsOn, setAvatarsOn] = useState(cfg.avatars !== "off");
  const [runner, setRunner] = useState(cfg.agentRunner || "claude-sdk");
  const [cliCmd, setCliCmd] = useState(cfg.agentCliCommand || "");
  function save() { api("/settings", { skipArchitect: skipArch ? "on" : "off", gitnexus: gitnexus ? "on" : "off", maxTokensPerRun: Number(maxTok) || 0, maxReviseRounds: Number(revRounds) || 0, avatars: avatarsOn ? "on" : "off", agentRunner: runner, agentCliCommand: cliCmd }).then(() => { toast("Saved"); onClose(); reload(); }); }
  function changePw() { const np = window.prompt("New password (8+ characters)"); if (np == null) return; if (np.length < 8) { toast("8+ characters"); return; } api("/set-password", { value: np }).then(() => toast("Password changed")).catch((e) => toast((e && e.message) || "Couldn’t change", "error")); }
  return html`<${Sheet} title="Settings" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button>`}>

    ${data.user ? html`
      <div class="setgrp">
        <div class="sec">Account</div>
        <div class="muted" style="margin-bottom:8px">Signed in as <b>${data.user.username}</b> · ${data.user.role}</div>
        <div style="display:flex;gap:8px">
          <button class="btn ghost" style="flex:1;justify-content:center" onClick=${changePw}><${Icon} name="lock" size=${15}/> Change password</button>
          <a class="btn ghost" href="/logout" style="flex:1;justify-content:center"><${Icon} name="arrowleft" size=${15}/> Sign out</a>
        </div>
      </div>

      <div class="setgrp">
        <div class="sec">Connections</div>
        <div style="display:flex;gap:8px">
          <button class="btn" style="flex:1;justify-content:center" onClick=${openGithubTokens}><${Icon} name="link" size=${15}/> GitHub tokens</button>
          <button class="btn" style="flex:1;justify-content:center" onClick=${openModels}><${Icon} name="flask" size=${15}/> Models & API keys</button>
        </div>
      </div>
    ` : null}

    <div class="setgrp">
      <div class="sec">Appearance</div>
      <label class="ckline"><input type="checkbox" checked=${avatarsOn} onChange=${(e) => setAvatarsOn(e.target.checked)}/> Show agent avatars (cards & comments)</label>
    </div>

    <div class="setgrp">
      <div class="sec">Pipeline</div>
      <label class="ckline"><input type="checkbox" checked=${skipArch} onChange=${(e) => setSkipArch(e.target.checked)}/> Skip the architect step (faster, fewer tokens)</label>
      <label class="ckline"><input type="checkbox" checked=${gitnexus} onChange=${(e) => setGitnexus(e.target.checked)}/> Use the GitNexus code index</label>
      <label>Max tokens per run (0 = off)</label><input type="number" min="0" step="50000" value=${maxTok} onInput=${(e) => setMaxTok(e.target.value)}/>
      <label>Reviewer revise rounds before it asks you</label><input type="number" min="0" max="3" value=${revRounds} onInput=${(e) => setRevRounds(e.target.value)}/>
      <${RunnerPicker} runner=${runner} setRunner=${setRunner} cliCmd=${cliCmd} setCliCmd=${setCliCmd} admin=${admin}/>
    </div>

    ${admin && data.opsMeta ? html`<div class="setgrp"><${Operations} meta=${data.opsMeta} values=${data.ops || {}} reload=${reload}/></div>` : null}

    ${data.user ? html`
      <div class="setgrp">
        <div class="sec">Setup</div>
        <div class="muted" style="font-size:12px;margin-bottom:7px">Re-run the guided walkthrough to add or update tokens, models, and repos.</div>
        <button class="btn primary" style="width:100%" onClick=${() => api("/onboarded", { value: "0" }).then(() => { onClose(); reload(); })}><${Icon} name="play" size=${15}/> Run the setup wizard</button>
      </div>
      ${admin ? html`<div class="setgrp"><${Admin} users=${data.users || []} invites=${data.invites || []} webhookSecretSet=${data.webhookSecretSet} reload=${reload}/></div>` : null}
    ` : null}
  <//>`;
}
/**
 * Inline models panel in Settings: auto-switch toggle + fallback chain config.
 * Full provider/role management stays in /classic for now; this surfaces the new
 * rate-limit offload settings without requiring a page nav.
 */
function ModelsPanel() {
  const [md, setMd] = useState(null); // /models response
  const [autoSwitch, setAutoSwitch] = useState(false);
  const [chain, setChain] = useState([]); // [{providerId, model}]
  const [globalModel, setGlobalModel] = useState(null); // {providerId, model} | null
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getJSON("/models").then((d) => {
      setMd(d);
      setAutoSwitch(d.autoSwitchOnLimit || false);
      setChain(d.fallbackChain || []);
      setGlobalModel(d.globalModel || null);
    }).catch(() => {});
  }, []);
  if (!md) return null;
  const providers = md.providers || [];
  // Flat list of {providerId, model, label} choices for the fallback select
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ providerId: p.id, model: m, label: p.name + " / " + m })));
  function addFallback() {
    if (!modelOpts.length) { toast("Add a provider in Models & agents first"); return; }
    setChain((c) => c.concat(modelOpts[0]));
  }
  function removeFallback(idx) { setChain((c) => c.filter((_, i) => i !== idx)); }
  function setFallbackEntry(idx, opt) {
    const m = modelOpts.find((o) => o.providerId + "/" + o.model === opt);
    if (m) setChain((c) => c.map((e, i) => i === idx ? { providerId: m.providerId, model: m.model } : e));
  }
  function save() {
    setBusy(true);
    api("/models", { fallbackChain: chain, autoSwitchOnLimit: autoSwitch, globalModel })
      .then(() => toast("Saved")).catch(() => toast("Couldn't save")).then(() => setBusy(false));
  }
  return html`<div class="sec">Models & rate limit</div>
    <label style="margin-top:6px;display:block">Global Default Model</label>
    <select style="width:100%;margin-bottom:12px" value=${globalModel ? globalModel.providerId + "/" + globalModel.model : ""} onChange=${(e) => {
      const val = e.target.value;
      if (!val) {
        setGlobalModel(null);
      } else {
        const [providerId, model] = val.split("/");
        setGlobalModel({ providerId, model });
      }
    }}>
      <option value="">Default (Claude subscription / role defaults)</option>
      ${modelOpts.map((o) => html`<option key=${o.providerId + "/" + o.model} value=${o.providerId + "/" + o.model}>${o.label}</option>`)}
    </select>
    <label class="ckline"><input type="checkbox" checked=${autoSwitch} onChange=${(e) => setAutoSwitch(e.target.checked)}/> Auto-switch to fallback model on Claude usage limit</label>
    <div class="muted" style="font-size:12px;margin:3px 2px 7px">When enabled, hitting the Claude credit/session limit switches all unassigned roles to the first fallback below and retries — instead of stalling.</div>
    <label>Fallback chain (order of models to try when primary is rate-limited)</label>
    ${chain.map((entry, idx) => html`<div key=${idx} style="display:flex;gap:6px;align-items:center;margin-bottom:5px">
      <select style="flex:1" value=${entry.providerId + "/" + entry.model} onChange=${(e) => setFallbackEntry(idx, e.target.value)}>
        ${modelOpts.map((o) => html`<option key=${o.providerId + "/" + o.model} value=${o.providerId + "/" + o.model}>${o.label}</option>`)}
      </select>
      <button class="iconbtn" title="Remove" onClick=${() => removeFallback(idx)}><${Icon} name="trash" size=${15}/></button>
    </div>`)}
    ${modelOpts.length ? html`<button class="btn ghost" style="margin-bottom:4px" onClick=${addFallback}><${Icon} name="plus" size=${14}/> Add fallback</button>` : html`<div class="muted" style="font-size:12px">No alternative providers configured — add one under <b>Models & API keys</b> first.</div>`}
    <button class="btn primary" style="margin-top:8px" disabled=${busy} onClick=${save}>${busy ? html`<${Spinner} size=${14}/> Saving…` : "Save model settings"}</button>`;
}
function Operations({ meta, values, reload }) {
  const [vals, setVals] = useState(() => Object.assign({}, values));
  const set = (k, v) => setVals((o) => Object.assign({}, o, { [k]: v }));
  function save() { api("/settings", { ops: vals }).then(() => { toast("Operations saved"); reload(); }).catch(() => toast("Couldn’t save")); }
  const visibleMeta = meta.filter(m => m.key === "self_improve");
  if (!visibleMeta.length) return null;
  return html`<div class="sec">Operations</div>
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
    <div class="muted" style="font-size:12px;margin-bottom:8px">Connect once — replaces the bot + owner tokens. You just click Authorize on GitHub.</div>
    ${needClientId ? html`<label>OAuth App client ID</label>
      <input placeholder="Iv1.… (your GitHub OAuth App)" value=${clientId} onInput=${(e) => setClientId(e.target.value)}/>
      <a class="oblink" href="https://github.com/settings/applications/new" target="_blank" rel="noopener">Register an OAuth App — enable “Device Flow” <${Icon} name="link" size=${14}/></a>` : null}
    ${flow ? html`<div class="cmdbox" style="flex-direction:column;align-items:flex-start;gap:6px">
      <div>1 · Open <a href=${flow.verification_uri} target="_blank" rel="noopener">${flow.verification_uri}</a></div>
      <div>2 · Enter code <code style="font-size:16px;letter-spacing:2px">${flow.user_code}</code></div>
      <div class="muted" style="font-size:11px;display:flex;align-items:center;gap:6px"><${Spinner} size=${12}/> waiting for you to authorize…</div>
    </div>` : html`<button class="btn primary" style="width:100%;justify-content:center" disabled=${busy || (needClientId && !clientId.trim())} onClick=${connect}>${busy ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="link" size=${15}/>`} Connect GitHub</button>`}
    ${err ? html`<div class="testres bad" style="margin-top:6px">✗ ${err}</div>` : null}
  </div>`;
}

export function ModelsModal({ onClose, reload }) {
  const [providers, setProviders] = useState([]);
  const [secretKeys, setSecretKeys] = useState([]);
  const [status, setStatus] = useState(null);
  const [adding, setAdding] = useState(false);
  const [keys, setKeys] = useState(false);
  function refresh() {
    getJSON("/models").then((d) => setProviders(d.providers || [])).catch(() => {});
    getJSON("/data").then((d) => setSecretKeys(d.secretKeys || [])).catch(() => {});
    getJSON("/runner-status").then(setStatus).catch(() => {});
  }
  useEffect(refresh, []);
  function saveProviders(list) { return api("/models", { providers: list }).then(() => { toast("Saved"); reload(); refresh(); }).catch(() => toast("Couldn’t save", "error")); }
  function setRunner(id, runner) { saveProviders(providers.map((p) => (p.id === id ? { ...p, runner: runner || undefined } : p))); }
  function remove(id, name) { if (window.confirm("Remove " + name + "?")) saveProviders(providers.filter((p) => p.id !== id)); }
  const claudeSub = secretKeys.includes("claude_token"), claudeApi = secretKeys.includes("anthropic_api_key");
  const empty = !providers.length && !claudeSub && !claudeApi;
  return html`<${Sheet} title="Models & runners" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <div class="sec">Your models</div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Only the providers you’ve added. The dropdown picks which CLI runs each one — SDK is the default.</div>
    ${claudeSub || claudeApi ? html`<div class="modelrow">
      <div class="modelrow-main"><${Icon} name="crown" size=${15}/> <b>Claude</b> <span class="muted" style="font-size:11px">${[claudeSub ? "subscription" : "", claudeApi ? "API key" : ""].filter(Boolean).join(" + ")}</span></div>
      <button class="btn ghost" style="padding:3px 10px;font-size:12px" onClick=${() => setKeys(true)}>Keys</button>
    </div>` : null}
    ${providers.map((p) => html`<div class="modelrow" key=${p.id}>
      <div class="modelrow-main"><b>${p.name}</b> <span class="muted" style="font-size:11px">${(p.models || []).length} model${(p.models || []).length === 1 ? "" : "s"}</span></div>
      <select class="modelsel sm" value=${p.runner || ""} title="Runner (CLI) for this provider" onChange=${(e) => setRunner(p.id, e.target.value)}>
        <option value="">SDK</option><option value="pi-cli">pi</option><option value="claude-cli">claude</option><option value="custom-cli">custom</option>
      </select>
      <button class="iconbtn" style="width:30px;height:30px;border:none" title="Remove" onClick=${() => remove(p.id, p.name)}><${Icon} name="trash" size=${15}/></button>
    </div>`)}
    ${empty ? html`<div class="muted" style="font-size:12.5px;padding:10px 2px">No models added yet — add one below.</div>` : null}
    <div style="display:flex;gap:8px;margin:14px 0 4px">
      <button class="btn primary" style="flex:1;justify-content:center" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15}/> Add model</button>
      <button class="btn" style="flex:1;justify-content:center" onClick=${() => setKeys(true)}><${Icon} name="lock" size=${15}/> Add key / token</button>
    </div>
    <${ModelsPanel}/>
    ${adding ? html`<${AddProvider} existing=${providers} status=${status} onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); refresh(); }}/>` : null}
    ${keys ? html`<${KeyModal} secretKeys=${secretKeys} onClose=${() => setKeys(false)} reload=${() => { reload(); refresh(); }}/>` : null}
  <//>`;
}

// pi-style "add a provider" flow: 1) pick the CLI runner, 2) pick the provider, 3) paste its key.
// (LLM providers are API-key based; OAuth/subscription logins live under "Keys".)
function AddProvider({ existing, status, onClose, onSaved }) {
  const provs = OB_PROVIDERS.filter((p) => p.kind === "provider");
  const [runner, setRunner] = useState("");
  const [pid, setPid] = useState(provs[0] ? provs[0].id : "");
  const [val, setVal] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const def = provs.find((p) => p.id === pid);
  const ravail = {}; (status && status.runners || []).forEach((r) => (ravail[r.kind] = r));
  const sel = ravail[runner];
  function save() {
    if (!def) return;
    if (def.custom && !baseUrl.trim()) { toast("Enter the base URL"); return; }
    if (!val.trim()) { toast("Paste the API key"); return; }
    const prov = { id: def.id + "-" + Date.now().toString(36), name: def.preset?.name || "Custom", baseUrl: def.custom ? baseUrl.trim() : def.preset.baseUrl, apiKey: val.trim(), models: def.preset?.models || [], ...(runner ? { runner } : {}) };
    api("/models", { providers: (existing || []).concat(prov) }).then(() => { toast("Added " + prov.name); onSaved(); }).catch(() => toast("Couldn’t save", "error"));
  }
  return html`<${Sheet} title="Add model" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Add</button>`}>
    <label>1 · Runner (CLI)</label>
    <select value=${runner} onChange=${(e) => setRunner(e.target.value)}>
      <option value="">SDK (default — in-process)</option><option value="pi-cli">pi CLI</option><option value="claude-cli">claude CLI</option><option value="custom-cli">Custom CLI</option>
    </select>
    ${sel && sel.binary && !sel.available ? html`<div style="margin:5px 2px"><span class="statuschip s-attn"><${Icon} name="alert" size=${12}/> ${sel.binary} not installed — install it in Settings → Pipeline</span></div>` : null}
    <label style="margin-top:10px">2 · Provider</label>
    <select value=${pid} onChange=${(e) => { setPid(e.target.value); setVal(""); }}>
      ${provs.map((p) => html`<option key=${p.id} value=${p.id}>${p.label}</option>`)}
    </select>
    ${def && def.how ? html`<div class="muted" style="font-size:11px;white-space:pre-wrap;margin:6px 2px">${def.how}</div>` : null}
    ${def && def.link ? html`<a class="oblink" href=${def.link} target="_blank" rel="noopener">${def.linkLabel || "Get an API key"} <${Icon} name="link" size=${14}/></a>` : null}
    ${def && def.custom ? html`<label style="margin-top:8px">Base URL (Anthropic-compatible)</label><input placeholder="https://…/anthropic" value=${baseUrl} onInput=${(e) => setBaseUrl(e.target.value)}/>` : null}
    <label style="margin-top:8px">3 · API key</label>
    <input type="password" autocomplete="off" placeholder=${def ? def.placeholder : "API key"} value=${val} onInput=${(e) => setVal(e.target.value)}/>
  <//>`;
}

// Claude subscription token / API key (the OAuth-style logins). Paste once; stored encrypted.
function KeyModal({ secretKeys, onClose, reload }) {
  return html`<${Sheet} title="Keys & tokens" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <div style="margin-bottom:14px"><${SecretField} field=${{ key: "claude_token", label: "Claude subscription token", hint: "Runs Claude roles on your plan. Get it with: npm i -g @anthropic-ai/claude-code && claude setup-token" }} isSet=${secretKeys.includes("claude_token")} reload=${reload}/></div>
    <div><${SecretField} field=${{ key: "anthropic_api_key", label: "Claude API key", hint: "Pay-as-you-go (sk-ant-…)" }} isSet=${secretKeys.includes("anthropic_api_key")} reload=${reload}/></div>
  <//>`;
}

// Agent-runner picker with live install status. CLI runners (pi, claude) need a binary on PATH;
// if it's missing an admin can install it on the fly (POST /install-cli → npm -g to the data-volume
// prefix, so it persists across redeploys). Closes the loop on "spawn pi ENOENT".
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
    <select value=${runner} onChange=${(e) => setRunner(e.target.value)}>
      <option value="claude-sdk">Claude SDK (default — in-process, your subscription/key)</option>
      <option value="pi-cli">pi CLI (subprocess — drives any model pi supports)</option>
      <option value="claude-cli">claude CLI (subprocess)</option>
      <option value="custom-cli">Custom CLI (set command below)</option>
    </select>
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
