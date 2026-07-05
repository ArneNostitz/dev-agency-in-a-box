/**
 * Epics: when the planner decomposes an issue into sub-issues, the parent becomes an "epic"
 * that tracks its children. We:
 *   - keep a single tracking comment on the parent with a live checklist (n/m done),
 *   - update each child's status every scan,
 *   - when ALL children are done (their PRs merged / issues closed), run a final review on the
 *     parent against the integrated default branch and move it to "ready" so you can close it,
 *   - let `/merge` on the parent merge every child PR at once.
 */
import { createHash } from "node:crypto";
import { afterMerge } from "./merge_hooks.js";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  cloneRepo,
  commentOnIssue,
  upsertTrackerComment,
  mergePrForBranch,
  closeIssue,
  type RecentThread,
} from "./github.js";
import {
  listEpicParents,
  listEpicChildren,
  updateEpicChild,
  epicParentsOf,
  getEpicMeta,
  setEpicMeta,
  recordIssueStatus,
  getIssueStatus,
  recordRun,
  getSetting,
  setSetting,
  type EpicChild,
} from "./store.js";
import { runRole } from "./agents/roleAgent.js";
import { setActive, clearActive } from "./activity.js";
import { withStatus } from "./state.js";

/** Human-readable status for a child's tracking checklist, from DB status + closed state. */
export function childStatus(repo: string, t: RecentThread): string {
  const s = getIssueStatus(repo, t.number);
  // "done" when either the GitHub thread is closed OR the agency DB marked it done (PR merged). The
  // DB state flips at merge time; the GitHub close may lag or never fire — counting only t.closed
  // left the epic counter stuck after a sub-issue's PR merged.
  if (t.closed || s.state === "done") return "done";
  if (s.state === "review") return "in review";
  if (s.blocked === "awaitingApproval" || s.blocked === "awaitingAnswer") return "waiting";
  if (s.blocked === "needsAttention") return "blocked";
  if (s.state === "working") return "working";
  return "open";
}

/** A child counts as done when its PR merged (DB state "done") — GitHub close may lag or never fire. */
const childDone = (c: EpicChild): boolean => Boolean(c.closed) || c.state === "done";

/** The checklist markdown for the parent's tracking comment. */
export function renderEpicTracker(children: EpicChild[]): string {
  const done = children.filter(childDone).length;
  const lines = children.map((c) => `- [${childDone(c) ? "x" : " "}] #${c.child} — ${c.title} _(${c.state})_`);
  return [
    `### 🧩 Sub-issues — ${done}/${children.length} done`,
    "",
    ...lines,
    "",
    done === children.length
      ? "All sub-issues complete. Reviewing the integrated result; then this epic is ready to close/merge."
      : "This epic completes when every sub-issue above is done.",
  ].join("\n");
}

const sha = (s: string): string => createHash("sha1").update(s).digest("hex").slice(0, 16);

/**
 * Reconcile every epic in a repo against the latest issue snapshot (passed in to avoid extra
 * API calls). Updates child statuses + the tracking comment, and kicks the parent review when
 * all children are done.
 */
export async function reconcileEpics(repo: string, threads: Map<number, RecentThread>): Promise<void> {
  for (const parent of listEpicParents(repo)) {
    const pt = threads.get(parent);
    if (pt?.closed) continue; // epic already wrapped up
    const children = listEpicChildren(repo, parent);
    if (children.length === 0) continue;

    for (const c of children) {
      const t = threads.get(c.child);
      if (t) {
        const status = childStatus(repo, t);
        // A child counts as closed (✓) when its GitHub thread is closed OR the agency DB state is
        // "done" (PR merged). Both update the checklist + the n/m counter.
        const isDone = t.closed || status === "done";
        updateEpicChild(repo, parent, c.child, status, isDone);
      }
    }
    const fresh = listEpicChildren(repo, parent);
    const done = fresh.filter(childDone).length;

    const body = renderEpicTracker(fresh);
    const meta = getEpicMeta(repo, parent);
    const hash = sha(body);
    if (hash !== meta.hash) {
      await upsertTrackerComment(repo, parent, body);
      setEpicMeta(repo, parent, { hash });
    }

    if (done < fresh.length) continue; // epic-ness is isEpic() (the epics table), not a lifecycle state
    // All children done — run the integration review on the parent once.
    if (!meta.reviewed) {
      setEpicMeta(repo, parent, { reviewed: true });
      await runEpicReview(repo, parent, fresh).catch((err) =>
        console.error(`[agency] epic review failed ${repo} #${parent}:`, (err as Error).message),
      );
    }
  }
}

