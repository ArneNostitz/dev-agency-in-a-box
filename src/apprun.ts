/**
 * Run a PR's app straight from the dashboard.
 *
 *  - WEB apps: start the dev server in the container and open a temporary public Cloudflare
 *    quick-tunnel so you get a URL to open on your phone — no local install, nothing to type.
 *  - TAURI (or any native) apps: a browser can't run them, so we hand you a one-double-click
 *    `.command` file that clones the PR, installs, and launches the real native app on your Mac.
 *    See buildLocalCommand().
 *
 * The pure helpers (package-manager / script detection, log parsing, command building) are
 * exported for unit tests; the process orchestration is best-effort and self-contained.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cloneRepo } from "./github.js";
import { pushActivity, setActive, clearActive } from "./activity.js";
import { sNum } from "./settings.js";

// ---- pure helpers ---------------------------------------------------------

export function pmFor(dir: string): "pnpm" | "yarn" | "npm" {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  return "npm";
}

/** Pick the script that runs the WEB dev server — never the Tauri/native one. */
export function pickWebDevScript(scripts: Record<string, string> = {}): string | null {
  const names = Object.keys(scripts);
  const isNative = (n: string) => /tauri|electron|native|desktop|android|ios/i.test(n);
  for (const want of ["dev", "start", "serve", "preview"]) {
    if (scripts[want] && !isNative(scripts[want]) && !isNative(want)) return want;
  }
  // else first non-native script (name + body) that looks like a dev server
  return names.find((n) => !isNative(n) && !isNative(scripts[n]) && /dev|serve|start/i.test(n)) ?? null;
}

/** True if the project is a Tauri (native desktop) app — preview must run on the user's machine. */
export function isTauriPackage(pkgJson: string, hasSrcTauri: boolean): boolean {
  if (hasSrcTauri) return true;
  try {
    const d = JSON.parse(pkgJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
    const deps = { ...d.dependencies, ...d.devDependencies };
    if (Object.keys(deps).some((k) => k.startsWith("@tauri-apps"))) return true;
    return Object.values(d.scripts ?? {}).some((s) => /tauri/i.test(s));
  } catch {
    return false;
  }
}

/** Extract a localhost port from a dev server's stdout line, or 0 if none yet. */
export function parseDevPort(s: string): number {
  let m = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i.exec(s);
  if (m) return Number(m[1]);
  m = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i.exec(s);
  if (m) return Number(m[1]);
  m = /(?:port|listening on|running at)\D{0,6}(\d{4,5})\b/i.exec(s);
  return m ? Number(m[1]) : 0;
}

export function parseTunnelUrl(s: string): string {
  const m = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i.exec(s);
  return m ? m[1] : "";
}

/** The macOS `.command` script that clones, installs, and launches the PR app locally. */
export function buildLocalCommand(owner: string, repo: string, branch: string): string {
  const full = `${owner}/${repo}`;
  return [
    "#!/bin/bash",
    "# dev-agency — run this PR's app on your Mac. Double-click to launch (no typing).",
    "set -e",
    `DIR="$HOME/.devagency-previews/${repo}-${branch.replace(/[^\w.-]/g, "_")}"`,
    'echo "▶ dev-agency: preparing ' + full + " (" + branch + ')…"',
    'mkdir -p "$(dirname "$DIR")"',
    "if [ -d \"$DIR/.git\" ]; then",
    `  git -C "$DIR" fetch origin "${branch}" && git -C "$DIR" checkout "${branch}" && git -C "$DIR" reset --hard "origin/${branch}"`,
    "else",
    `  if command -v gh >/dev/null 2>&1; then gh repo clone ${full} "$DIR" -- --branch "${branch}"; else git clone --branch "${branch}" "https://github.com/${full}.git" "$DIR"; fi`,
    "fi",
    'cd "$DIR"',
    "corepack enable >/dev/null 2>&1 || true",
    'PM=pnpm; [ -f yarn.lock ] && PM=yarn; [ -f package-lock.json ] && [ ! -f pnpm-lock.yaml ] && PM=npm',
    'echo "📦 installing with $PM…"; $PM install',
    // Pick the native run script: tauri:dev > tauri > dev
    `RUN=$(node -e "const s=require('./package.json').scripts||{};process.stdout.write(s['tauri:dev']?'tauri:dev':(s['tauri']?'tauri':(s['dev']?'dev':'')))")`,
    'echo "🚀 launching ($RUN)…"',
    'if [ "$RUN" = "tauri" ]; then $PM tauri dev; elif [ -n "$RUN" ]; then $PM run "$RUN"; else echo "No run script found"; fi',
    'echo "— app exited. You can close this window."',
    "",
  ].join("\n");
}

// ---- runtime (web preview) ------------------------------------------------

export interface AppState {
  repo: string;
  number: number;
  status: "installing" | "starting" | "running" | "error" | "stopped";
  url?: string;
  error?: string;
  startedAt: number;
  lastSeen: number;
}
interface Live extends AppState {
  procs: ChildProcess[];
}
const apps = new Map<string, Live>();
const ttlMs = (): number => sNum("preview_ttl_min", "PREVIEW_TTL_MIN", 30) * 60_000;
const key = (repo: string, n: number) => `${repo}#${n}`;
const workdir = (repo: string, n: number) => join(process.cwd(), ".work", repo.replace("/", "__"), `preview-${n}`);

const pub = (a: Live): AppState => ({
  repo: a.repo,
  number: a.number,
  status: a.status,
  url: a.url,
  error: a.error,
  startedAt: a.startedAt,
  lastSeen: a.lastSeen,
});
export function getApp(repo: string, number: number): AppState | null {
  const a = apps.get(key(repo, number));
  if (!a) return null;
  a.lastSeen = Date.now();
  return pub(a);
}
export function listApps(): AppState[] {
  return [...apps.values()].map(pub);
}

function logLine(repo: string, n: number, text: string): void {
  pushActivity(repo, n, "developer", "tool", text.replace(/\s+$/, "").slice(0, 200));
}

function runToEnd(cmd: string, args: string[], cwd: string, onLine: (s: string) => void): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    p.stdout?.on("data", (d) => onLine(String(d)));
    p.stderr?.on("data", (d) => onLine(String(d)));
    p.on("error", rej);
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
  });
}

