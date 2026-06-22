/**
 * Post-merge coordination hook (v4). Runs after any successful merge: (1) writes the durable change
 * journal entry (real state — what landed + why), and (2) refreshes the repo's GitNexus index so the
 * Orchestrator and every next agent see the new structure immediately. Best-effort; never blocks a
 * merge. This is the "share what changed and why + keep code intelligence current after each merge"
 * foundation; the reconcile-at-merge and cross-issue negotiation layers build on top of it.
 */
import { recordChange, getIssueRow } from "./store.js";
import { ensureRepoIndex } from "./gitnexus.js";

export interface MergedFile { path: string; additions?: number; deletions?: number }

/** Call once after a PR for repo#number merges successfully. */
export function afterMerge(repo: string, number: number, files?: MergedFile[], title?: string): void {
  try {
    const t = title || getIssueRow(repo, number)?.title || `#${number}`;
    const fs = (files || []).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions }));
    const summary = fs.length
      ? `Merged: touched ${fs.length} file(s) — ${fs.slice(0, 6).map((f) => f.path).join(", ")}${fs.length > 6 ? ", …" : ""}`
      : "Merged.";
    recordChange(repo, number, { title: t, files: fs, summary });
  } catch { /* best effort */ }
  // Refresh code intelligence against the just-merged main (background, debounced, off critical path).
  try { ensureRepoIndex(repo); } catch { /* best effort */ }
}