/** Final integration review on the parent once all sub-issues merged. */
async function runEpicReview(repo: string, parent: number, children: EpicChild[]): Promise<void> {
  const workdir = join(process.cwd(), ".work", repo.replace("/", "__"), `epic-${parent}`);
  setActive(repo, parent, "issue", "reviewer", `epic #${parent} integration review`);
  try {
    await rm(workdir, { recursive: true, force: true });
    await mkdir(join(workdir, ".."), { recursive: true });
    await cloneRepo(repo, workdir);
    const list = children.map((c) => `#${c.child} ${c.title}`).join(", ");
    const review = await runRole("reviewer", {
      workdir,
      repo,
      issueNumber: parent,
      task:
        `Epic #${parent}: all sub-issues (${list}) are merged into the default branch. Review the INTEGRATED ` +
        `result — do the pieces fit together, are there gaps, missing wiring, or regressions across the modules? ` +
        `Inspect recent history (e.g. \`git log --oneline -20\`, \`git diff\`). ` +
        `Start with "APPROVE" or "NEEDS WORK", then a concise integration review.`,
    });
    recordRun(repo, parent, "reviewer", review.model, review.turns, "epic-review", review.costUsd);
    await commentOnIssue(
      repo,
      parent,
      `🔍 **Epic integration review** · _dev-agency_\n\n${review.text}\n\n— all sub-issues are done. This epic is **ready** to close.`,
    );
    recordIssueStatus(repo, parent, withStatus("review"));
    console.log(`[agency] epic #${parent} reviewed -> ready`);
  } finally {
    clearActive(repo, parent);
  }
}

/** `/merge` on an epic parent: merge every child's open PR, then close the parent. */
export async function mergeEpic(repo: string, parent: number): Promise<{ ok: boolean; msg: string }> {
  const children = listEpicChildren(repo, parent);
  if (children.length === 0) return { ok: false, msg: "not an epic" };
  const merged: number[] = [];
  const failed: string[] = [];
  for (const c of children) {
    if (childDone(c)) continue;
    const r = await mergePrForBranch(repo, `agency/issue-${c.child}`);
    if (r.ok) {
      afterMerge(repo, c.child, r.files);
      updateEpicChild(repo, parent, c.child, "done", true);
      recordIssueStatus(repo, c.child, withStatus("done"));
      merged.push(c.child);
    }
    else failed.push(`#${c.child}: ${r.msg}`);
  }
  if (failed.length) return { ok: false, msg: `merged ${merged.length}; could not merge ${failed.join("; ")}` };
  await closeIssue(repo, parent, `🚀 Epic complete — merged all sub-issues (${children.map((c) => `#${c.child}`).join(", ")}).`);
  recordIssueStatus(repo, parent, withStatus("done"));
  return { ok: true, msg: `merged ${merged.length} sub-issue PR(s)` };
}

/** Is this issue an epic parent? (has recorded children) */
export function isEpic(repo: string, parent: number): boolean {
  return listEpicChildren(repo, parent).length > 0;
}

/** The next sub-issue to work on: the first (by number = creation order) that isn't done or already working. */
export function nextEpicChild(repo: string, parent: number): EpicChild | null {
  for (const c of listEpicChildren(repo, parent)) {
    if (childDone(c)) continue;
    const st = getIssueStatus(repo, c.child);
    if (st.state === "done" || st.state === "working") continue;
    return c;
  }
  return null;
}

/**
 * Epic ▶ Play: work ALL sub-issues in order. Sets the per-epic auto flag and starts the first
 * pending child; every later child starts automatically when the previous one MERGES (see
 * onChildMerged). Stop/park a child (or clear the flag) to pause the train.
 */
export async function playEpic(repo: string, parent: number, start: (repo: string, number: number) => Promise<void>): Promise<{ ok: boolean; msg: string; started?: number }> {
  const kids = listEpicChildren(repo, parent);
  if (!kids.length) return { ok: false, msg: "not an epic" };
  setSetting(`epic_auto.${repo}#${parent}`, "1");
  const next = nextEpicChild(repo, parent);
  if (!next) return { ok: true, msg: "all sub-issues are already done or in progress" };
  await start(repo, next.child);
  return { ok: true, msg: `started #${next.child}`, started: next.child };
}

/**
 * Called after a sub-issue's PR merges (from the dashboard /merge or auto-merge): flip the child to
 * done in every parent checklist, and — when the parent's Play flag is on — start the next child.
 * DB-only bookkeeping; the tracking comment refreshes on the next reconcile.
 */
export async function onChildMerged(repo: string, child: number, start?: (repo: string, number: number) => Promise<void>): Promise<void> {
  for (const parent of epicParentsOf(repo, child)) {
    updateEpicChild(repo, parent, child, "done", true);
    if (start && getSetting(`epic_auto.${repo}#${parent}`) === "1") {
      const next = nextEpicChild(repo, parent);
      if (next) {
        await commentOnIssue(repo, parent, `▶ Sub-issue #${child} merged — starting the next sub-issue #${next.child}.`).catch(() => {});
        await start(repo, next.child).catch((err) =>
          console.error(`[agency] epic auto-start failed ${repo} #${next.child}:`, (err as Error).message),
        );
      } else {
        setSetting(`epic_auto.${repo}#${parent}`, ""); // train finished — reviewEpics picks it up from here
      }
    }
  }
}
