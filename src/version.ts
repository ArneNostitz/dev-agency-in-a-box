/**
 * Version info for the dashboard build stamp. Read from web/version.json (written at build by
 * scripts/version.mjs), but the commit SHA is overlaid from the SOURCE_COMMIT env at RUNTIME — so
 * a Coolify deploy shows its real commit even though the Docker build has no .git to read. The
 * label drops "build 0" (no git in the container) and leads with the SHA + date instead.
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

/** Current version, with the deployed commit overlaid from SOURCE_COMMIT (runtime) when present. */
export function versionInfo(): VersionInfo {
  let v: Partial<VersionInfo> = {};
  try {
    v = JSON.parse(readFileSync(join(process.cwd(), "web", "version.json"), "utf8")) as Partial<VersionInfo>;
  } catch {
    /* no build file (dev) — fall back to defaults below */
  }
  const envSha = (process.env.SOURCE_COMMIT || "").trim();
  const sha = envSha ? envSha.slice(0, 7) : v.sha || "";
  const version = v.version || "1.0.1";
  const build = v.build || 0;
  const builtAt = v.builtAt || new Date().toISOString();
  const stamp = v.stamp || fmtStamp(builtAt);
  return { version, build, builtAt, sha, stamp, label: buildLabel(version, build, sha, stamp) };
}
