// Hold + steer: interrupt queues a steer + requests hold; resume/start clears hold; steer taken once.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "hold-")), "agency.db");
const { requestHold, clearHold, isHoldRequested, queueSteer, takeSteer, peekSteer, hasSteer } = await import("../dist/abort.js");

test("hold flag round-trips and clears", () => {
  const repo = "acme/app", n = 5;
  assert.equal(isHoldRequested(repo, n), false);
  requestHold(repo, n);
  assert.equal(isHoldRequested(repo, n), true);
  clearHold(repo, n);
  assert.equal(isHoldRequested(repo, n), false);
});

test("steer queues, peeks without consuming, and is taken once", () => {
  const repo = "acme/app", n = 6;
  assert.equal(hasSteer(repo, n), false);
  queueSteer(repo, n, "use the new schema");
  queueSteer(repo, n, "  ");            // blank ignored
  queueSteer(repo, n, "and add a test");
  assert.deepEqual(peekSteer(repo, n), ["use the new schema", "and add a test"]);
  assert.equal(hasSteer(repo, n), true);
  const taken = takeSteer(repo, n);
  assert.deepEqual(taken, ["use the new schema", "and add a test"]);
  assert.equal(hasSteer(repo, n), false, "consumed after take");
  assert.deepEqual(takeSteer(repo, n), [], "second take is empty");
});
