/**
 * The orchestrator. A developer pin runs the full pipeline:
 *   Planner (Opus, asks questions if needed) -> Developer -> Tester -> Reviewer (1 revise)
 *   -> PR finalized.
 * The Planner can pause the work to ask the human clarifying questions (the issue is then
 * labelled agency:awaiting-answer); when the human replies, the pipeline resumes from the
 * Planner with the answers in hand.
 *
 * Specialist pins (@plan / @arch / @review / @test) run just that role.
 */
import type { Config } from "./config.js";
import type { Issue } from "./github.js";
import {
  addLabel,
  removeLabel,
  commentOnIssue,
  findPrForBranch,
  ensureBranchPushed,
  ensureDraftPr,
  createIssue,
  approvedByReaction,
  commentOnPr,
  upsertTrackerComment,
  AWAITING_LABEL,
  APPROVAL_LABEL,
} from "./github.js";
import { EPIC_LABEL, renderEpicTracker } from "./epics.js";
import { runRole } from "./agents/roleAgent.js";
import type { RoleName } from "./agents/roles.js";
import { recordRun, recordPlan, lastPlan, recordIssueState, recordPr, addEpicChild, listEpicChildren, getSession, issueActivity, recordReview, getReview } from "./store.js";
import { runReflection } from "./reflect.js";

const IN_PROGRESS = "agency:in-progress";
const READY = "agency:ready";
const NEEDS_ATTENTION = "agency:needs-attention";
const MAX_REVISE_ROUNDS = 1;

function issueHeader(issue: Issue): string {
  return `Issue #${issue.number}: ${issue.title}\n\n${issue.body || "(no description)"}`;
}

function changesRequested(reviewText: string): boolean {
  const firstLine = reviewText.split("\n").find((l) => l.trim().length > 0) ?? "";
  return /request\s+changes/i.test(firstLine);
}

/** Visible worker badge so each comment reads as the teammate that wrote it. */
const BADGE: Record<RoleName, string> = {
  planner: "🧠 **Planner**",
  developer: "💻 **Developer**",
  reviewer: "🔍 **Reviewer**",
  tester: "🧪 **Tester**",
  architect: "🏛 **Architect**",
  librarian: "📚 **Librarian**",
};
function say(role: RoleName, body: string): string {
  return `${BADGE[role]} · _dev-agency_\n\n${body}`;
}

export type PlannerDecision = { kind: "questions" | "plan"; body: string; auto: boolean };

/** Parse the planner's reply: first word signals intent (QUESTIONS / PLAN [AUTO]). */
export function parsePlannerDecision(text: string): PlannerDecision {
  const trimmed = text.trim();
  const m = /^\s*(QUESTIONS|PLAN)(\s+AUTO)?\b[:\-\s]*/i.exec(trimmed);
  if (m) {
    const kind = m[1].toLowerCase() === "questions" ? "questions" : "plan";
    return { kind, auto: Boolean(m[2]), body: trimmed.slice(m[0].length).trim() || trimmed };
  }
  return { kind: "plan", auto: false, body: trimmed };
}

/** Run the Planner once. Returns the decision and the model used (for the ledger). */
async function plan(repo: string, issue: Issue, workdir: string, thread: string): Promise<PlannerDecision> {
  const prior = lastPlan(repo, issue.number);
  const res = await runRole("planner", {
    workdir,
    repo,
    issueNumber: issue.number,
    // If a prior planner run was interrupted, resume its session (falls back to fresh on error).
    resumeSessionId: getSession(repo, issue.number, "planner") ?? undefined,
    task: [
      `Plan the work for this issue. Inspect the repository and project memory first.`,
      ``,
      issueHeader(issue),
      thread ? `\n### Conversation so far\n${thread}` : "",
      prior ? `\n### Your earlier plan (for reference)\n${prior}` : "",
      ``,
      `Reply starting with "QUESTIONS" (if you need clarification) or "PLAN" (if ready).`,
    ].join("\n"),
  });
  recordRun(repo, issue.number, "planner", res.model, res.turns, "plan", res.costUsd);
  return parsePlannerDecision(res.text);
}

/**
 * Deterministic finish (orchestrator, not the agent): commit any leftover work, push the
 * branch, and open the PR if missing. So a run that did the work but never reached `git push`
 * (looped / interrupted) still lands a PR instead of bouncing to needs-attention. Returns true
 * if a PR now exists.
 */
