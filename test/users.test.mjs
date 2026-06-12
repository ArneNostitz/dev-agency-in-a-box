import test from "node:test";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "dadb-")), "test.db");
const s = await import("../dist/store.js");

test("users: create, authenticate, count", () => {
  assert.equal(s.countUsers(), 0);
  const admin = s.createUser("arne", "hunter2", "admin", "arne@x.com");
  assert.ok(admin && admin.id > 0);
  assert.equal(admin.role, "admin");
  assert.equal(s.countUsers(), 1);
  assert.equal(s.createUser("arne", "again"), null, "duplicate username rejected");
  assert.ok(s.authenticate("arne", "hunter2"), "correct password authenticates");
  assert.equal(s.authenticate("arne", "wrong"), null, "wrong password rejected");
});

test("password reset: find by name/email, single-use token, expiry", () => {
  const u = s.getUserByName("arne");
  assert.equal(s.getUserByNameOrEmail("arne@x.com")?.id, u.id, "found by email (case-insensitive)");
  assert.equal(s.getUserByNameOrEmail("ARNE@X.COM")?.id, u.id, "email match is case-insensitive");
  assert.equal(s.getUserByNameOrEmail("arne")?.id, u.id, "found by username");
  assert.equal(s.getUserByNameOrEmail("nobody"), null, "unknown identifier → null");

  const tok = s.createPasswordReset(u.id);
  assert.ok(tok && tok.length > 10);
  assert.equal(s.consumePasswordReset(tok), u.id, "valid token returns the user id");
  assert.equal(s.consumePasswordReset(tok), null, "token can't be reused");
  assert.equal(s.consumePasswordReset("bogus"), null, "unknown token → null");

  const expired = s.createPasswordReset(u.id, -1000); // already expired
  assert.equal(s.consumePasswordReset(expired), null, "expired token → null");
});

test("sessions: create, validate, revoke", () => {
  const u = s.getUserByName("arne");
  const tok = s.createSession(u.id, 30);
  assert.ok(tok && tok.length > 10);
  const su = s.getSessionUser(tok);
  assert.equal(su.username, "arne");
  s.revokeSession(tok);
  assert.equal(s.getSessionUser(tok), null, "revoked session is invalid");
});

test("invites: create, fetch, accept", () => {
  const u = s.getUserByName("arne");
  const tok = s.createInvite("friend@x.com", "member", u.id);
  const inv = s.getInvite(tok);
  assert.equal(inv.email, "friend@x.com");
  s.acceptInvite(tok);
  assert.equal(s.getInvite(tok), null, "accepted invite no longer redeemable");
});

test("per-user secrets are encrypted at rest and decryptable", () => {
  const u = s.getUserByName("arne");
  s.setUserSecret(u.id, "github_token", "gho_secret_123");
  assert.equal(s.getUserSecret(u.id, "github_token"), "gho_secret_123");
  assert.deepEqual(s.listUserSecretKeys(u.id), ["github_token"]);
  s.setUserSecret(u.id, "github_token", ""); // clear
  assert.equal(s.getUserSecret(u.id, "github_token"), null);
});
