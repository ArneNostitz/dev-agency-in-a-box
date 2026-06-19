// Dev Agency dashboard — settings module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect } from "/web/vendor/standalone.mjs";
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
export function GithubTokensModal({ secretKeys, onClose, reload }) {
  return html`<${Sheet} title="GitHub Tokens" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <div class="muted" style="font-size:12px;margin-bottom:12px">Stored encrypted (AES-256-GCM). The agency uses them to run on your behalf. Write-only — never shown back.</div>
    <div style="margin-bottom:16px">
      <${SecretField} field=${{key: "github_bot_token", label: "GitHub bot token", hint: "The account the agency ACTS as — its commits and pull requests."}} isSet=${secretKeys.includes("github_bot_token")} reload=${reload}/>
    </div>
    <div style="margin-bottom:16px">
      <${SecretField} field=${{key: "github_user_token", label: "Your GitHub token", hint: "Lets the agency comment and open issues under YOUR name."}} isSet=${secretKeys.includes("github_user_token")} reload=${reload}/>
    </div>
  <//>`;
}

export function ModelsModal({ onClose, reload }) {
  const [existing, setExisting] = useState([]);
  const [secretKeys, setSecretKeys] = useState([]);
  function refresh() { 
    getJSON("/models").then((d) => setExisting(d.providers || [])).catch(() => {}); 
    getJSON("/data").then((d) => setSecretKeys(d.secretKeys || [])).catch(() => {});
  }
  useEffect(refresh, []);

  return html`<${Sheet} title="Models & API Keys" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <div class="muted" style="font-size:12px;margin-bottom:12px">Configure your API keys for various AI models. Keys are stored securely.</div>
    
    <div class="sec">Claude</div>
    <div style="margin-bottom:12px">
      <${SecretField} field=${{key: "claude_token", label: "Claude subscription token", hint: "CLAUDE_CODE_OAUTH_TOKEN — runs the Claude roles on your plan"}} isSet=${secretKeys.includes("claude_token")} reload=${() => {reload(); refresh();}}/>
    </div>
    <div style="margin-bottom:12px">
      <${SecretField} field=${{key: "anthropic_api_key", label: "Claude API key", hint: "Pay-as-you-go billing"}} isSet=${secretKeys.includes("anthropic_api_key")} reload=${() => {reload(); refresh();}}/>
    </div>

    <div class="sec">Other Providers</div>
    ${OB_PROVIDERS.filter(p => p.kind === "provider" && !p.custom).map(p => {
      const isSet = existing.some(ex => ex.name === p.preset.name && ex.apiKey);
      return html`<div key=${p.id} style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--ink-2)">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><${Icon} name=${p.icon} size=${14}/> <b>${p.label}</b> ${isSet ? html`<span class="statuschip s-ready"><${Icon} name="check" size=${12}/> set</span>` : null}</div>
        <div class="muted" style="font-size:11px;margin-bottom:8px">${p.how}</div>
        <${ProviderField} providerDef=${p} existing=${existing} reload=${() => {reload(); refresh();}}/>
      </div>`
    })}

    <div class="sec">Custom Provider</div>
    <div style="margin-bottom:16px">
      <div class="muted" style="font-size:11px;margin-bottom:8px">Add an Anthropic-compatible gateway (e.g. LiteLLM, claude-code-router).</div>
      <${ProviderField} providerDef=${OB_PROVIDERS.find(p => p.custom)} existing=${existing} reload=${() => {reload(); refresh();}} custom=${true}/>
    </div>

    <${ModelsPanel}/>
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

function ProviderField({ providerDef, existing, reload, custom }) {
  const [val, setVal] = useState("");
  const [baseUrl, setBaseUrl] = useState(providerDef.preset?.baseUrl || "");
  const [prunner, setPrunner] = useState(""); // "" = use the global runner
  function save() {
    if (!val) { toast("Paste an API key"); return; }
    const prov = { id: providerDef.id + "-" + Date.now().toString(36), name: providerDef.preset?.name || "Custom", baseUrl: custom ? baseUrl.trim() : providerDef.preset.baseUrl, apiKey: val.trim(), models: providerDef.preset?.models || [], ...(prunner ? { runner: prunner } : {}) };
    api("/models", { providers: (existing || []).concat(prov) }).then(() => { toast("Saved"); setVal(""); reload(); }).catch(() => toast("Couldn’t save"));
  }
  return html`
    ${custom ? html`<input placeholder="Base URL (https://...)" value=${baseUrl} onInput=${(e) => setBaseUrl(e.target.value)} style="margin-bottom:8px"/>` : null}
    <div style="display:flex;gap:8px">
      <input type="password" autocomplete="off" placeholder=${providerDef.placeholder || "API Key"} value=${val} onInput=${(e) => setVal(e.target.value)}/>
      <button class="btn" onClick=${save}>Save</button>
    </div>
    <label style="font-size:11px;margin-top:6px">Runner for this provider</label>
    <select value=${prunner} onChange=${(e) => setPrunner(e.target.value)}>
      <option value="">Use the global runner</option>
      <option value="claude-sdk">Claude SDK (in-process)</option>
      <option value="pi-cli">pi CLI</option>
      <option value="claude-cli">claude CLI</option>
      <option value="custom-cli">Custom CLI</option>
    </select>
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
