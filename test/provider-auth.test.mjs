// providerAuth: how a selected provider authenticates (subscription token vs its own apiKey).
import test from "node:test";
import assert from "node:assert/strict";
import { providerAuth } from "../dist/agents/provider-auth.js";

test("Claude-native provider (no key, no/anthropic baseUrl) → subscription when a Claude cred exists", () => {
  assert.equal(providerAuth({ name: "Claude (Subscription)", baseUrl: "", apiKey: "" }, true), "subscription");
  assert.equal(providerAuth({ baseUrl: "https://api.anthropic.com", apiKey: "" }, true), "subscription");
  assert.equal(providerAuth(null, true), "subscription"); // implicit default
});

test("Claude-native provider with NO Claude cred → missing (preflight should explain)", () => {
  assert.equal(providerAuth({ baseUrl: "", apiKey: "" }, false), "missing");
  assert.equal(providerAuth(null, false), "missing");
});

test("third-party provider with key + baseUrl → apiKey (regardless of Claude cred)", () => {
  const glm = { baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKey: "sk-glm" };
  assert.equal(providerAuth(glm, true), "apiKey");
  assert.equal(providerAuth(glm, false), "apiKey");
});

test("half-configured third-party (baseUrl but no key) → missing", () => {
  assert.equal(providerAuth({ baseUrl: "https://x.example/anthropic", apiKey: "" }, true), "missing");
  assert.equal(providerAuth({ baseUrl: "https://x.example/anthropic", apiKey: "" }, false), "missing");
});
