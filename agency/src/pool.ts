/**
 * Bounded worker pool so the agency can work several issues/PRs at once instead of serially.
 * `dispatch(key, fn)` runs fn unless a unit with the same key is already in flight (so the
 * same issue/PR is never worked twice concurrently). Concurrency is capped by
 * AGENCY_CONCURRENCY (default 3) to keep cost and rate-limits sane.
 */
import { sNum } from "./settings.js";

/** Concurrency cap, DB-first (dashboard) → AGENCY_CONCURRENCY env → 3. Read live each pump. */
function cap(): number {
  return Math.max(1, sNum("concurrency", "AGENCY_CONCURRENCY", 3));
}

let running = 0;
let stopped = false;
const queue: Array<() => Promise<void>> = [];
const inFlight = new Set<string>();
const drainWaiters: Array<() => void> = [];

/** Stop accepting new work (used for graceful shutdown — let in-flight runs finish). */
export function stop(): void {
  stopped = true;
}

function pump(): void {
  while (running < cap() && queue.length > 0) {
    const task = queue.shift()!;
    running++;
    task()
      .catch(() => {})
      .finally(() => {
        running--;
        pump();
        if (running === 0 && queue.length === 0) {
          for (const w of drainWaiters.splice(0)) w();
        }
      });
  }
}

/** Queue fn under `key`; ignored if that key is already running/queued (or shutting down). */
export function dispatch(key: string, fn: () => Promise<void>): void {
  if (stopped || inFlight.has(key)) return;
  inFlight.add(key);
  queue.push(async () => {
    try {
      await fn();
    } finally {
      inFlight.delete(key);
    }
  });
  pump();
}

export function maxConcurrency(): number {
  return cap();
}
/** Keys currently dispatched (running OR waiting for a slot) — for the "queued" UI. */
export function inFlightKeys(): string[] {
  return [...inFlight];
}
export function poolStatus(): { running: number; queued: number; max: number } {
  return { running, queued: queue.length, max: cap() };
}

/** Resolves when the pool is fully drained (used by once-mode). */
export function drain(): Promise<void> {
  if (running === 0 && queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => drainWaiters.push(resolve));
}
