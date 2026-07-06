/**
 * Code-only test runner (Phase 2 of the v2 plan).
 *
 * Running a project's checks is deterministic — you don't need an LLM to execute a command and read
 * an exit code. We detect the check commands (from package.json scripts, with sensible fallbacks),
 * run them in a subprocess for ZERO tokens, and return a structured pass/fail + first error. The
 * orchestrator only falls back to the (cheap) LLM tester when we can't detect commands or a failure
 * genuinely needs interpreting.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSetting, setSetting } from "./store.js";
import { ghBotToken } from "./creds.js";
import { TOOLCHAINS } from "./toolchains.js";

export interface CheckResult { name: string; cmd: string; ok: boolean; firstError: string; env?: boolean }
/**
 * `verified` is the fail-closed signal: true only when the checks ACTUALLY ran to a real pass/fail
 * here. Toolchain-missing (even after a provision attempt) and env-blocked runs are `verified:false`
 * so the caller never presents an unrun suite as "green" and silently merges broken code.
 */
export interface ChecksOutcome {
  ran: boolean;
  pass: boolean;
  verified: boolean;
  summary: string;
  results: CheckResult[];
  envBlocked?: boolean;
  blockReason?: string;
  /** A managed toolchain (catalog id) is required but not installed → the caller pauses + asks. */
  neededToolchain?: string;
}

interface CommandSet {
  /** Binary that must exist on PATH for these checks to run here (e.g. "swift", "go", "cargo", "flutter"). */
  requires?: string;
  install?: string;
  checks: Array<{ name: string; cmd: string }>;
  /** Absolute dir to prepend to PATH for the checks (where a managed toolchain installs its binary). */
  binDir?: string;
  /** Catalog toolchain id (see toolchains.ts) this stack needs — surfaced when `requires` is absent. */
  toolchain?: string;
}

/** Run a shell command in `cwd`, capturing combined output; resolves with code + tail of output. */
export function runShell(cmd: string, cwd: string, timeoutMs = 240_000): Promise<{ code: number; out: string }> { return run(cmd, cwd, timeoutMs); }
function run(cmd: string, cwd: string, timeoutMs = 240_000, extraPath?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const token = ghBotToken();
    const env = {
      ...process.env,
      CI: "1",
      ...(token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {}),
      ...(extraPath ? { PATH: `${extraPath}:${process.env.PATH ?? ""}` } : {}),
    };
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

/** First actionable error line from a command's output (best-effort). */
function firstError(out: string): string {
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /\b(error|failed|FAIL|✖|✗|cannot find|not found|Type error|exception)\b/i.test(l));
  return (hit || lines[lines.length - 1] || "").slice(0, 300);
}

// A check whose non-zero exit means "the sandbox couldn't run it", NOT "the code is broken" — so we
// never send the developer into a fix loop over it. 127 = command not found; pytest 2 = collection/
// usage error (e.g. import error from missing deps), 5 = no tests collected.
export function isEnvError(cmd: string, code: number): boolean {
  if (code === 0) return false;
  if (code === 127) return true;
  if (/\bpytest\b/.test(cmd) && (code === 2 || code === 5)) return true;
  return false;
}
const has = (workdir: string, ...files: string[]) => files.some((f) => existsSync(join(workdir, f)));

/** Node / TypeScript / JavaScript (package.json). */
function nodeCommands(workdir: string): CommandSet | null {
  const pkgPath = join(workdir, "package.json");
  if (!existsSync(pkgPath)) return null;
  let scripts: Record<string, string> = {};
  try { scripts = (JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {}) as Record<string, string>; } catch { /* noop */ }
  const checks: Array<{ name: string; cmd: string }> = [];
  const hasScript = (n: string) => typeof scripts[n] === "string" && scripts[n].trim().length > 0;
  if (hasScript("typecheck")) checks.push({ name: "typecheck", cmd: "npm run typecheck" });
  else if (existsSync(join(workdir, "tsconfig.json"))) checks.push({ name: "typecheck", cmd: "npx --no-install tsc -p tsconfig.json --noEmit || npx tsc -p tsconfig.json --noEmit" });
  if (hasScript("lint")) checks.push({ name: "lint", cmd: "npm run lint" });
  if (hasScript("test") && !/no test specified/i.test(scripts.test)) checks.push({ name: "test", cmd: "npm test" });
  if (hasScript("build")) checks.push({ name: "build", cmd: "npm run build" });
  if (!checks.length) return null;
  const install = existsSync(join(workdir, "package-lock.json")) ? "npm ci || npm install" : "npm install";
  return { requires: "node", install, checks };
}

