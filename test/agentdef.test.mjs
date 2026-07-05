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


test("canWriteCode gates the derived tool set + plan path", async () => {
  const { toolsFor, planFilePath } = await import("../dist/store.js");
  assert.deepEqual(toolsFor({ canWriteCode: true }), ["Read", "Glob", "Grep", "Write", "Edit", "Bash"]);
  assert.deepEqual(toolsFor({ canWriteCode: false }), ["Read", "Glob", "Grep", "Write"]);
  assert.match(planFilePath(12, "spec", new Date("2026-06-26")), /^_plan\/issue-12_2026-06-26_spec\.md$/);
  assert.match(planFilePath(3), /^_plan\/issue-3_\d{4}-\d{2}-\d{2}_notes\.md$/);
});

test("canWriteCode round-trips + back-compat inference for legacy rows", () => {
  s.upsertAgentDef({ name: "coder", handle: "@coder", canWriteCode: true, persona: "writes code" });
  assert.equal(s.getAgentDef("coder").canWriteCode, true);
  assert.deepEqual(s.getAgentDef("coder").tools, ["Read", "Glob", "Grep", "Write", "Edit", "Bash"], "tools derived from canWriteCode");
  s.upsertAgentDef({ name: "speccer", handle: "@spec2", canWriteCode: false, persona: "writes specs" });
  assert.equal(s.getAgentDef("speccer").canWriteCode, false);
  s.deleteAgentDef("coder"); s.deleteAgentDef("speccer");
});
