// Unit tests for issueDetail comment classification logic.
// Imports the real mapIssueDetail() from github.ts (via dist/) to ensure the test
// stays in sync with the implementation — same pattern as logic.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { AGENCY_MARKER, mapIssueDetail } from "../dist/github.js";

test("issueDetail: human/agency comment classification via AGENCY_MARKER", () => {
  const raw = {
    labels: [{ name: "agency:in-progress" }, { name: "bug" }],
    comments: [
      { body: "Hello from a human", createdAt: "2024-01-01T10:00:00Z" },
      { body: `Agency reply here\n\n${AGENCY_MARKER}`, createdAt: "2024-01-01T11:00:00Z" },
      { body: "Another human message", createdAt: "2024-01-01T12:00:00Z" },
    ],
  };

  const detail = mapIssueDetail(raw);

  assert.deepEqual(detail.labels, ["agency:in-progress", "bug"]);
  assert.equal(detail.comments.length, 3);

  assert.equal(detail.comments[0].who, "human");
  assert.equal(detail.comments[0].body, "Hello from a human");
  assert.equal(detail.comments[0].createdAt, "2024-01-01T10:00:00Z");

  assert.equal(detail.comments[1].who, "agency");
  // AGENCY_MARKER must be stripped from the body
  assert.ok(!detail.comments[1].body.includes("dev-agency"), "AGENCY_MARKER stripped");
  assert.equal(detail.comments[1].body, "Agency reply here");

  assert.equal(detail.comments[2].who, "human");
});

test("issueDetail: empty labels and comments return empty arrays", () => {
  const detail = mapIssueDetail({ labels: [], comments: [] });
  assert.deepEqual(detail, { labels: [], comments: [] });
});

test("issueDetail: missing labels/comments fields handled gracefully", () => {
  const detail = mapIssueDetail({});
  assert.deepEqual(detail, { labels: [], comments: [] });
});
