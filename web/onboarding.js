// Dev Agency dashboard — onboarding module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect } from "/web/vendor/standalone.mjs";
import { Icon, ProviderLogo, Sheet, Spinner, api, getJSON, toast } from "./core.js";
import { Settings, GitHubConnect } from "./settings.js";


// ---------- onboarding wizard ----------
let modelsConfig = {
  "Gemini": ["gemini-3.5-flash", "gemini-3.5-pro", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro", "gemini-1.5-flash"],
  "GLM (Zhipu)": ["glm-5.2", "glm-5.1", "glm-4.6", "glm-4.5"],
  "DeepSeek": ["deepseek-chat", "deepseek-reasoner"],
  "Kimi (Moonshot)": ["kimi-k2-0905-preview"]
};
getJSON("/web/models.json").then((m) => { if (m) modelsConfig = m; }).catch(() => {});

export const OB_PROVIDERS = [
  { id: "claude_sub", label: "Claude — subscription", note: "Recommended · runs agents on your plan", icon: "crown", kind: "secret", secretKey: "claude_token",
    title: "Claude subscription token", placeholder: "paste the setup-token output",
    how: "Runs the agents on your existing Claude plan — no per-token billing.\n\n1. Install the CLI:\n   npm i -g @anthropic-ai/claude-code\n2. Generate a token:\n   claude setup-token\n3. Log in with your Claude plan when the browser opens.\n4. Paste the token it prints below.",
    link: "https://docs.claude.com/en/docs/claude-code", linkLabel: "Claude Code docs" },
  { id: "claude_api", label: "Claude — API key", note: "Pay-as-you-go", icon: "flask", kind: "secret", secretKey: "anthropic_api_key",
    title: "Claude API key", placeholder: "sk-ant-...",
    how: "Pay-as-you-go billing instead of a subscription.\n\n1. Open platform.claude.com → API keys.\n2. Create a key.\n3. Paste it below.",
    link: "https://platform.claude.com/settings/keys", linkLabel: "Create an API key" },
  { id: "gemini", label: "Gemini", note: "needs an Anthropic-compatible proxy", icon: "globe", kind: "provider",
    preset: { name: "Gemini (via proxy)", baseUrl: "", get models() { return modelsConfig["Gemini"] || []; } },
    title: "Gemini base URL + key", placeholder: "AIza...",
    how: "Google has no native Anthropic-format endpoint, so the agent SDK can't call Gemini directly. Run an Anthropic-compatible gateway (e.g. LiteLLM) and paste its base URL in Settings → Models. GLM, DeepSeek and Kimi work without a proxy.",
    link: "https://aistudio.google.com/app/apikey", linkLabel: "Create a Gemini API key" },
  { id: "glm", label: "GLM (Zhipu)", note: "Cheap coding model", icon: "globe", kind: "provider",
    preset: { name: "GLM (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/anthropic", get models() { return modelsConfig["GLM (Zhipu)"] || []; } },
    title: "GLM API key", placeholder: "GLM API key",
    how: "An Anthropic-compatible endpoint, good for the cheaper roles.\n\n1. Get an API key from open.bigmodel.cn (Zhipu).\n2. Paste it below.\n\nAfter setup, assign GLM to specific agents in Settings → Models.",
    link: "https://open.bigmodel.cn/usercenter/apikeys", linkLabel: "Create a GLM API key" },
  { id: "deepseek", label: "DeepSeek", note: "", icon: "globe", kind: "provider",
    preset: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", get models() { return modelsConfig["DeepSeek"] || []; } },
    title: "DeepSeek API key", placeholder: "DeepSeek API key",
    how: "1. Get an API key from platform.deepseek.com.\n2. Paste it below.\n\nAssign it to agents later in Settings → Models.",
    link: "https://platform.deepseek.com/api_keys", linkLabel: "Create a DeepSeek API key" },
  { id: "kimi", label: "Kimi (Moonshot)", note: "", icon: "globe", kind: "provider",
    preset: { name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/anthropic", get models() { return modelsConfig["Kimi (Moonshot)"] || []; } },
    title: "Kimi API key", placeholder: "Kimi API key",
    how: "1. Get an API key from platform.moonshot.cn.\n2. Paste it below.\n\nAssign it to agents later in Settings → Models.",
    link: "https://platform.moonshot.cn/console/api-keys", linkLabel: "Create a Kimi API key" },
  { id: "other", label: "Other (Custom)", note: "Needs a router", icon: "settings", kind: "provider", custom: true,
    title: "Custom provider", placeholder: "API key",
    how: "OpenAI / Gemini / Ollama need an Anthropic-compatible gateway (claude-code-router or LiteLLM). Run one, then enter its base URL + key here.",
    link: "https://github.com/musistudio/claude-code-router", linkLabel: "claude-code-router" },
];
const OB_GH_BOT = { id: "github_bot", title: "GitHub bot token", icon: "pr", kind: "secret", secretKey: "github_bot_token", placeholder: "github_pat_...",
  how: "The account the agency ACTS as — its commits and pull requests. Best practice: a dedicated bot GitHub account.\n\n1. On the bot account: github.com → Settings → Developer settings → Fine-grained tokens → Generate new token.\n2. Repository access: the repos you'll use.\n3. Permissions: Contents, Issues, Pull requests, Workflows = Read & write; Metadata = Read.\n4. Paste the token (github_pat_…) below.",
  link: "https://github.com/settings/tokens?type=beta", linkLabel: "Create a fine-grained token" };
const OB_GH_OWNER = { id: "github_owner", title: "Your GitHub token", optional: true, icon: "link", kind: "secret", secretKey: "github_user_token", placeholder: "github_pat_... (optional)",
  how: "Lets the agency comment and open issues under YOUR name, and auto-invite the bot to repos. Same steps as the bot token, on your own account (add Administration: Read & write for auto-invite).\n\nOptional — skip if you'll invite the bot manually.",
  link: "https://github.com/settings/tokens?type=beta", linkLabel: "Create a fine-grained token" };

function ObTokenStep({ def, existing, onDone, onBack }) {
  const [val, setVal] = useState("");
  const [baseUrl, setBaseUrl] = useState(def.preset?.baseUrl || "");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null); // null | "testing" | {ok, via, error}
  const isClaude = def.secretKey === "claude_token" || def.secretKey === "anthropic_api_key";
  const v = val.trim();
  // Catch the most common 401 cause: pasting the wrong token TYPE into the wrong option.
  const shapeWarn = def.secretKey === "claude_token" && /^sk-ant-api/.test(v)
    ? "That looks like an API key (sk-ant-api…). Use the “Claude — API key” option instead, or it will 401."
    : def.secretKey === "anthropic_api_key" && /^sk-ant-oat/.test(v)
    ? "That looks like a subscription token (sk-ant-oat…). Use the “Claude — subscription” option instead."
    : def.secretKey === "anthropic_api_key" && v && !/^sk-ant-/.test(v)
    ? "An Anthropic API key usually starts with “sk-ant-”. If this is a subscription token, use the “Claude — subscription” option."
    : "";
  function storeVal() {
    if (def.kind === "secret") return api("/user-secret", { key: def.secretKey, value: v });
    const prov = { id: def.id + "-" + Date.now().toString(36), name: def.preset?.name || "Custom", baseUrl: def.custom ? baseUrl.trim() : def.preset.baseUrl, apiKey: v, models: def.preset?.models || [] };
    return api("/models", { providers: (existing || []).concat(prov) });
  }
  function save() {
    if (!v) { toast(def.optional ? "Paste a token or Skip" : "Paste the token"); return; }
    setBusy(true);
    storeVal().then(() => { toast("Saved"); onDone(); }).catch(() => toast("Couldn’t save")).then(() => setBusy(false));
  }
  function saveTest() {
    if (!v) { toast("Paste the token first"); return; }
    setTest("testing");
    storeVal().then(() => api("/test-claude", {})).then((r) => setTest(r)).catch((e) => setTest({ ok: false, error: (e && e.message) || "failed" }));
  }
  return html`
    <div class="obki"><${Icon} name=${def.icon || "lock"} size=${26}/></div>
    <div class="obh">${def.title}</div>
    <div class="obsteps">${def.how}</div>
    ${def.link ? html`<a class="oblink" href=${def.link} target="_blank" rel="noopener">${def.linkLabel} <${Icon} name="link" size=${14}/></a>` : null}
    ${def.custom ? html`<label>Base URL (Anthropic-compatible)</label><input placeholder="https://…/anthropic" value=${baseUrl} onInput=${(e) => setBaseUrl(e.target.value)}/>` : null}
    <label>${def.custom ? "API key" : "Token"}</label>
    <input type="password" autocomplete="off" placeholder=${def.placeholder} value=${val} onInput=${(e) => { setVal(e.target.value); setTest(null); }}/>
    <div class="muted" style="font-size:11px;margin:3px 2px 0">Paste it exactly — no spaces or line breaks (a stray space causes a 401).</div>
    ${shapeWarn ? html`<div class="testres bad">⚠ ${shapeWarn}</div>` : null}
    ${isClaude ? html`<div class="muted" style="font-size:11px;margin:4px 2px 0">Tip: “Save & test” makes a real call so you know it works before any agent runs.</div>` : null}
    ${test && test !== "testing" ? html`<div class=${"testres " + (test.ok ? "ok" : "bad")}>${test.ok ? "✓ Authenticated via " + (test.via || "Claude") : "✗ " + (test.error || "Failed")}</div>` : null}
    <div class="obnav">
      <button class="btn" onClick=${onBack}>Back</button>
      ${def.optional ? html`<button class="btn ghost" onClick=${onDone}>Skip</button>` : null}
      ${isClaude ? html`<button class="btn ghost" disabled=${test === "testing"} onClick=${saveTest}>${test === "testing" ? html`<${Spinner} size=${15}/> Testing…` : "Save & test"}</button>` : null}
      <button class="btn primary" disabled=${busy} onClick=${save}>Save & continue</button>
    </div>`;
}

// Dead-simple model add for onboarding: pick a provider, app sets its CLI/baseURL/models, paste key.
function ObAddModels({ onNext, onBack }) {
  const [providers, setProviders] = useState([]);
  const [secretKeys, setSecretKeys] = useState([]);
  const [pid, setPid] = useState("");
  const [val, setVal] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  function refresh() {
    getJSON("/models").then((d) => setProviders(d.providers || [])).catch(() => {});
    getJSON("/data").then((d) => setSecretKeys(d.secretKeys || [])).catch(() => {});
  }
  useEffect(refresh, []);
  const def = OB_PROVIDERS.find((x) => x.id === pid);
  const added = [];
  if (secretKeys.includes("claude_token")) added.push("Claude — subscription");
  if (secretKeys.includes("anthropic_api_key")) added.push("Claude — API key");
  providers.forEach((x) => added.push(x.name));
  function add() {
    if (!def) return;
    if ((def.kind !== "secret" && def.custom && !baseUrl.trim())) { toast("Enter the base URL"); return; }
    if (!val.trim()) { toast(def.kind === "secret" ? "Paste the token" : "Paste the key"); return; }
    setBusy(true);
    const done = () => { setBusy(false); setPid(""); setVal(""); setBaseUrl(""); refresh(); toast("Added"); };
    const fail = () => { setBusy(false); toast("Couldn’t save", "error"); };
    if (def.kind === "secret") api("/user-secret", { key: def.secretKey, value: val.trim() }).then(done).catch(fail);
    else {
      const prov = { id: def.id + "-" + Date.now().toString(36), name: def.preset?.name || "Custom", baseUrl: def.custom ? baseUrl.trim() : def.preset.baseUrl, apiKey: val.trim(), models: def.preset?.models || [] };
      api("/models", { providers: providers.concat(prov) }).then(done).catch(fail);
    }
  }
  return html`
    <div class="obki"><${Icon} name="flask" size=${26}/></div>
    <div class="obh">Add your models</div>
    <div class="obsub">Pick a provider, paste its key — done. Claude (subscription) is the recommended default; add more anytime in Settings.</div>
    ${added.length ? html`<div style="display:flex;flex-direction:column;gap:5px;margin:4px 0 10px">${added.map((n, ix) => html`<div key=${ix} style="display:flex;align-items:center;gap:7px;font-size:13px"><span class="statuschip s-ready"><${Icon} name="check" size=${12}/></span> <${ProviderLogo} name=${n} size=${15}/> ${n}</div>`)}</div>` : null}
    <label>+ Add a provider</label>
    <select value=${pid} onChange=${(e) => { setPid(e.target.value); setVal(""); setBaseUrl(""); }}>
      <option value="">Select a provider…</option>
      ${OB_PROVIDERS.map((x) => html`<option key=${x.id} value=${x.id}>${x.label}</option>`)}
    </select>
    ${def ? html`
      ${def ? html`<div style="display:flex;align-items:center;gap:7px;margin:6px 2px;font-weight:560"><${ProviderLogo} name=${def.preset?.name || def.label} size=${18}/> ${def.label}</div>` : null}
      ${def.how ? html`<div class="muted" style="font-size:11px;white-space:pre-wrap;margin:6px 2px">${def.how}</div>` : null}
      ${def.link ? html`<a class="oblink" href=${def.link} target="_blank" rel="noopener">${def.linkLabel || "Get a key"} <${Icon} name="link" size=${14}/></a>` : null}
      ${def.custom ? html`<label>Base URL (Anthropic-compatible)</label><input placeholder="https://…/anthropic" value=${baseUrl} onInput=${(e) => setBaseUrl(e.target.value)}/>` : null}
      <label>${def.kind === "secret" ? "Token" : "API key"}</label>
      <input type="password" autocomplete="off" placeholder=${def.placeholder} value=${val} onInput=${(e) => setVal(e.target.value)}/>
      <button class="btn primary" style="width:100%;margin-top:8px;justify-content:center" disabled=${busy} onClick=${add}>${busy ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="plus" size=${15}/>`} Add ${def.label}</button>
    ` : null}
    <div class="obnav"><button class="btn" onClick=${onBack}>Back</button><button class="btn primary" onClick=${onNext}>Continue</button></div>`;
}

export function Onboarding({ repos, github, reload }) {
  const [i, setI] = useState(0);
  const [repo, setRepo] = useState("");
  const steps = ["welcome", "models", "github", "repo", "done"];
  const step = steps[Math.min(i, steps.length - 1)];
  const next = () => setI((x) => Math.min(steps.length - 1, x + 1));
  const back = () => setI((x) => Math.max(0, x - 1));
  const finish = () => api("/onboarded", { value: "1" }).then(() => { toast("You're all set!"); reload(); });
  function addRepo() {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) { toast("Use owner/name"); return; }
    api("/add-repo", { repo: repo.trim() }).then(() => { toast("Repo added"); setRepo(""); reload(); next(); }).catch(() => toast("Couldn’t add"));
  }
  const dots = steps.map((_, idx) => html`<div class=${"obdot " + (idx === i ? "on" : idx < i ? "done" : "")}></div>`);

  let body;
  if (step === "welcome") body = html`
    <div class="obki"><${Icon} name="crown" size=${26}/></div>
    <div class="obh">Welcome to Dev Agency in a Box</div>
    <div class="obsub">Three quick things and your AI team is ready: pick your models, give it GitHub access, and add a repo. Takes about 2 minutes — you can change anything later in Settings.</div>
    <div class="obnav"><button class="btn primary" onClick=${next}>Get started</button></div>`;
  else if (step === "models") body = html`<${ObAddModels} onNext=${next} onBack=${back}/>`;
  else if (step === "github") body = html`
    <div class="obki"><${Icon} name="pr" size=${26}/></div>
    <div class="obh">Give it GitHub access</div>
    <div class="obsub">One click — connect with GitHub. The agency commits, opens PRs, and comments as this account. No bot account or tokens to manage.</div>
    <${GitHubConnect} github=${github} reload=${reload}/>
    <div class="obnav"><button class="btn" onClick=${back}>Back</button><button class="btn primary" onClick=${next}>Continue</button></div>`;
  else if (step === "repo") body = html`
    <div class="obki"><${Icon} name="pr" size=${26}/></div>
    <div class="obh">Add your first repo</div>
    <div class="obsub">The repository the agency will work in. Use <code>owner/name</code>. You can add more anytime from the repo bar.</div>
    <label>Repository</label>
    <div style="display:flex;gap:8px"><input placeholder="owner/name" value=${repo} onInput=${(e) => setRepo(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") addRepo(); }}/><button class="btn primary" onClick=${addRepo}>Add</button></div>
    <div class="obnav"><button class="btn" onClick=${back}>Back</button><button class="btn ghost" onClick=${next}>Skip for now</button></div>`;
  else body = html`
    <div class="obki" style="background:var(--green-weak);color:var(--green)"><${Icon} name="check" size=${28}/></div>
    <div class="obh">You're all set${(repos || []).length ? "" : " — almost"}</div>
    <div class="obsub">Your agency is ready. Open an issue (or use “+ New”) and the agents will plan, build, review, and open a PR. ${(repos || []).length ? "" : "Add a repo from the repo bar to get going."} Manage tokens, models, and automation anytime in Settings.</div>
    <div class="obnav"><button class="btn" onClick=${back}>Back</button><button class="btn primary" onClick=${finish}>Go to my board</button></div>`;

  return html`<div class="onboard"><div class="ob">
    <div class="obdots">${dots}</div>
    ${body}
    ${step !== "done" && step !== "welcome" ? html`<div style="text-align:center;margin-top:16px"><button class="btn ghost" style="font-size:13px" onClick=${finish}>Skip setup</button></div>` : null}
  </div></div>`;
}

// ---------- add a repo ----------
export function AddRepo({ repos, onClose, reload }) {
  const [avail, setAvail] = useState(null);
  const [manual, setManual] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { getJSON("/repos-available").then((d) => setAvail(d.repos || [])).catch(() => setAvail([])); }, []);
  function add(full) {
    if (!full || busy) return;
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) { toast("Use owner/name, e.g. acme/app"); return; }
    setBusy(true);
    api("/add-repo", { repo: full }).then(() => { toast("Added " + full); setManual(""); reload(); }).catch(() => toast("Couldn’t add — use owner/name")).then(() => setBusy(false));
  }
  function remove(full) { if (busy) return; setBusy(true); api("/remove-repo", { repo: full }).then(() => { toast("Removed " + full); reload(); }).catch(() => toast("Couldn’t remove")).then(() => setBusy(false)); }
  const q = filter.trim().toLowerCase();
  const matches = (avail || []).filter((r) => !q || r.full_name.toLowerCase().includes(q));
  return html`<${Sheet} title="Repos" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Close</button>`}>
    <label>Add a repo (owner/name)</label>
    <div style="display:flex;gap:8px">
      <input placeholder="owner/name" value=${manual} onInput=${(e) => setManual(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") add(manual.trim()); }}/>
      <button class="btn primary" disabled=${busy} onClick=${() => add(manual.trim())}>Add</button>
    </div>
    ${(repos || []).length ? html`<div class="sec">Watching</div>${repos.map((r) => html`<div key=${r} style="display:flex;align-items:center;gap:8px;margin:5px 2px">
      <span style="flex:1">${r}</span><button class="btn danger" disabled=${busy} onClick=${() => remove(r)} aria-label="Remove"><${Icon} name="trash" size=${15}/></button></div>`)}` : null}
    <div class="sec">Your GitHub repos ${avail && avail.length ? html`<span class="muted" style="font-weight:400">${matches.length}/${avail.length}</span>` : null}</div>
    ${avail && avail.length > 6 ? html`<div class="searchrow"><${Icon} name="search" size=${15} cls="searchic"/><input placeholder="Filter repos…" value=${filter} onInput=${(e) => setFilter(e.target.value)} autocomplete="off"/>${filter ? html`<button class="iconbtn" style="width:30px;height:30px;border:none" onClick=${() => setFilter("")} aria-label="Clear"><${Icon} name="x" size=${15}/></button>` : null}</div>` : null}
    ${avail === null ? html`<div class="muted">Loading…</div>`
      : !avail.length ? html`<div class="muted" style="font-size:12px">None to list yet — set a GitHub token (Settings → credentials) or type a repo above.</div>`
      : !matches.length ? html`<div class="muted" style="font-size:12px">No repos match “${filter}”.</div>`
      : html`<div class="repolist">${matches.map((r) => html`<div key=${r.full_name} style="display:flex;align-items:center;gap:8px;margin:5px 2px">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${r.full_name}</span><button class="btn" disabled=${busy} onClick=${() => add(r.full_name)}>Add</button></div>`)}</div>`}
  <//>`;
}
