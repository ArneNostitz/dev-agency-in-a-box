/**
 * The orchestrator. Given a pinned issue and the role it pinned, run the right
 * sequence of specialists and finalize the issue. The default (a developer pin)
 * runs the full pipeline: Architect plans -> Developer implements -> Tester checks
 * -> Reviewer reviews (with one bounded revise loop) -> PR finalized.
 *
 * Specialist-only pins (@arch / @review / @test) run just that role.
 */
import type { Config } from "./config.js";
import type { Issue } from "./github.js";
import { addLabel, removeLabel, commentOnIssue, findPrForBranch } from "./github.js";
import { runRole } from "./agents/roleAgent.js";
import type { RoleName } from "./agents/roles.js";

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

async function finalizeWithPr(repo: string, issue: Issue, branch: string): Promise<void> {
  const pr = await findPrForBranch(repo, branch);
  await removeLabel(repo, issue.number, IN_PROGRESS);
  if (pr) {
    await addLabel(repo, issue.number, READY);
    await commentOnIssue(
      repo,
      issue.number,
      [
        `✅ Work complete. Opened ${pr.isDraft ? "draft " : ""}PR ${pr.url}`,
        "",
        "Test it locally:",
        "```bash",
        `git fetch origin && git checkout ${branch}`,
        "```",
      ].join("\n"),
    );
    console.log(`[agency] ${repo} #${issue.number} -> ${READY}. PR: ${pr.url}`);
  } else {
    await addLabel(repo, issue.number, NEEDS_ATTENTION);
    await commentOnIssue(
      repo,
      issue.number,
      "⚠️ Finished without opening a pull request — it may need clarification or hit a blocker. Re-pin to retry.",
    );
    console.log(`[agency] ${repo} #${issue.number} -> ${NEEDS_ATTENTION} (no PR).`);
  }
}

/** Full pipeline for a developer pin. */
async function runDeveloperPipeline(cfg: Config, repo: string, issue: Issue, workdir: string): Promise<void> {
  const branch = `agency/issue-${issue.number}`;

  // 1. Architect — plan (no code).
  const plan = await runRole("architect", {
    workdir,
    task:
      `Produce a short technical plan for this issue. Do NOT write code.\n\n${issueHeader(issue)}\n\n` +
      `Output: Approach, Reuse (what already exists to use), Changes (files by world: UI/logic/infra), Checklist.`,
  });
  await commentOnIssue(repo, issue.number, `## 🏛 Architect plan\n\n${plan.text}`);

  // 2. Developer — implement on a branch and open a draft PR.
  await runRole("developer", {
    workdir,
    task:
      `Implement this issue on a new branch \`${branch}\` off an up-to-date main, following the plan ` +
      `and the harness. Reuse existing code; keep the change small. Add/extend tests. Commit, push, and ` +
      `open a DRAFT pull request whose body contains "Closes #${issue.number}".\n\n` +
      `### Plan\n${plan.text}\n\n### ${issueHeader(issue)}`,
  });

  // 3. Tester — run the project's checks in the working copy.
  const test = await runRole("tester", {
    workdir,
    task:
      `You are in the repository on branch \`${branch}\`. Run the project's checks (install if needed, then ` +
      `typecheck, lint, test, build via \`npm run --if-present <script>\` or the project's documented commands). ` +
      `Report each check's status and the first actionable errors if any failed.`,
  });
  await commentOnIssue(repo, issue.number, `## 🧪 Test results\n\n${test.text}`);

  // 4. Reviewer — review the diff; optionally one revise loop.
  for (let round = 0; ; round++) {
    const review = await runRole("reviewer", {
      workdir,
      task:
        `Review the changes on branch \`${branch}\` for issue #${issue.number} against the harness. ` +
        `Inspect the diff vs main (e.g. \`git diff main...HEAD\`). ` +
        `Start your reply with exactly "APPROVE" or "REQUEST CHANGES" on the first line, then your notes.\n\n` +
        `For context, the test results were:\n${test.text}`,
    });
    await commentOnIssue(repo, issue.number, `## 🔍 Review (round ${round + 1})\n\n${review.text}`);

    if (!changesRequested(review.text) || round >= MAX_REVISE_ROUNDS) break;

    await runRole("developer", {
      workdir,
      task:
        `The reviewer requested changes on branch \`${branch}\`. Address each point, commit, and push. ` +
        `Keep the diff focused.\n\n### Review\n${review.text}`,
    });
  }

  await finalizeWithPr(repo, issue, branch);
}

/** A single specialist pin (@arch / @review / @test): run that role, post its output, mark ready. */
async function runSpecialist(repo: string, issue: Issue, role: RoleName, workdir: string): Promise<void> {
  const branch = `agency/issue-${issue.number}`;
  const labels: Record<RoleName, string> = {
    architect: "🏛 Architect plan",
    reviewer: "🔍 Review",
    tester: "🧪 Test results",
    developer: "Developer",
  };
  const tasks: Record<RoleName, string> = {
    architect: `Produce a short technical plan for this issue (no code).\n\n${issueHeader(issue)}`,
    reviewer:
      `Review the latest changes for issue #${issue.number} (branch \`${branch}\` if it exists; otherwise ` +
      `review the issue's proposal). Inspect any diff vs main. Give specific, actionable feedback.\n\n${issueHeader(issue)}`,
    tester:
      `Run the project's checks (typecheck, lint, test, build) and report results. If a branch \`${branch}\` ` +
      `exists, test that; otherwise test the default branch.\n\n${issueHeader(issue)}`,
    developer: issueHeader(issue),
  };

  const out = await runRole(role, { workdir, task: tasks[role] });
  await commentOnIssue(repo, issue.number, `## ${labels[role]}\n\n${out.text}`);
  await removeLabel(repo, issue.number, IN_PROGRESS);
  await addLabel(repo, issue.number, READY);
  console.log(`[agency] ${repo} #${issue.number} -> ${READY} (${role}).`);
}

export async function runPipeline(
  cfg: Config,
  repo: string,
  issue: Issue,
  role: RoleName,
  workdir: string,
): Promise<void> {
  if (role === "developer") {
    await runDeveloperPipeline(cfg, repo, issue, workdir);
  } else {
    await runSpecialist(repo, issue, role, workdir);
  }
}
