// Planner file-footprint declarations: FILES: line + per-sub-issue {files: ...} annotations.
import test from "node:test";
import assert from "node:assert/strict";
import { parseFileList, parseSubIssues } from "../dist/pipeline.js";

test("parseFileList reads a FILES: line", () => {
  assert.deepEqual(parseFileList("blah\nFILES: src/a.ts, web/app.js\nmore"), ["src/a.ts", "web/app.js"]);
});

test("parseFileList reads a {files: ...} annotation and ignores prose", () => {
  assert.deepEqual(parseFileList("do the thing {files: src/x.ts web/board.js}"), ["src/x.ts", "web/board.js"]);
});

test("parseFileList returns [] when nothing declared", () => {
  assert.deepEqual(parseFileList("just a description with no files"), []);
});

test("sub-issues carry per-child file footprints, stripped from the body", () => {
  const plan = [
    "PLAN",
    "### SUB-ISSUES",
    "- [Board tweak] @dev update the kanban {files: web/board.js}",
    "- [Store change] @dev add a column {files: src/store.ts, src/webhook.ts}",
    "- [No files] @dev a task with no declared files",
  ].join("\n");
  const subs = parseSubIssues(plan);
  assert.equal(subs.length, 3);
  assert.deepEqual(subs[0].files, ["web/board.js"]);
  assert.ok(!subs[0].body.includes("files:"), "annotation stripped from body");
  assert.deepEqual(subs[1].files, ["src/store.ts", "src/webhook.ts"]);
  assert.deepEqual(subs[2].files, []);
});

test("parseSubIssues extracts the optional {agent}/{workflow} route recommendation", () => {
  const plan = [
    "### SUB-ISSUES",
    "- [API] Build the endpoint {files: src/api.ts} {agent: @dev}",
    "- [Big piece] Multi-step feature {workflow: @build}",
    "- [Plain] No route recommended",
  ].join("\n");
  const subs = parseSubIssues(plan);
  assert.equal(subs.length, 3);
  assert.equal(subs[0].route, "@dev");
  assert.deepEqual(subs[0].files, ["src/api.ts"]);
  assert.ok(!subs[0].body.includes("{agent"), "route annotation stripped from the body");
  assert.equal(subs[1].route, "@build");
  assert.equal(subs[2].route, undefined);
});
