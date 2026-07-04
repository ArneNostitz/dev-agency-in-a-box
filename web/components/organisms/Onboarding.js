// Organism — Onboarding. Extracted from web/onboarding.js; logic unchanged.
// The first-run setup wizard (models → GitHub → repo) and the add-repo sheet.
//
// Imports atoms + molecules + lib from their new (split) locations. OB_PROVIDERS now comes from
// data/providers.js (the canonical home, which breaks the old settings↔onboarding import cycle).
// GitHubConnect lives in the Settings organism now, so it's imported from there.
import { html, useState, useEffect } from "/web/vendor/standalone.mjs";
import { Icon } from "../atoms/Icon.js";
import { Spinner } from "../atoms/Spinner.js";
import { Sheet } from "../atoms/Sheet.js";
import { ProviderLogo } from "../atoms/ProviderLogo.js";
import { ProviderSearchSelect } from "../molecules/ProviderSearchSelect.js";
import { api, getJSON } from "../../lib/api.js";
import { toast } from "../../lib/toast.js";
import { OB_PROVIDERS } from "../../data/providers.js";
import { GitHubConnect } from "./Settings.js";


// ---------- onboarding wizard ----------
// There is no static model catalog. Each provider preset carries its `piKey` — pi's own built-in
// provider name (per pi's docs/providers.md auth.json table). pi knows each provider's endpoint +
// model catalog. The user picks a provider + pastes a key; the app writes it (merged) into pi's real
// ~/.pi/agent/auth.json and discovers models via `pi --list-models --provider <piKey>`.

const OB_GH_BOT = { id: "github_bot", title: "GitHub bot token", icon: "pr", kind: "secret", secretKey: "github_bot_token", placeholder: "github_pat_...",
  how: "The account the agency ACTS as — its commits and pull requests. Best practice: a dedicated bot GitHub account.\n\n1. On the bot account: github.com → Settings → Developer settings → Fine-grained tokens → Generate new token.\n2. Repository access: the repos you'll use.\n3. Permissions: Contents, Issues, Pull requests, Workflows = Read & write; Metadata = Read.\n4. Paste the token (github_pat_…) below.",
  link: "https://github.com/settings/tokens?type=beta", linkLabel: "Create a fine-grained token" };
const OB_GH_OWNER = { id: "github_owner", title: "Your GitHub token", optional: true, icon: "link", kind: "secret", secretKey: "github_user_token", placeholder: "github_pat_... (optional)",
  how: "Lets the agency comment and open issues under YOUR name, and auto-invite the bot to repos. Same steps as the bot token, on your own account (add Administration: Read & write for auto-invite).\n\nOptional — skip if you'll invite the bot manually.",
  link: "https://github.com/settings/tokens?type=beta", linkLabel: "Create a fine-grained token" };

export function ObTokenStep({ def, onDone, onBack }) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null); // null | "testing" | {ok, via, error}
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
    return api("/user-secret", { key: def.secretKey, value: v });
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
    <label>Token</label>
    <input type="password" autocomplete="off" placeholder=${def.placeholder} value=${val} onInput=${(e) => { setVal(e.target.value); setTest(null); }}/>
    <div class="muted" style="font-size:11px;margin:3px 2px 0">Paste it exactly — no spaces or line breaks (a stray space causes a 401).</div>
    ${shapeWarn ? html`<div class="testres bad">⚠ ${shapeWarn}</div>` : null}
    ${test && test !== "testing" ? html`<div class=${"testres " + (test.ok ? "ok" : "bad")}>${test.ok ? "✓ Authenticated via " + (test.via || "Claude") : "✗ " + (test.error || "Failed")}</div>` : null}
    <div class="obnav">
      <button class="btn" onClick=${onBack}>Back</button>
      ${def.optional ? html`<button class="btn ghost" onClick=${onDone}>Skip</button>` : null}
      ${isClaude ? html`<button class="btn ghost" disabled=${test === "testing"} onClick=${saveTest}>${test === "testing" ? html`<${Spinner} size=${15}/> Testing…` : "Save & test"}</button>` : null}
      <button class="btn primary" disabled=${busy} onClick=${save}>Save & continue</button>
    </div>`;
}

// Dead-simple model add for onboarding: pick a provider, app sets its CLI/baseURL/models, paste key.
export function ObAddModels({ onNext, onBack }) {
  const [providers, setProviders] = useState([]);
  const [secretKeys, setSecretKeys] = useState([]);
  const [pid, setPid] = useState("");
  const [val, setVal] = useState("");
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
    if (!val.trim()) { toast(def.kind === "secret" ? "Paste the token" : "Paste the API key"); return; }
    setBusy(true);
    const done = () => { setBusy(false); setPid(""); setVal(""); refresh(); toast("Added"); };
    const fail = () => { setBusy(false); toast("Couldn’t save", "error"); };
    if (def.kind === "secret") api("/user-secret", { key: def.secretKey, value: val.trim() }).then(done).catch(fail);
    else {
      // pi provider: name + piKey + key. The app writes the key into pi's auth.json (the login) and
      // discovers models live via `pi --list-models`.
      const prov = { id: def.id + "-" + Date.now().toString(36), name: def.label, piKey: def.piKey, apiKey: val.trim(), models: [] };
      api("/models", { providers: providers.concat(prov) }).then(() =>
        // Discover models live after adding (best-effort). Then run `done`.
        api("/discover-models", { id: prov.id }).catch(() => {}),
      ).then(done).catch(fail);
    }
  }
  return html`
    <div class="obki"><${Icon} name="flask" size=${26}/></div>
    <div class="obh">Add your models</div>
    <div class="obsub">Pick a provider, paste its key — done. Claude (subscription) is the recommended default; add more anytime in Settings.</div>
    ${added.length ? html`<div style="display:flex;flex-direction:column;gap:5px;margin:4px 0 10px">${added.map((n, ix) => html`<div key=${ix} style="display:flex;align-items:center;gap:7px;font-size:13px"><span class="statuschip s-ready"><${Icon} name="check" size=${12}/></span> <${ProviderLogo} name=${n} size=${15}/> ${n}</div>`)}</div>` : null}
    <label>+ Add a provider</label>
    <${ProviderSearchSelect} value=${pid} onChange=${(v) => { setPid(v); setVal(""); }} options=${OB_PROVIDERS.map((p) => ({ id: p.id, label: p.label, logo: p.label }))}/>
    ${def ? html`
      <div style="display:flex;align-items:center;gap:7px;margin:6px 2px;font-weight:560"><${ProviderLogo} name=${def.label} size=${18}/> ${def.label}</div>
      ${def.how ? html`<div class="muted" style="font-size:11px;white-space:pre-wrap;margin:6px 2px">${def.how}</div>` : null}
      ${def.link ? html`<a class="oblink" href=${def.link} target="_blank" rel="noopener">${def.linkLabel || "Get a key"} <${Icon} name="link" size=${14}/></a>` : null}
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
