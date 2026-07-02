// resolveChatExec honors Settings + the chatbox model pick: a resolved {providerId, model} routes the
// chat run at THAT provider (its own key+endpoint for a third-party one, the Claude subscription for a
// Claude-native pick) instead of always defaulting to the subscription. Issue #101 / #108.
//
// Since #108, resolveChatExec returns the resolved ROUTE ({model, provider, authKind}) — the runLLM
// funnel + each runner do the env translation. So these assertions check the route (provider + authKind
// + model) rather than a pre-baked env; the env translation itself is covered by sdk-claude tests.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "chat-model-")), "agency.db");
process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-sub-token"; // a Claude subscription credential is present

const { setProviders } = await import("../dist/store.js");
const { resolveChatExec } = await import("../dist/agents/chat.js");

setProviders([
  { id: "glm", name: "GLM", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiKey: "sk-glm", models: ["glm-4.6"] },
  { id: "claude", name: "Claude (Subscription)", baseUrl: "", apiKey: "", models: ["claude-sonnet-4-6", "claude-opus-4-8"] },
]);

test("no pick → Claude subscription default (unchanged global-caller behaviour)", () => {
  const { model, provider, authKind } = resolveChatExec("");
  assert.equal(model, "claude-sonnet-4-6");
  assert.equal(authKind, "subscription");
  assert.equal(provider, null); // Claude-native: no provider row, the runner uses the subscription token
});

test("chatbox pick on a third-party provider routes at that provider's key + endpoint", () => {
  const { model, provider, authKind } = resolveChatExec("", { providerId: "glm", model: "glm-4.6" });
  assert.equal(model, "glm-4.6");
  assert.equal(authKind, "apiKey");
  assert.equal(provider.id, "glm");
  assert.equal(provider.baseUrl, "https://open.bigmodel.cn/api/anthropic"); // the runner points here
});

test("chatbox pick on a Claude-native provider honors the chosen model on the subscription", () => {
  const { model, provider, authKind } = resolveChatExec("", { providerId: "claude", model: "claude-opus-4-8" });
  assert.equal(model, "claude-opus-4-8");
  assert.equal(authKind, "subscription"); // not the third-party GLM key
  assert.equal(provider, null);
});
