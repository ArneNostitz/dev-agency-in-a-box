/**
 * Cross-issue coordination context (v4). When an issue is about to be edited by an agent, tell that
 * agent which OTHER open issues touch the same files and what they intend — so it integrates with
 * their work instead of clobbering it. Informational only (no code coupling to unmerged branches);
 * the binding integration still happens at merge via reconcile-by-intent. Empty unless there's a
 * real overlap, so it costs nothing in the common (disjoint) case.
 */
import { recentIssues, filesFor, lastPlan } from "./store.js";
import { activeClaims } from "./locks.js";

const EDIT_ROLES = new Set(["developer"]);
const norm = (f: string): string => f.trim().replace(/^\.?\/+/, "").replace(/\\/g, "/");

/** A coordination preamble for repo#number's editing run, or "" when there's nothing to coordinate. */
export function coordinationContext(repo: string, number: number, role: string): string {
  if (!EDIT_ROLES.has(role)) return "";
  const mine = filesFor(repo, number).map(norm);
  if (!mine.length) return "";
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
  if (!overlaps.length) return "";
  return (
    "\n\n### Cross-issue coordination — shared files (integrate, do NOT clobber)\n" +
    "Other open issues touch files you'll edit. Keep your changes COMPATIBLE with their intent: preserve their structure, exports and APIs; never delete or rewrite their work to make room for yours. If a shared file needs a shape that serves both, choose that shared shape.\n" +
    overlaps
      .map((o) => `- #${o.n} ${o.title}${o.live ? " (RUNNING NOW)" : ""} — shares: ${o.shared.join(", ")}${o.intent ? `\n  their intent: ${o.intent}` : ""}`)
      .join("\n")
  );
}
