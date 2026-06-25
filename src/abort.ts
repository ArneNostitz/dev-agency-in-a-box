/**
 * Per-issue abort registry. Lets the dashboard "Stop" a running issue: every agent run for an
 * issue registers an AbortController here (passed to the Agent SDK `query`), so stopRuns() can
 * abort all in-flight role runs for that issue at once. A run releases its controller when it ends.
 */
const registry = new Map<string, Set<AbortController>>();

function keyOf(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/** Register a run for repo#number; pass `.controller` to the SDK and call `.release()` when done. */
export function registerRun(repo: string, number: number): { controller: AbortController; release: () => void } {
  const k = keyOf(repo, number);
  const controller = new AbortController();
  let set = registry.get(k);
  if (!set) {
    set = new Set();
    registry.set(k, set);
  }
  set.add(controller);
  return {
    controller,
    release() {
      const s = registry.get(k);
      if (s) {
        s.delete(controller);
        if (s.size === 0) registry.delete(k);
      }
    },
  };
}

/** Abort every in-flight run for repo#number. Returns how many were aborted. */
export function stopRuns(repo: string, number: number): number {
  const set = registry.get(keyOf(repo, number));
  if (!set) return 0;
  let n = 0;
  for (const c of set) {
    try {
      c.abort();
      n++;
    } catch {
      /* ignore */
    }
  }
  registry.delete(keyOf(repo, number));
  return n;
}

/** Is there at least one in-flight run for this issue? */
export function hasActiveRun(repo: string, number: number): boolean {
  return (registry.get(keyOf(repo, number))?.size ?? 0) > 0;
}

// ---- persistent per-issue STOP flag ----
// AbortController only kills the CURRENTLY in-flight SDK run; the next workflow/pipeline step would
// register a fresh (non-aborted) controller and "the next agent takes over". This flag is the
// authoritative "the user stopped this issue" signal that the workflow engine + pipeline check
// BETWEEN steps so nothing new starts. Cleared when a fresh run is explicitly started/resumed.
const stopRequested = new Set<string>();

/** Mark an issue as user-stopped (checked between steps). */
export function requestStop(repo: string, number: number): void { stopRequested.add(keyOf(repo, number)); }
/** Has the user pressed Stop on this issue since the last start/resume? */
export function isStopRequested(repo: string, number: number): boolean { return stopRequested.has(keyOf(repo, number)); }
/** Clear the stop flag — called when a fresh run is explicitly started/resumed. */
export function clearStop(repo: string, number: number): void { stopRequested.delete(keyOf(repo, number)); }

// ---- HOLD: pause-and-resume (distinct from STOP which cuts everything) ----
// A hold lets the user interrupt a RUNNING workflow from chat to steer it, WITHOUT discarding work:
// the current agent run finishes, then at the next step boundary the engine sees the hold, persists a
// `held` state, and stops advancing. The queued STEER (the user's chat message) is applied to the
// next step when the workflow resumes. Hold is cleared on an explicit resume/start.
const holdRequested = new Set<string>();
const steerQueue = new Map<string, string[]>();

/** Interrupt a running issue: it will pause at the next safe (step) boundary, not mid-run. */
export function requestHold(repo: string, number: number): void { holdRequested.add(keyOf(repo, number)); }
/** Should the engine pause at the next step boundary? */
export function isHoldRequested(repo: string, number: number): boolean { return holdRequested.has(keyOf(repo, number)); }
/** Clear the hold — called on resume/start so the workflow advances again. */
export function clearHold(repo: string, number: number): void { holdRequested.delete(keyOf(repo, number)); }

/** Queue a steer (a chat message) to fold into the next workflow step when it runs/resumes. */
export function queueSteer(repo: string, number: number, text: string): void {
  if (!text || !text.trim()) return;
  const k = keyOf(repo, number);
  const arr = steerQueue.get(k) ?? [];
  arr.push(text.trim());
  steerQueue.set(k, arr);
}
/** Peek the pending steers (without consuming) — for display/state. */
export function peekSteer(repo: string, number: number): string[] { return steerQueue.get(keyOf(repo, number))?.slice() ?? []; }
/** Take and CLEAR all pending steers — the engine folds them into the next step's task. */
export function takeSteer(repo: string, number: number): string[] {
  const k = keyOf(repo, number);
  const arr = steerQueue.get(k) ?? [];
  steerQueue.delete(k);
  return arr;
}
/** True if there's at least one queued steer for this issue. */
export function hasSteer(repo: string, number: number): boolean { return (steerQueue.get(keyOf(repo, number))?.length ?? 0) > 0; }
