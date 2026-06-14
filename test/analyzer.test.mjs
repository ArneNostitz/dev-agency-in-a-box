// v3 P6: Process Analyzer digest + gate (deterministic parts; no LLM).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-analyzer-")), "test.db");
process.env.ANALYZER_MIN_STEPS = "3";
const s = await import("../dist/store.js");
const a = await import("../dist/analyzer.js");

test("shouldAnalyze gates on enough new telemetry", () => {
  assert.equal(a.shouldAnalyze().ok, false, "no data → not yet");
  s.recordRunStep("acme/app", 1, "developer", "Bash", "$ npm test", true);
  s.recordRunStep("acme/app", 1, "developer", "Bash", "$ npm run build", true);
  s.recordRunStep("acme/app", 1, "tester", "Bash", "$ npm test", true);
  assert.equal(a.shouldAnalyze().ok, true, "≥3 steps → ready");
});

test("analysisDigest renders the telemetry sections", () => {
  s.recordRun("acme/app", 1, "developer", "claude-sonnet-4-6", 5, "implement", 0.1);
  const d = a.analysisDigest(new Date(0).toISOString());
  assert.match(d, /Tool usage/);
  assert.match(d, /Tokens by role/);
  assert.match(d, /developer · Bash/);
});
