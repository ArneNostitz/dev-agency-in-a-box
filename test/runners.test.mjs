// Tests for the runner seam — the pure, testable parts. Two in-process SDK runners remain
// (claude-sdk + pi-cli); the old subprocess CLI runners are gone.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-run-")), "test.db");

const reg = await import("../dist/runners/registry.js");
const exec = await import("../dist/runners/exec.js");

// ---- summarizeTool (the one shared copy) ----

test("summarizeTool formats each tool kind", () => {
  assert.equal(reg.summarizeTool("Bash", { command: "npm test" }), "$ npm test");
  assert.equal(reg.summarizeTool("Write", { file_path: "src/x.ts" }), "✏️ write src/x.ts");
  assert.equal(reg.summarizeTool("Edit", { file_path: "src/y.ts" }), "✏️ edit src/y.ts");
  assert.equal(reg.summarizeTool("Read", { file_path: "README.md" }), "📖 read README.md");
  assert.equal(reg.summarizeTool("Grep", { pattern: "TODO" }), "🔎 grep TODO");
  assert.equal(reg.summarizeTool("WebFetch", { url: "https://x" }), "🌐 fetch https://x");
  assert.equal(reg.summarizeTool("Mystery", { description: "d" }), "🔧 Mystery: d");
});

test("summarizeTool truncates long values", () => {
  const long = "x".repeat(500);
  const out = reg.summarizeTool("Bash", { command: long });
  assert.ok(out.length < 200, `expected truncated, got len ${out.length}`);
});

// ---- getRunner dispatch ----

test("getRunner returns the right adapter per kind; unknown kinds fall back to claude-sdk", () => {
  assert.equal(reg.getRunner("claude-sdk").kind, "claude-sdk");
  assert.equal(reg.getRunner("pi-cli").kind, "pi-cli");
  assert.equal(reg.getRunner("nonsense").kind, "claude-sdk");
});

// ---- runnerKindFor: the runner is decided by provider identity alone ----

test("runnerKindFor: Claude-native → claude-sdk; provider with a piKey → pi-cli", () => {
  assert.equal(exec.runnerKindFor(null, "subscription"), "claude-sdk");
  assert.equal(exec.runnerKindFor({ id: "glm", piKey: "zai" }, "apiKey"), "pi-cli");
  assert.equal(exec.runnerKindFor({ id: "x" }, "apiKey"), "pi-cli");
});
