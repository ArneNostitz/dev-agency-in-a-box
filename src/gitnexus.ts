/**
 * Optional GitNexus integration (https://github.com/abhigyanpatwari/GitNexus).
 *
 * GitNexus indexes a repo into a knowledge graph with Tree-sitter (NO LLM/tokens) and serves
 * ~16 MCP tools so agents get precomputed structural answers (impact, symbol context, call
 * chains, process-grouped search) in one call — instead of reading many files to research the
 * codebase. That directly cuts the tokens our agents spend on code exploration.
 *
 * Enable with GITNEXUS=true (default off). Everything here is best-effort: if the binary is
 * missing or indexing fails, agents just fall back to reading files as before.
 *
 * The index + its artifacts are hidden from git so the developer never accidentally commits
 * them. We run GitNexus with the container's normal HOME (its registry/setup live there) — a
 * per-run HOME breaks its module/setup resolution.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, appendFileSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { getSetting } from "./store.js";
import { sStr, sNum } from "./settings.js";

const exec = promisify(execFile);

/** Persistent per-repo index cache on the data volume (survives the per-run clone + redeploys). */
function cacheDirFor(repo: string): string {
  const dataDir = process.env.DB_PATH?.trim() ? dirname(process.env.DB_PATH.trim()) : "data";
  return join(dataDir, ".gncache", repo.replace(/[^\w.-]+/g, "_"));
}

export function gitnexusEnabled(): boolean {
  const s = getSetting("gitnexus"); // dashboard toggle wins over env
  if (s === "on") return true;
  if (s === "off") return false;
  return process.env.GITNEXUS?.trim().toLowerCase() === "true";
}

/** Has this clone been indexed (the .gitnexus dir exists)? */
export function isIndexed(workdir: string): boolean {
  return existsSync(join(workdir, ".gitnexus"));
}

/**
 * Make a GitNexus index available in a freshly-cloned `workdir`. Reuses a persistent per-repo
 * cache: if the cached index was built for the same commit, it's restored and we SKIP re-indexing
 * (the common case — clones land on the same default branch). Otherwise it indexes and refreshes
 * the cache. Best-effort.
 */
export async function indexRepo(workdir: string, repo: string, log: (s: string) => void = () => {}): Promise<boolean> {
  if (!gitnexusEnabled()) return false;
  const cache = cacheDirFor(repo);
  const cacheIndex = join(cache, ".gitnexus");
  const headFile = join(cache, "HEAD");
  // Keep GitNexus artifacts out of the developer's diff/commits.
  try {
    appendFileSync(join(workdir, ".git", "info", "exclude"), "\n.gitnexus/\n.gnhome/\n.gncache/\n.claude/\nAGENTS.md\nCLAUDE.md\n");
  } catch {
    /* ignore */
  }
  let curHead = "";
  try {
    curHead = (await exec("git", ["rev-parse", "HEAD"], { cwd: workdir })).stdout.trim();
  } catch {
    /* ignore */
  }
  // Restore a cached index into the fresh clone.
  let restored = false;
  if (existsSync(cacheIndex)) {
    try {
      cpSync(cacheIndex, join(workdir, ".gitnexus"), { recursive: true });
      restored = true;
    } catch {
      /* ignore */
    }
  }
  const cachedHead = existsSync(headFile) ? readFileSync(headFile, "utf8").trim() : "";
  if (restored && cachedHead && curHead && cachedHead === curHead) {
    log("🧭 reusing cached GitNexus index (codebase unchanged)");
    return true;
  }
  try {
    log(restored ? "🧭 refreshing GitNexus index (codebase changed)…" : "🧭 indexing codebase with GitNexus (no tokens)…");
    const argStr = sStr("gitnexus_analyze_args", "GITNEXUS_ANALYZE_ARGS", "");
    const args = argStr ? argStr.split(/\s+/) : ["analyze"];
    await exec("gitnexus", args, {
      cwd: workdir,
      timeout: sNum("gitnexus_index_timeout_ms", "GITNEXUS_INDEX_TIMEOUT_MS", 300_000),
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GITNEXUS_SKIP_OPTIONAL_GRAMMARS: "1" },
    });
    // The tree was pristine before indexing, so restore any tracked files GitNexus touched.
    await exec("git", ["checkout", "--", "."], { cwd: workdir }).catch(() => {});
    // Save the fresh index to the cache for the next run.
    try {
      mkdirSync(cache, { recursive: true });
      rmSync(cacheIndex, { recursive: true, force: true });
      if (existsSync(join(workdir, ".gitnexus"))) cpSync(join(workdir, ".gitnexus"), cacheIndex, { recursive: true });
      if (curHead) writeFileSync(headFile, curHead);
    } catch {
      /* cache write best-effort */
    }
    return isIndexed(workdir);
  } catch (err) {
    log(`GitNexus index ${restored ? "refresh failed (using cached)" : "skipped"}: ${(err as Error).message.slice(0, 140)}`);
    return restored; // a restored (possibly stale) index is still better than none
  }
}

export interface GitnexusWiring {
  servers: Record<string, { type: "stdio"; command: string; args: string[]; env: Record<string, string> }>;
  tools: string[];
}

/** MCP server + allowed tools to hand an agent running in `workdir`, or null if not available. */
export function gitnexusWiring(workdir: string): GitnexusWiring | null {
  if (!gitnexusEnabled() || !isIndexed(workdir)) return null;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  return {
    servers: {
      gitnexus: { type: "stdio", command: "gitnexus", args: ["mcp"], env },
    },
    tools: [
      "mcp__gitnexus__list_repos",
      "mcp__gitnexus__query",
      "mcp__gitnexus__context",
      "mcp__gitnexus__impact",
      "mcp__gitnexus__detect_changes",
      "mcp__gitnexus__cypher",
    ],
  };
}

/** A short prompt note telling the agent to use GitNexus FIRST for code research. */
export const GITNEXUS_PROMPT = [
  "=== CODE INTELLIGENCE (GitNexus MCP available) ===",
  "A knowledge graph of THIS repo is already indexed. Use it to locate and understand code.",
  "STRONGLY PREFER GitNexus over Grep/Glob and over reading many files — it's precomputed and",
  "far cheaper. To find where something lives or how it's used, DO NOT grep the repo:",
  "- mcp__gitnexus__query — find code/feature/process by intent (your primary search).",
  "- mcp__gitnexus__context — a symbol's 360° view (callers, callees, the files it lives in).",
  "- mcp__gitnexus__impact — blast radius before a change (what depends on X).",
  "- mcp__gitnexus__detect_changes — which processes your edits affect.",
  "Use these to jump straight to the few files you need. Use Grep ONLY inside a file you've",
  "already opened (not to search the whole repo). Read a full file only to see/modify exact code.",
  "If a tool complains about multiple repos, call mcp__gitnexus__list_repos and pass this repo's name.",
].join("\n");
