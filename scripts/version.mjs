#!/usr/bin/env node
// Regenerates web/version.json at build time so the dashboard always shows the current
// build's commit + timestamp. Run automatically by `npm run build` (and thus `npm test`).
//
// Version scheme: CalVer — YY.M.commits, fully derived from the build, zero manual bumping.
// So v26.7.568 = built in 2026-07, the 568th commit overall. Every deploy/merge → a new
// version. This replaced a manually-bumped major.minor in package.json (e.g. "1.23") that
// went stale for 92 commits / 10 days because nobody remembered to bump it — the number
// looked frozen even though the patch (commit count) kept climbing underneath it.
//
// Requires .git/ in the build context (Coolify git-pull provides this). Falls back to
// SOURCE_COMMIT (a SHA, no count) when .git/ is absent — in that case the patch stays at 0.
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const run = (cmd) => {
  try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
};
const sha = run("git rev-parse --short HEAD") || (process.env.SOURCE_COMMIT || "").trim().slice(0, 7);
const commitCount = Number(run("git rev-list --count HEAD")) || 0;
const builtAt = new Date().toISOString();

// Version: YY.M (two-digit year, unpadded month) + patch = commit count. e.g. 2026-07 + 568 → "26.7.568"
const d = new Date(builtAt);
const majorMinor = `${d.getFullYear() % 100}.${d.getMonth() + 1}`;
const version = `${majorMinor}.${commitCount}`;

// Human label: "v26.7.568 · abc1234 · 2026-07-05 00:28"
// (commit count is baked into the version, so no separate "build N" needed)
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const label = `v${version}${sha ? ` · ${sha}` : ""} · ${stamp}`;

const out = { version, build: commitCount, builtAt, sha, stamp, label };
writeFileSync(new URL("../web/version.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`[version] ${label}`);
