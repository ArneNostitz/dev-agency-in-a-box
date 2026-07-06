/**
 * Toolchain catalog + persistent install runner (the "Environments" feature).
 *
 * Some stacks (Flutter, Rust) need an SDK that isn't in the base sandbox image. Rather than clone a
 * ~1GB SDK inline on every run (slow, times out), the agency ASKS: a run that detects a missing
 * toolchain records a request and PAUSES the issue (no PR). The user installs it once, persistently,
 * from Settings → Environments; every later run finds it on PATH and verifies for real.
 *
 * Persistence: installs land under TOOLCHAINS_DIR (default $HOME/.devagency-toolchains). Point that
 * env at a mounted volume on the host so installs survive a redeploy.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSetting, setSetting } from "./store.js";

export interface Toolchain {
  id: string;
  /** Human label for the Environments tab. */
  label: string;
  /** Binary that must resolve once installed (also what `checks.ts` looks for on PATH). */
  binary: string;
  /** Absolute dir the binary installs into (added to PATH; symlinked into the shared bin). */
  binDir: string;
  /** Idempotent bash that installs the toolchain persistently under TOOLCHAINS_DIR. */
  install: string;
  /** One-liner shown under the toolchain (what it unlocks). */
  note: string;
  /**
   * Optional readiness/verify command — exit 0 means installed. Used for custom (by-hand) toolchains
   * where we can't infer an on-disk binary path. Built-ins rely on `existsSync(binDir/binary)`.
   */
  check?: string;
  /** True for user-added "install by hand" toolchains (stored in settings, not the built-in catalog). */
  custom?: boolean;
}

/** Where toolchains install. Configurable so the host can point it at a persistent volume. */
export function toolchainsDir(): string {
  const env = process.env.TOOLCHAINS_DIR?.trim();
  return env && env.length ? env : join(homedir(), ".devagency-toolchains");
}

/** Shared bin dir on PATH — every non-flutter/rust toolchain symlinks its binary here on install, so
 * one PATH entry (set in the Dockerfile) exposes presets AND custom tools to agents. */
export function sharedBinDir(): string { return join(toolchainsDir(), "bin"); }

const FLUTTER_DIR = join(toolchainsDir(), "flutter");
const CARGO_BIN = join(homedir(), ".cargo", "bin"); // rustup's home is persistent under $HOME already
const tdir = (sub: string): string => join(toolchainsDir(), sub);

// Built-in presets. Each installs WITHOUT root (the container runs as a non-root user) into the data
// volume, so it persists across redeploys. Arch-aware where needed (dpkg → amd64/arm64).
export const TOOLCHAINS: Record<string, Toolchain> = {
  flutter: {
    id: "flutter", label: "Flutter SDK", binary: "flutter", binDir: join(FLUTTER_DIR, "bin"),
    note: "Flutter/Dart apps (pubspec.yaml) — `flutter analyze` + `flutter test`.",
    install: [
      "set -e",
      `DIR="${FLUTTER_DIR}"`,
      'if [ ! -x "$DIR/bin/flutter" ]; then mkdir -p "$(dirname "$DIR")"; git clone --depth 1 -b stable https://github.com/flutter/flutter.git "$DIR"; fi',
      '"$DIR/bin/flutter" --version',
      '"$DIR/bin/flutter" precache --universal || true',
    ].join("\n"),
  },
  rust: {
    id: "rust", label: "Rust (cargo)", binary: "cargo", binDir: CARGO_BIN,
    note: "Rust crates + the Tauri backend (src-tauri/) — `cargo test`.",
    install: [
      "set -e",
      "command -v cargo >/dev/null 2>&1 || curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path",
      `"${CARGO_BIN}/cargo" --version`,
    ].join("\n"),
  },
  go: {
    id: "go", label: "Go", binary: "go", binDir: join(tdir("go"), "bin"),
    note: "Go modules (go.mod) — `go vet` / `go build` / `go test`.",
    install: [
      "set -e",
      'V=1.23.4; ARCH=$(dpkg --print-architecture)',
      `DIR="${tdir("go")}"`,
      'if [ ! -x "$DIR/bin/go" ]; then curl -fsSL "https://go.dev/dl/go${V}.linux-${ARCH}.tar.gz" -o /tmp/go.tgz && rm -rf "$DIR" && tar -C "$(dirname "$DIR")" -xzf /tmp/go.tgz && rm -f /tmp/go.tgz; fi',
      '"$DIR/bin/go" version',
    ].join("\n"),
  },
  bun: {
    id: "bun", label: "Bun", binary: "bun", binDir: join(tdir("bun"), "bin"),
    note: "Bun-based JS/TS projects — `bun test` / `bun run`.",
    install: [
      "set -e",
      `export BUN_INSTALL="${tdir("bun")}"`,
      'test -x "$BUN_INSTALL/bin/bun" || curl -fsSL https://bun.sh/install | bash',
      '"$BUN_INSTALL/bin/bun" --version',
    ].join("\n"),
  },
  deno: {
    id: "deno", label: "Deno", binary: "deno", binDir: join(tdir("deno"), "bin"),
    note: "Deno projects — `deno test` / `deno lint` / `deno check`.",
    install: [
      "set -e",
      `export DENO_INSTALL="${tdir("deno")}"`,
      'test -x "$DENO_INSTALL/bin/deno" || curl -fsSL https://deno.land/install.sh | sh -s -- -y',
      '"$DENO_INSTALL/bin/deno" --version',
    ].join("\n"),
  },
  dotnet: {
    id: "dotnet", label: ".NET SDK", binary: "dotnet", binDir: tdir("dotnet"),
    note: ".NET / C# projects — `dotnet build` / `dotnet test`.",
    install: [
      "set -e",
      `DIR="${tdir("dotnet")}"`,
      'test -x "$DIR/dotnet" || { curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dni.sh && bash /tmp/dni.sh --install-dir "$DIR" --channel LTS && rm -f /tmp/dni.sh; }',
      '"$DIR/dotnet" --version',
    ].join("\n"),
  },
};

