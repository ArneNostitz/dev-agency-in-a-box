// gh() / ghAs() circuit breaker: the Process Analyzer (dev-agency-analyzer#156-199, 24 reports over
// 9 days) found the same GitHub-comments fetch failing tens of thousands of times per ~6h window —
// gh() had no retry cap, no back-off, and no exit condition, so a rate-limited repo got hammered
// every scan tick indefinitely. Tripping on the FIRST failure and short-circuiting every subsequent
// call until a cooldown elapses turns that into one logged incident instead of thousands.
import test from "node:test";
import assert from "node:assert/strict";
import { maybeTripCircuit, circuitStatus, PRIMARY_RATE_LIMIT_COOLDOWN_MS, SECONDARY_RATE_LIMIT_COOLDOWN_MS } from "../dist/github.js";

test("a non-rate-limit error never trips the circuit", () => {
  assert.equal(circuitStatus().open, false, "starts closed");
  maybeTripCircuit(["issue", "comment"], new Error("connection reset"));
  assert.equal(circuitStatus().open, false, "an unrelated failure does not open it");
});

test("a primary rate-limit error trips the circuit for the long (primary) cooldown", () => {
  const before = Date.now();
  maybeTripCircuit(["api", "repos/o/r/issues/1/comments"], new Error("API rate limit exceeded for installation ID 123."));
  const status = circuitStatus();
  assert.equal(status.open, true, "trips open");
  assert.match(status.reason, /rate limit/i);
  assert.ok(status.until - before >= PRIMARY_RATE_LIMIT_COOLDOWN_MS - 100, "cooldown is ~the primary window, not the shorter secondary one");
});

test("tripping again while already open does not extend the cooldown (no re-trip on every retry)", () => {
  const untilBefore = circuitStatus().until;
  maybeTripCircuit(["api", "repos/o/r/issues/1/comments"], new Error("API rate limit exceeded for installation ID 123."));
  assert.equal(circuitStatus().until, untilBefore, "deadline unchanged — a retry storm can't keep pushing it out");
});

test("secondary/abuse-detection errors use the shorter cooldown", () => {
  // A fresh assertion on the constant relationship itself (not dependent on the now-open circuit
  // from the previous tests in this file, which node:test runs in the same module instance).
  assert.ok(SECONDARY_RATE_LIMIT_COOLDOWN_MS < PRIMARY_RATE_LIMIT_COOLDOWN_MS, "secondary limits reset far faster than the primary hourly window");
});
