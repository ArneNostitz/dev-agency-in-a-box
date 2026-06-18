/**
 * The users aggregate — accounts, sessions, invites, password resets, and per-user encrypted
 * secrets. Extracted from store.ts (Candidate 3, #70). Self-contained: depends on the
 * connection (getDb) and crypto, and calls nothing outside this module.
 */
import { getDb } from "./connection.js";
import { hashPassword, verifyPassword, newToken, encryptSecret, tryDecrypt } from "../crypto.js";

export interface User {
  id: number;
  username: string;
  email: string | null;
  role: string;
  created_at: string;
}
export type UserRow = User & { password_hash: string };

export function countUsers(): number {
  const d = getDb();
  if (!d) return 0;
  try {
    return (d.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  } catch {
    return 0;
  }
}
export function getUserByName(username: string): UserRow | null {
  const d = getDb();
  if (!d) return null;
  try {
    return (d.prepare(`SELECT id, username, email, role, created_at, password_hash FROM users WHERE username = ?`).get(username) as unknown as UserRow) ?? null;
  } catch {
    return null;
  }
}
/** Find a user by username OR email (case-insensitive email) — for "forgot password". */
export function getUserByNameOrEmail(identifier: string): UserRow | null {
  const d = getDb();
  if (!d || !identifier) return null;
  try {
    return (
      (d
        .prepare(
          `SELECT id, username, email, role, created_at, password_hash FROM users
           WHERE username = ? OR lower(email) = lower(?) LIMIT 1`,
        )
        .get(identifier, identifier) as unknown as UserRow) ?? null
    );
  } catch {
    return null;
  }
}
/** Create a single-use password-reset token (default 1h expiry). Returns the token. */
export function createPasswordReset(userId: number, ttlMs = 3_600_000): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const token = newToken(24);
    d.prepare(`INSERT INTO password_resets (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)`).run(
      token, userId, new Date(Date.now() + ttlMs).toISOString(),
    );
    return token;
  } catch {
    return null;
  }
}
/** Consume a reset token: returns the user id if valid+unused+unexpired (and marks it used), else null. */
export function consumePasswordReset(token: string): number | null {
  const d = getDb();
  if (!d || !token) return null;
  try {
    const row = d.prepare(`SELECT user_id, expires_at, used FROM password_resets WHERE token = ?`).get(token) as
      | { user_id: number; expires_at: string; used: number }
      | undefined;
    if (!row || row.used || (row.expires_at && Date.parse(row.expires_at) < Date.now())) return null;
    d.prepare(`UPDATE password_resets SET used = 1 WHERE token = ?`).run(token);
    return row.user_id;
  } catch {
    return null;
  }
}
export function getUserById(id: number): User | null {
  const d = getDb();
  if (!d) return null;
  try {
    return (d.prepare(`SELECT id, username, email, role, created_at FROM users WHERE id = ?`).get(id) as unknown as User) ?? null;
  } catch {
    return null;
  }
}
export function listUsers(): User[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d.prepare(`SELECT id, username, email, role, created_at FROM users ORDER BY id`).all() as unknown as User[];
  } catch {
    return [];
  }
}
export function createUser(username: string, password: string, role = "member", email: string | null = null): User | null {
  const d = getDb();
  if (!d) return null;
  try {
    const info = d.prepare(`INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      username, email, hashPassword(password), role, new Date().toISOString(),
    );
    return getUserById(Number(info.lastInsertRowid));
  } catch {
    return null; // likely UNIQUE(username) conflict
  }
}
export function setUserPassword(id: number, password: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), id);
  } catch {
    /* ignore */
  }
}
/** Verify credentials; returns the user (without hash) on success, else null. */
export function authenticate(username: string, password: string): User | null {
  const u = getUserByName(username);
  if (!u || !verifyPassword(password, u.password_hash)) return null;
  return { id: u.id, username: u.username, email: u.email, role: u.role, created_at: u.created_at };
}

export function createSession(userId: number, days = 30): string {
  const d = getDb();
  const token = newToken(24);
  if (!d) return token;
  try {
    const now = Date.now();
    d.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(
      token, userId, new Date(now).toISOString(), new Date(now + days * 86400_000).toISOString(),
    );
  } catch {
    /* ignore */
  }
  return token;
}
export function getSessionUser(token: string): User | null {
  const d = getDb();
  if (!d || !token) return null;
  try {
    const row = d.prepare(`SELECT user_id, expires_at FROM sessions WHERE token = ?`).get(token) as { user_id: number; expires_at: string } | undefined;
    if (!row) return null;
    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
      d.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
      return null;
    }
    return getUserById(row.user_id);
  } catch {
    return null;
  }
}
export function revokeSession(token: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  } catch {
    /* ignore */
  }
}

export function createInvite(email: string | null, role: string, createdBy: number): string {
  const d = getDb();
  const token = newToken(18);
  if (!d) return token;
  try {
    d.prepare(`INSERT INTO invites (token, email, role, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      token, email, role, createdBy, new Date().toISOString(),
    );
  } catch {
    /* ignore */
  }
  return token;
}
export function getInvite(token: string): { token: string; email: string | null; role: string } | null {
  const d = getDb();
  if (!d || !token) return null;
  try {
    const r = d.prepare(`SELECT token, email, role FROM invites WHERE token = ? AND accepted_at IS NULL`).get(token) as
      | { token: string; email: string | null; role: string }
      | undefined;
    return r ?? null;
  } catch {
    return null;
  }
}
export function acceptInvite(token: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`UPDATE invites SET accepted_at = ? WHERE token = ?`).run(new Date().toISOString(), token);
  } catch {
    /* ignore */
  }
}
export function listInvites(): Array<{ token: string; email: string | null; role: string; created_at: string; accepted: boolean }> {
  const d = getDb();
  if (!d) return [];
  try {
    return (d.prepare(`SELECT token, email, role, created_at, accepted_at FROM invites ORDER BY created_at DESC`).all() as Array<{ token: string; email: string | null; role: string; created_at: string; accepted_at: string | null }>).map(
      (r) => ({ token: r.token, email: r.email, role: r.role, created_at: r.created_at, accepted: Boolean(r.accepted_at) }),
    );
  } catch {
    return [];
  }
}

