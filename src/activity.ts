/**
 * In-process activity bus: agents emit their streamed thoughts + tool uses here as they
 * work. The dashboard reads recent activity (persisted in SQLite) and subscribes for a
 * live feed over SSE — so you can watch the agents think, like a chat.
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

// Which issue the running agent is working on (set by the pipeline before each role runs).
let context = { repo: "", number: 0 };
export function setActivityContext(repo: string, number: number): void {
  context = { repo, number };
}

// The single unit of work currently running (processing is serial → one at a time, or none).
export interface ActiveWork {
  repo: string;
  number: number;
  kind: "issue" | "pr";
  role: string;
  since: number;
}
let active: ActiveWork | null = null;
export function setActive(repo: string, number: number, kind: "issue" | "pr", role: string): void {
  active = { repo, number, kind, role, since: Date.now() };
}
export function updateActiveRole(role: string): void {
  if (active) active.role = role;
}
export function clearActive(): void {
  active = null;
}
export function getActive(): ActiveWork | null {
  return active;
}

const buffer: ActivityEvent[] = [];
const MAX = 200;
const subscribers = new Set<(e: ActivityEvent) => void>();

export function pushActivity(role: string, kind: ActivityEvent["kind"], text: string): void {
  if (kind === "start") updateActiveRole(role); // reflect the current role in "working now"
  const event: ActivityEvent = { ts: Date.now(), repo: context.repo, number: context.number, role, kind, text };
  buffer.push(event);
  if (buffer.length > MAX) buffer.shift();
  recordActivity(event.repo, event.number, role, kind, text);
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