/** Spawn `cmd`, keep it running, resolve with the first matcher hit (or reject on timeout/exit). */
function spawnUntil<T>(
  cmd: string,
  args: string[],
  cwd: string,
  match: (s: string) => T | 0 | "",
  timeoutMs: number,
  onLine: (s: string) => void,
  keep: ChildProcess[],
): Promise<T> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, BROWSER: "none", CI: "1" } });
    keep.push(p);
    let done = false;
    const to = setTimeout(() => !done && ((done = true), rej(new Error("timed out"))), timeoutMs);
    const onData = (d: Buffer) => {
      const s = String(d);
      onLine(s);
      const hit = match(s);
      if (hit && !done) {
        done = true;
        clearTimeout(to);
        res(hit as T);
      }
    };
    p.stdout?.on("data", onData);
    p.stderr?.on("data", onData);
    p.on("error", (e) => !done && ((done = true), clearTimeout(to), rej(e)));
    p.on("exit", (c) => !done && ((done = true), clearTimeout(to), rej(new Error(`exited ${c}`))));
  });
}

/** Start (or return) a web preview for a PR. Caps at one preview at a time to bound resources. */
export async function startApp(repo: string, number: number, devScript: string): Promise<void> {
  const k = key(repo, number);
  const existing = apps.get(k);
  if (existing && existing.status !== "stopped" && existing.status !== "error") return;
  // One at a time: stop any other preview to bound resources.
  for (const a of [...apps.values()]) if (key(a.repo, a.number) !== k) stopApp(a.repo, a.number);

  const state: Live = { repo, number, status: "installing", startedAt: Date.now(), lastSeen: Date.now(), procs: [] };
  apps.set(k, state);
  const log = (t: string) => logLine(repo, number, t);
  const branch = `agency/issue-${number}`;
  setActive(repo, number, "issue", "developer", `preview #${number}`);
  try {
    const dir = workdir(repo, number);
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, ".."), { recursive: true });
    log("📥 cloning branch…");
    await cloneRepo(repo, dir);
    await runToEnd("git", ["fetch", "origin", branch], dir, () => {}).catch(() => {});
    await runToEnd("git", ["checkout", branch], dir, () => {}).catch(() => {});

    const pm = pmFor(dir);
    log(`📦 ${pm} install…`);
    await runToEnd(pm, ["install"], dir, log);
    // best-effort codegen if present (e.g. Reimedy's `gen`)
    await runToEnd(pm, ["run", "gen"], dir, log).catch(() => {});

    state.status = "starting";
    log(`▶ ${pm} run ${devScript}…`);
    const port = await spawnUntil(pm, ["run", devScript], dir, (s) => parseDevPort(s), 150_000, log, state.procs);
    log(`🌐 opening public tunnel to :${port}…`);
    const url = await spawnUntil(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`],
      dir,
      (s) => parseTunnelUrl(s),
      45_000,
      log,
      state.procs,
    );
    state.url = url;
    state.status = "running";
    log(`✅ live at ${url}`);
  } catch (err) {
    state.status = "error";
    state.error = (err as Error).message;
    log(`❌ ${state.error}`);
    for (const p of state.procs) p.kill("SIGKILL");
  } finally {
    clearActive(repo, number);
  }
}

export function stopApp(repo: string, number: number): void {
  const a = apps.get(key(repo, number));
  if (!a) return;
  for (const p of a.procs) {
    try {
      p.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => {
    for (const p of a.procs) {
      try {
        p.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 4000);
  apps.delete(key(repo, number));
  logLine(repo, number, "⏹ preview stopped");
}

export function killAllApps(): void {
  for (const a of apps.values()) for (const p of a.procs) p.kill("SIGKILL");
  apps.clear();
}

/** Auto-stop idle previews (pure timer, no agent). */
export function startPreviewSweeper(): void {
  setInterval(() => {
    const now = Date.now();
    for (const a of [...apps.values()]) {
      if (now - a.lastSeen > ttlMs()) {
        logLine(a.repo, a.number, "⏹ preview idle — stopped");
        stopApp(a.repo, a.number);
      }
    }
  }, 60_000);
}