/** Map a `CommandSet.requires` binary (from checks.ts) to a built-in toolchain id, if we manage it. */
export function toolchainForBinary(binary: string): string | undefined {
  return Object.values(TOOLCHAINS).find((t) => t.binary === binary)?.id;
}

// ---- custom (install-by-hand) toolchains, stored in settings --------------

function readCustom(): Toolchain[] {
  try { return (JSON.parse(getSetting("toolchains_custom") || "[]") as Toolchain[]).map((t) => ({ ...t, custom: true })); } catch { return []; }
}
function writeCustom(list: Toolchain[]): void { setSetting("toolchains_custom", JSON.stringify(list)); }

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tool";

/**
 * Add a user-defined toolchain installed by a raw terminal command. `binary`/`binDir` are optional:
 * if given, readiness is `existsSync(binDir/binary)` and the binary is symlinked onto PATH; otherwise
 * supply a `check` command (exit 0 = ready). Returns the new id.
 */
export function addCustomToolchain(input: { label: string; install: string; check?: string; binary?: string; note?: string }): string {
  const list = readCustom();
  const base = slug(input.label);
  let id = base; let n = 2;
  const taken = new Set([...Object.keys(TOOLCHAINS), ...list.map((t) => t.id)]);
  while (taken.has(id)) id = `${base}-${n++}`;
  const binary = (input.binary || "").trim();
  const tc: Toolchain = {
    id, label: input.label.trim() || id, binary,
    binDir: binary ? sharedBinDir() : "", // a custom install is asked to drop its binary into the shared bin
    install: input.install,
    note: (input.note || "").trim() || "Custom environment (installed by hand).",
    check: (input.check || "").trim() || (binary ? `command -v ${binary}` : undefined),
    custom: true,
  };
  list.push(tc);
  writeCustom(list);
  return id;
}
export function removeCustomToolchain(id: string): void {
  writeCustom(readCustom().filter((t) => t.id !== id));
  const all = readStates(); delete all[id]; setSetting("toolchains_state", JSON.stringify(all));
}
export function listCustomToolchains(): Toolchain[] { return readCustom(); }

/** A toolchain by id — built-in preset or user-added custom. */
export function getToolchain(id: string): Toolchain | undefined {
  return TOOLCHAINS[id] || readCustom().find((t) => t.id === id);
}
/** Every toolchain (built-in presets first, then custom) for the Environments list. */
export function allToolchains(): Toolchain[] {
  return [...Object.values(TOOLCHAINS), ...readCustom()];
}

// ---- state (JSON in the key-value settings store) -------------------------

export type ToolchainStatus = "absent" | "installing" | "ready" | "failed";
interface StoredState { status: ToolchainStatus; version?: string; error?: string; at?: number }

function readStates(): Record<string, StoredState> {
  try { return JSON.parse(getSetting("toolchains_state") || "{}") as Record<string, StoredState>; } catch { return {}; }
}
function writeState(id: string, patch: Partial<StoredState>): void {
  const all = readStates();
  const prev: StoredState = all[id] || { status: "absent" };
  all[id] = { ...prev, ...patch };
  setSetting("toolchains_state", JSON.stringify(all));
}

