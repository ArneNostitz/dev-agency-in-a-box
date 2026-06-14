/**
 * Dev Agency — Process Analyzer (standalone watchdog).
 *
 * Deliberately minimal and independent. It does NOT share the agency's database or filesystem: it
 * pulls aggregate telemetry over an AUTHENTICATED, read-only HTTP endpoint and uses its OWN
 * credentials. It runs occasionally (gated on enough new telemetry), mines repeating/wasteful
 * patterns, and opens an ADVISORY GitHub issue of proposals (skills / hooks / deterministic code) —
 * it never writes to the agency and never auto-merges. It also verifies the agency deployment.
 *
 * Least privilege: the only thing it can do to the agency is READ aggregate metrics. Applying any
 * change (agents/skills/hooks) happens through the agency's own admin-authenticated UI after YOU
 * approve the proposal. Compromising the analyzer yields read-only metrics, nothing more.
 *
 * Config (env) — minimal:
 *   AGENCY_URL       base URL of the agency, e.g. https://devagency.example.com   (required)
 *   AGENCY_API_KEY   the shared secret matching the agency's ANALYZER_API_KEY      (required)
 *   LLM credential:  CLAUDE_CODE_OAUTH_TOKEN | ANTHROPIC_API_KEY | (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN for GLM)
 *   Optional: ANALYZER_MODEL (default claude-sonnet-4-6), PORT (default 3000).
 * The repo to post to + the run thresholds come FROM the agency (/telemetry config), and the agency
 * opens the issue on our behalf — so no GitHub token or repo is configured here.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

const AGENCY_URL = (process.env.AGENCY_URL || process.env.SERVICE_URL_AGENCY || "").trim();
const AGENCY_API_KEY = (process.env.AGENCY_API_KEY || "").trim();
const MODEL = process.env.ANALYZER_MODEL?.trim() || "claude-sonnet-4-6";
const PORT = Number(process.env.PORT) || 3000;
let INTERVAL_MS = 6 * 3600_000; // refined from the agency's config on the first pass
const base = () => (AGENCY_URL.startsWith("http") ? AGENCY_URL : `https://${AGENCY_URL}`);

// In-memory cursor (the analyzer never writes the agency). On boot, look back one interval.
let lastSince = new Date(Date.now() - INTERVAL_MS).toISOString();
let lastIssue = 0;
let lastDeploy = { ok: false };
let lastRunAt = null;

async function fetchTelemetry(sinceIso) {
  if (!AGENCY_URL || !AGENCY_API_KEY) throw new Error("AGENCY_URL / AGENCY_API_KEY not set");
  const res = await fetch(`${base()}/telemetry?since=${encodeURIComponent(sinceIso)}`, {
    headers: { Authorization: `Bearer ${AGENCY_API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`telemetry HTTP ${res.status}`);
  return res.json();
}

function digest(t) {
  const fmtK = (n) => (n >= 1000 ? Math.round(n / 1000) + "k" : "" + (n || 0));
  return [
    `## Telemetry since ${t.since}`, ``,
    `### Tool usage (role · tool · uses · fails)`,
    (t.toolStats || []).map((x) => `- ${x.role} · ${x.tool} · ${x.uses}× · ${x.fails} fail`).join("\n") || "_none_", ``,
    `### Tokens by role`,
    (t.tokensByRole || []).map((r) => `- ${r.role}: ${fmtK(r.tokens)} tok · $${Number(r.costUsd || 0).toFixed(2)} · ${r.runs} runs`).join("\n") || "_none_", ``,
    `### Recent lessons`,
    (t.lessons || []).map((l) => `- ${l}`).join("\n") || "_none_",
  ].join("\n");
}

const PERSONA = `You are the **Process Analyzer** for an autonomous dev agency. You receive a digest of the agency's own run
telemetry. Find REPEATING, mechanical, or wasteful patterns the agents keep doing by hand, and propose concrete,
detailed improvements the agency could implement — each as ONE of: a **skill** (reusable instruction: name +
description + body), a **hook** (a deterministic shell command pre/post a role: target + phase + command), or a
**deterministic code change** (what agent step to replace with code, and how). Be specific and conservative; at most 5,
highest-impact first. Write enough detail that an engineer (or the agency itself) could act on each without more
context. Output GitHub-flavored markdown with a short rationale each. ADVISORY only — a human approves before anything
changes.`;

async function llm(prompt) {
  const cfgDir = mkdtempSync(join(tmpdir(), "analyzer-"));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfgDir };
  let text = "";
  try {
    for await (const m of query({ prompt, options: { systemPrompt: PERSONA, model: MODEL, env, allowedTools: [], permissionMode: "bypassPermissions", maxTurns: 6, settingSources: [], stderr: () => {} } })) {
      if (m.type === "assistant") for (const b of (m.message?.content || [])) if (b.type === "text" && b.text) text += b.text;
    }
  } finally { try { rmSync(cfgDir, { recursive: true, force: true }); } catch {} }
  return text;
}

// The agency opens the advisory issue for us (its own GitHub token + configured repo) — so we carry
// no GitHub credentials. Authenticated with the same shared key; the agency rate-limits + labels it.
async function postProposal(title, body) {
  try {
    const r = await fetch(`${base()}/analyzer-issue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AGENCY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) { console.error("[analyzer] proposal post failed:", r.status); return 0; }
    return (await r.json()).number || 0;
  } catch (e) { console.error("[analyzer] proposal post error:", e.message); return 0; }
}

async function verifyDeploy() {
  if (!AGENCY_URL) return { ok: false, error: "no AGENCY_URL" };
  try {
    const res = await fetch(`${base()}/web/version.json`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const v = await res.json();
    return { ok: true, version: v.version };
  } catch (e) { return { ok: false, error: e.message }; }
}

let running = false;
async function pass(force = false) {
  if (running) { console.log("[analyzer] pass already running — skipping"); return; }
  running = true;
  try {
    const t = await fetchTelemetry(lastSince);
    const minSteps = Number(t.config?.minSteps) || 50;
    if (Number(t.config?.intervalHours) > 0) INTERVAL_MS = Number(t.config.intervalHours) * 3600_000;
    if (force || (t.runStepCount || 0) >= minSteps) {
      const dg = digest(t);
      const text = await llm(`Analyze this telemetry and propose improvements.\n\n${dg}`);
      lastSince = new Date().toISOString();
      lastRunAt = lastSince;
      if (text.trim()) {
        const n = await postProposal("Process Analyzer: improvement proposals", `🔬 **Process Analyzer — self-improvement proposals** (advisory; approve what you like)\n\n${text}\n\n---\n<details><summary>Telemetry digest</summary>\n\n${dg}\n</details>`);
        if (n) { lastIssue = n; console.log(`[analyzer] opened advisory issue #${n}`); }
      }
    } else {
      console.log(`[analyzer] only ${t.runStepCount || 0} new steps (< ${minSteps}) — skipping`);
    }
  } catch (e) {
    console.error("[analyzer] telemetry pass failed:", e.message);
  } finally {
    running = false;
  }
  lastDeploy = await verifyDeploy();
  console.log(`[analyzer] deploy ${lastDeploy.ok ? `ok (v${lastDeploy.version})` : `DOWN: ${lastDeploy.error}`}`);
}

function bearerOk(req) {
  if (!AGENCY_API_KEY) return false;
  const hdr = (req.headers["authorization"] || "").toString();
  const got = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : "";
  const a = Buffer.from(got), b = Buffer.from(AGENCY_API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

createServer((req, res) => {
  // Manual trigger: POST /run (Bearer auth) runs a pass NOW, forced (ignores the min-steps gate).
  if (req.method === "POST" && (req.url || "").split("?")[0] === "/run") {
    if (!bearerOk(req)) return void res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
    if (running) return void res.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify({ error: "already running" }));
    res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ started: true }));
    void pass(true);
    return;
  }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ mode: "analyzer", running, lastProposalsIssue: lastIssue, lastRun: lastRunAt, deploy: lastDeploy }));
}).listen(PORT, () => console.log(`[analyzer] watchdog up on :${PORT} (agency ${AGENCY_URL || "unset"}; thresholds from /telemetry config)`));

void pass();
setInterval(() => void pass(), INTERVAL_MS);
