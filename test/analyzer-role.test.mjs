// runAnalyzerPrompt (the Process Analyzer's one-shot, no-repo LLM call — POST /analyzer-run in
// webhook.ts) fails loud instead of silently defaulting when nothing is configured for the
// "analyzer" role, exactly like every other role's resolution path.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-analyzer-role-")), "test.db");
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { runAnalyzerPrompt } = await import("../dist/agents/roleAgent.js");
const { ROLES, ALL_ROLES } = await import("../dist/agents/roles.js");

test("analyzer is a real role: declared in ROLES and ALL_ROLES", () => {
  assert.ok(ROLES.analyzer, "ROLES.analyzer exists");
  assert.equal(ROLES.analyzer.personaFile, "analyzer");
  assert.ok(ALL_ROLES.includes("analyzer"), "surfaces in Settings → Models like every other role");
});

test("runAnalyzerPrompt fails loud (no silent fallback) when no model/credential is configured", async () => {
  await assert.rejects(
    () => runAnalyzerPrompt("analyze this"),
    /No model is set up for the Analyzer role/,
  );
});