/** True when a toolchain's binary exists on disk (built-ins + any custom that declared binary/binDir). */
function onDisk(tc: Toolchain | undefined): boolean {
  return !!tc && !!tc.binary && !!tc.binDir && existsSync(join(tc.binDir, tc.binary));
}

/**
 * Live status: an on-disk binary always wins over stored state (survives a state-store reset). Custom
 * toolchains with only a `check` command (no known binary path) fall back to the stored status set
 * by their last install.
 */
export function toolchainStatus(id: string): StoredState {
  const tc = getToolchain(id);
  const stored = readStates()[id] || { status: "absent" as ToolchainStatus };
  if (onDisk(tc)) return { status: "ready", version: stored.version, at: stored.at };
  return stored;
}

export function isToolchainReady(id: string): boolean {
  return onDisk(getToolchain(id)) || readStates()[id]?.status === "ready";
}

// ---- requests (agents ask; users install) ---------------------------------

export interface ToolchainRequest { id: string; repo: string; number: number; at: number }

function readRequests(): ToolchainRequest[] {
  try { return JSON.parse(getSetting("toolchain_requests") || "[]") as ToolchainRequest[]; } catch { return []; }
}
function writeRequests(list: ToolchainRequest[]): void {
  setSetting("toolchain_requests", JSON.stringify(list));
}
/** An agent detected it needs `id` for repo#number — record it (deduped) for the Environments tab. */
export function recordToolchainRequest(id: string, repo: string, number: number): void {
  if (!getToolchain(id)) return;
  const list = readRequests().filter((r) => !(r.id === id && r.repo === repo && r.number === number));
  list.push({ id, repo, number, at: Date.now() });
  writeRequests(list.slice(-100));
}
export function listToolchainRequests(): ToolchainRequest[] { return readRequests(); }
export function clearToolchainRequests(id: string): void {
  writeRequests(readRequests().filter((r) => r.id !== id));
}

// ---- live install stream (a dedicated channel, kept off the agent board) --

export interface TcEvent {
  id: string;
  kind: "progress" | "log" | "status";
  pct?: number;
  phase?: string;
  line?: string;
  status?: ToolchainStatus;
  version?: string;
  error?: string;
}
const tcSubs = new Set<(e: TcEvent) => void>();
/** Subscribe to live install events (progress %, log lines, status). Returns an unsubscribe fn. */
export function subscribeToolchains(fn: (e: TcEvent) => void): () => void { tcSubs.add(fn); return () => { tcSubs.delete(fn); }; }
function emit(e: TcEvent): void { for (const fn of tcSubs) { try { fn(e); } catch { /* bad subscriber */ } } }

// Latest progress per install, so a tab opened mid-install renders the bar + tail immediately.
const progress = new Map<string, { pct: number; phase: string; log: string[] }>();
export function toolchainProgress(id: string): { pct: number; phase: string; log: string[] } | undefined {
  return progress.get(id);
}

/** Turn a git/rustup/flutter output line into a { pct, phase }, or null if it carries no percentage. */
export function parseProgress(line: string): { pct: number; phase: string } | null {
  const m = /(\d{1,3})%/.exec(line);
  if (!m) return null;
  const pct = Math.max(0, Math.min(100, Number(m[1])));
  let phase = "Working…";
  if (/receiving objects/i.test(line)) phase = "Downloading…";
  else if (/resolving deltas/i.test(line)) phase = "Resolving…";
  else if (/updating files|checking out/i.test(line)) phase = "Checking out…";
  else if (/counting|compressing/i.test(line)) phase = "Preparing…";
  else if (/precache|download|fetch/i.test(line)) phase = "Fetching SDK…";
  else if (/install/i.test(line)) phase = "Installing…";
  return { pct, phase };
}

// ---- install runner (background, host-affecting) --------------------------

const installing = new Set<string>();

/** True while an install is in flight this process — the UI shows a spinner, repeat clicks are no-ops. */
export function isInstalling(id: string): boolean { return installing.has(id); }

/**
 * Install a toolchain persistently. Fire-and-forget from the HTTP layer (it can take many minutes):
 * flips state to "installing", runs the idempotent install bash, then "ready" (with version) or
 * "failed" (with the first error line). Clears any pending requests on success.
 */