async function finalizeWithPr(repo: string, issue: Issue, workdir: string, branch: string, changesRequested = false): Promise<boolean> {
  const hasCommits = await ensureBranchPushed(workdir, branch);
  const pr = hasCommits ? await ensureDraftPr(repo, issue.number, branch, issue.title) : await findPrForBranch(repo, branch);
  await removeLabel(repo, issue.number, IN_PROGRESS);
  if (pr) {
    await addLabel(repo, issue.number, READY);
    recordIssueState(repo, issue.number, { state: READY });
    recordPr(repo, issue.number, pr.number, pr.url);
    const head = changesRequested
      ? `**⚠️ PR opened, but the reviewer still wants changes.** ${pr.url}\n\nPress **Fix** on the card to address them, or **Merge anyway** to ship as-is.`
      : `**✅ Work complete.** Opened ${pr.isDraft ? "draft " : ""}PR ${pr.url}`;
    await commentOnIssue(
      repo,
      issue.number,
      say("developer", [
        head,
        "",
        "Test it locally:",
        "```bash",
        `git fetch origin && git checkout ${branch}`,
        "```",
      ].join("\n")),
    );
    console.log(`[agency] ${repo} #${issue.number} -> ${READY}. PR: ${pr.url}`);
    return true;
  } else {
    await addLabel(repo, issue.number, NEEDS_ATTENTION);
    recordIssueState(repo, issue.number, { state: NEEDS_ATTENTION });
    await commentOnIssue(
      repo,
      issue.number,
      "⚠️ No code changes were produced (nothing to commit). It may need clarification or hit a blocker — comment guidance, then re-pin.",
    );
    console.log(`[agency] ${repo} #${issue.number} -> ${NEEDS_ATTENTION} (no commits).`);
    return false;
  }
}

/** Approval words that mean "go build it" — the whole comment must be (essentially) just this. */
const APPROVAL_RE =
  /^(ok|okay|k|go|go ahead|proceed|approve|approved|lgtm|yes|yep|do it|ship it|build it|👍|✅)[.! ]*$/i;

/** Did the human approve via a short "ok" comment? */
export function isApproval(thread: string): boolean {
  const blocks = thread.split("\n\n---\n\n");
  const last = (blocks[blocks.length - 1] ?? "").trimStart();
  if (!last.startsWith("[human]")) return false; // the agency spoke last, not the human
  return APPROVAL_RE.test(last.replace(/^\s*\[human\]\s*/, "").trim());
}

/** Approved either by a 👍 on the proposal comment or a short "ok" reply. */
async function approved(repo: string, issue: Issue, thread: string): Promise<boolean> {
  return isApproval(thread) || (await approvedByReaction(repo, issue.number));
}

