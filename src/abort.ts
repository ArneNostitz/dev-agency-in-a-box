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
