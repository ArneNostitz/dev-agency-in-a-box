// Headless smoke test for the Preact dashboard (web/app.js). Mounts it under jsdom against a
// mocked API and asserts it renders without throwing — catches white-screen runtime errors.
import test from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Shared helper: create a jsdom window, wire up the browser globals the app
// needs, copy the web modules to a temp dir, mount the app, and return the
// { window, dom, root, mod } bundle.
//
// opts.fetch     – fetch mock (defaults to a minimal stub returning {})
// opts.online    – value to force onto navigator.onLine (default: leave as-is)
// opts.localStorage – object to pre-populate; keys → values (JSON-serialised)
// ---------------------------------------------------------------------------
async function mountApp(opts = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><head><meta id="metatheme"></head><body><div id="root"></div></body></html>',
    { pretendToBeVisual: true, url: "https://devagency.test/" },
  );
  const { window } = dom;

  // Globals the client expects (browser environment). Some Node globals (navigator) are
  // getter-only, so assign defensively and only what Preact/the app actually reads.
  const setG = (k, v) => { try { global[k] = v; } catch { try { Object.defineProperty(global, k, { value: v, configurable: true }); } catch {} } };
  setG("window", window);
  setG("document", window.document);
  setG("FileReader", window.FileReader);
  setG("localStorage", window.localStorage);
  setG("getSelection", () => ({ removeAllRanges() {}, addRange() {} }));
  setG("requestAnimationFrame", (cb) => { const t = setTimeout(() => cb(Date.now()), 0); if (t && t.unref) t.unref(); return t; });
  setG("cancelAnimationFrame", (id) => clearTimeout(id));
  // The app starts polling intervals; unref them so the test process can exit.
  const realSI = global.setInterval;
  setG("setInterval", (fn, ms) => { const t = realSI(fn, ms); if (t && t.unref) t.unref(); return t; });
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  setG("matchMedia", window.matchMedia);
  setG("EventSource", class { constructor() {} close() {} });

  if (opts.online !== undefined) {
    try { Object.defineProperty(window.navigator, "onLine", { get: () => opts.online, configurable: true }); } catch {}
  }
  if (opts.localStorage) {
    for (const [k, v] of Object.entries(opts.localStorage)) window.localStorage.setItem(k, JSON.stringify(v));
  }
  // v4: the top-level view (list|board|chat) is read raw from localStorage at mount.
  if (opts.view) window.localStorage.setItem("view", opts.view);

  global.fetch = opts.fetch || (async () => ({ ok: true, json: async () => ({}), text: async () => "" }));

  // The dashboard is split across ES modules in web/ that import each other relatively. Copy them
  // all into one temp dir (rewriting the absolute vendor import to a file URL) so Node can resolve
  // the relative `./core.js` etc., then import the entry.
  const webDir = join(HERE, "..", "web");
  const vendorUrl = pathToFileURL(join(webDir, "vendor", "standalone.mjs")).href;
  const tmpDir = mkdtempSync(join(tmpdir(), "daui-"));
  for (const f of ["core", "ui", "layout", "board", "detail", "settings", "onboarding", "topbar", "usage", "agents", "workflows", "builder", "table", "orch", "app"]) {
    const src = readFileSync(join(webDir, f + ".js"), "utf8").split("/web/vendor/standalone.mjs").join(vendorUrl);
    writeFileSync(join(tmpDir, f + ".js"), src);
  }
  const mod = await import(pathToFileURL(join(tmpDir, "app.js")).href);
  mod.mount(window.document.getElementById("root"));
  const root = window.document.getElementById("root");
  return { window, dom, root, mod, vendorUrl, tmpDir };
}

