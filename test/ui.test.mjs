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

  global.fetch = opts.fetch || (async () => ({ ok: true, json: async () => ({}), text: async () => "" }));

  // The dashboard is split across ES modules in web/ that import each other relatively. Copy them
  // all into one temp dir (rewriting the absolute vendor import to a file URL) so Node can resolve
  // the relative `./core.js` etc., then import the entry.
  const webDir = join(HERE, "..", "web");
  const vendorUrl = pathToFileURL(join(webDir, "vendor", "standalone.mjs")).href;
  const tmpDir = mkdtempSync(join(tmpdir(), "daui-"));
  for (const f of ["core", "board", "detail", "settings", "onboarding", "topbar", "usage", "agents", "app"]) {
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
    active: [], inflight: [], rateLimited: [], runs: [], activity: [], spendToday: { costUsd: 0 },
    session: { tokens: 0, budget: 0 }, config: {},
    issues: [
      { repo: "acme/app", number: 1, title: "A planned task", state: "planned", updated_at: new Date().toISOString(), auto: {} },
      { repo: "acme/app", number: 2, title: "Ready PR", state: "review", pr_number: 5, review: "approved", updated_at: new Date().toISOString(), auto: {} },
      // Issue 3 simulates the "fix" flow: has a PR (was in Review) but is now actively being fixed.
      // classify() must put it in Working (via i.running), not keep it in Review (via i.pr_number).
      { repo: "acme/app", number: 3, title: "Fix running now", state: "working", pr_number: 7, running: true, updated_at: new Date().toISOString(), auto: {} },
    ],
  };
  const route = (u) => {
    u = String(u);
    if (u.includes("/data")) return SAMPLE;
    if (u.includes("/thread")) return { author: "arne", createdAt: new Date().toISOString(), body: "hello", comments: [] };
    if (u.includes("/app-info")) return { kind: "none" };
    if (u.includes("/pr-status")) return { review: { verdict: "approved" }, merge: { mergeable: "clean" } };
    if (u.includes("/runner-status")) return { runners: [{ kind: "claude-sdk", label: "Claude Agent SDK (built-in)", binary: null, available: true }, { kind: "pi-cli", label: "pi", binary: "pi", pkg: "@earendil-works/pi-coding-agent", available: false }] };
    return {};
  };

  const { window, dom, root, mod } = await mountApp({
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

  // Verify lane placement for the fix flow: an issue with pr_number AND running:true must go to
  // Working, not Review. The mobile TabBar shows counts per column, so "Working · 1" confirms
  // classify() put the fix-running card in Working rather than Review.
  const html2 = root.innerHTML;
  assert.match(html2, /Working.*?·.*?1|Working\s*·\s*1/, "Working tab shows 1 issue (the fix-running card)");
  // Review should have 1 card (the approved PR), not 2 — the fix-running card must NOT be there.
  assert.match(html2, /Review.*?·.*?1|Review\s*·\s*1/, "Review tab shows only 1 issue (not the fix-running card)");

  // onboarding wizard renders (onboarded:false) — exercises its hook components
  assert.match(root.innerHTML, /Welcome to Dev Agency in a Box/, "onboarding wizard renders");
  assert.match(root.innerHTML, /Which models|Get started/, "onboarding has the model/get-started step");

  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => window.document.querySelector(s);
  const click = (el) => { if (!el) throw new Error("element not found"); el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };

  // Composer (uses hooks) — opening it would crash if invoked as a function not an element.
  // "Add Issue" lives in the Planned column header now (top + button was removed).
  const addBtn = Array.from(window.document.querySelectorAll(".colbtn.primary")).find((b) => /Add Issue/.test(b.textContent));
  click(addBtn);
  await tick(40);
  assert.match(root.innerHTML, /Add to Planned/, "composer opens with two-button submit");
  assert.match(root.innerHTML, /Start now/, "composer has Start now");
  click(q(".sheet .sh .iconbtn")); // close
  await tick(40);

  // Settings (uses hooks).
  click(q('[aria-label="Settings"]'));
  await tick(40);
  assert.match(root.innerHTML, /Settings/, "settings opens");
  assert.match(root.innerHTML, /Pipeline/, "settings shows pipeline knobs");
  assert.match(root.innerHTML, /Connections/, "connections section renders for a signed-in user");
  assert.match(root.innerHTML, /Show agent avatars/, "appearance section has the avatars toggle");
  assert.match(root.innerHTML, /Team \(admin\)/, "admin team section renders");
  assert.match(root.innerHTML, /Operations/, "operations panel renders");
  assert.match(root.innerHTML, /Agent runner/, "runner picker renders in settings");
  assert.match(root.innerHTML, /arne/, "signed-in user shown");
  click(q(".sheet .sh .iconbtn"));
  await tick(40);

  // Detail (uses hooks) — open the first card.
  click(q(".card"));
  await tick(80);
  assert.match(root.innerHTML, /Conversation/, "detail opens with conversation pane");

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
  assert.equal(mdOverlay("- item"), '<div class="mdb">- item</div>', "bullet line classed");
  assert.equal(mdOverlay("1. first"), '<div class="mdo">1. first</div>', "ordered line classed");
  const multi = mdOverlay("- a\n- b\n\ntext");
  assert.equal(multi.match(/<div/g).length, 4, "one div per source line, blanks included as spacer");
  assert.match(multi, /<div class="mde">/, "blank line renders as a spacer div");
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
  for (const f of ["core", "board"]) {
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
