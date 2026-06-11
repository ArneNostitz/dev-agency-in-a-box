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
