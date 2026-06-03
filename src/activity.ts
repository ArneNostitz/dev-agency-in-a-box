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

const buffer: ActivityEvent[] = [];
const MAX = 200;
const subscribers = new Set<(e: ActivityEvent) => void>();

export function pushActivity(role: string, kind: ActivityEvent["kind"], text: string): void {
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
