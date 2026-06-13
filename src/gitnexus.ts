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
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, appendFileSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { getSetting } from "./store.js";
import { sStr, sNum } from "./settings.js";

const exec = promisify(execFile);

/**
 * Run `gitnexus <args>` streaming its progress to `log` (so the live stream shows the analyze
 * progress bar instead of looking frozen), capturing the output tail for a useful error message.
 * Resolves on exit 0; rejects with the captured tail otherwise (or on timeout).
 */
function runGitnexusStreaming(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  log: (s: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("gitnexus", args, { cwd, env });
    let tail = "";
    let lastEmit = 0;
    const onData = (buf: Buffer): void => {
      const s = buf.toString();
      tail = (tail + s).slice(-4000);
      // Progress bars overwrite a line with \r — split on both, surface the latest meaningful line,
      // throttled so the stream shows movement without flooding the activity log.
      const lines = s.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
      const last = lines[lines.length - 1];
      const now = Date.now();
      if (last && now - lastEmit > 1200) {
        lastEmit = now;
        log("🧭 " + last.replace(/\s+/g, " ").slice(0, 160));
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s — ${tail.trim().slice(-500)}`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`exit ${code} — ${tail.trim().slice(-700)}`));
    });
  });
}

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
  log(restored ? "🧭 refreshing GitNexus index (codebase changed)…" : "🧭 indexing codebase with GitNexus (no tokens)…");
  const argStr = sStr("gitnexus_analyze_args", "GITNEXUS_ANALYZE_ARGS", "");
  const args = argStr ? argStr.split(/\s+/) : ["analyze"];
  // On a refresh, drop the stale restored index first so a *failed* analyze can't leave a stale or
  // half-written index that the MCP then rejects ("not indexed"); we re-restore from cache below if
  // analyze produces nothing usable.
  if (restored) rmSync(join(workdir, ".gitnexus"), { recursive: true, force: true });
  let analyzeErr: Error | null = null;
  try {
    await runGitnexusStreaming(
      args,
      workdir,
      { ...process.env, GITNEXUS_SKIP_OPTIONAL_GRAMMARS: "1" },
      sNum("gitnexus_index_timeout_ms", "GITNEXUS_INDEX_TIMEOUT_MS", 300_000),
      log,
    );
  } catch (err) {
    analyzeErr = err as Error;
  }
  // The tree was pristine before indexing, so restore any tracked files GitNexus touched.
  await exec("git", ["checkout", "--", "."], { cwd: workdir }).catch(() => {});

  // Keep the index if analyze actually produced one — even on a non-zero exit (e.g. the harmless
  // "FTS extension unavailable" warning makes gitnexus exit 1 while still writing a usable index).
  if (isIndexed(workdir)) {
    if (analyzeErr) log("🧭 GitNexus finished with warnings but produced an index — using it.");
    try {
      mkdirSync(cache, { recursive: true });
      rmSync(cacheIndex, { recursive: true, force: true });
      cpSync(join(workdir, ".gitnexus"), cacheIndex, { recursive: true });
      if (curHead) writeFileSync(headFile, curHead);
    } catch {
      /* cache write best-effort */
    }
    return true;
  }

  // No usable index produced. Surface the REAL error (not truncated), and fall back to the cached
  // index if we had one.
  log(`GitNexus indexing failed — ${(analyzeErr?.message ?? "no index produced").slice(0, 600)}`);
  if (restored && existsSync(cacheIndex)) {
    try {
      cpSync(cacheIndex, join(workdir, ".gitnexus"), { recursive: true });
      log("🧭 fell back to the previous cached index.");
      return true;
    } catch {
      /* ignore */
    }
  }
  return false;
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
  "A structural knowledge graph of THIS repo is indexed. Prefer it over reading many files — it's",
  "precomputed and far cheaper. Use the GRAPH tools (these work reliably):",
  "- mcp__gitnexus__context — a symbol's 360° view (definition, callers, callees, the files it's in).",
  "  This is your primary 'where does X live / how is it used' tool — pass a symbol/function/class name.",
  "- mcp__gitnexus__impact — blast radius before a change (what depends on X).",
  "- mcp__gitnexus__detect_changes — which processes your edits affect.",
  "- mcp__gitnexus__cypher — structural queries over the graph when you need something specific.",
  "NOTE: mcp__gitnexus__query (full-text/BM25 search) may be UNAVAILABLE or return empty here (the",
  "LadybugDB FTS extension can't be installed offline). Don't rely on it — if it returns nothing, use",
  "context/impact/cypher above, and only then a TARGETED grep on a specific dir/file (never the whole",
  "repo). If a tool complains about multiple repos, call mcp__gitnexus__list_repos and pass this repo.",
].join("\n");
