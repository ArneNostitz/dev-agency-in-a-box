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
  createIssue,
  approvedByReaction,
  AWAITING_LABEL,
  APPROVAL_LABEL,
} from "./github.js";
import { runRole } from "./agents/roleAgent.js";
import type { RoleName } from "./agents/roles.js";
import { recordRun, recordPlan, lastPlan, recordIssueState } from "./store.js";
import { setActivityContext } from "./activity.js";

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
  recordRun(repo, issue.number, "planner", res.model, res.turns, "plan");
  return parsePlannerDecision(res.text);
}

async function finalizeWithPr(repo: string, issue: Issue, branch: string): Promise<void> {
  const pr = await findPrForBranch(repo, branch);
  await removeLabel(repo, issue.number, IN_PROGRESS);
  if (pr) {
    await addLabel(repo, issue.number, READY);
    recordIssueState(repo, issue.number, { state: READY });
    await commentOnIssue(
      repo,
      issue.number,
      say("developer", [
        `**✅ Work complete.** Opened ${pr.isDraft ? "draft " : ""}PR ${pr.url}`,
        "",
        "Test it locally:",
        "```bash",
        `git fetch origin && git checkout ${branch}`,
        "```",
      ].join("\n")),
    );
    console.log(`[agency] ${repo} #${issue.number} -> ${READY}. PR: ${pr.url}`);
  } else {
    await addLabel(repo, issue.number, NEEDS_ATTENTION);
    recordIssueState(repo, issue.number, { state: NEEDS_ATTENTION });
    await commentOnIssue(
      repo,
      issue.number,
      "⚠️ Finished without opening a pull request — it may need clarification or hit a blocker. Re-pin to retry.",
    );
    console.log(`[agency] ${repo} #${issue.number} -> ${NEEDS_ATTENTION} (no PR).`);
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

  const links: string[] = [];
  for (const s of subs) {
    const body = /@\w/.test(s.body) ? s.body : `@dev ${s.body}`;
    const created = await createIssue(repo, s.title, `${body}\n\n_(split from #${issue.number})_`);
    links.push(`- #${created.number} — ${s.title}`);
    recordRun(repo, issue.number, "planner", MODELS_NONE, 0, "create-issue");
  }
  await commentOnIssue(
    repo,
    issue.number,
    say("planner", `**Created ${subs.length} sub-issue(s)** — the agency will work them:\n${links.join("\n")}`),
  );
  await removeLabel(repo, issue.number, IN_PROGRESS);
  await removeLabel(repo, issue.number, APPROVAL_LABEL);
  await addLabel(repo, issue.number, READY);
  recordIssueState(repo, issue.number, { state: READY });
  console.log(`[agency] ${repo} #${issue.number} -> decomposed into ${subs.length} issues.`);
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
): Promise<void> {
  const branch = `agency/issue-${issue.number}`;

  const dev = await runRole("developer", {
    workdir,
    task:
      `Implement this issue on a new branch \`${branch}\` off an up-to-date main, following the approved plan ` +
      `and the harness. Reuse existing code; keep the change small. Add/extend tests. Commit, push, and ` +
      `open a DRAFT pull request whose body contains "Closes #${issue.number}".\n\n` +
      `### Approved plan\n${planText}\n\n### ${issueHeader(issue)}` +
      (thread ? `\n\n### Conversation (latest changes apply)\n${thread}` : ""),
  });
  recordRun(repo, issue.number, "developer", dev.model, dev.turns, "implement");

  const test = await runRole("tester", {
    workdir,
    task:
      `You are in the repository on branch \`${branch}\`. Run the project's checks (install if needed, then ` +
      `typecheck, lint, test, build via \`npm run --if-present <script>\` or documented commands). ` +
      `Report each check's status and the first actionable errors if any failed.`,
  });
  recordRun(repo, issue.number, "tester", test.model, test.turns, "test");
  await commentOnIssue(repo, issue.number, say("tester", `**Test results**\n\n${test.text}`));

  for (let round = 0; ; round++) {
    const review = await runRole("reviewer", {
      workdir,
      task:
        `Review the changes on branch \`${branch}\` for issue #${issue.number} against the harness. ` +
        `Inspect the diff vs main (e.g. \`git diff main...HEAD\`). ` +
        `Start your reply with exactly "APPROVE" or "REQUEST CHANGES" on the first line, then notes.\n\n` +
        `Test results were:\n${test.text}`,
    });
    recordRun(repo, issue.number, "reviewer", review.model, review.turns, "review");
    await commentOnIssue(repo, issue.number, say("reviewer", `**Review (round ${round + 1})**\n\n${review.text}`));

    if (!changesRequested(review.text) || round >= MAX_REVISE_ROUNDS) break;

    const revise = await runRole("developer", {
      workdir,
      task:
        `The reviewer requested changes on branch \`${branch}\`. Address each point, commit, and push. ` +
        `Keep the diff focused.\n\n### Review\n${review.text}`,
    });
    recordRun(repo, issue.number, "developer", revise.model, revise.turns, "revise");
  }

  await finalizeWithPr(repo, issue, branch);
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

  // Small/obvious task -> the planner said PLAN AUTO: build immediately, no approval gate.
  if (decision.auto) {
    recordPlan(repo, issue.number, decision.body);
    await commentOnIssue(repo, issue.number, say("planner", `**Plan (auto — small task, building now)**\n\n${decision.body}`));
    await build(repo, issue, workdir, decision.body, thread);
    return;
  }

  // 2. Architect — turn the recommendation into a concrete technical plan.
  const arch = await runRole("architect", {
    workdir,
    task:
      `Turn this recommended approach into a concrete technical plan for the repo. List the files to add/` +
      `change grouped by world (UI / logic / infrastructure), the existing pieces to reuse, and any key ` +
      `structural decisions. Keep it KISS. Do NOT write code.\n\n### Recommended approach\n${decision.body}` +
      `\n\n### ${issueHeader(issue)}`,
  });
  recordRun(repo, issue.number, "architect", arch.model, arch.turns, "design");

  const proposal = `${decision.body}\n\n---\n\n### 🏛 Technical plan (Architect)\n\n${arch.text}`;
  recordPlan(repo, issue.number, proposal);
  await commentOnIssue(
    repo,
    issue.number,
    say("planner", `**Proposed approach**\n\n${proposal}\n\n---\n\n👉 **👍 this comment** (or reply \`ok\`) to build it. For changes, just reply with the change — no need to restate the plan.`),
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

  const out = await runRole(role, { workdir, task: tasks[role] });
  recordRun(repo, issue.number, role, out.model, out.turns, "specialist");
  await commentOnIssue(repo, issue.number, say(role, out.text));
  await removeLabel(repo, issue.number, IN_PROGRESS);
  await addLabel(repo, issue.number, READY);
  recordIssueState(repo, issue.number, { state: READY });
  console.log(`[agency] ${repo} #${issue.number} -> ${READY} (${role}).`);
}

export async function runPipeline(
  cfg: Config,
  repo: string,
  issue: Issue,
  role: RoleName,
  workdir: string,
  thread: string,
): Promise<void> {
  setActivityContext(repo, issue.number);
  if (role === "developer") {
    await runDeveloperPipeline(repo, issue, workdir, thread);
  } else {
    await runSpecialist(repo, issue, role, workdir, thread);
  }
}
