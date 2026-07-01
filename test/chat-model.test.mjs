// resolveChatExec honors Settings + the chatbox model pick: a resolved {providerId, model} routes the
// chat run at THAT provider (its own key+endpoint for a third-party one, the Claude subscription for a
// Claude-native pick) instead of always defaulting to the subscription. Issue #101.
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
  const { model, env } = resolveChatExec("");
  assert.equal(model, "claude-sonnet-4-6");
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "claude-sub-token");
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
});

test("chatbox pick on a third-party provider routes at that provider's key + endpoint", () => {
  const { model, env } = resolveChatExec("", { providerId: "glm", model: "glm-4.6" });
  assert.equal(model, "glm-4.6");
  assert.equal(env.ANTHROPIC_BASE_URL, "https://open.bigmodel.cn/api/anthropic");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, "sk-glm");
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined); // not the Claude subscription
});

test("chatbox pick on a Claude-native provider honors the chosen model on the subscription", () => {
  const { model, env } = resolveChatExec("", { providerId: "claude", model: "claude-opus-4-8" });
  assert.equal(model, "claude-opus-4-8");
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "claude-sub-token");
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
});
