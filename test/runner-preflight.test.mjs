// Runner binary preflight: pick the right executable per runner kind, and detect whether it's
// installed — so a missing CLI falls back to an SDK runner instead of a raw spawn ENOENT.
import test from "node:test";
import assert from "node:assert/strict";
import { runnerBinary, binaryAvailable } from "../dist/runners/registry.js";

test("runnerBinary: SDK runners have no binary (in-process); CLI kinds resolve their executable", () => {
  assert.equal(runnerBinary("claude-sdk"), null);
  assert.equal(runnerBinary("pi-cli"), null); // pi now runs in-process via createAgentSession (no `pi` binary)
  assert.equal(runnerBinary("custom-cli", "mytool --flag {task}"), "mytool");
});

test("binaryAvailable: true for a real PATH binary, false for a missing one", () => {
  // node runs this test, so it's guaranteed on PATH.
  assert.equal(binaryAvailable("node"), true);
  assert.equal(binaryAvailable("definitely-not-installed-xyz-9999"), false);
  assert.equal(binaryAvailable(""), false);
});

test("binaryAvailable: absolute path checked directly", () => {
  assert.equal(binaryAvailable("/definitely/missing/pi"), false);
});