/** Parse a `### SUB-ISSUES` section: lines like `- [Short title] @dev <one-line task>`. */
export function parseSubIssues(planText: string): Array<{ title: string; body: string }> {
  const idx = planText.search(/#{0,3}\s*SUB-?ISSUES/i);
  if (idx < 0) return [];
  const out: Array<{ title: string; body: string }> = [];
  for (const line of planText.slice(idx).split("\n")) {
    const m = /^\s*[-*]\s*\[(.+?)\]\s*(.+)$/.exec(line);
    if (m) out.push({ title: m[1].trim(), body: m[2].trim() });
  }
  return out;
}

/**
 * If the approved plan proposed a SUB-ISSUES breakdown, open each as its own @dev issue
 * (the agency then works them automatically) and mark the parent done. Returns true if it
 * handled the issue (so the caller skips building/accepting).
 */
async function maybeDecompose(repo: string, issue: Issue, planText: string): Promise<boolean> {
  const subs = parseSubIssues(planText);
  if (subs.length === 0) return false;

  for (const s of subs) {
    // Link each sub-issue back to the parent so the relationship is explicit in GitHub.
    const body = /@\w/.test(s.body) ? s.body : `@dev ${s.body}`;
    const created = await createIssue(repo, s.title, `${body}\n\nPart of epic #${issue.number}.`);
    addEpicChild(repo, issue.number, created.number, s.title);
    recordRun(repo, issue.number, "planner", MODELS_NONE, 0, "create-issue");
  }
  await commentOnIssue(
    repo,
    issue.number,
    say("planner", `**Created ${subs.length} sub-issue(s)** — tracking them below. This becomes an **epic**: it completes (and becomes reviewable/mergeable) when all sub-issues are done.`),
  );
  // Post the live checklist and keep the parent as an epic (not "ready" yet).
  await upsertTrackerComment(repo, issue.number, renderEpicTracker(listEpicChildren(repo, issue.number)));
  await removeLabel(repo, issue.number, IN_PROGRESS);
  await removeLabel(repo, issue.number, APPROVAL_LABEL);
  await addLabel(repo, issue.number, EPIC_LABEL);
  recordIssueState(repo, issue.number, { state: EPIC_LABEL });
  console.log(`[agency] ${repo} #${issue.number} -> epic of ${subs.length} sub-issues.`);
  return true;
}

const MODELS_NONE = "-";

async function pause(repo: string, issue: Issue, label: string): Promise<void> {
  await removeLabel(repo, issue.number, IN_PROGRESS);
  await addLabel(repo, issue.number, label);
  recordIssueState(repo, issue.number, { state: label });
}

/** Build phase: Developer implements -> Tester -> Reviewer (1 revise) -> PR. */
async function build(
  repo: string,
  issue: Issue,
  workdir: string,
  planText: string,
  thread: string,
  resume?: { digest: string },
): Promise<void> {
  const branch = `agency/issue-${issue.number}`;

  // Resuming an interrupted run: continue from the existing branch (don't redo committed work)
  // and try to resume the developer's exact prior session; fall back to fresh if that fails.
  // Note on finishing: a Tester runs the full checks next, and the ORCHESTRATOR commits/pushes
  // and opens the PR after you — so don't loop re-running the whole suite or worry about the PR.
  const finishRule =
    `IMPORTANT: commit and push after EACH logical chunk (\`git add <files> && git commit -m "…" && git push\`), ` +
    `not just at the end. A quick sanity check is fine, but do NOT repeatedly re-run the full test suite — the ` +
    `Tester does that next, and the orchestrator opens/updates the PR. When the change is made and committed, stop.`;
  const devTask = resume
    ? `RESUMING an interrupted run. First \`git fetch origin ${branch}\` and check it out if it exists; review ` +
      `what's already committed (\`git log --oneline main..HEAD\`, \`git diff\`). Finish ONLY what's incomplete ` +
      `per the plan — do NOT redo committed work. ${finishRule}\n\n` +
      `### Plan\n${planText}\n\n### What the interrupted run already did\n${resume.digest}\n\n### ${issueHeader(issue)}`
    : `Implement this issue on branch \`${branch}\` off an up-to-date main, following the plan and the harness. ` +
      `Reuse existing code; keep the change small; add/extend tests. ${finishRule}\n\n` +
      `### Approved plan\n${planText}\n\n### ${issueHeader(issue)}` +
      (thread ? `\n\n### Conversation (latest changes apply)\n${thread}` : "");

  const dev = await runRole("developer", {
    workdir,
    repo,
    issueNumber: issue.number,
    task: devTask,
    ...(resume ? { resumeSessionId: getSession(repo, issue.number, "developer") ?? undefined } : {}),
  });
  recordRun(repo, issue.number, "developer", dev.model, dev.turns, "implement", dev.costUsd);

  const test = await runRole("tester", {
    workdir,
    repo,
    issueNumber: issue.number,
    task:
      `You are in the repository on branch \`${branch}\`. Run the project's checks (install if needed, then ` +
      `typecheck, lint, test, build via \`npm run --if-present <script>\` or documented commands). ` +
      `Report each check's status and the first actionable errors if any failed.`,
  });
  recordRun(repo, issue.number, "tester", test.model, test.turns, "test", test.costUsd);
  await commentOnIssue(repo, issue.number, say("tester", `**Test results**\n\n${test.text}`));

  let lastReview = "";
  for (let round = 0; ; round++) {
    const review = await runRole("reviewer", {
      workdir,
      repo,
      issueNumber: issue.number,
      task:
        `Review the changes on branch \`${branch}\` for issue #${issue.number} against the harness. ` +
        `Inspect the diff vs main (e.g. \`git diff main...HEAD\`). ` +
        `Start your reply with exactly "APPROVE" or "REQUEST CHANGES" on the first line, then notes.\n\n` +
        `Test results were:\n${test.text}`,
    });
    recordRun(repo, issue.number, "reviewer", review.model, review.turns, "review", review.costUsd);
    lastReview = review.text;
    await commentOnIssue(repo, issue.number, say("reviewer", `**Review (round ${round + 1})**\n\n${review.text}`));

    if (!changesRequested(review.text) || round >= MAX_REVISE_ROUNDS) break;

    const revise = await runRole("developer", {
      workdir,
      repo,
      issueNumber: issue.number,
      task:
        `The reviewer requested changes on branch \`${branch}\`. Address each point, commit, and push. ` +
        `Keep the diff focused.\n\n### Review\n${review.text}`,
    });
    recordRun(repo, issue.number, "developer", revise.model, revise.turns, "revise", revise.costUsd);
  }

  // Record the FINAL verdict so the dashboard knows whether this PR still has requested changes
  // (after the one allowed auto-revise round). If so, the card flags it and offers a Fix button.
  const stillChanges = changesRequested(lastReview);
  recordReview(repo, issue.number, stillChanges ? "changes" : "approved", lastReview);

  const ok = await finalizeWithPr(repo, issue, workdir, branch, stillChanges);
  if (ok) {
    // Reflect (cheap, best-effort): what should the agency remember from this build?
    await runReflection(
      repo,
      issue.number,
      workdir,
      `Issue: ${issue.title}\n\nPlan (gist):\n${planText.slice(0, 1500)}\n\nTest results:\n${test.text.slice(0, 1500)}\n\nLast review:\n${lastReview.slice(0, 1500)}`,
    );
  }
}

/**
 * Full pipeline for a developer pin — a conversation, not a one-shot:
 *   1. Planner researches and proactively recommends an approach (or asks if truly blocked).
 *   2. Architect refines it into a concrete technical plan.
 *   3. The proposal is posted and the issue waits for your "ok" (agency:awaiting-approval).
 *   4. You reply "ok" -> build. Anything else -> treated as feedback, re-proposed.
 */
async function runDeveloperPipeline(
  repo: string,
  issue: Issue,
  workdir: string,
  thread: string,
): Promise<void> {
  // Resuming a proposal that the human approved (by 👍 or "ok")?
  if (issue.labels.includes(APPROVAL_LABEL) && (await approved(repo, issue, thread))) {
    const planText = lastPlan(repo, issue.number);
    if (planText) {
      await removeLabel(repo, issue.number, APPROVAL_LABEL);
      // If the plan was a decomposition, open the sub-issues instead of building this one.
      if (await maybeDecompose(repo, issue, planText)) return;
      await commentOnIssue(repo, issue.number, say("developer", "**Approved — building it now.**"));
      await build(repo, issue, workdir, planText, thread);
      return;
    }
  }
  // Otherwise (fresh, answered questions, or feedback on a proposal) -> propose.
  await removeLabel(repo, issue.number, APPROVAL_LABEL);

  // 1. Planner — research + recommend (only asks questions if genuinely blocked).
  const decision = await plan(repo, issue, workdir, thread);
  if (decision.kind === "questions") {
    await commentOnIssue(repo, issue.number, say("planner", `**A few questions before I plan**\n\n${decision.body}`));
    await pause(repo, issue, AWAITING_LABEL);
    console.log(`[agency] ${repo} #${issue.number} -> awaiting answer.`);
    return;
  }

  // Default: the planner said PLAN AUTO — build immediately, no approval gate, short note.
  if (decision.auto) {
    recordPlan(repo, issue.number, decision.body);
    await commentOnIssue(repo, issue.number, say("planner", `**Building now.**\n\n${decision.body}`));
    await build(repo, issue, workdir, decision.body, thread);
    return;
  }

  // 2. Architect — optional. By default the Opus planner already produces the technical plan,
  // so we skip a second agent that re-reads the whole repo (big token saving). Set
  // SKIP_ARCHITECT=false to bring back a separate Sonnet architect refinement.
  let proposal = decision.body;
  if (process.env.SKIP_ARCHITECT?.trim().toLowerCase() === "false") {
    const arch = await runRole("architect", {
      workdir,
      repo,
      issueNumber: issue.number,
      task:
        `Turn this recommended approach into a concrete technical plan for the repo. List the files to add/` +
        `change grouped by world (UI / logic / infrastructure), the existing pieces to reuse, and any key ` +
        `structural decisions. Keep it KISS. Do NOT write code.\n\n### Recommended approach\n${decision.body}` +
        `\n\n### ${issueHeader(issue)}`,
    });
    recordRun(repo, issue.number, "architect", arch.model, arch.turns, "design", arch.costUsd);
    proposal = `${decision.body}\n\n---\n\n### 🏛 Technical plan (Architect)\n\n${arch.text}`;
  }
  recordPlan(repo, issue.number, proposal);
  await commentOnIssue(
    repo,
    issue.number,
    say("planner", `**Larger change — quick sign-off?**\n\n${proposal}\n\n---\n\n👉 **👍** (or reply \`ok\`) to build. For changes, just say what to change.`),
  );
  await pause(repo, issue, APPROVAL_LABEL);
  console.log(`[agency] ${repo} #${issue.number} -> awaiting approval.`);
}

/** A single specialist pin. @plan/@arch produce a plan (planner can ask questions); @review/@test run that role. */
async function runSpecialist(
  repo: string,
  issue: Issue,
  role: RoleName,
  workdir: string,
  thread: string,
): Promise<void> {
  const branch = `agency/issue-${issue.number}`;

  if (role === "planner") {
    // Conversational: if you approved the last proposal (👍 or "ok"), decompose it (if it
    // proposed sub-issues) or accept it.
    if (issue.labels.includes(APPROVAL_LABEL) && (await approved(repo, issue, thread))) {
      await removeLabel(repo, issue.number, APPROVAL_LABEL);
      const planText = lastPlan(repo, issue.number) ?? "";
      if (await maybeDecompose(repo, issue, planText)) return;
      await removeLabel(repo, issue.number, IN_PROGRESS);
      await addLabel(repo, issue.number, READY);
      await commentOnIssue(repo, issue.number, say("planner", "**👍 Plan accepted.** Pin `@dev` to build it."));
      recordIssueState(repo, issue.number, { state: READY });
      return;
    }
    await removeLabel(repo, issue.number, APPROVAL_LABEL);

    const decision = await plan(repo, issue, workdir, thread);
    if (decision.kind === "questions") {
      await commentOnIssue(repo, issue.number, say("planner", `**A few questions**\n\n${decision.body}`));
      await removeLabel(repo, issue.number, IN_PROGRESS);
      await addLabel(repo, issue.number, AWAITING_LABEL);
      recordIssueState(repo, issue.number, { state: AWAITING_LABEL });
      return;
    }
    // Post the plan and keep the conversation open — reply to refine, or "ok" to accept.
    await removeLabel(repo, issue.number, AWAITING_LABEL);
    recordPlan(repo, issue.number, decision.body);
    await commentOnIssue(
      repo,
      issue.number,
      say("planner", `**Plan**\n\n${decision.body}\n\n---\n\n👉 **👍** (or reply \`ok\`) to accept. For changes, just reply with the change.`),
    );
    await removeLabel(repo, issue.number, IN_PROGRESS);
    await addLabel(repo, issue.number, APPROVAL_LABEL);
    recordIssueState(repo, issue.number, { state: APPROVAL_LABEL });
    return;
  }

  const tasks: Record<string, string> = {
    architect: `Produce a short technical plan for this issue (no code).\n\n${issueHeader(issue)}`,
    reviewer:
      `Review the latest changes for issue #${issue.number} (branch \`${branch}\` if it exists; otherwise ` +
      `the proposal). Inspect any diff vs main. Give specific, actionable feedback.\n\n${issueHeader(issue)}`,
    tester:
      `Run the project's checks (typecheck, lint, test, build) and report results. If branch \`${branch}\` ` +
      `exists, test that; otherwise the default branch.\n\n${issueHeader(issue)}`,
  };

  const out = await runRole(role, { workdir, repo, issueNumber: issue.number, task: tasks[role] });
  recordRun(repo, issue.number, role, out.model, out.turns, "specialist", out.costUsd);
  await commentOnIssue(repo, issue.number, say(role, out.text));
  await removeLabel(repo, issue.number, IN_PROGRESS);
  await addLabel(repo, issue.number, READY);
  recordIssueState(repo, issue.number, { state: READY });
  console.log(`[agency] ${repo} #${issue.number} -> ${READY} (${role}).`);
}

/**
 * Address review feedback left on an agency PR: the developer checks out the branch, makes
 * the requested change, pushes (updating the PR), and the tester re-checks.
 */
export async function runPrFix(
  repo: string,
  issueNumber: number,
  pr: number,
  branch: string,
  workdir: string,
  thread: string,
): Promise<void> {
  // If the reviewer recorded concrete change requests, hand them to the developer explicitly —
  // a vague "fix the requested things" comment alone makes weaker models bail with "nothing to do".
  const rev = getReview(repo, issueNumber);
  const reviewBlock =
    rev && rev.verdict === "changes"
      ? `\n\n### Reviewer's requested changes (you MUST address each one)\n${rev.summary}`
      : "";
  // Stream activity under the PR number — it must match setActive's key, otherwise the
  // dashboard's live card for this PR stays empty.
  const dev = await runRole("developer", {
    workdir,
    repo,
    issueNumber: pr,
    task:
      `Update the existing pull request. First run \`git fetch origin ${branch} && git checkout ${branch}\`. ` +
      `Then make the changes the human is asking for in the latest comment (and any reviewer-requested changes ` +
      `below), commit, and push (this updates PR #${pr}). Keep the diff focused. ` +
      `Actually implement the changes and commit — do NOT reply that there is nothing to do unless you have ` +
      `verified in the code that every requested point is already satisfied, and then explain why for each point.` +
      reviewBlock +
      `\n\n### PR conversation (latest comment is the request)\n${thread}`,
  });
  recordRun(repo, issueNumber, "developer", dev.model, dev.turns, "pr-fix", dev.costUsd);

  const test = await runRole("tester", {
    workdir,
    repo,
    issueNumber: pr,
    task: `On branch \`${branch}\`, run the project's checks and report briefly (pass/fail + first error only).`,
  });
  recordRun(repo, issueNumber, "tester", test.model, test.turns, "test", test.costUsd);
  await commentOnPr(repo, pr, say("developer", `**Pushed fixes.**\n\n${test.text}`));

  // Re-review so the verdict (and the card's ⚠ badge) reflects the new state of the PR.
  const review = await runRole("reviewer", {
    workdir,
    repo,
    issueNumber: pr,
    task:
      `Re-review branch \`${branch}\` after the latest changes. Inspect \`git diff main...HEAD\`. ` +
      `Start your reply with exactly "APPROVE" or "REQUEST CHANGES" on the first line, then notes.\n\nLatest tests:\n${test.text}`,
  });
  recordRun(repo, issueNumber, "reviewer", review.model, review.turns, "review", review.costUsd);
  await commentOnIssue(repo, issueNumber, say("reviewer", `**Review (after fix)**\n\n${review.text}`));
  recordReview(repo, issueNumber, changesRequested(review.text) ? "changes" : "approved", review.text);
}

export async function runPipeline(
  cfg: Config,
  repo: string,
  issue: Issue,
  role: RoleName,
  workdir: string,
  thread: string,
): Promise<void> {
  if (role === "developer") {
    await runDeveloperPipeline(repo, issue, workdir, thread);
  } else {
    await runSpecialist(repo, issue, role, workdir, thread);
  }
}

/**
 * A follow-up on a thread the agency already delivered: the human left a new comment after a
 * previous build (often after merging, when the issue/PR is closed). No planner gate — the
 * comment IS the instruction. The developer applies it on a fresh branch off the now-current
 * main and opens a new draft PR; tester + reviewer run as usual.
 */
/** A compact digest of an interrupted run's activity, to hand the resumed agent. */
export function resumeDigest(repo: string, number: number): string {
  const rows = issueActivity(repo, number, 50).filter((a) => a.kind === "text" || a.kind === "tool");
  if (rows.length === 0) return "(no recorded activity)";
  return rows
    .map((a) => `- [${a.role}] ${a.text.replace(/\s+/g, " ").slice(0, 160)}`)
    .join("\n")
    .slice(0, 4000);
}

/**
 * Resume an interrupted build WITHOUT redoing finished work: the plan already exists (skip the
 * Opus planner), so we go straight to the build — the developer continues from the branch's
 * committed work (and resumes its exact prior session if possible), then tester/reviewer/PR.
 */
export async function runResumeBuild(repo: string, issue: Issue, workdir: string, thread: string): Promise<void> {
  const planText = lastPlan(repo, issue.number) ?? "(plan unavailable — infer from the issue + branch)";
  await commentOnIssue(repo, issue.number, say("developer", "**Resuming** from where it stopped — continuing the existing branch, not redoing finished work."));
  await build(repo, issue, workdir, planText, thread, { digest: resumeDigest(repo, issue.number) });
}

/**
 * Address an open PR's outstanding review (and/or merge conflicts) on its existing branch, then
 * re-test, re-review and update the PR. This is the dashboard "Fix" button: the developer fixes
 * exactly what the reviewer flagged (no fresh plan, no redoing finished work), resolving conflicts
 * with main when asked. Re-records the verdict so the card clears its ⚠ flag once clean.
 */
export async function runReviewFix(repo: string, issue: Issue, workdir: string, opts?: { conflict?: boolean }): Promise<void> {
  const branch = `agency/issue-${issue.number}`;
  const review = getReview(repo, issue.number)?.summary || "(see the reviewer's latest comment on the issue)";
  const conflictRule = opts?.conflict
    ? `This branch CONFLICTS with main. First merge the latest main in and resolve all conflicts: ` +
      `\`git fetch origin main && git merge origin/main\` (or rebase), fix every conflict, build, then continue. `
    : "";
  await commentOnIssue(repo, issue.number, say("developer", `**On it — addressing the review${opts?.conflict ? " + resolving conflicts" : ""}.**`));

  const dev = await runRole("developer", {
    workdir,
    repo,
    issueNumber: issue.number,
    task:
      `Make sure you're on the PR branch: \`git checkout ${branch}\` (it's already checked out). ` +
      `Address the reviewer's requested changes. ${conflictRule}` +
      `Make the fixes, add/extend tests as needed, then commit and push to the SAME branch (do NOT open a new PR). ` +
      `Keep the diff focused on what was asked.\n\n### Reviewer's requested changes\n${review}\n\n### ${issueHeader(issue)}`,
    ...(getSession(repo, issue.number, "developer") ? { resumeSessionId: getSession(repo, issue.number, "developer") ?? undefined } : {}),
  });
  recordRun(repo, issue.number, "developer", dev.model, dev.turns, "revise", dev.costUsd);

  const test = await runRole("tester", {
    workdir,
    repo,
    issueNumber: issue.number,
    task: `On branch \`${branch}\`, run the project's checks (typecheck, lint, test, build) and report pass/fail + first error only.`,
  });
  recordRun(repo, issue.number, "tester", test.model, test.turns, "test", test.costUsd);
  await commentOnIssue(repo, issue.number, say("tester", `**Re-test after fixes**\n\n${test.text}`));

  const review2 = await runRole("reviewer", {
    workdir,
    repo,
    issueNumber: issue.number,
    task:
      `Re-review branch \`${branch}\` for issue #${issue.number} after the fixes. Inspect \`git diff main...HEAD\`. ` +
      `Start your reply with exactly "APPROVE" or "REQUEST CHANGES" on the first line, then notes.\n\nLatest tests:\n${test.text}`,
  });
  recordRun(repo, issue.number, "reviewer", review2.model, review2.turns, "review", review2.costUsd);
  await commentOnIssue(repo, issue.number, say("reviewer", `**Review (after fix)**\n\n${review2.text}`));

  const stillChanges = changesRequested(review2.text);
  recordReview(repo, issue.number, stillChanges ? "changes" : "approved", review2.text);
  await finalizeWithPr(repo, issue, workdir, branch, stillChanges);
}

export async function runFollowUp(
  repo: string,
  issue: Issue,
  workdir: string,
  thread: string,
): Promise<void> {
  await commentOnIssue(
    repo,
    issue.number,
    say("developer", "**On your note — preparing a fix.** Building on a fresh branch off the latest `main`."),
  );
  const planText =
    "FOLLOW-UP: a previous version of this issue was already delivered (and may have been merged). " +
    "Apply the human's latest comment(s) below as the change set. Branch off an up-to-date main so you " +
    "include any already-merged work. Keep the diff focused on what the comment asks for.";
  await build(repo, issue, workdir, planText, thread);
}
