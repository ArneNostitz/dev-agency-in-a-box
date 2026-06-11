import test from "node:test";
import assert from "node:assert";

process.env.MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { encryptSecret, decryptSecret, tryDecrypt, hashPassword, verifyPassword, newToken, masterKeyConfigured } = await import("../dist/crypto.js");

test("master key is configured in the test", () => {
  assert.equal(masterKeyConfigured(), true);
});

test("encrypt/decrypt round-trips and is non-deterministic", () => {
  const secret = "gho_supersecrettoken_ABC123";
  const a = encryptSecret(secret);
  const b = encryptSecret(secret);
  assert.notEqual(a, b, "same plaintext encrypts to different ciphertext (random IV)");
  assert.match(a, /^v1:/);
  assert.equal(decryptSecret(a), secret);
  assert.equal(decryptSecret(b), secret);
});

test("tampered ciphertext fails to decrypt", () => {
  const enc = encryptSecret("hello");
  const tampered = enc.slice(0, -2) + (enc.slice(-2) === "AA" ? "BB" : "AA");
  assert.equal(tryDecrypt(tampered), null);
});

test("password hashing verifies correctly and rejects wrong passwords", () => {
  const h = hashPassword("correct horse battery staple");
  assert.match(h, /^scrypt\$/);
  assert.equal(verifyPassword("correct horse battery staple", h), true);
  assert.equal(verifyPassword("wrong", h), false);
  assert.equal(verifyPassword("", h), false);
});

test("tokens are unique and url-safe", () => {
  const a = newToken(), b = newToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});
