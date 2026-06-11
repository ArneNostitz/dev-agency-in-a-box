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
    user: { id: 1, username: "arne", role: "admin", email: "a@x.com" }, authEnabled: true,
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

  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => window.document.querySelector(s);
  const click = (el) => { if (!el) throw new Error("element not found"); el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };

  // Composer (uses hooks) — opening it would crash if invoked as a function not an element.
  click(q('[aria-label="New issue"]'));
  await tick(40);
  assert.match(root.innerHTML, /Add to Planned/, "composer opens with two-button submit");
  assert.match(root.innerHTML, /Start now/, "composer has Start now");
  click(q(".sheet .sh .iconbtn")); // close
  await tick(40);

  // Settings (uses hooks).
  click(q('[aria-label="Settings"]'));
  await tick(40);
  assert.match(root.innerHTML, /Automation/, "settings opens");
  assert.match(root.innerHTML, /Pipeline/, "settings shows pipeline knobs");
  assert.match(root.innerHTML, /Your credentials/, "credentials section renders for a signed-in user");
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
