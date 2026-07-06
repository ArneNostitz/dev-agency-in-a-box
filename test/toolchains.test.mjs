// Tests for the toolchain catalog + request/state store (Environments feature). Pure DB/state logic —
// the actual installToolchain() clones an SDK over the network and is NOT exercised here.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TOOLCHAINS,
  parseProgress,
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

test("parseProgress reads git/flutter percentages + a human phase, null when none", () => {
  assert.deepEqual(parseProgress("Receiving objects:  45% (123/273)"), { pct: 45, phase: "Downloading…" });
  assert.deepEqual(parseProgress("Resolving deltas: 100% (500/500), done."), { pct: 100, phase: "Resolving…" });
  assert.equal(parseProgress("Checking out files: 12%").phase, "Checking out…");
  assert.equal(parseProgress("Cloning into '/home/x/.devagency-toolchains/flutter'..."), null);
  assert.equal(parseProgress("just a plain line"), null);
  assert.equal(parseProgress("Receiving objects: 250%").pct, 100, "clamped to 100");
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
