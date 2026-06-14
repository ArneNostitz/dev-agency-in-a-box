// v3 P5: skills (Claude Code schema) + hooks store + injection.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-skills-")), "test.db");
const s = await import("../dist/store.js");

test("skill CRUD + skillsPrompt renders SKILL blocks", () => {
  s.upsertSkill({ name: "commit-style", description: "Use when writing a commit message", body: "Imperative mood, <72 chars." });
  assert.equal(s.getSkill("commit-style").description, "Use when writing a commit message");
  assert.ok(s.listSkills().some((x) => x.name === "commit-style"));
  const p = s.skillsPrompt(["commit-style", "does-not-exist"]);
  assert.match(p, /SKILL: commit-style/);
  assert.match(p, /Imperative mood/);
  assert.equal(s.skillsPrompt([]), "");
  s.deleteSkill("commit-style");
  assert.equal(s.getSkill("commit-style"), null);
});

test("hook CRUD + listHooks filters by target/phase/enabled", () => {
  s.upsertHook({ target: "developer", phase: "pre", command: "npm ci" });
  s.upsertHook({ target: "developer", phase: "post", command: "npm run lint", enabled: false });
  s.upsertHook({ target: "tester", phase: "pre", command: "echo hi" });
  const devPre = s.listHooks("developer", "pre");
  assert.equal(devPre.length, 1);
  assert.equal(devPre[0].command, "npm ci");
  assert.equal(s.listHooks("developer", "post").length, 0, "disabled hook excluded");
  assert.ok(s.listHooks().length >= 2);
});
