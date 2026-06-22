/**
 * Cross-issue coordination context (v4). When an issue is about to be edited by an agent, tell that
 * agent which OTHER open issues touch the same files and what they intend — so it integrates with
 * their work instead of clobbering it. Informational only (no code coupling to unmerged branches);
 * the binding integration still happens at merge via reconcile-by-intent. Empty unless there's a
 * real overlap, so it costs nothing in the common (disjoint) case.
 */
import { recentIssues, filesFor, lastPlan, getSetting } from "./store.js";
import { activeClaims } from "./locks.js";

const EDIT_ROLES = new Set(["developer"]);
const norm = (f: string): string => f.trim().replace(/^\.?\/+/, "").replace(/\\/g, "/");

const STRUCTURAL_RE = /\b(refactor|restructur|reorganiz|rename|relocat|migrat|rework|extract (a|the|into|to)|split (out|into)|move .* (to|into)|break (up|out))/i;
/** Heuristic: does this issue's text describe a structural change (rename/move/delete/refactor)? */
export function isStructural(title = "", body = ""): boolean {
  return STRUCTURAL_RE.test(`${title}\n${body}`);
}
/** Persist that repo#number is a structural change (DB-first flag the agent + scheduler read). */
export function structuralFlagKey(repo: string, number: number): string { return `structural:${repo}#${number}`; }

/** A coordination preamble for repo#number's editing run, or "" when there's nothing to coordinate. */
export function coordinationContext(repo: string, number: number, role: string): string {
  if (!EDIT_ROLES.has(role)) return "";
  const structuralNote = getSetting(structuralFlagKey(repo, number)) === "1"
    ? "\n\n### You are making a STRUCTURAL change (exclusive lock)\nThis issue renames/moves/deletes or restructures code, so it runs ALONE with a repo-wide lock. Use GitNexus `impact` to find EVERY caller/importer of the symbols you change and update them all in this one change — leave nothing dangling. State each rename/move explicitly (old path \u2192 new path) in your PR description so other issues can rebase onto it."
    : "";
  const mine = filesFor(repo, number).map(norm);
  if (!mine.length) return structuralNote;
  const mineSet = new Set(mine);
  const claims = activeClaims(repo);
  const overlaps: Array<{ n: number; title: string; shared: string[]; live: boolean; intent: string }> = [];
  for (const o of recentIssues(160)) {
    if (o.repo !== repo || o.number === number || o.state === "done") continue;
    const shared = filesFor(repo, o.number).map(norm).filter((f) => mineSet.has(f));
    if (!shared.length) continue;
    overlaps.push({
      n: o.number,
      title: o.title,
      shared,
      live: claims.some((c) => c.number === o.number),
      intent: (lastPlan(repo, o.number) || "").replace(/\s+/g, " ").trim().slice(0, 280),
    });
  }
  if (!overlaps.length) return structuralNote;
  return structuralNote + (
    "\n\n### Cross-issue coordination — shared files (integrate, do NOT clobber)\n" +
    "Other open issues touch files you'll edit. Keep your changes COMPATIBLE with their intent: preserve their structure, exports and APIs; never delete or rewrite their work to make room for yours. If a shared file needs a shape that serves both, choose that shared shape.\n" +
    overlaps
      .map((o) => `- #${o.n} ${o.title}${o.live ? " (RUNNING NOW)" : ""} — shares: ${o.shared.join(", ")}${o.intent ? `\n  their intent: ${o.intent}` : ""}`)
      .join("\n")
  );
}
