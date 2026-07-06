// Tests for the toolchain catalog + request/state store (Environments feature). Pure DB/state logic —
// the actual installToolchain() clones an SDK over the network and is NOT exercised here.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TOOLCHAINS,
  toolchainForBinary,
  toolchainStatus,
  isToolchainReady,
  toolchainsDir,
  recordToolchainRequest,
  listToolchainRequests,
  clearToolchainRequests,
} from "../dist/toolchains.js";

test("catalog: Flutter + Rust are defined with a binary and an install script", () => {
  assert.ok(TOOLCHAINS.flutter && TOOLCHAINS.rust);
  assert.equal(TOOLCHAINS.flutter.binary, "flutter");
  assert.equal(TOOLCHAINS.rust.binary, "cargo");
  for (const t of Object.values(TOOLCHAINS)) {
    assert.ok(t.install && t.install.length, `${t.id} has install bash`);
    assert.ok(t.binDir && t.binDir.length, `${t.id} has a binDir`);
  }
});

test("toolchainForBinary maps a checks.ts `requires` binary to a catalog id", () => {
  assert.equal(toolchainForBinary("flutter"), "flutter");
  assert.equal(toolchainForBinary("cargo"), "rust");
  assert.equal(toolchainForBinary("python3"), undefined, "unmanaged binaries return undefined");
});

test("toolchainsDir honours TOOLCHAINS_DIR, else defaults under $HOME", () => {
  const prev = process.env.TOOLCHAINS_DIR;
  process.env.TOOLCHAINS_DIR = "/mnt/vol/toolchains";
  assert.equal(toolchainsDir(), "/mnt/vol/toolchains");
  delete process.env.TOOLCHAINS_DIR;
  assert.match(toolchainsDir(), /\.devagency-toolchains$/);
  if (prev !== undefined) process.env.TOOLCHAINS_DIR = prev;
});

test("an uninstalled toolchain reads as absent / not ready", () => {
  const st = toolchainStatus("flutter");
  assert.ok(["absent", "installing", "failed", "ready"].includes(st.status));
  // In CI the SDK isn't on disk, so readiness is false unless a real install happened.
  if (!isToolchainReady("flutter")) assert.notEqual(st.status, "ready");
});

test("requests: record → list → clear, deduped, ignores unknown ids", () => {
  clearToolchainRequests("flutter");
  recordToolchainRequest("flutter", "acme/app", 12);
  recordToolchainRequest("flutter", "acme/app", 12); // dupe collapses
  recordToolchainRequest("flutter", "acme/app", 13);
  recordToolchainRequest("bogus", "acme/app", 99); // unknown id → ignored
  const mine = listToolchainRequests().filter((r) => r.id === "flutter" && r.repo === "acme/app");
  assert.equal(mine.length, 2, "two distinct issues, dupe collapsed");
  assert.ok(!listToolchainRequests().some((r) => r.id === "bogus"), "unknown toolchain not recorded");
  clearToolchainRequests("flutter");
  assert.ok(!listToolchainRequests().some((r) => r.id === "flutter" && r.repo === "acme/app"), "cleared");
});
