import test from "node:test";
import assert from "node:assert/strict";
import { parseTokenResponse, noreplyEmail, OAUTH_SCOPE } from "../dist/github-oauth.js";

test("parseTokenResponse classifies the device-flow states", () => {
  assert.deepEqual(parseTokenResponse({ access_token: "gho_abc" }), { status: "ok", token: "gho_abc" });
  assert.deepEqual(parseTokenResponse({ error: "authorization_pending" }), { status: "pending" });
  assert.deepEqual(parseTokenResponse({ error: "slow_down", interval: 15 }), { status: "slow_down", interval: 15 });
  assert.equal(parseTokenResponse({ error: "expired_token" }).status, "error");
  assert.equal(parseTokenResponse({ error: "access_denied" }).status, "error");
  assert.equal(parseTokenResponse({}).status, "error");
});

test("noreplyEmail builds the GitHub commit-attribution address", () => {
  assert.equal(noreplyEmail(12345, "octocat"), "12345+octocat@users.noreply.github.com");
  assert.equal(noreplyEmail(0, "octocat"), "octocat@users.noreply.github.com");
});

test("scope covers repo + workflow + org read", () => {
  assert.ok(OAUTH_SCOPE.includes("repo") && OAUTH_SCOPE.includes("workflow") && OAUTH_SCOPE.includes("read:org"));
});
