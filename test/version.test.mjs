// Version label tests. The SHA is now baked in at build time by scripts/version.mjs; there is no
// longer a runtime SOURCE_COMMIT override (removed in v1.7.7 — the label must always reflect the
// running code, not a deploy-time env injection that could mismatch the actual build).
import test from "node:test";
import assert from "node:assert/strict";
import { buildLabel, versionInfo } from "../dist/version.js";

test("buildLabel drops 'build 0' and leads with the SHA", () => {
  assert.equal(buildLabel("1.0.1", 0, "abc1234", "2026-06-19 09:56"), "v1.0.1 · abc1234 · 2026-06-19 09:56");
  assert.equal(buildLabel("1.0.1", 5, "abc1234", "2026-06-19 09:56"), "v1.0.1 · build 5 · abc1234 · 2026-06-19 09:56");
  assert.equal(buildLabel("2.0.0", 0, "", "2026-06-19 09:56"), "v2.0.0 · 2026-06-19 09:56");
});

test("versionInfo ignores SOURCE_COMMIT — sha comes only from the baked build file", () => {
  const prev = process.env.SOURCE_COMMIT;
  try {
    process.env.SOURCE_COMMIT = "deadbeefcafebabe1234";
    const v = versionInfo();
    // SOURCE_COMMIT must NOT override the sha — the build file is authoritative
    assert.ok(v.sha !== "deadbee", "sha must not be set from SOURCE_COMMIT at runtime");
    assert.ok(v.label.startsWith("v"), v.label);
    assert.ok(!v.label.includes("deadbee"), "label must not contain the runtime SOURCE_COMMIT sha");
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

test("version is CalVer (YY.M.commits) — never a manually-bumped number that can go stale", () => {
  // A manually-maintained major.minor in package.json (e.g. "1.23") sat unbumped for 92 commits /
  // 10 days and looked frozen even though the patch (commit count) kept climbing underneath it.
  // scripts/version.mjs now derives the whole thing from the build itself — this asserts the real,
  // just-built web/version.json (npm test runs `npm run build` first) actually follows that scheme.
  const v = versionInfo();
  assert.match(v.version, /^\d{2}\.\d{1,2}\.\d+$/, v.version);
  const now = new Date();
  const expectedPrefix = `${now.getFullYear() % 100}.${now.getMonth() + 1}.`;
  assert.ok(v.version.startsWith(expectedPrefix), `${v.version} should start with ${expectedPrefix} (built this month)`);
});
