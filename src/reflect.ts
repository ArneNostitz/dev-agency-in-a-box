/**
 * The self-evolving loop, in two stages:
 *
 *   1. REFLECT (after every finished build): a cheap librarian agent looks at what happened
 *      and distills 0–3 reusable lessons into SQLite. Recent lessons are injected into every
 *      agent's system prompt, so the agency immediately benefits.
 *
 *   2. IMPROVE (when enough lessons pile up): a librarian agent folds the accumulated lessons
 *      into the LEARNING part of the agents — the DB-backed "Learned (shared)" doc that's
 *      injected into every agent. This applies live (no redeploy) and every change is kept in
 *      the agent_revisions history (auditable + revertible). The self-improvement loop only
 *      ever touches the LEARNING part — the FIXED persona/playbooks/constitution are user-only.
 */
import type { Config } from "./config.js";
import { runRole } from "./agents/roleAgent.js";
import { readAgentFile, SHARED_LEARNED_PATH } from "./memory.js";
import {
  recordLesson,
  recordRun,
  unprocessedLessons,
  markLessonsProcessed,
  setAgentOverride,
  type LessonRow,
} from "./store.js";
import { setActive, clearActive } from "./activity.js";
import { dispatch } from "./pool.js";

/** Parse the librarian's reply: "LESSONS:\n- ..." or "NOTHING". Exported for tests. */
export function parseLessons(text: string): string[] {
  if (/^\s*NOTHING\b/i.test(text.trim())) return [];
  const idx = text.search(/LESSONS\s*:/i);
  if (idx < 0) return [];
  const out: string[] = [];
  for (const line of text.slice(idx).split("\n")) {
    const m = /^\s*[-*]\s+(.+)$/.exec(line);
    if (m && m[1].trim()) out.push(m[1].trim());
  }
  return out.slice(0, 3);
}

/**
 * Stage 1 — reflect on a finished build. Best-effort: never throws, never blocks the
 * pipeline outcome (the PR is already up when this runs).
 */
export async function runReflection(
  repo: string,
  issueNumber: number,
  workdir: string,
  context: string,
): Promise<void> {
  try {
    const res = await runRole("librarian", {
      workdir,
      repo,
      issueNumber,
      task:
        `A build for ${repo}#${issueNumber} just finished. Decide if anything is worth remembering ` +
        `for future runs (see your output format).\n\n### What happened\n${context.slice(0, 6000)}`,
    });
    recordRun(repo, issueNumber, "librarian", res.model, res.turns, "reflect", res.costUsd);
    const lessons = parseLessons(res.text);
    for (const l of lessons) recordLesson(repo, issueNumber, l);
    if (lessons.length) console.log(`[agency] librarian: ${lessons.length} lesson(s) from ${repo}#${issueNumber}`);
  } catch (err) {
    console.warn("[agency] reflection skipped:", (err as Error).message);
  }
}

const lessonsPrThreshold = (): number => {
  const v = Number(process.env.LESSONS_PR_THRESHOLD?.trim());
  return Number.isFinite(v) && v > 0 ? v : 8;
};

let improving = false;

/**
 * Stage 2 — when enough unprocessed lessons exist, open ONE draft PR against the agency's
 * own repo that folds them into the playbooks. Dispatched into the worker pool (deduped),
 * so it never blocks normal issue work.
 */
export function maybeSelfImprove(cfg: Config): void {
  if (!cfg.selfImprove) return;
  const lessons = unprocessedLessons();
  if (lessons.length < lessonsPrThreshold() || improving) return;
  dispatch(`self#improve`, () => selfImprove(cfg, lessons));
}

async function selfImprove(cfg: Config, lessons: LessonRow[]): Promise<void> {
  improving = true;
  const repo = cfg.agencyRepo;
  console.log(`[agency] self-improvement: folding ${lessons.length} lessons into the Learned doc`);
  setActive(repo, 0, "issue", "librarian", `self-improvement (${lessons.length} lessons)`);
  try {
    const current = (await readAgentFile(SHARED_LEARNED_PATH)) || "";
    const list = lessons.map((l) => `- (${l.repo}#${l.number}) ${l.lesson}`).join("\n");
    const res = await runRole("librarian", {
      workdir: process.cwd(),
      repo,
      issueNumber: 0,
      task:
        `Maintain our LEARNED playbook — durable, reusable, cross-project guidance distilled from real runs, ` +
        `injected into every agent. Fold the new lessons into the current doc: merge related points, dedupe, ` +
        `organise by theme, and DROP anything noisy, one-off, or already covered by our fixed playbooks. ` +
        `Keep it tight.\n\n### Current LEARNED playbook\n${current || "(empty)"}\n\n### New lessons\n${list}\n\n` +
        `Output ONLY the complete updated LEARNED playbook as markdown — no preamble, no commentary.`,
    });
    const content = res.text.trim();
    recordRun(repo, 0, "librarian", res.model, res.turns, "self-improve", res.costUsd);
    if (content) {
      // Live + versioned: applies on the next agent run, history kept in agent_revisions.
      setAgentOverride(SHARED_LEARNED_PATH, content, "self-improve", `folded ${lessons.length} lessons`);
      markLessonsProcessed(lessons.map((l) => l.id));
      console.log(`[agency] self-improvement: Learned doc updated (+${lessons.length} lessons, live)`);
    } else {
      console.warn("[agency] self-improvement produced no content — lessons stay queued.");
    }
  } catch (err) {
    console.error("[agency] self-improvement failed:", (err as Error).message);
  } finally {
    clearActive(repo, 0);
    improving = false;
  }
}
