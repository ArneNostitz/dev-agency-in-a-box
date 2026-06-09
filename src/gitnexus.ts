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
 * Isolation: each issue's clone is indexed with HOME pointed at a per-clone dir, so the
 * GitNexus registry never collides across the parallel runs. The index + its artifacts are
 * hidden from git so the developer never accidentally commits them.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const exec = promisify(execFile);

export function gitnexusEnabled(): boolean {
  return process.env.GITNEXUS?.trim().toLowerCase() === "true";
}

const gnHome = (workdir: string): string => join(workdir, ".gnhome");

/** Has this clone been indexed (the .gitnexus dir exists)? */
export function isIndexed(workdir: string): boolean {
  return existsSync(join(workdir, ".gitnexus"));
}

/** Index a freshly-cloned repo. Best-effort; returns true if an index now exists. */
export async function indexRepo(workdir: string, log: (s: string) => void = () => {}): Promise<boolean> {
  if (!gitnexusEnabled()) return false;
  try {
    log("🧭 indexing codebase with GitNexus (no tokens)…");
    // Flags vary by gitnexus version (e.g. some lack --skip-embeddings). Plain `analyze` always
    // works; override the args with GITNEXUS_ANALYZE_ARGS (space-separated) for your version.
    const args = process.env.GITNEXUS_ANALYZE_ARGS?.trim()
      ? process.env.GITNEXUS_ANALYZE_ARGS.trim().split(/\s+/)
      : ["analyze"];
    await exec("gitnexus", args, {
      cwd: workdir,
      timeout: Number(process.env.GITNEXUS_INDEX_TIMEOUT_MS?.trim()) || 300_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, HOME: gnHome(workdir), GITNEXUS_SKIP_OPTIONAL_GRAMMARS: "1" },
    });
    // Keep GitNexus artifacts out of the developer's diff/commits.
    try {
      appendFileSync(join(workdir, ".git", "info", "exclude"), "\n.gitnexus/\n.gnhome/\nAGENTS.md\nCLAUDE.md\n");
    } catch {
      /* ignore */
    }
    // The tree was pristine before indexing, so restore any tracked files GitNexus touched.
    await exec("git", ["checkout", "--", "."], { cwd: workdir }).catch(() => {});
    return isIndexed(workdir);
  } catch (err) {
    log(`GitNexus index skipped: ${(err as Error).message.slice(0, 140)}`);
    return false;
  }
}

export interface GitnexusWiring {
  servers: Record<string, { type: "stdio"; command: string; args: string[]; env: Record<string, string> }>;
  tools: string[];
}

/** MCP server + allowed tools to hand an agent running in `workdir`, or null if not available. */
export function gitnexusWiring(workdir: string): GitnexusWiring | null {
  if (!gitnexusEnabled() || !isIndexed(workdir)) return null;
  return {
    servers: {
      gitnexus: { type: "stdio", command: "gitnexus", args: ["mcp"], env: { ...process.env, HOME: gnHome(workdir) } },
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

/** A short prompt note telling the agent to prefer GitNexus for code research. */
export const GITNEXUS_PROMPT = [
  "=== CODE INTELLIGENCE (GitNexus MCP available) ===",
  "A knowledge graph of THIS repo is indexed. To research the codebase, PREFER the GitNexus",
  "tools over reading many files — they're precomputed and far cheaper:",
  "- mcp__gitnexus__query — find code/process by intent (hybrid search).",
  "- mcp__gitnexus__context — 360° view of a symbol (callers, callees, files).",
  "- mcp__gitnexus__impact — blast radius before a change (what depends on X).",
  "- mcp__gitnexus__detect_changes — which processes your edits affect.",
  "Read full files only when you must see/modify exact code.",
].join("\n");
