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
  mergeBaseInto,
  mergeProbe,
  localHeadSha,
  workdirDirty,
  AWAITING_LABEL,
  APPROVAL_LABEL,
} from "./github.js";
import { EPIC_LABEL, renderEpicTracker } from "./epics.js";
import { runRole } from "./agents/roleAgent.js";
import { isStopRequested } from "./abort.js";
// True if the user has stopped this issue — every phase checks this before doing ANY work so Stop
// means "no next agent, no next step, no commit/PR". (runRole has its own guard for the agent run.)
function stopped(repo: string, number: number, where: string): boolean {
  if (isStopRequested(repo, number)) { console.log(`[agency] ${where} skipped — Stop requested ${repo} #${number}`); return true; }
  return false;
}
import type { RoleName } from "./agents/roles.js";
import { recordRun, recordPlan, lastPlan, recordIssueState, recordIssueStatus, recordIssueFiles, recordPr, setByAgent, addEpicChild, listEpicChildren, getSession, issueActivity, recordReview, getReview, recordConflict, clearConflict, getSetting, skillsPrompt, listHooks, listAgentDefs, changesTouchingFiles, type Workflow } from "./store.js";
import { conflictFiles } from "./github.js";
import { pushActivity, setActive } from "./activity.js";
import { execSync } from "node:child_process";
import { runReflection } from "./reflect.js";
import { runChecks, baselineFailures, parseDiscoveredChecks, rememberChecks } from "./checks.js";
import { decideNext } from "./orchestrator.js";
import { LABEL_IN_PROGRESS as IN_PROGRESS, LABEL_READY as READY, LABEL_NEEDS_ATTENTION as NEEDS_ATTENTION, withStatus, setBlocked, parseLegacyStatus } from "./state.js";

/**
 * Run the project's checks the cheap way: deterministic command runner first (zero tokens), and only
 * fall back to the cheap LLM tester when the stack is unknown / its toolchain isn't available here.
 * The LLM is asked to emit a `CHECKS_JSON:` block describing the commands it ran, which we cache so
 * the SAME repo is token-free next time — the tester self-adjusts to any language once.
 */
async function runTests(
  repo: string,
  issueNumber: number,
  workdir: string,
  branch: string,
): Promise<{ text: string; pass: boolean }> {
  const checks = await runChecks(workdir, repo);
  if (checks.ran) {
    recordRun(repo, issueNumber, "tester", "code", 0, "test", 0); // deterministic, token-free
    // The sandbox couldn't actually run the checks (deps wouldn't install, pytest collection error,
    // missing tool). That's NOT a code defect — don't gate on it or the developer chases ghosts.
    if (checks.envBlocked) {
      return {
        text: `⚙️ **Couldn't run the checks in the sandbox** — \`${checks.blockReason}\`.\n\nThis is an environment/dependency issue, not a code failure, so the change isn't blocked on it. Run the suite locally to confirm.`,
        pass: true,
      };
    }
    if (checks.pass) return { text: checks.summary, pass: true };
    // Some checks failed. Were they ALREADY red on main (pre-existing), or did THIS change break them?
    // Only newly-introduced failures gate the PR; pre-existing ones are reported, not fixed in a loop.
    const failing = checks.results.filter((r) => !r.ok);
    const preexisting = await baselineFailures(workdir, branch, failing);
    const introduced = failing.filter((r) => !preexisting.has(r.name));
    const note = preexisting.size
      ? `\n\n> ℹ️ ${preexisting.size} check(s) (${[...preexisting].join(", ")}) were **already failing on \`main\`** before this change — pre-existing, not gated. ${introduced.length ? "" : "Proceeding to review."}`
      : "";
    return { text: checks.summary + note, pass: introduced.length === 0 };
  }
  // Unknown stack or toolchain missing → let the cheap tester discover the commands, then cache them.
  const t = await runRole("tester", {
    workdir,
    repo,
    issueNumber,
    task:
      `You are in the repository on branch \`${branch}\`. Detect the project's stack and run its checks ` +
      `(install deps if needed, then typecheck/lint/test/build using the documented or conventional commands ` +
      `for THIS language — Node/TS, Python, Swift/SPM, Go, Rust, etc.). Report each check's status and the ` +
      `first actionable error if any failed. If a required toolchain isn't installed here, say so clearly ` +
      `(it may need to run on the user's machine).\n\n` +
      `IMPORTANT: end your reply with a single machine-readable line so the system can run these checks ` +
      `without an LLM next time:\nCHECKS_JSON: {"requires":"<binary or omit>","install":"<install cmd or omit>",` +
      `"checks":[{"name":"test","cmd":"<exact command>"}]}`,
  });
  recordRun(repo, issueNumber, "tester", t.model, t.turns, "test", t.costUsd);
  const discovered = parseDiscoveredChecks(t.text);
  if (discovered) rememberChecks(repo, discovered);
  // Strip the machine line from what humans read.
  const text = t.text.replace(/CHECKS_JSON:\s*\{[\s\S]*$/m, "").trim();
  return { text, pass: !/❌|\bFAIL\b|\bfailed\b/i.test(text) };
}
// Dashboard-tunable (setting wins over env wins over default), so no redeploy to change behaviour.
function maxReviseRounds(): number {
  const s = Number(getSetting("max_revise_rounds"));
  if (Number.isFinite(s) && s >= 0) return s;
  const e = Number(process.env.MAX_REVISE_ROUNDS?.trim());
  return Number.isFinite(e) && e >= 0 ? e : 1;
}
function skipArchitect(): boolean {
  const s = getSetting("skip_architect");
  if (s === "on") return true;
  if (s === "off") return false;
  return process.env.SKIP_ARCHITECT?.trim().toLowerCase() !== "false"; // default: skip
}

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
  decomposer: "🪓 **Decomposer**",
  developer: "💻 **Developer**",
  reviewer: "🔍 **Reviewer**",
  tester: "🧪 **Tester**",
  architect: "🏛 **Architect**",
  librarian: "📚 **Librarian**",
  auditor: "🔎 **Auditor**",
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
    return { kind, auto: Boolean(m[2]), body: trimmed.slice(m[0].length).trim() };
  }
  return { kind: "plan", auto: false, body: trimmed };
}

