#!/usr/bin/env node
// Regenerates web/version.json at build time so the dashboard always shows the current
// build's commit + timestamp. Run automatically by `npm run build` (and thus `npm test`).
//
// Version scheme: the patch number IS the git commit count (monotonic, no manual bumping).
// So v1.23.549 = the 549th commit on the 1.23 line. Every deploy/merge → a new version,
// derived from the build at deploy time. major.minor comes from package.json.
//
// Requires .git/ in the build context (Coolify git-pull provides this). Falls back to
// SOURCE_COMMIT (a SHA, no count) when .git/ is absent — in that case the patch stays at 0.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const run = (cmd) => {
  try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
};
const sha = run("git rev-parse --short HEAD") || (process.env.SOURCE_COMMIT || "").trim().slice(0, 7);
const commitCount = Number(run("git rev-list --count HEAD")) || 0;
const builtAt = new Date().toISOString();

// Version: major.minor from package.json, patch = commit count. e.g. "1.23" + 549 → "1.23.549"
const baseVersion = pkg.version || "0.0";
const majorMinor = baseVersion.replace(/\.\d+$/, ""); // strip any existing patch → "1.23"
const version = `${majorMinor}.${commitCount}`;

// Human label: "v1.23.549 · abc1234 · 2026-07-05 00:28"
// (commit count is baked into the version, so no separate "build N" needed)
const pad = (n) => String(n).padStart(2, "0");
const d = new Date(builtAt);
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const label = `v${version}${sha ? ` · ${sha}` : ""} · ${stamp}`;

const out = { version, build: commitCount, builtAt, sha, stamp, label };
writeFileSync(new URL("../web/version.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`[version] ${label}`);
