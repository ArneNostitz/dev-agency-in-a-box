// Tests for parseDiscoveredChecks — the self-adjusting bit of the code-only tester (Phase 2).
import test from "node:test";
import assert from "node:assert/strict";
import { parseDiscoveredChecks } from "../dist/checks.js";

test("parseDiscoveredChecks: parses a CHECKS_JSON block from an LLM report", () => {
  const text = `All checks passed.\n\nCHECKS_JSON: {"requires":"python3","install":"pip install -r requirements.txt","checks":[{"name":"test","cmd":"python3 -m pytest -q"}]}`;
  const set = parseDiscoveredChecks(text);
  assert.ok(set, "parsed");
  assert.equal(set.requires, "python3");
  assert.equal(set.install, "pip install -r requirements.txt");
  assert.equal(set.checks.length, 1);
  assert.equal(set.checks[0].cmd, "python3 -m pytest -q");
});

test("parseDiscoveredChecks: works with fenced block and minimal fields", () => {
  const text = "Swift package.\n```\nCHECKS_JSON: {\"checks\":[{\"name\":\"build\",\"cmd\":\"swift build\"},{\"name\":\"test\",\"cmd\":\"swift test\"}]}\n```";
  const set = parseDiscoveredChecks(text);
  assert.ok(set);
  assert.equal(set.checks.length, 2);
  assert.equal(set.requires, undefined);
});

test("parseDiscoveredChecks: returns null when absent or malformed", () => {
  assert.equal(parseDiscoveredChecks("no machine line here"), null);
  assert.equal(parseDiscoveredChecks("CHECKS_JSON: {not json}"), null);
  assert.equal(parseDiscoveredChecks('CHECKS_JSON: {"checks":[]}'), null, "empty checks → null");
});
