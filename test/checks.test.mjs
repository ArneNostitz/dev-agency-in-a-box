// Tests for parseDiscoveredChecks — the self-adjusting bit of the code-only tester (Phase 2).
import test from "node:test";
import assert from "node:assert/strict";
import { parseDiscoveredChecks } from "../dist/checks.js";

test("parseDiscoveredChecks: parses a CHECKS_JSON block from an LLM report", () => {
  const text = `All checks passed.\n\nCHECKS_JSON: {"requires":"python3","install":"pip install -r requirements.txt","checks":[{"name":"test","cmd":"python3 -m pytest -q"}]}`;
  const set = parseDiscoveredChecks(text);
  assert.ok(set, "parsed");
  assert.equal(set.requires, "python3");
  assert.equal(set.install, "pip install -r requirements.txt");
  assert.equal(set.checks.length, 1);
  assert.equal(set.checks[0].cmd, "python3 -m pytest -q");
});

test("parseDiscoveredChecks: works with fenced block and minimal fields", () => {
  const text = "Swift package.\n```\nCHECKS_JSON: {\"checks\":[{\"name\":\"build\",\"cmd\":\"swift build\"},{\"name\":\"test\",\"cmd\":\"swift test\"}]}\n```";
  const set = parseDiscoveredChecks(text);
  assert.ok(set);
  assert.equal(set.checks.length, 2);
  assert.equal(set.requires, undefined);
});

test("parseDiscoveredChecks: returns null when absent or malformed", () => {
  assert.equal(parseDiscoveredChecks("no machine line here"), null);
  assert.equal(parseDiscoveredChecks("CHECKS_JSON: {not json}"), null);
  assert.equal(parseDiscoveredChecks('CHECKS_JSON: {"checks":[]}'), null, "empty checks → null");
});

import { isEnvError, baselineFailures, detectCommands } from "../dist/checks.js";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A repo name that was never cached, so detectCommands hits the language registry (not a stored set).
const fresh = () => `test/detect-${Math.random().toString(36).slice(2)}`;

test("detectCommands: Flutter (pubspec.yaml) → analyze+test, requires flutter, provisions the SDK", () => {
  const wd = mkdtempSync(join(tmpdir(), "flutter-"));
  writeFileSync(join(wd, "pubspec.yaml"), "name: demo\n");
  const set = detectCommands(wd, fresh());
  assert.ok(set, "detected");
  assert.equal(set.requires, "flutter");
  assert.equal(set.toolchain, "flutter", "maps to the managed catalog toolchain (install via Environments)");
  assert.deepEqual(set.checks.map((c) => c.name), ["analyze", "test"]);
  assert.match(set.checks[0].cmd, /flutter analyze/);
  assert.ok(set.binDir && set.binDir.endsWith("/bin"), "binDir points at the SDK bin");
});

test("detectCommands: Tauri (src-tauri/) wins over Node and runs the Rust backend too", () => {
  const wd = mkdtempSync(join(tmpdir(), "tauri-"));
  // A Node front-end (would otherwise match nodeCommands first)…
  writeFileSync(join(wd, "package.json"), JSON.stringify({ scripts: { test: "vitest", tauri: "tauri" } }));
  // …plus a Rust backend that must NOT be skipped.
  mkdirSync(join(wd, "src-tauri"));
  writeFileSync(join(wd, "src-tauri", "Cargo.toml"), "[package]\nname='app'\n");
  const set = detectCommands(wd, fresh());
  assert.ok(set, "detected");
  assert.equal(set.requires, "cargo");
  assert.ok(set.checks.some((c) => /cargo test --manifest-path src-tauri\/Cargo.toml/.test(c.cmd)), "checks the Rust backend");
  assert.ok(set.checks.some((c) => c.name === "test"), "keeps the web checks too");
});

test("detectCommands: a plain Node repo is unaffected (no false Tauri/Flutter match)", () => {
  const wd = mkdtempSync(join(tmpdir(), "node-"));
  writeFileSync(join(wd, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
  const set = detectCommands(wd, fresh());
  assert.ok(set);
  assert.equal(set.requires, "node");
  assert.ok(!set.toolchain, "a normal Node repo needs no managed toolchain");
});

test("isEnvError: pytest collection/no-test + cmd-not-found are env, real failures are not", () => {
  assert.equal(isEnvError("python3 -m pytest -q", 2), true);  // collection/usage error (import error)
  assert.equal(isEnvError("python3 -m pytest -q", 5), true);  // no tests collected
  assert.equal(isEnvError("python3 -m pytest -q", 1), false); // genuine test failures → gate
  assert.equal(isEnvError("python3 -m pytest -q", 0), false); // pass
  assert.equal(isEnvError("npm test", 127), true);            // command not found anywhere
  assert.equal(isEnvError("npm test", 1), false);             // genuine failure
});

test("baselineFailures: a check already red on main is reported pre-existing; a new break is not", () => {
  const wd = mkdtempSync(join(tmpdir(), "baseline-"));
  const sh = (c) => execSync(c, { cwd: wd, stdio: "pipe" });
  sh("git init -q && git config user.email a@b.c && git config user.name t && git checkout -q -B main");
  // A 'test' check that fails (exit 1) — this represents a PRE-EXISTING broken test on main.
  writeFileSync(join(wd, "check.sh"), "#!/bin/bash\nexit 1\n"); chmodSync(join(wd, "check.sh"), 0o755);
  // A 'lint' check that passes on main but we'll break on the branch.
  writeFileSync(join(wd, "lint.sh"), "#!/bin/bash\nexit 0\n"); chmodSync(join(wd, "lint.sh"), 0o755);
  sh("git add -A && git commit -q -m base");
  sh("git checkout -q -b agency/issue-1");
  // On the branch, break lint too (a NEW regression introduced by the change).
  writeFileSync(join(wd, "lint.sh"), "#!/bin/bash\nexit 1\n");
  sh("git add -A && git commit -q -m 'break lint'");
  const failing = [
    { name: "test", cmd: "bash check.sh", ok: false, firstError: "x" },
    { name: "lint", cmd: "bash lint.sh", ok: false, firstError: "y" },
  ];
  return baselineFailures(wd, "agency/issue-1", failing).then((pre) => {
    assert.ok(pre.has("test"), "test was already failing on main → pre-existing");
    assert.ok(!pre.has("lint"), "lint passed on main, broke on branch → introduced (gates)");
    // workdir restored to the branch with its commit intact
    assert.equal(execSync("git rev-parse --abbrev-ref HEAD", { cwd: wd }).toString().trim(), "agency/issue-1");
  });
});
