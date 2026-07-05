// Tests for the newest-first model ordering (src/db/model-recency.ts) and the one-time
// activeModels migration ([] used to mean "all", now means "none") in getProviders.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-recency-")), "test.db");
const { sortModelsByRecency, newestModels } = await import("../dist/db/model-recency.js");
const s = await import("../dist/store.js");

test("sortModelsByRecency: version beats date, families stay grouped, -latest floats up", () => {
  const sorted = sortModelsByRecency([
    "claude-3-5-sonnet-20241022",
    "claude-opus-4-5",
    "claude-fable-5",
    "claude-opus-4-5-20251101",
    "claude-3-5-haiku-latest",
    "claude-opus-4-8",
  ]);
  assert.deepEqual(sorted, [
    "claude-fable-5", // [5] tops every 4.x, dated or not
    "claude-opus-4-8",
    "claude-opus-4-5-20251101", // dated 4.5 above the undated alias
    "claude-opus-4-5",
    "claude-3-5-haiku-latest", // -latest above its dated 3.5 sibling
    "claude-3-5-sonnet-20241022",
  ]);
  // Cross-family versions don't compare: gemma-4 must NOT outrank gemini-3.5.
  const google = sortModelsByRecency(["gemma-4-31b-it", "gemini-2.5-pro", "gemini-3.5-flash"]);
  assert.deepEqual(google, ["gemini-3.5-flash", "gemini-2.5-pro", "gemma-4-31b-it"]);
});

test("newestModels: picks from the dominant family", () => {
  const picked = newestModels(
    ["gemma-4-31b-it", "gemini-2.0-flash", "gemini-2.5-pro", "gemini-3-pro-preview", "gemini-3.5-flash"],
    3,
  );
  assert.deepEqual(picked, ["gemini-3.5-flash", "gemini-3-pro-preview", "gemini-2.5-pro"]);
});

test("getProviders migrates legacy activeModels [] (= all) to absent, once", () => {
  s.setSetting("providers", JSON.stringify([
    { id: "a", name: "A", piKey: "zai", apiKey: "k", models: ["m1", "m2"], activeModels: [] },
  ]));
  const migrated = s.getProviders();
  assert.equal(migrated[0].activeModels, undefined, "legacy [] normalized to absent");
  assert.equal(s.getSetting("active_models_v2"), "1", "migration stamped");
  // After the stamp, [] means "none active" and must survive a read untouched.
  s.setSetting("providers", JSON.stringify([
    { id: "a", name: "A", piKey: "zai", apiKey: "k", models: ["m1", "m2"], activeModels: [] },
  ]));
  assert.deepEqual(s.getProviders()[0].activeModels, [], "post-migration [] is preserved");
});
