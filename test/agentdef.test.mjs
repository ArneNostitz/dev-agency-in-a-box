// v3 P3: agent registry + chat-agent resolution.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-agentdef-")), "test.db");
const s = await import("../dist/store.js");

test("seedBaseAgents registers all 6 workflow-referenceable roles as builtin, editable rows", () => {
  // Fresh install bug (#152-adjacent): only spec-creator/grill-me were ever seeded, so "developer"
  // (used by the default Full-build workflow) had no agent_def row at all — invisible on the Agents
  // page, and any workflow step referencing an unrecognized/deleted agent silently misrouted instead
  // of failing clearly.
  s.seedBaseAgents();
  const names = ["planner", "architect", "developer", "reviewer", "tester", "decomposer"];
  const handles = { planner: "@plan", architect: "@arch", developer: "@dev", reviewer: "@review", tester: "@test", decomposer: "@split" };
  for (const name of names) {
    const d = s.getAgentDef(name);
    assert.ok(d, `${name} seeded`);
    assert.equal(d.handle, handles[name]);
    assert.equal(d.builtin, true, `${name} is builtin (protected from delete)`);
    assert.ok(d.defaultTask.length > 0, `${name} has a default task`);
  }
  assert.equal(s.getAgentDef("developer").canWriteCode, true);
  assert.equal(s.getAgentDef("planner").canWriteCode, false);
});

test("seedBaseAgents is idempotent — a user's edit to a base role survives re-seeding", () => {
  s.seedBaseAgents();
  s.upsertAgentDef({ name: "developer", handle: "@dev", canWriteCode: true, defaultTask: "Custom instructions the user wrote." });
  s.seedBaseAgents(); // simulates a restart
  assert.equal(s.getAgentDef("developer").defaultTask, "Custom instructions the user wrote.", "re-seed must not clobber an existing row");
});

test("deleteAgentDef refuses to delete a builtin base role", () => {
  s.seedBaseAgents();
  s.deleteAgentDef("developer");
  assert.ok(s.getAgentDef("developer"), "builtin row survives a delete attempt");
});

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
