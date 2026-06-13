// Tests for fallback chain, auto-switch flag, and per-issue model override (store layer).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-models-")), "test.db");
const s = await import("../dist/store.js");

test("fallbackChain: default empty, set/get/round-trip", () => {
  assert.deepEqual(s.getFallbackChain(), [], "default is empty");
  const chain = [
    { providerId: "glm-abc", model: "glm-4.6" },
    { providerId: "deepseek-xyz", model: "deepseek-chat" },
  ];
  s.setFallbackChain(chain);
  assert.deepEqual(s.getFallbackChain(), chain, "round-trip matches");
  s.setFallbackChain([]);
  assert.deepEqual(s.getFallbackChain(), [], "can be cleared");
});

test("autoSwitchOnLimit: default off, toggled via setSetting", () => {
  assert.equal(s.getAutoSwitchOnLimit(), false, "default is off");
  s.setSetting("auto_switch_on_limit", "on");
  assert.equal(s.getAutoSwitchOnLimit(), true, "on after setting");
  s.setSetting("auto_switch_on_limit", "off");
  assert.equal(s.getAutoSwitchOnLimit(), false, "off after resetting");
});

test("per-issue model override: set, get, clear", () => {
  const repo = "owner/repo";
  const num = 42;
  assert.equal(s.getIssueModelOverride(repo, num), null, "null before set");
  s.setIssueModelOverride(repo, num, "glm-abc", "glm-4.6");
  const got = s.getIssueModelOverride(repo, num);
  assert.deepEqual(got, { providerId: "glm-abc", model: "glm-4.6" }, "correct value after set");
  s.clearIssueModelOverride(repo, num);
  assert.equal(s.getIssueModelOverride(repo, num), null, "null after clear");
});

test("per-issue model override: different issues don't interfere", () => {
  s.setIssueModelOverride("a/b", 1, "p1", "m1");
  s.setIssueModelOverride("a/b", 2, "p2", "m2");
  assert.equal(s.getIssueModelOverride("a/b", 1)?.model, "m1");
  assert.equal(s.getIssueModelOverride("a/b", 2)?.model, "m2");
  s.clearIssueModelOverride("a/b", 1);
  assert.equal(s.getIssueModelOverride("a/b", 1), null, "only issue 1 cleared");
  assert.equal(s.getIssueModelOverride("a/b", 2)?.model, "m2", "issue 2 unaffected");
});
