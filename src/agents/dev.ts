/**
 * The Developer agent: given one issue and a checked-out working copy, it
 * implements the change, branches, commits, pushes, opens a linked draft PR,
 * and comments the result back on the issue. It does this through its Bash tool
 * using `git` and `gh`, bounded by the Constitution.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Issue } from "../github.js";

export interface DevAgentInput {
  issue: Issue;
  repo: string;
  workdir: string;
  constitution: string;
  gitPlaybook: string;
  model?: string;
}

function buildSystemPrompt(constitution: string, gitPlaybook: string): string {
  return [
    "You are a senior software developer working as part of an autonomous developer agency.",
    "You complete exactly one GitHub issue per run, then stop.",
    "",
    "=== CONSTITUTION (hard rules — always obey) ===",
    constitution,
    "",
    "=== GIT WORKFLOW PLAYBOOK ===",
    gitPlaybook,
  ].join("\n");
}

function buildTaskPrompt(input: DevAgentInput): string {
  const { issue, repo } = input;
  return [
    `Work on issue #${issue.number} in the repository ${repo}.`,
    "",
    `Title: ${issue.title}`,
    "",
    "Issue body:",
    issue.body || "(no description provided)",
    "",
    "Steps:",
    `1. Create branch agency/issue-${issue.number} off an up-to-date main.`,
    "2. Read the relevant parts of the codebase first. Do not duplicate existing functionality.",
    "3. Implement the smallest change that fully satisfies the issue. Match the repo's conventions.",
    "4. If the repo has tests/lint/build, run them and make sure they pass.",
    `5. Commit, push the branch, and open a DRAFT pull request with "Closes #${issue.number}" in the body.`,
    `6. Post a comment on issue #${issue.number} summarising what you changed, the PR URL, and the exact command to test it locally.`,
    "",
    "If the issue is too ambiguous to implement safely, do NOT guess: comment on the issue asking a specific question, and stop without changing code.",
    `You are already inside the cloned repository working directory. Use git and gh for all GitHub operations (gh is authenticated). The remote is the ${repo} repo.`,
  ].join("\n");
}

export interface DevAgentResult {
  finalText: string;
  turns: number;
}

export async function runDevAgent(input: DevAgentInput): Promise<DevAgentResult> {
  const systemPrompt = buildSystemPrompt(input.constitution, input.gitPlaybook);
  const taskPrompt = buildTaskPrompt(input);

  let finalText = "";
  let turns = 0;

  for await (const message of query({
    prompt: taskPrompt,
    options: {
      cwd: input.workdir,
      systemPrompt,
      model: input.model,
      // Phase 1 runs fully autonomously inside a throwaway sandbox repo.
      // Tighten this (e.g. canUseTool / explicit allow-list) before pointing at real repos.
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      // Don't auto-load the host's ~/.claude settings; the agency is self-contained.
      settingSources: [],
    },
  })) {
    if (message.type === "assistant") {
      turns += 1;
    }
    if ("result" in message && typeof (message as { result?: unknown }).result === "string") {
      finalText = (message as { result: string }).result;
    }
  }

  return { finalText, turns };
}
