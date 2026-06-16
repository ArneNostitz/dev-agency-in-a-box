// File-lock scheduler: overwrite protection across any two concurrent runs.
import test from "node:test";
import assert from "node:assert/strict";
import { claimFiles, releaseFiles, fileOverlap, _resetLocks } from "../dist/locks.js";

test("disjoint files run in parallel", () => {
  _resetLocks();
  assert.equal(claimFiles("acme/app", 1, ["src/a.ts", "src/b.ts"]).ok, true);
  assert.equal(claimFiles("acme/app", 2, ["src/c.ts"]).ok, true);
});

test("an overlapping file blocks the second run, naming the holder + file", () => {
  _resetLocks();
  assert.equal(claimFiles("acme/app", 1, ["web/app.js"]).ok, true);
  const r = claimFiles("acme/app", 2, ["web/app.js", "src/x.ts"]);
  assert.equal(r.ok, false);
  assert.equal(r.blockedBy, 1);
  assert.equal(r.file, "web/app.js");
});

test("releasing the first frees the lock for the second", () => {
  _resetLocks();
  claimFiles("acme/app", 1, ["src/x.ts"]);
  assert.equal(claimFiles("acme/app", 2, ["src/x.ts"]).ok, false);
  releaseFiles("acme/app", 1);
  assert.equal(claimFiles("acme/app", 2, ["src/x.ts"]).ok, true);
});

test("an unknown (empty) footprint never blocks", () => {
  _resetLocks();
  claimFiles("acme/app", 1, ["src/x.ts"]);
  assert.equal(claimFiles("acme/app", 2, []).ok, true);
});

test("re-claiming for the SAME issue is idempotent (its own lock doesn't block it)", () => {
  _resetLocks();
  assert.equal(claimFiles("acme/app", 1, ["src/x.ts"]).ok, true);
  assert.equal(claimFiles("acme/app", 1, ["src/x.ts"]).ok, true);
});

test("paths are normalized (./ prefix, backslashes)", () => {
  assert.deepEqual(fileOverlap(["./web/app.js"], ["web/app.js"]), ["web/app.js"]);
  assert.deepEqual(fileOverlap(["src\\a.ts"], ["src/a.ts"]), ["src/a.ts"]);
});

test("different repos never collide", () => {
  _resetLocks();
  claimFiles("acme/one", 1, ["src/x.ts"]);
  assert.equal(claimFiles("acme/two", 1, ["src/x.ts"]).ok, true);
});
