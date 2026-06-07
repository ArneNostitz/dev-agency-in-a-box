/**
 * In-process activity bus: agents emit their streamed thoughts + tool uses here as they
 * work. The dashboard reads recent activity (persisted in SQLite) and subscribes for a live
 * feed over SSE. Everything is keyed by repo+issue so it's correct under parallel runs.
 */
import { recordActivity } from "./store.js";

export interface ActivityEvent {
  ts: number;
  repo: string;
  number: number;
  role: string;
  kind: "start" | "text" | "tool" | "done";
  text: string;
}

// Units of work currently running (concurrent → can be several at once).
export interface ActiveWork {
  repo: string;
  number: number;
  kind: "issue" | "pr";
  role: string;
  title: string;
  since: number;
}
const akey = (repo: string, number: number) => `${repo}#${number}`;
const active = new Map<string, ActiveWork>();
export function setActive(repo: string, number: number, kind: "issue" | "pr", role: string, title = ""): void {
  active.set(akey(repo, number), { repo, number, kind, role, title, since: Date.now() });
}
export function updateActiveRole(repo: string, number: number, role: string): void {
  const a = active.get(akey(repo, number));
  if (a) a.role = role;
}
export function clearActive(repo: string, number: number): void {
  active.delete(akey(repo, number));
}
export function getActive(): ActiveWork[] {
  return [...active.values()].sort((a, b) => a.since - b.since);
}

const buffer: ActivityEvent[] = [];
const MAX = 300;
const subscribers = new Set<(e: ActivityEvent) => void>();

export function pushActivity(
  repo: string,
  number: number,
  role: string,
  kind: ActivityEvent["kind"],
  text: string,
): void {
  if (kind === "start") updateActiveRole(repo, number, role);
  const event: ActivityEvent = { ts: Date.now(), repo, number, role, kind, text };
  buffer.push(event);
  if (buffer.length > MAX) buffer.shift();
  recordActivity(repo, number, role, kind, text);
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      /* ignore a bad subscriber */
    }
  }
}

export function subscribe(fn: (e: ActivityEvent) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
