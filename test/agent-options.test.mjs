// agentOptions/agentOnlyOptions (web/lib/agent-options.js): the static ROLE_PINS list was missing
// "@dev"/Developer entirely — every picker built from it (reply composer, new-issue agent picker)
// had no way to select Developer by name, the most-used role, even though it's used by every
// workflow. Reported as "the developer agent is missing" (#152-adjacent).
import test from "node:test";
import assert from "node:assert/strict";
import { agentOptions, agentOnlyOptions } from "../web/lib/agent-options.js";

test("agentOptions includes a Developer pin when no custom agentDef covers it", () => {
  const values = agentOptions([], []).map((o) => o.value);
  assert.ok(values.includes("@dev"), `expected @dev in ${JSON.stringify(values)}`);
  // The full set of built-in single-role pins, not just @dev.
  for (const v of ["@plan", "@dev", "@split", "@arch", "@review", "@test"]) {
    assert.ok(values.includes(v), `expected ${v} in ${JSON.stringify(values)}`);
  }
});

test("agentOnlyOptions (reply composer) also includes Developer", () => {
  const values = agentOnlyOptions([]).map((o) => o.value);
  assert.ok(values.includes("@dev"));
});

test("a real developer agentDef hides the static Dev pin (no duplicate)", () => {
  const defs = [{ name: "developer", handle: "@dev", avatar: "" }];
  const values = agentOptions(defs, []).map((o) => o.value);
  assert.equal(values.filter((v) => v === "@dev").length, 1, "exactly one @dev entry — the richer agentDef one, not a duplicate pin");
});
