// Tests for parsing `gh api --paginate` comment output (the detail-page conversation).
import test from "node:test";
import assert from "node:assert/strict";
import { parseGhCommentsJson } from "../dist/github.js";

test("single-page array parses", () => {
  const out = JSON.stringify([
    { id: 1, user: { login: "arne" }, body: "hi", created_at: "2026-01-01T00:00:00Z" },
  ]);
  const r = parseGhCommentsJson(out);
  assert.equal(r.length, 1);
  assert.equal(r[0].user.login, "arne");
});

test("concatenated pages from --paginate join into one flat array", () => {
  const page1 = JSON.stringify([{ id: 1, body: "a" }, { id: 2, body: "b" }]);
  const page2 = JSON.stringify([{ id: 3, body: "c" }]);
  const r = parseGhCommentsJson(page1 + page2); // "[...][...]"
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((c) => c.id), [1, 2, 3]);
});

test("whitespace between concatenated pages is tolerated", () => {
  const r = parseGhCommentsJson('[{"id":1}]\n[{"id":2}]');
  assert.equal(r.length, 2);
});

test("empty / blank output yields no comments (no throw)", () => {
  assert.deepEqual(parseGhCommentsJson(""), []);
  assert.deepEqual(parseGhCommentsJson("   \n  "), []);
});

test("NDJSON stream fallback parses line-by-line", () => {
  const r = parseGhCommentsJson('{"id":1}\n{"id":2}\n{"id":3}');
  assert.equal(r.length, 3);
});

test("garbage is ignored rather than throwing", () => {
  assert.deepEqual(parseGhCommentsJson("not json at all"), []);
});
