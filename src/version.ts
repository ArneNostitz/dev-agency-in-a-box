/**
 * Version info for the dashboard build stamp. Read from web/version.json (written at build by
 * scripts/version.mjs). Values are baked in at build time — no runtime env override — so the
 * displayed label always equals the code that is actually running.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface VersionInfo {
  version: string;
  build: number;
  builtAt: string;
  sha: string;
  stamp: string;
  label: string;
}

function fmtStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildLabel(version: string, build: number, sha: string, stamp: string): string {
  return `v${version}${build ? ` · build ${build}` : ""}${sha ? ` · ${sha}` : ""} · ${stamp}`;
}

/** Current version — values baked in at build time by scripts/version.mjs (web/version.json).
 *  No runtime env override: the label always reflects the code that is actually running. */
export function versionInfo(): VersionInfo {
  let v: Partial<VersionInfo> = {};
  try {
    v = JSON.parse(readFileSync(join(process.cwd(), "web", "version.json"), "utf8")) as Partial<VersionInfo>;
  } catch {
    /* no build file (dev) — fall back to defaults below */
  }
  const sha = v.sha || "";
  const version = v.version || "1.0.1";
  const build = v.build || 0;
  const builtAt = v.builtAt || new Date().toISOString();
  const stamp = v.stamp || fmtStamp(builtAt);
  return { version, build, builtAt, sha, stamp, label: buildLabel(version, build, sha, stamp) };
}
