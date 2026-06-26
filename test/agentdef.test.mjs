// v3 P3: agent registry + chat-agent resolution.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-agentdef-")), "test.db");
const s = await import("../dist/store.js");

test("seedChatAgents registers spec-creator + grill-me as chat agents", () => {
  s.seedChatAgents();
  const spec = s.getAgentDef("spec-creator");
  assert.equal(spec.mode, "chat");
  assert.equal(spec.handle, "@spec");
  assert.ok(spec.persona.length > 0);
  assert.equal(spec.pushesGithub, true);
  assert.ok(s.getAgentDef("grill-me"));
});

test("upsert + list + delete custom agent", () => {
  s.upsertAgentDef({ name: "researcher", handle: "@research", mode: "chat", tools: ["Read"], persona: "Research things." });
  assert.equal(s.getAgentDef("researcher").tools[0], "Read");
  assert.ok(s.listAgentDefs().some((a) => a.name === "researcher"));
  s.deleteAgentDef("researcher");
  assert.equal(s.getAgentDef("researcher"), null);
});

test("interactive flag round-trips (default false)", () => {
  s.upsertAgentDef({ name: "talker", handle: "@talk", mode: "chat", tools: ["Read"], persona: "Talks.", interactive: true });
  assert.equal(s.getAgentDef("talker").interactive, true, "interactive persisted true");
  s.upsertAgentDef({ name: "quiet", handle: "@quiet", mode: "repo", tools: ["Read"], persona: "Runs ahead." });
  assert.equal(s.getAgentDef("quiet").interactive, false, "interactive defaults false");
  s.deleteAgentDef("talker"); s.deleteAgentDef("quiet");
});

test("chatAgentForText matches a mentioned handle", () => {
  s.seedChatAgents();
  assert.equal(s.chatAgentForText("hey @spec help me scope this")?.name, "spec-creator");
  assert.equal(s.chatAgentForText("@grill this plan")?.name, "grill-me");
  assert.equal(s.chatAgentForText("just a normal issue, no handle"), null);
});