/** Run the Planner once. Returns the decision and the model used (for the ledger). */
async function plan(repo: string, issue: Issue, workdir: string, thread: string): Promise<PlannerDecision> {
  if (stopped(repo, issue.number, "plan")) return { kind: "questions", body: "", auto: false };
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
      `When you PLAN, declare the file footprint on its own line: \`FILES: path/one.ts, path/two.ts\` —`,
      `the exact files this work will create or modify. If you break it into SUB-ISSUES, append a`,
      `\`{files: ...}\` annotation to EACH sub-issue line with the files THAT sub-issue touches. The agency`,
      `uses this to run non-overlapping work in parallel and never let two agents edit the same file at once.`,
    ].join("\n"),
  });
  recordRun(repo, issue.number, "planner", res.model, res.turns, "plan", res.costUsd);
  const decision = parsePlannerDecision(res.text);
  if (decision.kind === "plan") {
    const files = parseFileList(decision.body);
    if (files.length) recordIssueFiles(repo, issue.number, files); // footprint → file-lock scheduling
  }
  return decision;
}

/**
 * Deterministic finish (orchestrator, not the agent): commit any leftover work, push the
 * branch, and open the PR if missing. So a run that did the work but never reached `git push`
 * (looped / interrupted) still lands a PR instead of bouncing to needs-attention. Returns true
 * if a PR now exists.
 */
async function finalizeWithPr(repo: string, issue: Issue, workdir: string, branch: string, changesRequested = false): Promise<boolean> {
  if (stopped(repo, issue.number, "finalizeWithPr")) return false;
  const hasCommits = await ensureBranchPushed(workdir, branch);
  const pr = hasCommits ? await ensureDraftPr(repo, issue.number, branch, issue.title) : await findPrForBranch(repo, branch);
  await removeLabel(repo, issue.number, IN_PROGRESS);
  if (pr) {
    await addLabel(repo, issue.number, READY);
    recordIssueStatus(repo, issue.number, withStatus("review"));
    recordPr(repo, issue.number, pr.number, pr.url);
    // Reconcile the conflict box against reality — a normal finalize (not just the conflict-only Fix
    // path) can make a branch mergeable, and a stale "resolve first" must not stick on the card/PR bar.
    const cf = await mergeProbe(repo, branch, "main");
    if (cf.ok) { if (cf.files.length) recordConflict(repo, issue.number, "", cf.files); else clearConflict(repo, issue.number); }
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
    recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "needsAttention"));
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
  if (stopped(repo, issue.number, "approved")) return false;
  return isApproval(thread) || (await approvedByReaction(repo, issue.number));
}

