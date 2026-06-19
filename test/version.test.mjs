// Version label + the SOURCE_COMMIT runtime overlay (so a Coolify deploy shows its real commit).
import test from "node:test";
import assert from "node:assert/strict";
import { buildLabel, versionInfo } from "../dist/version.js";

test("buildLabel drops 'build 0' and leads with the SHA", () => {
  assert.equal(buildLabel("1.0.1", 0, "abc1234", "2026-06-19 09:56"), "v1.0.1 · abc1234 · 2026-06-19 09:56");
  assert.equal(buildLabel("1.0.1", 5, "abc1234", "2026-06-19 09:56"), "v1.0.1 · build 5 · abc1234 · 2026-06-19 09:56");
  assert.equal(buildLabel("2.0.0", 0, "", "2026-06-19 09:56"), "v2.0.0 · 2026-06-19 09:56");
});

test("versionInfo overlays SOURCE_COMMIT (short) over the build file", () => {
  const prev = process.env.SOURCE_COMMIT;
  try {
    process.env.SOURCE_COMMIT = "deadbeefcafebabe1234";
    const v = versionInfo();
    assert.equal(v.sha, "deadbee");
    assert.ok(v.label.includes("deadbee"), v.label);
    assert.ok(v.label.startsWith("v"), v.label);
  } finally {
    if (prev === undefined) delete process.env.SOURCE_COMMIT; else process.env.SOURCE_COMMIT = prev;
  }
});

test("versionInfo without SOURCE_COMMIT still returns a usable label", () => {
  const prev = process.env.SOURCE_COMMIT;
  delete process.env.SOURCE_COMMIT;
  try {
    const v = versionInfo();
    assert.ok(typeof v.version === "string" && v.version.length > 0);
    assert.ok(v.label.startsWith("v"), v.label);
  } finally {
    if (prev !== undefined) process.env.SOURCE_COMMIT = prev;
  }
});
