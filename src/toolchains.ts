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
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSetting, setSetting } from "./store.js";

export interface Toolchain {
  id: string;
  /** Human label for the Environments tab. */
  label: string;
  /** Binary that must resolve once installed (also what `checks.ts` looks for on PATH). */
  binary: string;
  /** Absolute dir added to PATH so checks find the binary; where `install` puts it. */
  binDir: string;
  /** Idempotent bash that installs the toolchain persistently under TOOLCHAINS_DIR. */
  install: string;
  /** One-liner shown under the toolchain (what it unlocks). */
  note: string;
}

/** Where toolchains install. Configurable so the host can point it at a persistent volume. */
export function toolchainsDir(): string {
  const env = process.env.TOOLCHAINS_DIR?.trim();
  return env && env.length ? env : join(homedir(), ".devagency-toolchains");
}

const FLUTTER_DIR = join(toolchainsDir(), "flutter");
const CARGO_BIN = join(homedir(), ".cargo", "bin"); // rustup's home is persistent under $HOME already

export const TOOLCHAINS: Record<string, Toolchain> = {
  flutter: {
    id: "flutter",
    label: "Flutter SDK",
    binary: "flutter",
    binDir: join(FLUTTER_DIR, "bin"),
    note: "Runs `flutter analyze` + `flutter test` for Flutter/Dart apps (pubspec.yaml).",
    install: [
      "set -e",
      `DIR="${FLUTTER_DIR}"`,
      'if [ ! -x "$DIR/bin/flutter" ]; then',
      '  mkdir -p "$(dirname "$DIR")"',
      '  git clone --depth 1 -b stable https://github.com/flutter/flutter.git "$DIR"',
      "fi",
      '"$DIR/bin/flutter" --version',
      '"$DIR/bin/flutter" precache --universal || true', // warm the Dart SDK so first analyze is fast
    ].join("\n"),
  },
  rust: {
    id: "rust",
    label: "Rust (cargo)",
    binary: "cargo",
    binDir: CARGO_BIN,
    note: "Runs `cargo test` for the Rust backend of Tauri apps (src-tauri/) and Rust crates.",
    install: [
      "set -e",
      "command -v cargo >/dev/null 2>&1 || curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal",
      `"${CARGO_BIN}/cargo" --version`,
    ].join("\n"),
  },
};

/** Map a `CommandSet.requires` binary (from checks.ts) to a catalog toolchain id, if we manage it. */
export function toolchainForBinary(binary: string): string | undefined {
  return Object.values(TOOLCHAINS).find((t) => t.binary === binary)?.id;
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

/** Live status: an on-disk binary always wins over stored state (survives a state-store reset). */
export function toolchainStatus(id: string): StoredState {
  const tc = TOOLCHAINS[id];
  const stored = readStates()[id] || { status: "absent" as ToolchainStatus };
  if (tc && existsSync(join(tc.binDir, tc.binary))) {
    return { status: "ready", version: stored.version, at: stored.at };
  }
  return stored;
}

export function isToolchainReady(id: string): boolean {
  const tc = TOOLCHAINS[id];
  return !!tc && existsSync(join(tc.binDir, tc.binary));
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
  if (!TOOLCHAINS[id]) return;
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
  const tc = TOOLCHAINS[id];
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
    if (r.code === 0 && existsSync(join(tc.binDir, tc.binary))) {
      let version = "";
      try {
        const v = await sh(`"${join(tc.binDir, tc.binary)}" --version`, toolchainsDir(), 60_000);
        version = (v.out.split("\n").map((l) => l.trim()).find(Boolean) || "").slice(0, 120);
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
function sh(cmd: string, cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], { cwd, env: { ...process.env } });
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