/** Pull a declared file list out of agent text: `FILES: a, b` or a `{files: a, b}` annotation. */
export function parseFileList(s: string): string[] {
  const m = /\{?\s*files?\s*:\s*([^}\n]+)\}?/i.exec(s || "");
  if (!m) return [];
  return [...new Set(
    m[1].split(/[,\s]+/).map((f) => f.trim().replace(/[`'"().]+$/g, "").replace(/^[`'"]+/g, "")).filter((f) => /[\/.]/.test(f) && !f.includes(":")),
  )];
}

/** Parse a `### SUB-ISSUES` section: `- [Short title] @dev <task> {files: a, b}`. The files annotation
 *  (optional) declares the footprint so non-overlapping sub-issues can run in parallel. */
export function parseSubIssues(planText: string): Array<{ title: string; body: string; files: string[] }> {
  const idx = planText.search(/#{0,3}\s*SUB-?ISSUES/i);
  if (idx < 0) return [];
  const out: Array<{ title: string; body: string; files: string[] }> = [];
  for (const line of planText.slice(idx).split("\n")) {
    const m = /^\s*[-*]\s*\[(.+?)\]\s*(.+)$/.exec(line);
    if (m) {
      const files = parseFileList(m[2]);
      const body = m[2].replace(/\{?\s*files?\s*:[^}\n]+\}?/i, "").trim();
      out.push({ title: m[1].trim(), body, files });
    }
  }
  return out;
}

/**
 * If the approved plan proposed a SUB-ISSUES breakdown, open each as its own @dev issue
 * (the agency then works them automatically) and mark the parent done. Returns true if it
 * handled the issue (so the caller skips building/accepting).
 */
/**
 * The Decomposer's split: turn its `### SUB-ISSUES` output into EPIC-level issues that are PLANNED
 * (NOT auto-started) and tagged "by agent" so the human reviews and starts each. Issues are created
 * in order (Part N/M) and linked to the parent as an epic. The user then approves an epic and the
 * build workflow decomposes IT into sub-issues. Returns how many were created.
 */
async function splitIntoPlanned(repo: string, issue: Issue, text: string): Promise<number> {
  const items = parseSubIssues(text);
  if (items.length === 0) return 0;
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    const body = `${it.body}\n\n— Epic ${n + 1} of ${items.length}, part of #${issue.number}. Created by the 🪓 Decomposer agent; review and press ▶ Start when ready.`;
    const created = await createIssue(repo, it.title, body);
    if (!created.number) continue;
    addEpicChild(repo, issue.number, created.number, it.title);
    if (it.files.length) recordIssueFiles(repo, created.number, it.files);
    await addLabel(repo, created.number, "agency:planned").catch(() => {});
    recordIssueStatus(repo, created.number, withStatus("planned"), { title: it.title });
    setByAgent(repo, created.number, true); // DB-first marker; the dashboard reads this, not a GitHub label
    recordRun(repo, issue.number, "decomposer", MODELS_NONE, 0, "create-issue");
  }
  await commentOnIssue(repo, issue.number, say("decomposer", `**Split into ${items.length} epic(s)** — created as **Planned** (tagged \`by agent\`). Review each and press ▶ Start to build it; the build then breaks the epic into sub-issues.`));
  await upsertTrackerComment(repo, issue.number, renderEpicTracker(listEpicChildren(repo, issue.number))).catch(() => {});
  await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
  await addLabel(repo, issue.number, EPIC_LABEL).catch(() => {});
  recordIssueStatus(repo, issue.number, withStatus("review"));
  return items.length;
}

async function maybeDecompose(repo: string, issue: Issue, planText: string): Promise<boolean> {
  const subs = parseSubIssues(planText);
  if (subs.length === 0) return false;

  for (const s of subs) {
    // Link each sub-issue back to the parent so the relationship is explicit in GitHub.
    const body = /@\w/.test(s.body) ? s.body : `@dev ${s.body}`;
    const created = await createIssue(repo, s.title, `${body}\n\nPart of epic #${issue.number}.`);
    addEpicChild(repo, issue.number, created.number, s.title);
    if (s.files.length) recordIssueFiles(repo, created.number, s.files); // footprint → file-lock scheduling
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
  // label → {state, blocked} via the state module (e.g. 'agency:awaiting-answer' → working+awaitingAnswer).
  recordIssueStatus(repo, issue.number, parseLegacyStatus(label));
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
  if (stopped(repo, issue.number, "build")) return;
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

  const test = await runTests(repo, issue.number, workdir, branch);
  await commentOnIssue(repo, issue.number, say("tester", `**Test results**\n\n${test.text}`));

  // Orchestrated loop (decideNext is the single source of "what next"): keep tests green BEFORE
  // reviewing broken code, re-test after every revise, and warm the reviewer across its own rounds.
  let testText = test.text, testPass = test.pass, lastReview = "", round = 0, reviews = 0;
  const maxR = maxReviseRounds();
  const reviseDev = async (task: string): Promise<boolean> => {
    const before = await localHeadSha(workdir);
    const revise = await runRole("developer", {
      workdir, repo, issueNumber: issue.number, task,
      // Warm: the developer that wrote the code resumes to fix it.
      ...(getSession(repo, issue.number, "developer") ? { resumeSessionId: getSession(repo, issue.number, "developer") ?? undefined } : {}),
    });
    recordRun(repo, issue.number, "developer", revise.model, revise.turns, "revise", revise.costUsd);
    return (await localHeadSha(workdir)) !== before || (await workdirDirty(workdir));
  };
  const retest = async (label: string): Promise<void> => {
    const t = await runTests(repo, issue.number, workdir, branch);
    testText = t.text; testPass = t.pass;
    await commentOnIssue(repo, issue.number, say("tester", `**${label}**\n\n${t.text}`));
  };

  for (;;) {
    if (isStopRequested(repo, issue.number)) { console.log(`[agency] build halted by Stop ${repo} #${issue.number}`); return; }
    // 1) Tests failing → fix them (errors only) and re-test before spending a review on broken code.
    if (!testPass) {
      const d = decideNext({ phase: "tested", devChanged: true, testPass: false, round, maxRounds: maxR });
      if (d.action !== "revise") { lastReview = "REQUEST CHANGES — tests still failing (out of revise rounds)."; break; }
      round++;
      const changed = await reviseDev(`Tests are FAILING on branch \`${branch}\`. Fix only what's needed to make them pass, commit and push. Keep the diff focused.\n\n### Failing checks\n${testText}`);
      if (!changed) { lastReview = "REQUEST CHANGES — tests failing and the developer produced no change."; break; }
      await retest("Re-test after fix");
      continue;
    }
    // 2) Tests pass → review (first review cold/independent, re-reviews resume = warm).
    const review = await runRole("reviewer", {
      workdir, repo, issueNumber: issue.number,
      task:
        reviews === 0
          ? `Review the changes on branch \`${branch}\` for issue #${issue.number} against the harness. ` +
            `Inspect the diff vs main (e.g. \`git diff main...HEAD\`). Start your reply with exactly ` +
            `"APPROVE" or "REQUEST CHANGES" on the first line, then notes.\n\nTest results were:\n${testText}`
          : `The developer addressed your previous requested changes on branch \`${branch}\`. Re-check ONLY ` +
            `whether each point you raised is now resolved (inspect \`git diff main...HEAD\`). Start with exactly ` +
            `"APPROVE" or "REQUEST CHANGES" on the first line.\n\nLatest tests:\n${testText}`,
      ...(reviews > 0 ? { resumeSessionId: getSession(repo, issue.number, "reviewer") ?? undefined } : {}),
    });
    recordRun(repo, issue.number, "reviewer", review.model, review.turns, "review", review.costUsd);
    lastReview = review.text; reviews++;
    await commentOnIssue(repo, issue.number, say("reviewer", `**Review (round ${reviews})**\n\n${review.text}`));

    const verdict: "approved" | "changes" = changesRequested(review.text) ? "changes" : "approved";
    const d = decideNext({ phase: "reviewed", devChanged: true, reviewVerdict: verdict, round, maxRounds: maxR });
    if (d.action === "finalize") break;

    // 3) Changes requested + rounds left → warm dev addresses them, then re-test and loop.
    round++;
    const changed = await reviseDev(`The reviewer requested changes on branch \`${branch}\`. Address each point, commit and push. Keep the diff focused.\n\n### Review\n${review.text}`);
    if (!changed) break; // no-op → stop (don't re-review identical code)
    await retest("Re-test after fixes");
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
      `Issue: ${issue.title}\n\nPlan (gist):\n${planText.slice(0, 1500)}\n\nTest results:\n${testText.slice(0, 1500)}\n\nLast review:\n${lastReview.slice(0, 1500)}`,
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
  if (stopped(repo, issue.number, "runDeveloperPipeline")) return;
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
  if (decision.kind === "questions" && decision.body.replace(/\s+/g, " ").trim().length >= 12) {
    await commentOnIssue(repo, issue.number, say("planner", `**A few questions before I plan**\n\n${decision.body}`));
    await pause(repo, issue, AWAITING_LABEL);
    console.log(`[agency] ${repo} #${issue.number} -> awaiting answer.`);
    return;
  }

  // Degenerate proposal: the planner gated (PLAN) but gave no real content — don't make you
  // approve nothing. Just build it from the issue (the developer has the issue + playbooks).
  if (decision.kind === "plan" && !decision.auto && decision.body.replace(/\s+/g, " ").trim().length < 24) {
    recordPlan(repo, issue.number, issueHeader(issue));
    await commentOnIssue(repo, issue.number, say("planner", "**Building now.**"));
    await build(repo, issue, workdir, decision.body || issueHeader(issue), thread);
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
  if (!skipArchitect()) {
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
  if (stopped(repo, issue.number, "runSpecialist")) return;
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
      recordIssueStatus(repo, issue.number, withStatus("review"));
      return;
    }
    await removeLabel(repo, issue.number, APPROVAL_LABEL);

    const decision = await plan(repo, issue, workdir, thread);
    if (decision.kind === "questions") {
      await commentOnIssue(repo, issue.number, say("planner", `**A few questions**\n\n${decision.body}`));
      await removeLabel(repo, issue.number, IN_PROGRESS);
      await addLabel(repo, issue.number, AWAITING_LABEL);
      recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "awaitingAnswer"));
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
    recordIssueStatus(repo, issue.number, setBlocked(withStatus("planned"), "awaitingApproval"));
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
  recordIssueStatus(repo, issue.number, withStatus("review"));
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

  const test = await runTests(repo, pr, workdir, branch);
  await commentOnPr(repo, pr, say("developer", `**Pushed fixes.**\n\n${test.text}`));

  // Re-review so the verdict (and the card's ⚠ badge) reflects the new state of the PR.
  const review = await runRole("reviewer", {
    workdir,
    repo,
    issueNumber: pr,
    task:
      `Re-review branch \`${branch}\` after the latest changes. Inspect \`git diff main...HEAD\`. ` +
      `Start your reply with exactly "APPROVE" or "REQUEST CHANGES" on the first line, then notes.\n\nLatest tests:\n${test.text}`,
    ...(getSession(repo, pr, "reviewer") ? { resumeSessionId: getSession(repo, pr, "reviewer") ?? undefined } : {}),
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
  if (stopped(repo, issue.number, "runResumeBuild")) return;
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
/**
 * Change-journal context for a set of files (v4 reconcile-by-intent): what OTHER issues already
 * merged into these files and WHY. Handed to the conflict resolver so it integrates with the
 * incoming work's intent instead of guessing from conflict markers. Empty (no-op) until merges exist.
 */
function journalContextForFiles(repo: string, files: string[]): string {
  const hits = changesTouchingFiles(repo, files, 8);
  if (!hits.length) return "";
  return (
    `\n\n### What recently landed in these files (change journal — integrate with their INTENT, never undo them)\n` +
    hits.map((c) => `- #${c.number} **${c.title}** — ${c.summary || "merged"}${c.files.length ? ` (files: ${c.files.slice(0, 6).map((f) => f.path).join(", ")})` : ""}`).join("\n")
  );
}

export async function runReviewFix(repo: string, issue: Issue, workdir: string, opts?: { conflict?: boolean }): Promise<void> {
  if (stopped(repo, issue.number, "runReviewFix")) return;
  const branch = `agency/issue-${issue.number}`;
  const rev = getReview(repo, issue.number);
  const wantsChanges = rev?.verdict === "changes"; // reviewer actually asked for changes
  const review = rev?.summary || "(see the reviewer's latest comment on the issue)";

  // ---------------------------------------------------------------------------------------------
  // Conflict resolution — deterministic and TOKEN-FRUGAL. The old flow ran developer+tester+reviewer
  // on every Fix even for a pure conflict (and could loop, re-testing forever). Now: a clean merge
  // costs ZERO agent turns; a real conflict spends ONE focused developer turn (resolve the files);
  // and if it still won't merge afterwards we STOP at needs-attention instead of looping.
  // ---------------------------------------------------------------------------------------------
  if (opts?.conflict) {
    const m = await mergeBaseInto(workdir, "main");

    if (m.status === "error") {
      await conflictUnresolved(repo, issue, branch, "I couldn't auto-merge `main` into this branch (history/fetch problem).", m.files);
      return; // do not loop
    }

    if (m.status === "conflicts") {
      await commentOnIssue(repo, issue.number, say("developer", `**Resolving merge conflicts with main** in ${m.files.length} file(s): ${m.files.map((f) => "`" + f + "`").join(", ")}.`));
      const dev = await runRole("developer", {
        workdir,
        repo,
        issueNumber: issue.number,
        task:
          `A merge of \`origin/main\` is IN PROGRESS in this checkout, with conflicts in:\n` +
          m.files.map((f) => `- \`${f}\``).join("\n") +
          `\n\nResolve EVERY conflict by editing those files. CRITICAL — this is a FEATURE-AWARE merge: you must ` +
          `INTEGRATE BOTH SIDES so NO work is lost. \`main\` (the incoming side) may contain features added by ` +
          `OTHER issues since this branch started; your branch (the current side) contains THIS issue's feature. ` +
          `Keep BOTH — combine the changes so every feature from each side survives. Never resolve by deleting one ` +
          `side's code to make the markers go away. Remove all \`<<<<<<<\`/\`=======\`/\`>>>>>>>\` markers, then \`git add\` each resolved file. ` +
          `Do NOT run \`git merge\`/\`git rebase\` again, do NOT \`git merge --abort\`, do NOT open a new PR, and do NOT commit — the system commits and pushes for you. ` +
          `When every file is resolved and \`git add\`ed, make sure the project still builds, then stop.` +
          journalContextForFiles(repo, m.files),
        ...(getSession(repo, issue.number, "developer") ? { resumeSessionId: getSession(repo, issue.number, "developer") ?? undefined } : {}),
      });
      recordRun(repo, issue.number, "developer", dev.model, dev.turns, "resolve-conflict", dev.costUsd);
    } else {
      await commentOnIssue(repo, issue.number, say("developer", `**Merged the latest main in cleanly** — no conflicts.`));
    }

    // Commit the merge (if not already) and push it. This is the step the loop was missing.
    await ensureBranchPushed(workdir, branch);
    // Verify against the FRESH REMOTE state — the SAME branch→main merge GitHub runs. The local
    // workdir and GitHub's cached `mergeable` flag both lie right after a push; only a real probe of
    // the pushed origin/branch vs origin/main tells the truth.
    const probe = await mergeProbe(repo, branch, "main");
    if (!probe.ok || probe.files.length) {
      await conflictUnresolved(
        repo, issue, branch,
        probe.ok
          ? "The PR branch still conflicts with `main` after this pass, so it isn't mergeable yet."
          : "Couldn't verify the merge against `main` (network/history) — leaving it for a human to check.",
        probe.files.length ? probe.files : m.files,
      );
      return; // STOP — no automatic retry, no token bleed
    }

    clearConflict(repo, issue.number); // resolved
    if (!wantsChanges) {
      // The conflict was the only blocker — finalize as ready WITHOUT a review cycle. Done.
      await finalizeWithPr(repo, issue, workdir, branch, false);
      await commentOnIssue(repo, issue.number, say("developer", `**✅ Merge conflicts resolved** — the PR is mergeable again.`));
      return;
    }
    // Reviewer ALSO wanted changes — fall through to address them on the now-merged branch.
  }

  // ---------------------------------------------------------------------------------------------
  // Address the reviewer's requested changes (full developer → tester → reviewer cycle).
  // ---------------------------------------------------------------------------------------------
  await commentOnIssue(repo, issue.number, say("developer", `**On it — addressing the review.**`));
  const beforeSha = await localHeadSha(workdir);
  const dev = await runRole("developer", {
    workdir,
    repo,
    issueNumber: issue.number,
    task:
      `Make sure you're on the PR branch: \`git checkout ${branch}\` (it's already checked out). ` +
      `Address the reviewer's requested changes. ` +
      `Make the fixes, add/extend tests as needed, then commit and push to the SAME branch (do NOT open a new PR). ` +
      `Keep the diff focused on what was asked.\n\n### Reviewer's requested changes\n${review}\n\n### ${issueHeader(issue)}`,
    ...(getSession(repo, issue.number, "developer") ? { resumeSessionId: getSession(repo, issue.number, "developer") ?? undefined } : {}),
  });
  recordRun(repo, issue.number, "developer", dev.model, dev.turns, "revise", dev.costUsd);

  // Orchestrator decision: if the developer produced NO change (HEAD didn't move and the tree is
  // clean), re-running the tester + reviewer would just re-confirm the prior verdict at full token
  // cost. Stop and ask the human instead of blindly launching the next two agents.
  const changed = (await localHeadSha(workdir)) !== beforeSha || (await workdirDirty(workdir));
  if (!changed) {
    await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
    await addLabel(repo, issue.number, NEEDS_ATTENTION).catch(() => {});
    recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "needsAttention"));
    await commentOnIssue(repo, issue.number, say("developer", `**No code changes were produced** addressing the review, so I skipped the re-test/re-review to avoid burning tokens. Comment guidance and re-pin, or **Merge anyway**.`));
    return;
  }

  const test = await runTests(repo, issue.number, workdir, branch);
  await commentOnIssue(repo, issue.number, say("tester", `**Re-test after fixes**\n\n${test.text}`));

  const review2 = await runRole("reviewer", {
    workdir,
    repo,
    issueNumber: issue.number,
    task:
      `Re-review branch \`${branch}\` for issue #${issue.number} after the fixes. Inspect \`git diff main...HEAD\`. ` +
      `Start your reply with exactly "APPROVE" or "REQUEST CHANGES" on the first line, then notes.\n\nLatest tests:\n${test.text}`,
    ...(getSession(repo, issue.number, "reviewer") ? { resumeSessionId: getSession(repo, issue.number, "reviewer") ?? undefined } : {}),
  });
  recordRun(repo, issue.number, "reviewer", review2.model, review2.turns, "review", review2.costUsd);
  await commentOnIssue(repo, issue.number, say("reviewer", `**Review (after fix)**\n\n${review2.text}`));

  const stillChanges = changesRequested(review2.text);
  recordReview(repo, issue.number, stillChanges ? "changes" : "approved", review2.text);
  await finalizeWithPr(repo, issue, workdir, branch, stillChanges);
}

/** Park an unresolved-conflict PR at needs-attention with a clear note (and keep the conflict box). */
async function conflictUnresolved(repo: string, issue: Issue, branch: string, why: string, files: string[]): Promise<void> {
  await removeLabel(repo, issue.number, READY).catch(() => {});
  await addLabel(repo, issue.number, NEEDS_ATTENTION).catch(() => {});
  recordIssueStatus(repo, issue.number, setBlocked(withStatus("working"), "needsAttention"));
  recordConflict(repo, issue.number, "", files); // keep the box visible with whatever files we know
  await commentOnIssue(
    repo,
    issue.number,
    say("developer", `**⚠️ ${why}** Press **Fix merge conflicts** to try again, or resolve it manually on branch \`${branch}\`.`),
  ).catch(() => {});
  console.log(`[agency] ${repo} #${issue.number} -> ${NEEDS_ATTENTION} (conflict unresolved).`);
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


// ---- workflow engine (Phase 2): run a custom workflow's steps in order, with forced skills/hooks
// and gates. The proven full-build path stays on runPipeline; this drives everything else. ----
const STEP_ROLE: Record<string, RoleName> = { "@dev": "developer", "@plan": "planner", "@arch": "architect", "@review": "reviewer", "@test": "tester", "@split": "decomposer" };

async function runStepHooks(ids: number[], phase: "pre" | "post", workdir: string, repo: string, number: number): Promise<void> {
  if (!ids.length) return;
  for (const h of listHooks(undefined, phase)) {
    if (!ids.includes(h.id) || !h.enabled) continue;
    try {
      execSync(h.command, { cwd: workdir, stdio: "pipe", timeout: 120_000 });
      pushActivity(repo, number, "developer", "tool", `🪝 ${phase}-hook: ${h.command.slice(0, 70)}`);
    } catch (e) {
      pushActivity(repo, number, "developer", "tool", `🪝 ${phase}-hook failed: ${(e as Error).message.slice(0, 90)}`);
    }
  }
}

async function evalGate(cond: string, repo: string, issue: Issue, workdir: string, branch: string): Promise<boolean> {
  switch (cond) {
    case "review:changes": return getReview(repo, issue.number)?.verdict === "changes";
    case "review:approved": return getReview(repo, issue.number)?.verdict === "approved";
    case "tests:pass": return (await runTests(repo, issue.number, workdir, branch)).pass;
    case "tests:fail": return !(await runTests(repo, issue.number, workdir, branch)).pass;
    case "conflict": return (await conflictFiles(repo, branch).catch(() => [])).length > 0;
    case "humanApproval": return true;
    default: return false;
  }
}

/** Run a workflow's steps in sequence with gates (review verdict / tests / conflict / human approval). */
/**
 * Solo developer run — the @dev pin or a single code agent. The clone is already done; the
 * developer makes the change directly (no planner/architect gate, no tester/reviewer loop) and the
 * orchestrator opens a draft PR. This is the "just the developer" path; the multi-step build is the
 * Full build workflow (@build).
 */
export async function runDeveloperSolo(repo: string, issue: Issue, workdir: string, thread: string): Promise<void> {
  if (stopped(repo, issue.number, "runDeveloperSolo")) return;
  const branch = `agency/issue-${issue.number}`;
  const dev = await runRole("developer", {
    workdir,
    repo,
    issueNumber: issue.number,
    task:
      `Implement this issue on branch \`${branch}\` off an up-to-date main. Reuse existing code, keep the change ` +
      `focused, and commit + push your work (\`git add … && git commit -m "…" && git push\`). When the change is ` +
      `made and committed, stop — the orchestrator opens the PR.\n\n### ${issueHeader(issue)}` +
      (thread ? `\n\n### Conversation (latest applies)\n${thread}` : ""),
  });
  if (isStopRequested(repo, issue.number)) return; // user stopped — don't open a PR
  recordRun(repo, issue.number, "developer", dev.model, dev.turns, "implement", dev.costUsd);
  await commentOnIssue(repo, issue.number, say("developer", dev.text));
  await finalizeWithPr(repo, issue, workdir, branch, false);
}

const WF_ROLE_DEFAULT_TASK: Record<string, string> = { "@plan": "Produce a concrete build plan for this issue.", "@arch": "Turn the plan into a concrete technical design (no code).", "@dev": "Implement the plan; commit and open a PR.", "@review": "Review the PR against the plan and the codebase.", "@test": "Run the project's checks and fix any failures." };
/** A step's instruction, or — when blank — the agent's default task (agentDef.defaultTask, else the role default). */
function stepInstruction(step: { agent?: string; instruction?: string }): string {
  const own = (step.instruction || "").trim();
  if (own) return own;
  const handle = (step.agent || "").toLowerCase();
  const def = listAgentDefs().find((d) => (d.handle || `@${d.name}`).toLowerCase() === handle || d.name.toLowerCase() === handle.replace(/^@/, ""));
  return (def && def.defaultTask && def.defaultTask.trim()) || WF_ROLE_DEFAULT_TASK[handle] || `Do your part for this issue as the ${handle || "developer"} agent.`;
}

export async function runWorkflowEngine(cfg: Config, repo: string, issue: Issue, wf: Workflow, workdir: string, thread: string): Promise<void> {
  void cfg;
  const branch = `agency/issue-${issue.number}`;
  const loops: Record<number, number> = {};
  let i = 0, guard = 0;
  await commentOnIssue(repo, issue.number, say("developer", `🧭 Running workflow **${wf.name}** — ${wf.steps.length} step(s).`));
  const wfHookIds = (wf.hooks || []).map(Number).filter((n) => Number.isFinite(n));
  await runStepHooks(wfHookIds, "pre", workdir, repo, issue.number); // workflow-level pre hooks
  while (i < wf.steps.length && guard++ < 30) {
    if (isStopRequested(repo, issue.number)) { console.log(`[agency] workflow halted by Stop ${repo} #${issue.number}`); return; }
    const step = wf.steps[i];
    const role: RoleName = STEP_ROLE[(step.agent || "").toLowerCase()] ?? "developer";
    const hookIds = (step.hooks || []).map(Number).filter((n) => Number.isFinite(n));
    const skills = step.skills && step.skills.length ? `

${skillsPrompt(step.skills)}` : "";
    setActive(repo, issue.number, "issue", role, issue.title);
    const instr = stepInstruction(step);
    await commentOnIssue(repo, issue.number, say(role, `▶ **Step ${i + 1}/${wf.steps.length}** · ${instr.split("\n")[0].slice(0, 90)}`));
    await runStepHooks(hookIds, "pre", workdir, repo, issue.number);
    const out = await runRole(role, {
      workdir, repo, issueNumber: issue.number,
      task: `${instr}

### ${issueHeader(issue)}${thread ? `

### Conversation
${thread}` : ""}${skills}`,
      ...(step.model ? { model: step.model } : {}),
    });
    if (isStopRequested(repo, issue.number)) { console.log(`[agency] workflow halted mid-step by Stop ${repo} #${issue.number}`); return; }
    recordRun(repo, issue.number, role, out.model, out.turns, "workflow", out.costUsd);
    await commentOnIssue(repo, issue.number, say(role, out.text));
    await runStepHooks(hookIds, "post", workdir, repo, issue.number);
    if (role === "decomposer") { await splitIntoPlanned(repo, issue, out.text).catch(() => {}); return; } // split → planned epics, end this run
    if (role === "developer") await finalizeWithPr(repo, issue, workdir, branch).catch(() => {});

    const gate = (wf.gates || []).find((g) => g.after === i);
    let route = "continue";
    if (gate && (await evalGate(gate.condition, repo, issue, workdir, branch))) {
      if (gate.condition === "humanApproval") {
        await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
        await addLabel(repo, issue.number, APPROVAL_LABEL).catch(() => {});
        recordIssueStatus(repo, issue.number, setBlocked(withStatus("planned"), "awaitingApproval"));
        await commentOnIssue(repo, issue.number, say(role, "⏸ **Approval needed** to continue — press **Approve** on the dashboard."));
        return;
      }
      route = gate.route;
    }
    if (route === "stop") break;
    if (route.startsWith("loop:")) {
      const target = Number(route.slice(5));
      loops[i] = (loops[i] || 0) + 1;
      if (Number.isFinite(target) && loops[i] <= (gate?.maxLoops ?? 2)) { i = target; continue; }
    }
    i++;
  }
  await runStepHooks(wfHookIds, "post", workdir, repo, issue.number); // workflow-level post hooks
  await removeLabel(repo, issue.number, IN_PROGRESS).catch(() => {});
  await addLabel(repo, issue.number, READY).catch(() => {});
  recordIssueStatus(repo, issue.number, withStatus("review"));
  await commentOnIssue(repo, issue.number, say("developer", `✅ Workflow **${wf.name}** complete — ready for your review.`));
}