/** Store a per-user secret, encrypted at rest. Empty value clears it. */
export function setUserSecret(userId: number, key: string, plaintext: string): void {
  const d = getDb();
  if (!d) return;
  try {
    if (!plaintext) {
      d.prepare(`DELETE FROM user_secrets WHERE user_id = ? AND key = ?`).run(userId, key);
      return;
    }
    d.prepare(`INSERT INTO user_secrets (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(
      userId, key, encryptSecret(plaintext), new Date().toISOString(),
    );
  } catch {
    /* ignore */
  }
}
/** Decrypt and return a per-user secret, or null if unset/undecryptable. */
export function getUserSecret(userId: number, key: string): string | null {
  const d = getDb();
  if (!d) return null;
  try {
    const r = d.prepare(`SELECT value FROM user_secrets WHERE user_id = ? AND key = ?`).get(userId, key) as { value: string } | undefined;
    return r ? tryDecrypt(r.value) : null;
  } catch {
    return null;
  }
}
/**
 * Health of a stored secret: "unset" (nothing saved), "ok" (decrypts), or "undecryptable" (a row
 * exists but the MASTER_KEY can't decrypt it — usually the key changed since it was saved). The
 * last case is the silent cause of 401s, so the dashboard surfaces it.
 */
export function getUserSecretStatus(userId: number, key: string): "unset" | "ok" | "undecryptable" {
  const d = getDb();
  if (!d) return "unset";
  try {
    const r = d.prepare(`SELECT value FROM user_secrets WHERE user_id = ? AND key = ?`).get(userId, key) as { value: string } | undefined;
    if (!r || !r.value) return "unset";
    return tryDecrypt(r.value) == null ? "undecryptable" : "ok";
  } catch {
    return "unset";
  }
}
/** Which secret keys this user has set (names only — never the values). */
export function listUserSecretKeys(userId: number): string[] {
  const d = getDb();
  if (!d) return [];
  try {
    return (d.prepare(`SELECT key FROM user_secrets WHERE user_id = ? AND value IS NOT NULL`).all(userId) as Array<{ key: string }>).map((r) => r.key);
  } catch {
    return [];
  }
}
