// Binary availability helper (used by the dashboard install preflight).
import test from "node:test";
import assert from "node:assert/strict";
import { binaryAvailable } from "../dist/runners/registry.js";

test("binaryAvailable: true for a real PATH binary, false for a missing one", () => {
  // node runs this test, so it's guaranteed on PATH.
  assert.equal(binaryAvailable("node"), true);
  assert.equal(binaryAvailable("definitely-not-installed-xyz-9999"), false);
  assert.equal(binaryAvailable(""), false);
});

test("binaryAvailable: absolute path checked directly", () => {
  assert.equal(binaryAvailable(process.execPath), true);
  assert.equal(binaryAvailable("/definitely/not/a/real/binary"), false);
});
