// Tests for the pi NDJSON parser (#63). Uses lines captured from a real `pi --mode json --print`
// run so the schema is verified against ground truth, not a guess.
import test from "node:test";
import assert from "node:assert/strict";
import { parsePiLine } from "../dist/runners/pi-parse.js";

test("non-JSON / blank lines are ignored (best-effort)", () => {
  assert.deepEqual(parsePiLine(""), []);
  assert.deepEqual(parsePiLine("   "), []);
  assert.deepEqual(parsePiLine("not json at all"), []);
  assert.deepEqual(parsePiLine("  pi: starting...  "), []);
});

test("message_end carries the assistant usage (tokens + cost)", () => {
  const line = JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant", content: [{ type: "text", text: "ok" }],
      usage: { input: 355, output: 3, cacheRead: 64, cacheWrite: 0, totalTokens: 422, cost: { input: 0.001, output: 0.0001, cacheRead: 0, cacheWrite: 0, total: 0.0011 } },
    },
  });
  const evs = parsePiLine(line);
  const u = evs.find((e) => e.usage)?.usage;
  assert.ok(u);
  assert.equal(u.input, 355);
  assert.equal(u.output, 3);
  assert.equal(u.cacheRead, 64);
  assert.equal(u.totalTokens, 422);
  assert.equal(u.costTotal, 0.0011);
});

test("text_delta surfaces the streaming text chunk", () => {
  const line = JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ok" },
  });
  const evs = parsePiLine(line);
  assert.equal(evs.find((e) => e.textDelta)?.textDelta, "ok");
});

test("tool_execution_start produces a one-liner tool summary", () => {
  const line = JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "tool_execution_start", toolName: "Bash", args: { command: "npm test" } },
  });
  assert.equal(parsePiLine(line).find((e) => e.tool)?.tool, "🔧 Bash: $ npm test");
  const line2 = JSON.stringify({
    type: "message_update",
    assistantMessageEvent: { type: "tool_execution_start", toolName: "Write", args: { file_path: "src/x.ts" } },
  });
  assert.equal(parsePiLine(line2).find((e) => e.tool)?.tool, "🔧 Write: src/x.ts");
});

test("turn_end counts a turn AND captures the final assistant text", () => {
  const line = JSON.stringify({
    type: "turn_end",
    message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } } },
    toolResults: [],
  });
  const evs = parsePiLine(line);
  assert.equal(evs.find((e) => e.turnEnded)?.turnEnded, true);
  assert.equal(evs.find((e) => e.finalText)?.finalText, "done");
});

test("agent_end signals done", () => {
  assert.equal(parsePiLine('{"type":"agent_end","messages":[],"willRetry":false}').find((e) => e.done)?.done, true);
});

test("a partial-line stream: usage is the LAST seen value (running totals — last wins)", () => {
  // pi reports cumulative usage across updates; the runner keeps the latest.
  const a = parsePiLine(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "o", partial: { usage: { input: 100, output: 1, totalTokens: 101, cost: { total: 0.05 } } } } }));
  const b = parsePiLine(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "k", partial: { usage: { input: 355, output: 3, totalTokens: 422, cost: { total: 0.21 } } } } }));
  let usage = a.find((e) => e.usage)?.usage;
  assert.equal(usage?.totalTokens, 101);
  usage = b.find((e) => e.usage)?.usage;
  assert.equal(usage?.totalTokens, 422);
  assert.equal(usage?.costTotal, 0.21);
});

test("usage with no explicit totalTokens falls back to input+output+cache", () => {
  const line = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: { total: 0 } } } });
  assert.equal(parsePiLine(line).find((e) => e.usage)?.usage?.totalTokens, 18);
});