test("preact dashboard mounts and renders the board frame + data", async () => {
  const SAMPLE = {
    user: { id: 1, username: "arne", role: "admin", email: "a@x.com" }, authEnabled: true, onboarded: false,
    secretKeys: ["claude_token"], users: [{ id: 1, username: "arne", role: "admin" }], invites: [],
    opsMeta: [
      { key: "trigger_mode", env: "TRIGGER_MODE", type: "select", options: ["mention", "label", "any"], def: "mention", label: "How issues start" },
      { key: "concurrency", env: "AGENCY_CONCURRENCY", type: "num", def: 3, label: "Max concurrent runs" },
      { key: "self_improve", env: "SELF_IMPROVE", type: "bool", def: true, label: "Self-improve PRs" },
    ],
    ops: { trigger_mode: "mention", concurrency: 3, self_improve: true },
    repos: ["acme/app"], auto: { resume: "", merge: "" }, autoRepos: { "acme/app": {} },
    github: { connected: false, user: null, clientIdSet: false },
    workflows: [{ id: "full-build", name: "Full build", trigger: "@dev", steps: [], gates: [], builtin: true }],
    active: [], inflight: [], rateLimited: [], runs: [], activity: [], spendToday: { costUsd: 0 },
    session: { tokens: 0, budget: 0 }, config: {},
    // /data carries the same provider list as /models, with auth annotations. The model pickers read
    // this: an auth:"missing" provider's models must NEVER reach a picker.
    providers: [
      { id: "glm-1", name: "GLM (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKey: "x", models: ["glm-4.6"], auth: "apiKey" },
      { id: "ds-dead", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", apiKey: "", models: ["deepseek-chat"], auth: "missing" },
    ],
    issues: [
      { repo: "acme/app", number: 1, title: "A planned task", state: "planned", updated_at: new Date().toISOString(), auto: {} },
      { repo: "acme/app", number: 2, title: "Ready PR", state: "review", pr_number: 5, review: "approved", updated_at: new Date().toISOString(), auto: {} },
      // Issue 3 simulates the "fix" flow: has a PR (was in Review) but is now actively being fixed.
      // classify() must put it in Working (via i.running), not keep it in Review (via i.pr_number).
      { repo: "acme/app", number: 3, title: "Fix running now", state: "working", pr_number: 7, running: true, updated_at: new Date().toISOString(), auto: {} },
      // Issue 4: a workflow in progress with real steps → exercises the detail-page timeline + per-step picker.
      { repo: "acme/app", number: 4, title: "Workflow run", state: "working", running: true, workflowId: "full-build",
        wfSteps: [{ agent: "@plan", name: "Plan", role: "planner" }, { agent: "@dev", name: "Dev", role: "developer" }],
        wfStep: 1, agentModels: {}, updated_at: new Date().toISOString(), auto: {} },
    ],
  };
  const route = (u) => {
    u = String(u);
    if (u.includes("/data")) return SAMPLE;
    if (u.includes("/thread")) return { author: "arne", createdAt: new Date().toISOString(), body: "hello", comments: [] };
    if (u.includes("/app-info")) return { kind: "none" };
    if (u.includes("/pr-status")) return { review: { verdict: "approved" }, merge: { mergeable: "clean" } };
    if (u.includes("/models")) return { providers: [
      // Authenticated → its models ARE available to pickers.
      { id: "glm-1", name: "GLM (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKey: "x", models: ["glm-4.6"], tiers: { medium: { model: "glm-4.6", fallback: "" } }, auth: "apiKey" },
      // Keyless → auth "missing" → its models MUST NOT appear in any picker.
      { id: "ds-dead", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", apiKey: "", models: ["deepseek-chat"], auth: "missing" },
    ], roleModels: {}, globalModel: null, fallbackChain: [], autoSwitchOnLimit: false, roles: ["planner", "developer", "reviewer", "tester"] };
    if (u.includes("/runner-status")) return { runners: [{ kind: "claude-sdk", label: "Claude Agent SDK (built-in)", binary: null, available: true }, { kind: "pi-cli", label: "pi", binary: "pi", pkg: "@earendil-works/pi-coding-agent", available: false }] };
    return {};
  };

  const { window, dom, root, mod } = await mountApp({
    view: "board",
    fetch: async (u) => ({ ok: true, json: async () => route(u), text: async () => "" }),
  });

  assert.equal(typeof mod.mount, "function", "app.js exports mount()");

  // Initial synchronous render: the shell + column labels must be present.
  let htmlNow = window.document.getElementById("root").innerHTML;
  assert.match(htmlNow, /Dev Agency/, "brand renders");
  assert.match(htmlNow, /Planned/, "Planned column renders");
  assert.match(htmlNow, /Working/, "Working column renders");

  // Let the data fetch + effects flush, then the cards should appear.
  await new Promise((r) => setTimeout(r, 150));
  assert.match(root.innerHTML, /A planned task/, "planned issue card renders from /data");
  assert.ok(window.document.querySelector(".bcard .statuschip") || window.document.querySelector(".bcard"), "card uses the new status chip header");

  // Verify lane placement for the fix flow: an issue with pr_number AND running:true must go to
  // Working, not the "Needs you" lane. The mobile TabBar shows counts per column, so "Working · 1"
  // confirms classify() put the fix-running card in Working rather than the review lane.
  const html2 = root.innerHTML;
  assert.match(html2, /Working.*?·.*?1|Working\s*·\s*1/, "Working tab shows 1 issue (the fix-running card)");
  // The needs-you lane should have 1 card (the approved PR), not 2 — the fix-running card must NOT be there.
  assert.match(html2, /Needs you.*?·.*?1|Needs you\s*·\s*1/, "Needs-you tab shows only 1 issue (not the fix-running card)");

  // onboarding wizard renders (onboarded:false) — exercises its hook components
  assert.match(root.innerHTML, /Welcome to Dev Agency in a Box/, "onboarding wizard renders");
  assert.match(root.innerHTML, /Which models|Get started/, "onboarding has the model/get-started step");

  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => window.document.querySelector(s);
  const click = (el) => { if (!el) throw new Error("element not found"); el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };

  // Step through the simplified onboarding: welcome → models → github (device-flow connect).
  const getStarted = Array.from(window.document.querySelectorAll(".ob .btn")).find((b) => /Get started/.test(b.textContent));
  if (getStarted) {
    click(getStarted); await tick(40);
    assert.match(root.innerHTML, /Add your models/, "onboarding models step renders");
    const cont = Array.from(window.document.querySelectorAll(".ob .obnav .btn.primary")).find((b) => /Continue/.test(b.textContent));
    click(cont); await tick(40);
    assert.match(root.innerHTML, /Give it GitHub access/, "onboarding github step renders");
    assert.match(root.innerHTML, /Connect GitHub/, "onboarding uses the device-flow connect");
  }

  // Composer (uses hooks) — opening it would crash if invoked as a function not an element.
  // "Add Issue" lives in the Planned column header now (top + button was removed).
  const addBtn = Array.from(window.document.querySelectorAll(".colbtn.primary")).find((b) => /Add Issue/.test(b.textContent));
  click(addBtn);
  await tick(40);
  assert.match(root.innerHTML, /Add to Planned/, "composer opens with two-button submit");
  assert.match(root.innerHTML, /Start now/, "composer has Start now");
  assert.match(root.innerHTML, /Full build/, "agent picker shows workflow names");
  assert.ok(window.document.querySelector(".modal"), "composer uses the atomic Modal");
  click(q(".modal-scrim")); // close via backdrop
  await tick(40);

  // Settings (uses hooks).
  click(q('[aria-label="Settings"]'));
  await tick(40);
  assert.match(root.innerHTML, /Settings/, "settings opens");
  assert.match(root.innerHTML, /Run defaults/, "settings shows the run-defaults section");
  assert.match(root.innerHTML, /Connections/, "connections section renders for a signed-in user");
  assert.match(root.innerHTML, /Show agent avatars/, "appearance section has the avatars toggle");
  assert.match(root.innerHTML, /Team \(admin\)/, "admin team section renders");
  assert.match(root.innerHTML, /Automation/, "automation panel renders");
  assert.doesNotMatch(root.innerHTML, /Agent runner/, "runner picker removed (runner is auto-decided: Claude→claude-sdk, else pi)");
  assert.match(root.innerHTML, /arne/, "signed-in user shown");
  // Models & runners modal (redesigned picker): list of added models + per-row runner + Add.
  const modelsBtn = Array.from(window.document.querySelectorAll(".btn")).find((b) => /Models & API keys/.test(b.textContent));
  if (modelsBtn) {
    click(modelsBtn); await tick(60);
    assert.match(root.innerHTML, /Models.{1,8}runners/, "redesigned models modal renders");
    assert.match(root.innerHTML, /GLM \(Zhipu\)/, "an added provider is listed");
    assert.match(root.innerHTML, /Add provider/, "has the Add provider button");
    assert.ok(window.document.querySelector(".modal"), "uses the atomic Modal");
    assert.match(root.innerHTML, /Global default.{1,12}rate limit/, "global default + fallback section renders (per-agent now lives in the Agents page)");
    assert.match(root.innerHTML, /Save settings/, "Save lives in the modal footer");
    assert.doesNotMatch(root.innerHTML, /Per-agent model/, "per-agent model section moved OUT of the Models modal");
    assert.ok(Array.from(window.document.querySelectorAll(".tip")).some((t) => /Edit provider/.test(t.getAttribute("data-tip") || "")), "each provider row has an Edit button");
    const closeBtn = Array.from(window.document.querySelectorAll(".modal-f .btn")).find((b) => /Close/.test(b.textContent));
    if (closeBtn) { click(closeBtn); await tick(40); }
  }

  // GitHub tokens modal → the one-click device-flow connect (replaces bot+owner PATs).
  const ghBtn = Array.from(window.document.querySelectorAll(".btn")).find((b) => /GitHub tokens/.test(b.textContent));
  if (ghBtn) {
    click(ghBtn); await tick(60);
    assert.match(root.innerHTML, /Connect GitHub/, "device-flow connect button renders");
    assert.match(root.innerHTML, /OAuth App client ID/, "prompts for client ID when unset");
    const cb = window.document.querySelectorAll(".sheet .sh .iconbtn");
    click(cb[cb.length - 1]); await tick(40);
  }

  click(q(".sheet .sh .iconbtn"));
  await tick(40);

  // The topbar "Agents" button opens the Agents & Workflow builder, which now owns the per-agent
  // MODEL assignment (moved out of the Models modal). Open it, open the New-agent form, and confirm
  // the per-agent model picker (AgentModelPicker) renders there.
  const agentsBtn = window.document.querySelector('[aria-label="Agents"]');
  if (agentsBtn) {
    click(agentsBtn); await tick(60);
    const newAgentBtn = Array.from(window.document.querySelectorAll("button")).find((b) => /New agent/.test(b.textContent || ""));
    if (newAgentBtn) { click(newAgentBtn); await tick(60); }
    // The AgentModelPicker replaces the old free-text Model field. Its closed trigger shows the
    // "Default — inherit" option (tier/model options live behind the trigger).
    assert.match(root.innerHTML, /Default — inherit/, "the per-agent model picker renders on the Agents/workflow page (tier/model options behind the trigger)");
    const closeAgents = window.document.querySelectorAll(".modal-scrim");
    if (closeAgents.length) { click(closeAgents[0]); await tick(40); }
    const closeSheet = window.document.querySelector(".sheet .sh .iconbtn");
    if (closeSheet) { click(closeSheet); await tick(40); }
  }

  // Detail (uses hooks) — open the first card.
  click(q(".bcard"));
  await tick(80);
  assert.match(root.innerHTML, /Conversation/, "detail opens with conversation pane");

  // Open the workflow issue → its detail-page timeline (with per-step model pickers) must render.
  const wfCard = Array.from(window.document.querySelectorAll(".bcard")).find((c) => /Workflow run/.test(c.textContent));
  if (wfCard) {
    click(wfCard); await tick(80);
    assert.match(root.innerHTML, /Workflow run/, "workflow issue detail opens");
    assert.ok(window.document.querySelector(".dtl-flow"), "detail-page timeline (.dtl-flow) renders for a workflow issue");
    assert.ok(window.document.querySelectorAll(".dtl-flow .flow__pick").length >= 2, "each workflow step's avatar is a per-step model picker (.flow__pick)");
  }

  dom.window.close();
});

test("v4: default List view renders the rich progress table + timeline; Chat view mounts", async () => {
  const SAMPLE = {
    user: { id: 1, username: "arne", role: "admin" }, authEnabled: true, onboarded: true,
    repos: ["acme/app"], auto: { resume: "", merge: "" }, autoRepos: { "acme/app": {} },
    github: { connected: true }, workflows: [], active: [], runs: [], activity: [],
    spendToday: { costUsd: 0 }, session: { tokens: 0, budget: 0 }, config: {},
    issues: [
      { repo: "acme/app", number: 1, title: "A planned task", state: "planned", byAgent: true, updated_at: new Date().toISOString(), auto: {} },
      { repo: "acme/app", number: 2, title: "Running dev", state: "working", role: "developer", running: true, updated_at: new Date().toISOString(), auto: {} },
    ],
  };
  const route = (u) => {
    u = String(u);
    if (u.includes("/data")) return SAMPLE;
    if (u.includes("/orch")) return { thread: [] };
    return {};
  };
  const { window, dom, root } = await mountApp({
    view: "list",
    fetch: async (u) => ({ ok: true, json: async () => route(u), text: async () => "" }),
  });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(window.document.querySelector(".irow"), "card-row List renders by default");
  assert.match(root.innerHTML, /A planned task/, "planned row renders");
  assert.ok(window.document.querySelector(".listsec") || window.document.querySelector(".pane-list"), "the card List is the default list view");
  assert.match(root.innerHTML, /Running/, "a working+running issue shows a Running status");

  // Chat is now a toggle (slide-over panel / docked slot) — open it and assert the Orchestrator mounts.
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  const chatBtn = Array.from(window.document.querySelectorAll(".topbar button")).find((b) => /chat/i.test(b.getAttribute("data-tip") || ""));
  assert.ok(chatBtn, "chat toggle button exists in the top bar");
  chatBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(120);
  assert.match(root.innerHTML, /Orchestrator/, "chat toggle mounts the Orchestrator panel");
  assert.ok(window.document.querySelector(".orch-compose"), "orchestrator has a compose box");
  // Live run-state: the running issue (#2) surfaces in the chat's "Working now" strip.
  assert.match(root.innerHTML, /Working now/, "orchestrator reflects live run-state");
  assert.ok(window.document.querySelector(".orch-livecmt"), "live work comment renders when a run is active");
  dom.window.close();
});

test("v4: epics unfold their sub-issues as indented full rows in the List", async () => {
  const SAMPLE = {
    user: { id: 1, username: "arne", role: "admin" }, authEnabled: true, onboarded: true,
    repos: ["acme/app"], auto: {}, autoRepos: {}, github: { connected: true }, workflows: [],
    active: [], runs: [], activity: [], spendToday: { costUsd: 0 }, session: {}, config: {},
    issues: [
      { repo: "acme/app", number: 5, title: "Big epic", state: "agency:epic", updated_at: new Date().toISOString(), auto: {},
        epic: { total: 2, done: 1, children: [ { child: 6, title: "Child one", closed: 1, state: "done" }, { child: 7, title: "Child two", closed: 0, state: "working" } ] } },
      { repo: "acme/app", number: 7, title: "Child two", state: "working", running: true, updated_at: new Date().toISOString(), auto: {} },
    ],
  };
  const { window, dom, root } = await mountApp({
    view: "list",
    fetch: async (u) => ({ ok: true, json: async () => (String(u).includes("/data") ? SAMPLE : {}), text: async () => "" }),
  });
  await new Promise((r) => setTimeout(r, 150));
  assert.match(root.innerHTML, /Big epic/, "epic row renders");
  assert.ok(window.document.querySelector(".irow__exp"), "epic has an expand toggle");
  assert.ok(window.document.querySelector(".prow-child"), "sub-issues render as indented child rows (default unfolded)");
  assert.match(root.innerHTML, /Child one/, "stub sub-issue (#6, not in list) shows from epic.children");
  assert.match(root.innerHTML, /Child two/, "live sub-issue (#7) shows under the epic");
  dom.window.close();
});

// Pure unit tests for shapeToastMsg (web/core.js) — the toast-message tokenizer that splits a
// string into text/url/path segments. core.js imports the vendor bundle via an absolute path, so
// copy it to a temp dir rewriting that import, then import only the named export (no jsdom needed).
test("shapeToastMsg tokenizes text, urls, paths and mixed messages", async () => {
  const vendorUrl = pathToFileURL(join(HERE, "..", "web", "vendor", "standalone.mjs")).href;
  const tmpDir = mkdtempSync(join(tmpdir(), "dacore-"));
  const src = readFileSync(join(HERE, "..", "web", "core.js"), "utf8").split("/web/vendor/standalone.mjs").join(vendorUrl);
  writeFileSync(join(tmpDir, "core.js"), src);
  const { shapeToastMsg } = await import(pathToFileURL(join(tmpDir, "core.js")).href);

  const seg = (msg) => shapeToastMsg(msg);

  // Empty/falsy → single empty text segment (the render path relies on this).
  assert.deepEqual(seg(""), [{ t: "text", v: "" }], "empty message → one empty text segment");
  assert.deepEqual(seg(undefined), [{ t: "text", v: "" }], "falsy message → one empty text segment");

  // Plain text → one text segment, unchanged.
  assert.deepEqual(seg("hello world"), [{ t: "text", v: "hello world" }], "plain text is one segment");

  // URL only → one url segment carrying the raw URL.
  assert.deepEqual(seg("https://github.com/foo/bar/issues/49"), [{ t: "url", v: "https://github.com/foo/bar/issues/49" }], "url-only message → one url segment");

  // Absolute unix path only → one path segment.
  assert.deepEqual(seg("/home/user/src/app/file.js"), [{ t: "path", v: "/home/user/src/app/file.js" }], "path-only message → one path segment");

  // Mixed: text before, url in the middle, text after.
  assert.deepEqual(seg("see https://example.com/x/y for docs"), [
    { t: "text", v: "see " }, { t: "url", v: "https://example.com/x/y" }, { t: "text", v: " for docs" },
  ], "mixed text+url+text tokenizes in order");

  // Leading path (no preceding space) is still matched.
  assert.deepEqual(seg("/etc/hosts is next"), [
    { t: "path", v: "/etc/hosts" }, { t: "text", v: " is next" },
  ], "leading absolute path tokenizes");

  // Path preceded by a space: the leading whitespace stays with the text, the path segment is the
  // matched path only (no trailing/leading space), per the capture group.
  assert.deepEqual(seg("see /var/log/app.log done"), [
    { t: "text", v: "see " }, { t: "path", v: "/var/log/app.log" }, { t: "text", v: " done" },
  ], "space-prefixed path splits correctly");

  // URL wins over a path at the same position (tie-break: uNext <= pNext).
  assert.deepEqual(seg("https://x.io/a/b/c"), [{ t: "url", v: "https://x.io/a/b/c" }], "url beats path interpretation of the same substring");

  // Message with no recognizable segments → single text segment with the full string.
  assert.deepEqual(seg("no segments here at all"), [{ t: "text", v: "no segments here at all" }], "no-segment message → one text segment");
});

// Pure unit tests for the live-markdown composer helpers (web/core.js): mdOverlay renders a
// line-preserving preview (one <div> per source line, markers visible so the caret aligns), and
// continueMarkdownList auto-continues `- `/`1. ` on Enter.
test("mdOverlay renders one div per line with list/header markers preserved", async () => {
  const vendorUrl = pathToFileURL(join(HERE, "..", "web", "vendor", "standalone.mjs")).href;
  const tmpDir = mkdtempSync(join(tmpdir(), "dacore-md-"));
  const src = readFileSync(join(HERE, "..", "web", "core.js"), "utf8").split("/web/vendor/standalone.mjs").join(vendorUrl);
  writeFileSync(join(tmpDir, "core.js"), src);
  const { mdOverlay } = await import(pathToFileURL(join(tmpDir, "core.js")).href);

  assert.equal(mdOverlay(""), "", "empty input → empty preview");
  assert.equal(mdOverlay("hello world"), "<div>hello world</div>", "plain text is one div");
  assert.equal(mdOverlay("## Title"), '<div class="mdh mdh2">## Title</div>', "header preserves marker count");
  assert.equal(mdOverlay("- item"), '<div class="mdb">\u2022 item</div>', "bullet marker shown as a dot");
  assert.equal(mdOverlay("1. first"), '<div class="mdo">1. first</div>', "ordered line classed");
  const multi = mdOverlay("- a\n- b\n\ntext");
  assert.equal(multi.match(/<div/g).length, 4, "one div per source line, blanks included as spacer");
  assert.match(multi, /<div class="mde">/, "blank line renders as a spacer div");
});

test("md renders root-relative /attach image & link URLs (not just http) — pasted images show inline", async () => {
  const vendorUrl = pathToFileURL(join(HERE, "..", "web", "vendor", "standalone.mjs")).href;
  const tmpDir = mkdtempSync(join(tmpdir(), "dacore-md3-"));
  const src = readFileSync(join(HERE, "..", "web", "core.js"), "utf8").split("/web/vendor/standalone.mjs").join(vendorUrl);
  writeFileSync(join(tmpDir, "core.js"), src);
  const { md } = await import(pathToFileURL(join(tmpDir, "core.js")).href);

  // The bug: a pasted-image ref like ![image 1](/attach/<id>) stayed as literal text in comments
  // because the renderer only matched http(s) URLs. Root-relative /attach must render as <img>/<a>.
  assert.match(md("![image 1](/attach/abc123)"), /<img alt="image 1" src="\/attach\/abc123">/, "root-relative image → <img>");
  assert.match(md("[file](/attach/def456)"), /<a href="\/attach\/def456"[^>]*>file<\/a>/, "root-relative link → <a>");
  assert.match(md("![x](https://example.com/y.png)"), /<img alt="x" src="https:\/\/example.com\/y.png">/, "absolute http(s) still works");
});

test("continueMarkdownList continues `- ` and `1. ` at line end, exits on empty item", async () => {
  const vendorUrl = pathToFileURL(join(HERE, "..", "web", "vendor", "standalone.mjs")).href;
  const tmpDir = mkdtempSync(join(tmpdir(), "dacore-md2-"));
  const src = readFileSync(join(HERE, "..", "web", "core.js"), "utf8").split("/web/vendor/standalone.mjs").join(vendorUrl);
  writeFileSync(join(tmpDir, "core.js"), src);
  const { continueMarkdownList } = await import(pathToFileURL(join(tmpDir, "core.js")).href);

  const mk = (value, pos) => ({ value, selectionStart: pos, selectionEnd: pos });

  let el = mk("hello", 5);
  assert.equal(continueMarkdownList(el), false, "no list → not handled");

  el = mk("- item", 6);
  assert.equal(continueMarkdownList(el), true, "bullet line handled");
  assert.equal(el.value, "- item\n- ", "bullet continues with new prefix");
  assert.equal(el.selectionStart, "- item\n- ".length, "caret lands after the new prefix");

  el = mk("- ", 2);
  assert.equal(continueMarkdownList(el), true, "empty bullet handled (exit)");
  assert.equal(el.value, "", "empty bullet removed");
  assert.equal(el.selectionStart, 0, "caret at start after exit");

  el = mk("1. first", 8);
  assert.equal(continueMarkdownList(el), true, "ordered line handled");
  assert.equal(el.value, "1. first\n2. ", "ordered list increments");
  assert.equal(el.selectionStart, "1. first\n2. ".length, "caret after new ordered prefix");
});

// Unit test for md (web/core.js): local-first attachments are served from root-relative
// /attach/<id> URLs, so the inline image/link renderer must accept them (not only http(s)),
// otherwise pasted images stay as raw `![…](/attach/…)` text in comments (issue #87).
test("md renders root-relative /attach image and link URLs", async () => {
  const vendorUrl = pathToFileURL(join(HERE, "..", "web", "vendor", "standalone.mjs")).href;
  const tmpDir = mkdtempSync(join(tmpdir(), "dacore-mdimg-"));
  const src = readFileSync(join(HERE, "..", "web", "core.js"), "utf8").split("/web/vendor/standalone.mjs").join(vendorUrl);
  writeFileSync(join(tmpDir, "core.js"), src);
  const { md } = await import(pathToFileURL(join(tmpDir, "core.js")).href);

  const img = md("![image 1](/attach/5674948b82ae40d0b30e)");
  assert.match(img, /<img alt="image 1" src="\/attach\/5674948b82ae40d0b30e">/, "relative /attach image renders as <img>");

  const file = md("[📎 notes.pdf](/attach/abc123)");
  assert.match(file, /<a href="\/attach\/abc123"[^>]*>📎 notes.pdf<\/a>/, "relative /attach link renders as <a>");

  // http(s) URLs still work.
  assert.match(md("![x](https://e.com/a.png)"), /<img alt="x" src="https:\/\/e.com\/a.png">/, "absolute image still renders");
});

// Unit tests for getSetupProgress (web/core.js): derives the real clone/setup % from the live
// activity stream. The backend streams `📥 cloning <repo>… NN%` (real git progress) and `🧭 …`
// indexing lines; any later agent tool/text/start event ends the setup phase.
test("getSetupProgress parses real clone % and ends setup on agent activity", async () => {
  const vendorUrl = pathToFileURL(join(HERE, "..", "web", "vendor", "standalone.mjs")).href;
  const tmpDir = mkdtempSync(join(tmpdir(), "dacore-sp-"));
  const src = readFileSync(join(HERE, "..", "web", "core.js"), "utf8").split("/web/vendor/standalone.mjs").join(vendorUrl);
  writeFileSync(join(tmpDir, "core.js"), src);
  const { getSetupProgress } = await import(pathToFileURL(join(tmpDir, "core.js")).href);

  const ev = (kind, text) => ({ kind, text });

  // No stream → no setup progress.
  assert.equal(getSetupProgress([]), null, "empty stream → null");
  assert.equal(getSetupProgress(null), null, "null stream → null");

  // Latest line is a clone-with-real-percent → that % + phase.
  assert.deepEqual(getSetupProgress([ev("tool", "📥 cloning foo/bar… 0%")]), { percent: 0, phase: "cloning foo/bar…" }, "0% parsed");
  assert.deepEqual(getSetupProgress([ev("tool", "📥 cloning foo/bar… 42%")]), { percent: 42, phase: "cloning foo/bar…" }, "mid % parsed");
  assert.deepEqual(getSetupProgress([ev("tool", "📥 cloning foo/bar… done")]), { percent: 100, phase: "cloning foo/bar…" }, "done → 100%");

  // Clone line without a number (e.g. first emit before % arrives) → null percent, phase kept.
  assert.deepEqual(getSetupProgress([ev("tool", "📥 cloning foo/bar…")]), { percent: null, phase: "cloning foo/bar…" }, "no-number clone line");

  // Indexing line → null percent, indexing phase.
  assert.deepEqual(getSetupProgress([ev("tool", "🧭 using cached GitNexus index (refreshing in the background)")]), { percent: null, phase: "using cached GitNexus index (refreshing in the background)" }, "indexing line");

  // Once a real agent tool/text/start event appears after the setup line, setup is done → null.
  assert.equal(getSetupProgress([ev("tool", "📥 cloning foo/bar… 42%"), ev("start", "started (claude)"), ]), null, "start event ends setup");
  assert.equal(getSetupProgress([ev("tool", "📥 cloning foo/bar… 42%"), ev("text", "🤖 LLM Call: claude")]), null, "text event ends setup");
  assert.equal(getSetupProgress([ev("tool", "📥 cloning foo/bar… 42%"), ev("tool", "$ npm install")]), null, "non-setup tool event ends setup");

  // Setup line is the latest (no agent activity yet) → still in setup.
  assert.deepEqual(getSetupProgress([ev("start", "started (claude)"), ev("tool", "📥 cloning foo/bar… 80%")]), { percent: 80, phase: "cloning foo/bar…" }, "latest setup line wins");
});

// Offline queue: pre-populate localStorage and verify the status-line indicator renders.
test("offline queue indicator shows when dab_offline_q has entries", async () => {
  const SAMPLE = {
    repos: ["acme/app"], auto: {}, autoRepos: {}, active: [], activity: [],
    session: {}, config: {}, issues: [
      { repo: "acme/app", number: 1, title: "Task", state: "planned", updated_at: new Date().toISOString(), auto: {} },
    ],
  };

  const { dom, root } = await mountApp({
    fetch: async (u) => ({ ok: true, json: async () => (String(u).includes("/data") ? SAMPLE : {}), text: async () => "" }),
    online: false,
    localStorage: { dab_offline_q: [{ type: "comment", repo: "acme/app", number: 1, body: "offline comment", _qid: 42 }] },
  });

  await new Promise((r) => setTimeout(r, 150));
  assert.match(root.innerHTML, /queued offline/, "status line shows 'queued offline' indicator when queue is non-empty");

  dom.window.close();
});

test("epic card nests its sub-issues and hides their standalone cards", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "https://devagency.test/" });
  const { window } = dom;
  const setG = (k, v) => { try { global[k] = v; } catch { try { Object.defineProperty(global, k, { value: v, configurable: true }); } catch {} } };
  setG("window", window); setG("document", window.document);

  // Build temp copies of the web modules (rewriting the absolute vendor import) so Node resolves the
  // relative imports, then load Board + the vendor's html/render directly.
  const webDir = join(HERE, "..", "web");
  const vendorUrl = pathToFileURL(join(webDir, "vendor", "standalone.mjs")).href;
  const tmpDir = mkdtempSync(join(tmpdir(), "dagrp-"));
  for (const f of ["core", "ui", "board"]) {
    const src = readFileSync(join(webDir, f + ".js"), "utf8").split("/web/vendor/standalone.mjs").join(vendorUrl);
    writeFileSync(join(tmpDir, f + ".js"), src);
  }
  const { Board, nestedChildKeys } = await import(pathToFileURL(join(tmpDir, "board.js")).href);
  const { html, render } = await import(vendorUrl);

  const issues = [
    { repo: "acme/app", number: 10, title: "Big epic", state: "agency:epic", auto: {}, updated_at: new Date().toISOString(),
      epic: { total: 2, done: 1, children: [
        { child: 11, title: "Nested child A", state: "review", closed: false },
        { child: 12, title: "Nested child B", state: "done", closed: true },
      ] } },
    // The same sub-issues as their own open issues — these standalone cards must be hidden.
    { repo: "acme/app", number: 11, title: "STANDALONE-ELEVEN", state: "review", pr_number: 9, auto: {}, updated_at: new Date().toISOString() },
    { repo: "acme/app", number: 12, title: "STANDALONE-TWELVE", state: "done", auto: {}, updated_at: new Date().toISOString() },
  ];

  // Pure helper: keys of issues nested under a present epic parent.
  const keys = nestedChildKeys(issues);
  assert.ok(keys.has("acme/app#11") && keys.has("acme/app#12"), "both children are marked nested");
  assert.equal(keys.size, 2, "the epic parent itself is not nested");

  let opened = null;
  const act = { isBusy: () => false };
  const data = { config: {}, providers: [] };
  render(
    html`<${Board} issues=${issues} repos=${["acme/app"]} repoFilter="acme/app" tab="planned" sort="time" isDesktop=${true}
      onOpen=${() => {}} onOpenChild=${(r, n, t) => { opened = { r, n, t }; }} onAddRepo=${() => {}} onAddIssue=${() => {}}
      onAnalyze=${() => {}} auditRepos=${[]} act=${act} data=${data}/>`,
    window.document.getElementById("root"),
  );
  const root = window.document.getElementById("root");
  let h = root.innerHTML;

  assert.match(h, /Big epic/, "epic parent card renders");
  assert.match(h, /Sub-issues/, "epic card shows the collapsible sub-issue list");
  // Default-open because a child is in Review; the nested rows use the epic metadata titles.
  assert.match(h, /Nested child A/, "nested sub-issue row renders");
  assert.match(h, /Nested child B/, "second nested sub-issue row renders");
  assert.doesNotMatch(h, /STANDALONE-ELEVEN/, "the review sub-issue's standalone card is hidden");
  assert.doesNotMatch(h, /STANDALONE-TWELVE/, "the done sub-issue's standalone card is hidden");

  // Clicking a nested row opens that sub-issue's detail (via onOpenChild).
  const rowA = Array.from(window.document.querySelectorAll(".subrow")).find((b) => /Nested child A/.test(b.textContent));
  rowA.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(opened, { r: "acme/app", n: 11, t: "Nested child A" }, "row opens sub-issue #11");

  // Collapsing the list hides the rows.
  const toggle = window.document.querySelector(".subtoggle");
  toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.doesNotMatch(root.innerHTML, /Nested child A/, "rows hidden after collapsing");

  dom.window.close();
});
