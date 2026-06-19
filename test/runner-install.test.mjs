// CLI install spec + package-name validation (the pure, security-sensitive parts).
import test from "node:test";
import assert from "node:assert/strict";
import { installSpec, validPackageSpec, RUNNER_PACKAGES } from "../dist/runners/install.js";

test("installSpec maps known runner kinds to their npm package + binary", () => {
  assert.deepEqual(installSpec("pi-cli"), { pkg: "@earendil-works/pi-coding-agent", binary: "pi" });
  assert.deepEqual(installSpec("claude-cli"), { pkg: "@anthropic-ai/claude-code", binary: "claude" });
  assert.equal(RUNNER_PACKAGES["pi-cli"].label, "pi");
});

test("installSpec for custom-cli requires a valid explicit package", () => {
  assert.deepEqual(installSpec("custom-cli", "some-cli"), { pkg: "some-cli" });
  assert.equal(installSpec("custom-cli"), null);
  assert.equal(installSpec("custom-cli", "bad name; rm -rf /"), null);
  assert.equal(installSpec("claude-sdk"), null); // SDK needs no install
});

test("validPackageSpec accepts real names/scopes/versions, rejects injection + flags", () => {
  for (const ok of ["pi", "@earendil-works/pi-coding-agent", "@anthropic-ai/claude-code@1.2.3", "gemini-cli@latest"])
    assert.equal(validPackageSpec(ok), true, ok);
  for (const bad of ["", "-g", "--force", "a; rm -rf /", "a && b", "a$(whoami)", "a b", "/etc/passwd"])
    assert.equal(validPackageSpec(bad), false, bad);
});
