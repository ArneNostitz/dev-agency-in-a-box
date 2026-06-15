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

test("preact dashboard mounts and renders the board frame + data", async () => {
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
      { repo: "acme/app", number: 2, title: "Ready PR", state: "agency:ready", pr_number: 5, review: "approved", updated_at: new Date().toISOString(), auto: {} },
      // Issue 3 simulates the "fix" flow: has a PR (was in Review) but is now actively being fixed.
      // classify() must put it in Working (via i.running), not keep it in Review (via i.pr_number).
      { repo: "acme/app", number: 3, title: "Fix running now", state: "agency:in-progress", pr_number: 7, running: true, updated_at: new Date().toISOString(), auto: {} },
      // Epic parent — should be pinned at the top of the Working column
      { repo: "acme/app", number: 4, title: "My Epic", state: "agency:epic", epic: { total: 1, done: 0, children: [{ child: 5, title: "Sub task", state: "open", closed: 0 }] }, updated_at: new Date().toISOString(), auto: {} },
      // Sub-issue — should show parent bar "#4 · My Epic" in the card
      { repo: "acme/app", number: 5, title: "Sub task", state: "agency:in-progress", parentEpic: { number: 4, title: "My Epic" }, updated_at: new Date().toISOString(), auto: {} },
    ],
  };
  const route = (u) => {
    u = String(u);
    if (u.includes("/data")) return SAMPLE;
    if (u.includes("/thread")) return { author: "arne", createdAt: new Date().toISOString(), body: "hello", comments: [] };
    if (u.includes("/app-info")) return { kind: "none" };
    if (u.includes("/pr-status")) return { review: { verdict: "approved" }, merge: { mergeable: "clean" } };
    return {};
  };
  global.fetch = async (u) => ({ ok: true, json: async () => route(u), text: async () => "" });

  // Rewrite the absolute vendor import (browser path) to a file URL so Node can resolve it.
  const src = readFileSync(join(HERE, "..", "web", "app.js"), "utf8");
  const vendorUrl = pathToFileURL(join(HERE, "..", "web", "vendor", "standalone.mjs")).href;
  const patched = src.replace("/web/vendor/standalone.mjs", vendorUrl);
  const tmp = join(mkdtempSync(join(tmpdir(), "daui-")), "app.mjs");
  writeFileSync(tmp, patched);

  const mod = await import(pathToFileURL(tmp).href);
  assert.equal(typeof mod.mount, "function", "app.js exports mount()");
  mod.mount(window.document.getElementById("root"));

  // Initial synchronous render: the shell + column labels must be present.
  let htmlNow = window.document.getElementById("root").innerHTML;
  assert.match(htmlNow, /Dev Agency/, "brand renders");
  assert.match(htmlNow, /Planned/, "Planned column renders");
  assert.match(htmlNow, /Working/, "Working column renders");

  // Let the data fetch + effects flush, then the cards should appear.
  await new Promise((r) => setTimeout(r, 150));
  const root = window.document.getElementById("root");
  assert.match(root.innerHTML, /A planned task/, "planned issue card renders from /data");

  // Verify lane placement for the fix flow: an issue with pr_number AND running:true must go to
  // Working, not Review. The mobile TabBar shows counts per column, so "Working · 3" confirms
  // classify() placed the fix-running card + epic + sub-issue in Working rather than Review.
  const html2 = root.innerHTML;
  assert.match(html2, /Working.*?·.*?3|Working\s*·\s*3/, "Working tab shows 3 issues (fix-running + epic + sub-issue)");
  // Review should have 1 card (the approved PR), not more.
  assert.match(html2, /Review.*?·.*?1|Review\s*·\s*1/, "Review tab shows only 1 issue (not the fix-running card)");

  // Switch to Working tab (mobile renders one column at a time; matchMedia returns non-desktop)
  const workingTabBtn = Array.from(root.querySelectorAll(".tab")).find((b) => /Working/.test(b.textContent));
  if (workingTabBtn) {
    workingTabBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  }

  // Epic pinning: the parent bar for the sub-issue must render with parent info
  const parentBar = root.querySelector(".card-parent-bar");
  assert.ok(parentBar, "card-parent-bar element exists for sub-issue");
  assert.match(parentBar.textContent, /#4/, "parent bar shows parent issue number");
  assert.match(parentBar.textContent, /My Epic/, "parent bar shows parent issue title");

  // Epic pin divider: Working column must have the section divider between pinned epics and tasks
  const sectDiv = root.querySelector(".col-sect-div");
  assert.ok(sectDiv, "col-sect-div divider renders in Working column between epic pins and sub-issues");

  // Switch back to Planned tab so subsequent interactions (Add Issue, etc.) work as expected
  const plannedTabBtn = Array.from(root.querySelectorAll(".tab")).find((b) => /Planned/.test(b.textContent));
  if (plannedTabBtn) {
    plannedTabBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  }

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
  assert.match(root.innerHTML, /arne/, "signed-in user shown");
  click(q(".sheet .sh .iconbtn"));
  await tick(40);

  // Detail (uses hooks) — open the first card.
  click(q(".card"));
  await tick(80);
  assert.match(root.innerHTML, /Conversation/, "detail opens with conversation pane");

  dom.window.close();
});
