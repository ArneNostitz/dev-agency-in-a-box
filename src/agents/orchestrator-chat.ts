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
import { appendOrchMsg, listOrchThread, recentIssues, getSession, setSession, recordRun, filesFor, listEpicChildren, recentChanges } from "../store.js";
import { activeClaims } from "../locks.js";
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
  const all = recentIssues(160).filter((i) => i.repo === repo);
  if (!all.length) return "No issues tracked for this repo yet.";
  const recent = all.slice(0, 25).map((i) => {
    const f = filesFor(repo, i.number);
    return `#${i.number} [${i.state}${i.blocked ? "/" + i.blocked : ""}] ${i.title}${f.length ? ` — files: ${f.slice(0, 8).join(", ")}` : ""}`;
  }).join("\n");

  // What's running RIGHT NOW + which files each run has live-claimed (the overwrite-protection
  // registry). This is how the Orchestrator knows what's in flight without reading the repo.
  const claims = activeClaims(repo);
  const inflight = all.filter((i) => i.state === "working").map((i) => {
    const live = claims.find((c) => c.number === i.number);
    return `#${i.number} ${i.title}${live && live.files.length ? ` — editing: ${live.files.join(", ")}` : ""}`;
  });
  const liveBlock = inflight.length ? `\n\nIn flight right now (don't propose work that fights these):\n${inflight.join("\n")}` : "";

  // Epics and their planned sub-issues (the "handoff codes") so you know how big work was split.
  const epics = listEpicChildren ? all.filter((i) => i.state === "agency:epic").map((i) => {
    const kids = (listEpicChildren(repo, i.number) || []).map((c) => `#${c.child} ${c.title}`);
    return `#${i.number} ${i.title} → ${kids.length ? kids.join(", ") : "(no sub-issues yet)"}`;
  }) : [];
  const epicBlock = epics.length ? `\n\nEpics & their sub-issues:\n${epics.join("\n")}` : "";

  // File ownership across all open work — so a proposal can route to disjoint files and avoid clashes.
  const owners: string[] = [];
  for (const i of all) {
    if (i.state === "done") continue;
    const f = filesFor(repo, i.number);
    for (const path of f) owners.push(`${path} ← #${i.number}`);
  }
  const ownBlock = owners.length ? `\n\nDeclared file footprints (avoid proposing edits that overlap these unless you sequence them):\n${[...new Set(owners)].slice(0, 40).join("\n")}` : "";

  // Recently MERGED changes (real state, from the change journal) — what actually landed + why.
  const merged = recentChanges(repo, 10).map((c) => `#${c.number} ${c.title}${c.files.length ? ` — ${c.files.slice(0, 6).map((f) => f.path).join(", ")}` : ""}`);
  const mergedBlock = merged.length ? `\n\nRecently merged (real state — build on these, not on unmerged branches):\n${merged.join("\n")}` : "";

  return recent + liveBlock + epicBlock + ownBlock + mergedBlock;
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
    `You are the Orchestrator for the repository **${repo}**.\n\n` +
    `## Live repo state (issues, what's in flight, epics, file ownership)\n${repoContext(repo)}\n\n` +
    `When you propose work, route it to files NOT already owned by open issues. If an idea must touch a file another issue owns, say so and propose to SEQUENCE it after that issue (so the second builds on the first's change) rather than running in parallel — two agents must never edit the same file at once.\n\n${RECALL_PROMPT}`;

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
