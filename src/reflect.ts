/**
 * The self-evolving loop, in two stages:
 *
 *   1. REFLECT (after every finished build): a cheap librarian agent looks at what happened
 *      and distills 0–3 reusable lessons into SQLite. Recent lessons are injected into every
 *      agent's system prompt, so the agency immediately benefits.
 *
 *   2. IMPROVE (when enough lessons pile up): a developer agent folds the accumulated
 *      lessons into the playbooks/personas of the agency's OWN repo and opens a draft PR.
 *      The human reviews/merges -> Coolify redeploys -> the agency is permanently smarter.
 *      Rule changes always go through a PR — the agency never edits its own rules silently.
 */
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import { runRole } from "./agents/roleAgent.js";
import { cloneRepo, findPrForBranch } from "./github.js";
import { recordLesson, recordRun, unprocessedLessons, markLessonsProcessed, type LessonRow } from "./store.js";
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
  const branch = `agency/self-improve-${new Date().toISOString().slice(0, 10)}`;
  const workdir = join(process.cwd(), ".work", "self", "improve");
  console.log(`[agency] self-improvement: folding ${lessons.length} lessons into ${repo}`);
  try {
    await rm(workdir, { recursive: true, force: true });
    await mkdir(join(workdir, ".."), { recursive: true });
    await cloneRepo(repo, workdir);

    setActive(repo, 0, "pr", "developer", `self-improvement (${lessons.length} lessons)`);
    const list = lessons.map((l) => `- (${l.repo}#${l.number}) ${l.lesson}`).join("\n");
    const res = await runRole("developer", {
      workdir,
      repo,
      issueNumber: 0,
      task:
        `Self-improvement task on the agency's own repo. The lessons below were distilled from real runs. ` +
        `Fold the ones with lasting value into the markdown under \`memory/central/\` (playbooks/, agents/, ` +
        `CONSTITUTION.md) — edit existing sections rather than adding new files; keep each edit minimal and in ` +
        `the existing voice; drop redundant or one-off lessons. Touch ONLY markdown under memory/. ` +
        `Then: create branch \`${branch}\`, commit, push, and open a DRAFT PR titled ` +
        `"self-improvement: fold ${lessons.length} lessons into the playbooks" whose body lists which lessons ` +
        `you applied and which you dropped (with one-line reasons).\n\n### Lessons\n${list}`,
    });
    recordRun(repo, 0, "developer", res.model, res.turns, "self-improve", res.costUsd);

    const pr = await findPrForBranch(repo, branch);
    if (pr) {
      markLessonsProcessed(lessons.map((l) => l.id));
      console.log(`[agency] self-improvement PR: ${pr.url}`);
    } else {
      console.warn("[agency] self-improvement run finished without a PR — lessons stay queued.");
    }
  } catch (err) {
    console.error("[agency] self-improvement failed:", (err as Error).message);
  } finally {
    clearActive(repo, 0);
    improving = false;
  }
}
