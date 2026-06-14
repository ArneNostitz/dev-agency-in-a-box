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

export interface CheckResult { name: string; cmd: string; ok: boolean; firstError: string }
export interface ChecksOutcome { ran: boolean; pass: boolean; summary: string; results: CheckResult[] }

interface CommandSet {
  /** Binary that must exist on PATH for these checks to run here (e.g. "swift", "go", "cargo"). */
  requires?: string;
  install?: string;
  checks: Array<{ name: string; cmd: string }>;
}

/** Run a shell command in `cwd`, capturing combined output; resolves with code + tail of output. */
function run(cmd: string, cwd: string, timeoutMs = 240_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const token = ghBotToken();
    const env = { ...process.env, CI: "1", ...(token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {}) };
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
    ? "pip install --break-system-packages -r requirements.txt || true"
    : "pip install --break-system-packages -e . || true";
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
 * Detect check commands for a clone. Cache wins (incl. what the LLM tester discovered for an unusual
 * stack), then a language registry. Returns null for stacks we can't run here (e.g. an Xcode
 * .xcodeproj, which needs macOS) → the caller defers to the LLM tester / local run.
 */
function detectCommands(workdir: string, repo: string): CommandSet | null {
  const cached = getSetting(`checks:${repo}`);
  if (cached) { try { return JSON.parse(cached) as CommandSet; } catch { /* fall through */ } }
  // Order matters for polyglot repos: pick the primary stack by its most specific marker.
  return (
    nodeCommands(workdir) ||
    swiftCommands(workdir) ||
    goCommands(workdir) ||
    rustCommands(workdir) ||
    pythonCommands(workdir) ||
    null
  );
}

/** Is a binary available on PATH in this container? */
async function hasTool(name: string): Promise<boolean> {
  const r = await run(`command -v ${name}`, process.cwd(), 10_000);
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
  if (!set) return { ran: false, pass: false, summary: "", results: [] };
  // If the language's toolchain isn't installed here (e.g. an Xcode/Swift app on a Linux box),
  // don't false-fail — defer to the LLM tester / a local run.
  if (set.requires && !(await hasTool(set.requires))) {
    return { ran: false, pass: false, summary: "", results: [] };
  }

  if (set.install) {
    const inst = await run(set.install, workdir);
    if (inst.code !== 0) {
      // Install failed — hand off to the LLM tester, which can adapt (different package manager, etc.).
      return { ran: false, pass: false, summary: "", results: [] };
    }
  }

  const results: CheckResult[] = [];
  for (const c of set.checks) {
    const r = await run(c.cmd, workdir);
    results.push({ name: c.name, cmd: c.cmd, ok: r.code === 0, firstError: r.code === 0 ? "" : firstError(r.out) });
  }
  const pass = results.every((r) => r.ok);
  const summary = `| check | status | detail |\n|---|---|---|\n` +
    results.map((r) => `| ${r.name} | ${r.ok ? "✅ pass" : "❌ FAIL"} | ${r.ok ? "" : "`" + r.firstError.replace(/\|/g, "\\|") + "`"} |`).join("\n") +
    `\n\n${pass ? "All checks passed." : "Some checks failed — see the first error above."}`;
  return { ran: true, pass, summary, results };
}
