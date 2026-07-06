// Full-build approve wiring (#152): the full-build workflow must LEAD as "developer" so
// runPipeline routes into runDeveloperPipeline (plan → approve → build). Leading as "planner"
// routed it into the solo-planner conversational flow, which re-planned and re-parked on every
// Approve and never handed over to the dev.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-fba-")), "test.db");

const { workflowLeadRole } = await import("../dist/workflow.js");
const { getWorkflow, seedWorkflows, setSetting, getSetting } = await import("../dist/store.js");
const { isApproval } = await import("../dist/pipeline.js");

test("full-build leads as developer (routes to runDeveloperPipeline)", () => {
  seedWorkflows();
  const wf = getWorkflow("full-build");
  assert.ok(wf, "full-build workflow exists");
  assert.equal(workflowLeadRole(wf), "developer");
});

test("plan-only still leads as planner; review-only as reviewer", () => {
  const planOnly = getWorkflow("plan-only");
  const reviewOnly = getWorkflow("review-only");
  if (planOnly) assert.equal(workflowLeadRole(planOnly), "planner");
  if (reviewOnly) assert.equal(workflowLeadRole(reviewOnly), "reviewer");
});

test("dashboard approval flag is a plain setting the gates can peek", () => {
  // The pipeline gates peek `issue_approved.<repo>#<n>` because the Approve button moves the card
  // to "working" (erasing the awaitingApproval blocked reason) before the run starts.
  setSetting("issue_approved.o/r#7", "1");
  assert.equal(getSetting("issue_approved.o/r#7"), "1");
  setSetting("issue_approved.o/r#7", "");
  assert.equal(getSetting("issue_approved.o/r#7") || "", "");
});

test("isApproval accepts a short human ok and rejects agency-last threads", () => {
  assert.equal(isApproval("[human] ok"), true);
  assert.equal(isApproval("[human] plan it\n\n---\n\n[agency] proposal"), false);
  assert.equal(isApproval("[human] looks wrong, change X"), false);
});
