/**
 * The repo Orchestrator chat (v4). A per-repo, conversational front door: the user thinks out loud,
 * the Orchestrator grounds itself in the repo's memory + recent issues, and — when the user is ready
 * — proposes concrete work as a structured handoff the user confirms (it never creates issues
 * itself; that's the confirmed /orch-handoff route). DB-first: the thread lives in `orch_msg`.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendOrchMsg, listOrchThread, recentIssues, getSession, setSession, recordRun } from "../store.js";
import { resolveChatExec } from "./chat.js";
import { recallWiring, RECALL_PROMPT } from "./recall.js";

export interface HandoffIssue { title: string; scope: string }
export interface HandoffProposal { workflow: string; issues: HandoffIssue[] }
export interface OrchReply { reply: string; proposal: HandoffProposal | null }

const VALID_WF = new Set(["quick-fix", "full-build", "plan-only", "split"]);
const ORCH_ROLE = "orchestrator";

/** Parse the trailing ```handoff block (if any) into a structured proposal; tolerant of small drift. */
export function parseHandoff(text: string): HandoffProposal | null {
  const m = text.match(/```handoff\s*([\s\S]*?)```/i);
  if (!m) return null;
  const lines = m[1].split("\n").map((l) => l.trim()).filter(Boolean);
  let workflow = "";
  const issues: HandoffIssue[] = [];
  for (const line of lines) {
    const wf = line.match(/^workflow\s*:\s*(.+)$/i);
    if (wf) { workflow = wf[1].trim().toLowerCase().replace(/\s+/g, "-"); continue; }
    const it = line.match(/^[-*]\s*\[(.+?)\]\s*(.*)$/);
    if (it) { issues.push({ title: it[1].trim(), scope: it[2].trim() }); continue; }
    const bare = line.match(/^[-*]\s+(.+)$/);
    if (bare) issues.push({ title: bare[1].trim().slice(0, 80), scope: bare[1].trim() });
  }
  if (!VALID_WF.has(workflow)) workflow = issues.length > 1 ? "split" : "full-build";
  if (!issues.length) return null;
  return { workflow, issues };
}

/** Strip the handoff block from the user-facing reply (the proposal is surfaced as a UI card). */
function stripHandoff(text: string): string {
  return text.replace(/```handoff[\s\S]*?```/gi, "").trim();
}

function loadPersona(): string {
  for (const p of ["memory/central/agents/orchestrator.md", join(process.cwd(), "memory/central/agents/orchestrator.md")]) {
    try { return readFileSync(p, "utf8"); } catch { /* try next */ }
  }
  return "You are the repo Orchestrator: converse with the user, ground answers in the repo, and propose concrete work when they're ready.";
}

function repoContext(repo: string): string {
  const mine = recentIssues(120).filter((i) => i.repo === repo).slice(0, 25);
  if (!mine.length) return "No issues tracked for this repo yet.";
  return mine.map((i) => `#${i.number} [${i.state}${i.blocked ? "/" + i.blocked : ""}] ${i.title}`).join("\n");
}

/**
 * Run one turn of the repo Orchestrator over its thread. Persists the user message and the reply,
 * and returns the reply text (handoff block stripped) plus the parsed proposal, if any.
 */
export async function runOrchestratorChat(repo: string, userText: string): Promise<OrchReply> {
  appendOrchMsg(repo, "user", userText);
  const history = listOrchThread(repo, 40)
    .map((m) => `${m.role === "user" ? "User" : "Orchestrator"}: ${m.text}`)
    .join("\n\n");

  const { model, env } = resolveChatExec(process.env.ORCHESTRATOR_MODEL || "");
  const cfgDir = mkdtempSync(join(tmpdir(), "orch-cfg-"));
  const workdir = mkdtempSync(join(tmpdir(), "orch-wd-"));
  env.CLAUDE_CONFIG_DIR = cfgDir;
  const rc = recallWiring(repo);
  const systemPrompt =
    `${loadPersona()}\n\n` +
    `You are the Orchestrator for the repository **${repo}**.\n` +
    `Recent issues in this repo:\n${repoContext(repo)}\n\n${RECALL_PROMPT}`;

  const resumeId = getSession(repo, 0, ORCH_ROLE) || undefined;
  let text = "";
  let turns = 0;
  try {
    for await (const message of query({
      prompt:
        `### Conversation so far\n${history || "(this is the first message)"}\n\n` +
        `The user just said:\n${userText}\n\n` +
        `Respond as the Orchestrator. Discuss and advise conversationally; only append a \`handoff\` block if the user is ready to create work.`,
      options: {
        cwd: workdir,
        systemPrompt,
        model,
        env,
        allowedTools: [...rc.tools],
        mcpServers: { ...rc.servers },
        permissionMode: "bypassPermissions",
        maxTurns: 12,
        settingSources: [],
        ...(resumeId ? { resume: resumeId } : {}),
        stderr: () => {},
      },
    })) {
      const sid = (message as { session_id?: string }).session_id;
      if (sid) setSession(repo, 0, ORCH_ROLE, sid);
      if (message.type === "assistant") {
        turns++;
        const content = (message as { message?: { content?: Array<{ type?: string; text?: string }> } }).message?.content;
        if (Array.isArray(content)) for (const b of content) if (b.type === "text" && b.text?.trim()) text += (text ? "\n\n" : "") + b.text.trim();
      }
    }
  } finally {
    try { rmSync(cfgDir, { recursive: true, force: true }); } catch { /* noop */ }
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* noop */ }
  }

  const proposal = parseHandoff(text);
  const reply = stripHandoff(text) || "(no response)";
  appendOrchMsg(repo, "orchestrator", reply, proposal ? { proposal } : null);
  recordRun(repo, 0, ORCH_ROLE, model, turns, "chat", 0);
  return { reply, proposal };
}