export async function installToolchain(id: string): Promise<void> {
  const tc = getToolchain(id);
  if (!tc) throw new Error(`unknown toolchain: ${id}`);
  if (installing.has(id)) return;
  installing.add(id);
  writeState(id, { status: "installing", at: Date.now(), error: undefined });
  progress.set(id, { pct: 0, phase: "Starting…", log: [] });
  emit({ id, kind: "status", status: "installing" });
  emit({ id, kind: "progress", pct: 0, phase: "Starting…" });
  try {
    mkdirSync(toolchainsDir(), { recursive: true });
    const r = await runStreaming(tc.install, toolchainsDir(), 1_800_000, (line) => {
      const p = progress.get(id);
      if (!p) return;
      p.log.push(line);
      if (p.log.length > 300) p.log.shift();
      emit({ id, kind: "log", line });
      const parsed = parseProgress(line);
      if (parsed) { p.pct = parsed.pct; p.phase = parsed.phase; emit({ id, kind: "progress", pct: parsed.pct, phase: parsed.phase }); }
    });
    // Success = the install exited 0 AND the toolchain verifies: on-disk binary for built-ins /
    // custom-with-binary, else the custom `check` command's exit code.
    const verified = r.code === 0 && (onDisk(tc) || (tc.check ? (await sh(tc.check, toolchainsDir(), 120_000, tc.binDir)).code === 0 : r.code === 0));
    if (verified) {
      // Expose the binary to agents via the shared bin (on PATH) — but not flutter/rust, which have
      // their own explicit PATH dirs and can misbehave when their launcher is symlinked.
      if (tc.binary && tc.binDir && id !== "flutter" && id !== "rust") {
        try {
          mkdirSync(sharedBinDir(), { recursive: true });
          const link = join(sharedBinDir(), tc.binary), target = join(tc.binDir, tc.binary);
          if (existsSync(target)) { try { unlinkSync(link); } catch { /* fresh */ } symlinkSync(target, link); }
        } catch { /* best-effort PATH exposure */ }
      }
      let version = "";
      try {
        const bin = tc.binary && tc.binDir ? join(tc.binDir, tc.binary) : tc.binary;
        if (bin) { const v = await sh(`"${bin}" --version`, toolchainsDir(), 60_000, tc.binDir); version = (v.out.split("\n").map((l) => l.trim()).find(Boolean) || "").slice(0, 120); }
      } catch { /* version is best-effort */ }
      writeState(id, { status: "ready", version, at: Date.now(), error: undefined });
      clearToolchainRequests(id);
      const p = progress.get(id); if (p) { p.pct = 100; p.phase = "Ready"; }
      emit({ id, kind: "progress", pct: 100, phase: "Ready" });
      emit({ id, kind: "status", status: "ready", version });
    } else {
      const error = lastLine(r.out) || "install failed";
      writeState(id, { status: "failed", error, at: Date.now() });
      emit({ id, kind: "status", status: "failed", error });
    }
  } catch (e) {
    const error = String(e).slice(0, 300);
    writeState(id, { status: "failed", error, at: Date.now() });
    emit({ id, kind: "status", status: "failed", error });
  } finally {
    installing.delete(id);
  }
}

function lastLine(out: string): string {
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] || "").slice(0, 300);
}

/** Minimal shell runner (kept local to avoid a checks.ts ↔ toolchains.ts import cycle). */
function sh(cmd: string, cwd: string, timeoutMs: number, extraPath?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(extraPath ? { PATH: `${extraPath}:${sharedBinDir()}:${process.env.PATH ?? ""}` } : {}) };
    const child = spawn("bash", ["-lc", cmd], { cwd, env });
    let out = "";
    const cap = (d: Buffer) => { out += d.toString(); if (out.length > 200_000) out = out.slice(-200_000); };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } resolve({ code: 124, out: out + "\n[timed out]" }); }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, out: out + "\n" + String(e) }); });
  });
}

/**
 * Like `sh` but streams each output line to `onLine` as it arrives. Splits on BOTH \r and \n because
 * git writes its progress meter with carriage returns (one "Receiving objects: NN%" line, rewritten).
 */
function runStreaming(cmd: string, cwd: string, timeoutMs: number, onLine: (line: string) => void): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], { cwd, env: { ...process.env } });
    let out = "", buf = "";
    const feed = (d: Buffer) => {
      const s = d.toString();
      out += s; if (out.length > 200_000) out = out.slice(-200_000);
      buf += s;
      const parts = buf.split(/[\r\n]+/);
      buf = parts.pop() ?? "";
      for (const ln of parts) { const t = ln.trim(); if (t) onLine(t); }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } resolve({ code: 124, out: out + "\n[timed out]" }); }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); const t = buf.trim(); if (t) onLine(t); resolve({ code: code ?? 1, out }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, out: out + "\n" + String(e) }); });
  });
}
