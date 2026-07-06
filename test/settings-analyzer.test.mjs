// Process Analyzer settings (Settings → General): an explicit enable/disable toggle (defaults ON,
// matching docker-compose.yml's prefilled ANALYZER_API_KEY — a real kill-switch, not an opt-in) and
// a target-repo override, both wired through the generic OPS_SETTINGS/opsSettingsValues plumbing so
// the dashboard's auto-save "ops: {...}" path picks them up with no new endpoint code.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-analyzer-settings-")), "test.db");

const { setSetting } = await import("../dist/store.js");
const { OPS_SETTINGS, opsSettingsValues, sBool } = await import("../dist/settings.js");

test("analyzer_enabled defaults to true (explicit kill-switch, not opt-in)", () => {
  assert.equal(sBool("analyzer_enabled", "", true), true);
  const v = opsSettingsValues();
  assert.equal(v.analyzer_enabled, true);
});

test("analyzer_enabled can be turned off and it sticks", () => {
  setSetting("analyzer_enabled", "off");
  assert.equal(sBool("analyzer_enabled", "", true), false);
  assert.equal(opsSettingsValues().analyzer_enabled, false);
  setSetting("analyzer_enabled", "on"); // restore for later tests in this file
});

test("analyzer_repo defaults empty (agency's own repo) and round-trips", () => {
  assert.equal(opsSettingsValues().analyzer_repo, "");
  setSetting("analyzer_repo", "acme/widgets");
  assert.equal(opsSettingsValues().analyzer_repo, "acme/widgets");
});

test("both keys are declared in OPS_SETTINGS (so the generic /settings ops-save path accepts them)", () => {
  const keys = OPS_SETTINGS.map((s) => s.key);
  assert.ok(keys.includes("analyzer_enabled"));
  assert.ok(keys.includes("analyzer_repo"));
});
