/**
 * Process Analyzer (v3 P6) — the self-improvement service. Runs on its OWN instance
 * (RUN_MODE=analyzer), occasionally (gated on enough new telemetry), and mines the agency's run
 * history for repeating/wasteful patterns. It proposes skills, hooks, and deterministic-code
 * changes — ADVISORY ONLY: it opens a GitHub issue you approve, never auto-merges. It also verifies
 * the deployment so a change that needs a redeploy/tool-install is caught.
 */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.js";
import {
  toolStatsSince, tokensByRoleSince, topIssuesByTokensSince, runStepCountSince, recentLessons,
  getSetting, setSetting,
} from "./store.js";
import { createIssue, addLabel } from "./github.js";
import { effectiveRepos } from "./commands.js";
import { resolveChatExec } from "./agents/chat.js";
import { query } from "@anthropic-ai/claude-agent-sdk";

const LAST_KEY = "analyzer_last_run";
const MIN_NEW_STEPS = Number(process.env.ANALYZER_MIN_STEPS) || 50;
const INTERVAL_MS = (Number(process.env.ANALYZER_INTERVAL_HOURS) || 6) * 3600_000;

/** Deterministic telemetry digest (no LLM) — what the analyzer reasons over. */
export function analysisDigest(sinceIso: string): string {
  const tools = toolStatsSince(sinceIso).slice(0, 25);
  const byRole = tokensByRoleSince(sinceIso);
  const topIssues = topIssuesByTokensSince(sinceIso, 8);
  const lessons = recentLessons(10);
  const fmtK = (n: number) => (n >= 1000 ? Math.round(n / 1000) + "k" : "" + n);
  return [
    `## Telemetry since ${sinceIso}`,
    ``,
    `### Tool usage (role · tool · uses · fails)`,
    tools.map((t) => `- ${t.role} · ${t.tool} · ${t.uses}× · ${t.fails} fail`).join("\n") || "_none_",
    ``,
    `### Tokens by role`,
    byRole.map((r) => `- ${r.role}: ${fmtK(r.tokens)} tok · $${(r.costUsd || 0).toFixed(2)} · ${r.runs} runs`).join("\n") || "_none_",
    ``,
    `### Most expensive issues`,
    topIssues.map((i) => `- ${i.repo.split("/").pop()}#${i.number}: ${fmtK(i.tokens)} tok · ${i.runs} runs`).join("\n") || "_none_",
    ``,
    `### Recent lessons`,
    lessons.map((l) => `- ${l}`).join("\n") || "_none_",
  ].join("\n");
}

/** "Enough new data?" gate. */
export function shouldAnalyze(): { ok: boolean; since: string } {
  const since = getSetting(LAST_KEY) || new Date(0).toISOString();
  return { ok: runStepCountSince(since) >= MIN_NEW_STEPS, since };
}

const ANALYZER_PERSONA = `You are the **Process Analyzer** for an autonomous dev agency. You receive a digest of the agency's
own run telemetry. Find REPEATING, mechanical, or wasteful patterns the agents keep doing by hand, and propose concrete
improvements — each as ONE of:
- a **skill** (reusable instruction; give name + description + body),
- a **hook** (a deterministic shell command to run pre/post a role; give target role + phase + command),
- a **deterministic code change** (describe what agent step could be replaced by code).
Be specific and conservative. Propose at most 5, highest-impact first. Output GitHub-flavored markdown with a short
rationale per proposal. This is ADVISORY — a human approves before anything changes.`;

/** Run one analysis pass: LLM over the digest → advisory GitHub issue. Returns the issue number or 0. */
export async function runAnalysis(cfg: Config): Promise<number> {
  const { ok, since } = shouldAnalyze();
  if (!ok) return 0;
  const repo = (getSetting("analyzer_repo") || effectiveRepos(cfg)[0] || "").trim();
  if (!repo) return 0;
  const digest = analysisDigest(since);
  const { model, env } = resolveChatExec("");
  const cfgDir = mkdtempSync(join(tmpdir(), "analyzer-"));
  const workdir = mkdtempSync(join(tmpdir(), "analyzer-wd-"));
  env.CLAUDE_CONFIG_DIR = cfgDir;
  let text = "";
  try {
    for await (const message of query({
      prompt: `Analyze this telemetry and propose improvements.\n\n${digest}`,
      options: { cwd: workdir, systemPrompt: ANALYZER_PERSONA, model, env, allowedTools: [], permissionMode: "bypassPermissions", maxTurns: 6, settingSources: [], stderr: () => {} },
    })) {
      if ((message as { type?: string }).type === "assistant") {
        const content = (message as { message?: { content?: Array<{ type?: string; text?: string }> } }).message?.content;
        if (Array.isArray(content)) for (const b of content) if (b.type === "text" && b.text) text += b.text;
      }
    }
  } finally {
    try { rmSync(cfgDir, { recursive: true, force: true }); } catch { /* noop */ }
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  setSetting(LAST_KEY, new Date().toISOString());
  if (!text.trim()) return 0;
  const body = `🔬 **Process Analyzer — self-improvement proposals** (advisory; approve what you like)\n\n${text}\n\n---\n<details><summary>Telemetry digest</summary>\n\n${digest}\n</details>`;
  const r = await createIssue(repo, "Process Analyzer: improvement proposals", body).catch(() => ({ number: 0 }));
  if (r.number) {
    await addLabel(repo, r.number, "agency:analyzer").catch(() => {});
    await addLabel(repo, r.number, "agency:ignore").catch(() => {}); // advisory — agents don't act on it
  }
  return r.number;
}

/** Verify the deployment is up (after changes that need a redeploy/tool install). */
export async function verifyDeploy(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const url = (process.env.SERVICE_URL_AGENCY || process.env.COOLIFY_FQDN || "").trim();
  if (!url) return { ok: false, error: "no SERVICE_URL_AGENCY set" };
  const base = url.startsWith("http") ? url : `https://${url}`;
  try {
    const res = await fetch(`${base}/web/version.json`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const v = (await res.json()) as { version?: string };
    return { ok: true, version: v.version };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** RUN_MODE=analyzer loop: periodic, gated, advisory. */
export function startAnalyzer(cfg: Config): void {
  // A tiny health endpoint so Coolify (and any uptime check) sees a healthy worker — the analyzer is
  // otherwise headless. Reports the last analysis time + deploy check, nothing sensitive.
  const port = Number(process.env.PORT) || 3000;
  let lastIssue = 0;
  let lastDeploy: { ok: boolean; version?: string; error?: string } = { ok: false };
  createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ mode: "analyzer", lastProposalsIssue: lastIssue, lastRun: getSetting(LAST_KEY) || null, deploy: lastDeploy }),
    );
  }).listen(port, () => console.log(`[analyzer] health on :${port}`));

  const tick = async (): Promise<void> => {
    try {
      const n = await runAnalysis(cfg);
      if (n) { lastIssue = n; console.log(`[analyzer] opened advisory proposals issue #${n}`); }
      lastDeploy = await verifyDeploy();
      console.log(`[analyzer] deploy ${lastDeploy.ok ? `ok (v${lastDeploy.version})` : `DOWN: ${lastDeploy.error}`}`);
    } catch (err) {
      console.error("[analyzer] pass failed:", (err as Error).message);
    }
  };
  void tick();
  setInterval(() => void tick(), INTERVAL_MS);
}
