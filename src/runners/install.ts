/**
 * Install a CLI runner's binary on the fly (from the dashboard) so users can add new agent CLIs
 * without rebuilding the image. Globals go to NPM_CONFIG_PREFIX, which in the container is a
 * data-volume path on PATH — so installs persist across redeploys. Pure helpers (spec + validation)
 * are unit-tested; installCli() shells out to npm.
 */
import { spawn } from "node:child_process";

/** The npm package + resulting binary for each installable CLI runner. */
export const RUNNER_PACKAGES: Record<string, { pkg: string; binary: string; label: string }> = {
  "pi-cli": { pkg: "@earendil-works/pi-coding-agent", binary: "pi", label: "pi" },
  "claude-cli": { pkg: "@anthropic-ai/claude-code", binary: "claude", label: "Claude Code" },
};

/** What to install for a runner kind (or an explicit package for custom-cli). null = nothing known. */
export function installSpec(kind: string, customPkg?: string): { pkg: string; binary?: string } | null {
  if (kind === "custom-cli" || kind === "custom") return customPkg && validPackageSpec(customPkg) ? { pkg: customPkg.trim() } : null;
  const r = RUNNER_PACKAGES[kind];
  return r ? { pkg: r.pkg, binary: r.binary } : null;
}

// npm package name (optionally scoped) with an optional @version/range. Rejects flags, spaces-as-
// args, shell metacharacters — defense in depth on top of the shell-less spawn.
const PKG_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9][a-z0-9-._~^.|>=< ]*)?$/i;
export function validPackageSpec(pkg: string): boolean {
  if (typeof pkg !== "string") return false;
  const s = pkg.trim();
  return s.length > 0 && s.length < 214 && !s.startsWith("-") && PKG_RE.test(s);
}

/** Install an npm CLI globally (→ NPM_CONFIG_PREFIX). Resolves with the captured log. */
export function installCli(pkg: string): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    if (!validPackageSpec(pkg)) return resolve({ ok: false, log: `invalid package name: ${pkg}` });
    const proc = spawn("npm", ["install", "-g", "--ignore-scripts", pkg.trim()], { shell: false });
    let out = "";
    proc.stdout.on("data", (b: Buffer) => (out += b.toString()));
    proc.stderr.on("data", (b: Buffer) => (out += b.toString()));
    proc.on("error", (e) => resolve({ ok: false, log: `${e.message}\n${out}`.slice(-4000) }));
    proc.on("close", (code) => resolve({ ok: code === 0, log: out.slice(-4000) }));
  });
}
