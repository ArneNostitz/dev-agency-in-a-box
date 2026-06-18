// Tests for the runner seam (Candidate 4 / #63) — the pure, testable parts.
// (ClaudeSdkRunner.run is a verbatim port of the proven loop; agent execution can't be
//  exercised here — that's verified by construction + a watched first deploy.)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-run-")), "test.db");

const cli = await import("../dist/runners/cli.js");
const reg = await import("../dist/runners/registry.js");

// ---- parseCommandLine (no shell, no injection) ----

test("parseCommandLine splits on spaces and trims empties", () => {
  assert.deepEqual(cli.parseCommandLine("pi --mode print  --model  x"), ["pi", "--mode", "print", "--model", "x"]);
});

test("parseCommandLine honors double quotes", () => {
  assert.deepEqual(cli.parseCommandLine('echo "hello world" foo'), ["echo", "hello world", "foo"]);
});

test("parseCommandLine honors single quotes", () => {
  assert.deepEqual(cli.parseCommandLine("echo 'a b' c"), ["echo", "a b", "c"]);
});

test("parseCommandLine keeps shell metacharacters as literal args (no injection)", () => {
  // These are passed as ARGV to spawn(shell:false), so `;` and `$()` are not interpreted.
  const a = cli.parseCommandLine("pi --task 'x; rm -rf /'");
  assert.equal(a[0], "pi");
  assert.equal(a[2], "x; rm -rf /");
});

test("parseCommandLine handles an empty template", () => {
  assert.deepEqual(cli.parseCommandLine(""), []);
});

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

test("getRunner returns the right adapter per kind", () => {
  assert.equal(reg.getRunner("claude-sdk").kind, "claude-sdk");
  assert.equal(reg.getRunner("claude-cli").kind, "cli");
  assert.equal(reg.getRunner("pi-cli").kind, "cli");
  assert.equal(reg.getRunner("custom-cli", "mycli --x {task}").kind, "cli");
});

test("defaultRunnerKind reads agent_runner, defaults to claude-sdk, rejects garbage", async () => {
  const { setSetting } = await import("../dist/store.js");
  setSetting("agent_runner", "pi-cli");
  assert.equal(reg.defaultRunnerKind(), "pi-cli");
  setSetting("agent_runner", "nonsense");
  assert.equal(reg.defaultRunnerKind(), "claude-sdk");
  setSetting("agent_runner", "");
});