/** Python (pyproject / requirements / setup.py / tests). Lint/typecheck only when configured. */
function pythonCommands(workdir: string): CommandSet | null {
  if (!has(workdir, "pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "pytest.ini", "tox.ini")) return null;
  let pyproject = "";
  try { pyproject = readFileSync(join(workdir, "pyproject.toml"), "utf8"); } catch { /* none */ }
  const checks: Array<{ name: string; cmd: string }> = [];
  if (/\[tool\.ruff/.test(pyproject) || has(workdir, "ruff.toml", ".ruff.toml")) checks.push({ name: "lint", cmd: "python3 -m ruff check ." });
  if (/\[tool\.mypy/.test(pyproject) || has(workdir, "mypy.ini")) checks.push({ name: "typecheck", cmd: "python3 -m mypy ." });
  checks.push({ name: "test", cmd: "python3 -m pytest -q" });
  const install = has(workdir, "requirements.txt")
    ? "pip install --break-system-packages -r requirements.txt"
    : "pip install --break-system-packages -e .";
  return { requires: "python3", install, checks };
}

/** Swift Package Manager (Package.swift). Xcode projects (.xcodeproj) need macOS — handled below. */
function swiftCommands(workdir: string): CommandSet | null {
  if (existsSync(join(workdir, "Package.swift"))) {
    return { requires: "swift", checks: [{ name: "build", cmd: "swift build" }, { name: "test", cmd: "swift test" }] };
  }
  return null;
}

function goCommands(workdir: string): CommandSet | null {
  if (!existsSync(join(workdir, "go.mod"))) return null;
  return { requires: "go", checks: [{ name: "vet", cmd: "go vet ./..." }, { name: "build", cmd: "go build ./..." }, { name: "test", cmd: "go test ./..." }] };
}

function rustCommands(workdir: string): CommandSet | null {
  if (!existsSync(join(workdir, "Cargo.toml"))) return null;
  return { requires: "cargo", checks: [{ name: "build", cmd: "cargo build" }, { name: "test", cmd: "cargo test" }] };
}

/**
 * Tauri (native desktop): a Node/web front-end plus a Rust backend in `src-tauri/`. Detected before
 * `nodeCommands` so the Rust side is never skipped — a green front-end with a broken backend was
 * exactly the "looks tested, isn't" trap. Runs the web checks (if any) + `cargo test` on the backend.
 */
function tauriCommands(workdir: string): CommandSet | null {
  if (!existsSync(join(workdir, "src-tauri", "Cargo.toml"))) return null;
  const node = nodeCommands(workdir);
  const checks = [
    ...(node?.checks ?? []),
    { name: "cargo-test", cmd: "cargo test --manifest-path src-tauri/Cargo.toml" },
  ];
  return {
    requires: "cargo",
    install: node?.install,
    checks,
    binDir: TOOLCHAINS.rust.binDir,
    toolchain: "rust", // installed on demand via Settings → Environments
  };
}

/**
 * Flutter / Dart (pubspec.yaml). `flutter analyze` is the gate that catches compile-level defects
 * (missing imports, type errors) that a plain `flutter test` on a subset would miss. The SDK is
 * installed once from Settings → Environments; until then a run pauses and asks for it.
 */
function flutterCommands(workdir: string): CommandSet | null {
  if (!existsSync(join(workdir, "pubspec.yaml"))) return null;
  return {
    requires: "flutter",
    checks: [
      { name: "analyze", cmd: "flutter analyze" },
      { name: "test", cmd: "flutter test" },
    ],
    binDir: TOOLCHAINS.flutter.binDir,
    toolchain: "flutter",
  };
}

/**
 * Detect check commands for a clone. Cache wins (incl. what the LLM tester discovered for an unusual
 * stack), then a language registry. Returns null for stacks we can't run here (e.g. an Xcode
 * .xcodeproj, which needs macOS) → the caller defers to the LLM tester / local run.
 */
export function detectCommands(workdir: string, repo: string): CommandSet | null {
  const cached = getSetting(`checks:${repo}`);
  if (cached) { try { return JSON.parse(cached) as CommandSet; } catch { /* fall through */ } }
  // Order matters for polyglot repos: pick the primary stack by its most specific marker. Tauri
  // (src-tauri/) wins over Node so the Rust backend is checked; Flutter's pubspec is checked before
  // the looser Python markers.
  return (
    tauriCommands(workdir) ||
    nodeCommands(workdir) ||
    swiftCommands(workdir) ||
    goCommands(workdir) ||
    rustCommands(workdir) ||
    flutterCommands(workdir) ||
    pythonCommands(workdir) ||
    null
  );
}

/** Is a binary available on PATH (optionally including a provisioned `extraPath`) in this container? */
async function hasTool(name: string, extraPath?: string): Promise<boolean> {
  const r = await run(`command -v ${name}`, process.cwd(), 10_000, extraPath);
  return r.code === 0;
}

/** Persist a discovered command set so future runs skip detection (used after an LLM tester run). */
export function rememberChecks(repo: string, set: CommandSet): void {
  try { setSetting(`checks:${repo}`, JSON.stringify(set)); } catch { /* best effort */ }
}

/**
 * Self-adjusting: when the LLM tester figures out an unfamiliar stack's commands, it emits a
 * `CHECKS_JSON: {...}` line. Parse it so we can cache the commands and run them deterministically
 * (token-free) on every subsequent run. Returns null if no valid block is present.
 */
export function parseDiscoveredChecks(text: string): CommandSet | null {
  const m = /CHECKS_JSON:\s*(\{[\s\S]*?\})\s*(?:```|$)/m.exec(text);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]) as Partial<CommandSet>;
    if (!Array.isArray(o.checks) || !o.checks.length) return null;
    const checks = o.checks
      .filter((c) => c && typeof c.name === "string" && typeof c.cmd === "string")
      .map((c) => ({ name: String(c.name), cmd: String(c.cmd) }));
    if (!checks.length) return null;
    return {
      ...(typeof o.requires === "string" ? { requires: o.requires } : {}),
      ...(typeof o.install === "string" ? { install: o.install } : {}),
      checks,
    };
  } catch {
    return null;
  }
}

/**
 * Run the project's checks deterministically. Returns `ran:false` when the stack is unknown so the
 * caller can fall back to the LLM tester.
 */
export async function runChecks(workdir: string, repo: string): Promise<ChecksOutcome> {
  const set = detectCommands(workdir, repo);
  if (!set) return { ran: false, pass: false, verified: false, summary: "", results: [] };
  const extraPath = set.binDir;
  // Toolchain missing. If it's one we manage (Flutter, Rust), DON'T clone it inline — signal
  // `neededToolchain` so the pipeline pauses the issue and asks the user to install it once from
  // Settings → Environments (persistent). Otherwise defer to the LLM tester / a local run. Either
  // way we never treat an unrun suite as green.
  if (set.requires && !(await hasTool(set.requires, extraPath))) {
    return { ran: false, pass: false, verified: false, neededToolchain: set.toolchain, summary: "", results: [] };
  }

  if (set.install) {
    const inst = await run(set.install, workdir, 240_000, extraPath);
    if (inst.code !== 0) {
      // Dependencies didn't install → the sandbox can't run these checks. Don't fall into a fix loop
      // over phantom failures; report it as environment-blocked (unverified) so the caller neither
      // gates the developer on it nor mistakes it for a passing run.
      return { ran: true, pass: false, verified: false, envBlocked: true, blockReason: firstError(inst.out) || "dependency install failed", summary: "", results: [] };
    }
  }

  const results: CheckResult[] = [];
  for (const c of set.checks) {
    const r = await run(c.cmd, workdir, 240_000, extraPath);
    const env = isEnvError(c.cmd, r.code);
    results.push({ name: c.name, cmd: c.cmd, ok: r.code === 0, firstError: r.code === 0 ? "" : firstError(r.out), env });
  }
  const pass = results.every((r) => r.ok);
  const envBlocked = results.some((r) => !r.ok && r.env);
  const blockReason = envBlocked ? (results.find((r) => r.env)?.firstError || "checks could not be executed") : undefined;
  const summary = `| check | status | detail |\n|---|---|---|\n` +
    results.map((r) => `| ${r.name} | ${r.ok ? "✅ pass" : r.env ? "⚙️ env" : "❌ FAIL"} | ${r.ok ? "" : "`" + r.firstError.replace(/\|/g, "\\|") + "`"} |`).join("\n") +
    `\n\n${pass ? "All checks passed." : "Some checks failed — see the first error above."}`;
  // Verified only when it genuinely executed to a real result (not an env-blocked run).
  return { ran: true, pass, verified: !envBlocked, envBlocked, blockReason, summary, results };
}


/**
 * Which of these failing checks were ALREADY failing on the base (origin/main) BEFORE this change?
 * Re-runs only the failing checks against the base commit in the same workdir (deps already
 * installed, so it's cheap and token-free), then restores the branch. A check that fails on both is
 * pre-existing — the agency shouldn't loop trying to "fix" code it didn't break. Best-effort: if the
 * base can't be checked out, returns empty (treat all as introduced — the safe, conservative side).
 */
export async function baselineFailures(workdir: string, branch: string, failing: CheckResult[]): Promise<Set<string>> {
  const pre = new Set<string>();
  if (failing.length === 0) return pre;
  const ref = async (r: string): Promise<boolean> => (await run(`git rev-parse --verify ${r}`, workdir)).code === 0;
  const base = (await ref("origin/main")) ? "origin/main" : (await ref("main")) ? "main" : "";
  if (!base) return pre; // no baseline available → don't suppress anything
  const head = ((await run("git rev-parse --abbrev-ref HEAD", workdir)).out.trim()) || branch;
  const cur = head === "HEAD" ? ((await run("git rev-parse HEAD", workdir)).out.trim() || branch) : head;
  const stashed = (await run("git stash push -u -m agency-baseline", workdir)).out.includes("Saved");
  try {
    if ((await run(`git checkout --quiet --force ${base}`, workdir)).code !== 0) return pre;
    for (const c of failing) {
      if ((await run(c.cmd, workdir)).code !== 0) pre.add(c.name); // already red on base → pre-existing
    }
  } finally {
    await run(`git checkout --quiet --force ${cur}`, workdir);
    if (stashed) await run("git stash pop", workdir);
  }
  return pre;
}
