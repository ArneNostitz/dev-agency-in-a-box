/**
 * Encryption + password hashing for multi-user mode.
 *
 * - Secrets at rest (GitHub tokens, Claude subscription token, LLM API keys) are encrypted with
 *   AES-256-GCM using a single server-held MASTER_KEY (env). The server can decrypt them on its
 *   own so the agency keeps running autonomously in the background on a user's behalf.
 * - Passwords are hashed with scrypt (salted, constant-time compare). Never stored in plaintext.
 *
 * MASTER_KEY: a 64-char hex string (32 bytes) is used directly; any other string is hashed to a
 * 32-byte key. Generate one with:  openssl rand -hex 32
 */
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, createHash, timingSafeEqual } from "node:crypto";

function masterKey(): Buffer {
  const k = process.env.MASTER_KEY?.trim();
  if (!k) throw new Error("MASTER_KEY is not set — required for multi-user mode (openssl rand -hex 32)");
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, "hex");
  return createHash("sha256").update(k).digest();
}

/** True if a usable MASTER_KEY is configured (so we can enable/disable encrypted features safely). */
export function masterKeyConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a UTF-8 secret → "v1:" + base64(iv|tag|ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v1:" + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a value produced by encryptSecret. Throws if tampered or wrong key. */
export function decryptSecret(enc: string): string {
  if (!enc || !enc.startsWith("v1:")) throw new Error("not an encrypted secret");
  const raw = Buffer.from(enc.slice(3), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Try to decrypt; return null instead of throwing (e.g. key rotated, corrupt row). */
export function tryDecrypt(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

/** Hash a password → "scrypt$<saltHex>$<hashHex>". */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(pw, salt, 32);
  return "scrypt$" + salt.toString("hex") + "$" + dk.toString("hex");
}

/** Constant-time verify a password against a stored scrypt hash. */
export function verifyPassword(pw: string, stored: string): boolean {
  const parts = (stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let dk: Buffer;
  try {
    dk = scryptSync(pw, salt, expected.length);
  } catch {
    return false;
  }
  return expected.length === dk.length && timingSafeEqual(expected, dk);
}

/** A URL-safe random token (sessions, invites). */
export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
