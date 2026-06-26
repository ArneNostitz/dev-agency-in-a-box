// H/M/L tier resolution + fallback chain.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "tiers-")), "agency.db");
const { setProviders, tierModel, fallbackFor, parseModelRef, setIssueProvider, getIssueProvider, setIssueAgentModel, getIssueAgentModels, setIssueUseFallback, getIssueUseFallback } = await import("../dist/db/providers.js");

setProviders([
  { id: "glm", name: "GLM", baseUrl: "https://x", apiKey: "k", models: ["glm-5.2", "glm-4.6"],
    tiers: { high: { model: "glm-5.2", fallback: "claude/claude-sonnet-4-6" }, low: { model: "glm-4.6", fallback: "" } } },
  { id: "claude", name: "Claude", baseUrl: "", apiKey: "", models: ["claude-sonnet-4-6"],
    tiers: { medium: { model: "claude-sonnet-4-6", fallback: "glm/glm-4.6" } } },
]);

test("tierModel resolves a tier to its provider model", () => {
  assert.deepEqual(tierModel("glm", "high"), { providerId: "glm", model: "glm-5.2" });
  assert.deepEqual(tierModel("glm", "low"), { providerId: "glm", model: "glm-4.6" });
  // unset tier → first model
  assert.deepEqual(tierModel("glm", "medium"), { providerId: "glm", model: "glm-5.2" });
});

test("fallbackFor returns the model's tier fallback", () => {
  assert.deepEqual(fallbackFor("glm", "glm-5.2"), { providerId: "claude", model: "claude-sonnet-4-6" });
  assert.equal(fallbackFor("glm", "glm-4.6"), null); // no fallback set
  assert.deepEqual(fallbackFor("claude", "claude-sonnet-4-6"), { providerId: "glm", model: "glm-4.6" });
});

test("per-issue provider + per-agent + useFallback round-trip", () => {
  const repo = "a/b", n = 1;
  setIssueProvider(repo, n, "glm");
  assert.equal(getIssueProvider(repo, n), "glm");
  setIssueAgentModel(repo, n, "developer", "claude/claude-sonnet-4-6");
  assert.deepEqual(getIssueAgentModels(repo, n), { developer: "claude/claude-sonnet-4-6" });
  assert.equal(getIssueUseFallback(repo, n), true); // default on
  setIssueUseFallback(repo, n, false);
  assert.equal(getIssueUseFallback(repo, n), false);
});
