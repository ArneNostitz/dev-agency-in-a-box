// Issue classification + sorting — pure functions.
// statusChip uses hm from format.js (resumeAt time formatting).

import { hm } from "./format.js";

export function isDone(i) { return i.state === "done"; }

// The issue's lifecycle lane: inbox | planned | working | review | done. Derived from the
// canonical IssueState enum in `i.state` + the BlockedReason in `i.blocked` (ADR-0001/0003).
// `agency:epic` is a one-way read-compat fallback for rows written before the epics.ts fix
// (docs/adr/0003) — nothing writes that value anymore, but old rows may still carry it.
export function classify(i) {
  const s = i.state || "";
  if (s === "agency:epic") return i.epic && i.epic.done >= i.epic.total ? "review" : "working";
  if (s === "done") return "done";
  if (s === "notPlanned") return "notPlanned"; // Inbox — never-triaged GitHub issue, nothing auto-starts it
  if (i.active || i.queued || i.running) return "working"; // actually executing right now
  if (i.pr_number && s !== "planned") return "review"; // a PR is up → waiting on you
  // Waiting on the human shows in Review (needs your 👍 / answer / attention).
  if (i.blocked === "awaitingApproval" || i.blocked === "awaitingAnswer" || i.blocked === "needsAttention") return "review";
  if (s === "working") return "working";
  if (s === "review") return "review";
  return "planned";
}

export function statusChip(i) {
  const s = i.state || "";
  if (s === "done") return { cls: "s-done", label: "done", icon: "merge" };
  if (i.active) return { cls: "s-working", label: "working", icon: "loader" };
  if (i.queued) return { cls: "s-working", label: "queued", icon: "clock" };
  if (i.blocked === "rateLimited") return { cls: "s-auto", label: i.resumeAt ? "resumes " + hm(new Date(i.resumeAt)) : "auto-resume", icon: "hourglass" };
  if (s === "agency:epic") return { cls: "s-epic", label: i.epic ? i.epic.done + "/" + i.epic.total : "epic", icon: "layers" };
  // Distinct chips for each BlockedReason (the payoff of carrying `blocked` in the payload).
  if (i.blocked === "conflict") return { cls: "s-changes", label: "conflict", icon: "alert" };
  if (i.blocked === "budgetExceeded") return { cls: "s-attn", label: "over budget", icon: "alert" };
  if (i.blocked === "held") return { cls: "s-working", label: "on hold", icon: "clock" };
  if (i.blocked === "needsAttention") return { cls: "s-attn", label: "needs you", icon: "alert" };
  if (i.blocked === "awaitingApproval") return { cls: "s-attn", label: "approve?", icon: "check" };
  if (i.blocked === "awaitingAnswer") return { cls: "s-attn", label: "reply", icon: "messages" };
  if (s === "working") return { cls: "s-working", label: "working", icon: "loader" };
  if (s === "review") return i.review === "changes" ? { cls: "s-changes", label: "changes", icon: "alert" } : { cls: "s-ready", label: "ready", icon: "pr" };
  if (s === "notPlanned") return { cls: "s-inbox", label: "inbox", icon: "inbox" };
  return { cls: "s-planned", label: "planned", icon: "planned" };
}

export const COLS = [
  { k: "notPlanned", label: "Inbox", icon: "inbox" },
  { k: "planned", label: "Planned", icon: "planned" },
  { k: "working", label: "Working", icon: "loader" },
  { k: "review", label: "Needs you", icon: "alert" },
  { k: "done", label: "Done", icon: "check" },
];

export function sortCmp(sort) {
  const s = sort || { key: "time", dir: "desc" };
  const dir = s.dir === "asc" ? 1 : -1;
  if (s.key === "name") return (a, b) => dir * String(a.title || "").localeCompare(String(b.title || ""));
  return (a, b) => dir * (new Date(a.updated_at || 0) - new Date(b.updated_at || 0));
}

// Board control sort — string key form used by the BoardControls toolbar.
export function boardSortCmp(v) {
  if (v === "updated_asc")  return (a, b) => new Date(a.updated_at || 0) - new Date(b.updated_at || 0);
  // GitHub issue numbers are creation order, and the DB has no created_at — so "created" sorts by number.
  if (v === "created_desc") return (a, b) => (b.number || 0) - (a.number || 0);
  if (v === "created_asc")  return (a, b) => (a.number || 0) - (b.number || 0);
  if (v === "number_asc")   return (a, b) => (a.number || 0) - (b.number || 0);
  if (v === "number_desc")  return (a, b) => (b.number || 0) - (a.number || 0);
  return (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0); // updated_desc default
}

// Filter issues by updated_at recency.
export function filterByTime(arr, v) {
  if (!v || v === "any") return arr;
  const ms = v === "24h" ? 86400000 : v === "7d" ? 7 * 86400000 : 30 * 86400000;
  const cut = Date.now() - ms;
  return arr.filter((i) => new Date(i.updated_at || 0).getTime() >= cut);
}
