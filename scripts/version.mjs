#!/usr/bin/env node
// Regenerates web/version.json at build time so the dashboard always shows the current
// build's commit + timestamp. Run automatically by `npm run build` (and thus `npm test`).
// Build number = git commit count (monotonic, no persistent state file needed).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const run = (cmd) => {
  try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
};
const sha = run("git rev-parse --short HEAD") || (process.env.SOURCE_COMMIT || "").trim().slice(0, 7);
const build = Number(run("git rev-list --count HEAD")) || 0;
const builtAt = new Date().toISOString();

// Human label: "v1.0.1 · build 1234 · 2026-06-19 13:24 · abc1234"
const pad = (n) => String(n).padStart(2, "0");
const d = new Date(builtAt);
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const label = `v${pkg.version}${build ? ` · build ${build}` : ""}${sha ? ` · ${sha}` : ""} · ${stamp}`;

const out = { version: pkg.version, build, builtAt, sha, stamp, label };
writeFileSync(new URL("../web/version.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`[version] ${label}`);
