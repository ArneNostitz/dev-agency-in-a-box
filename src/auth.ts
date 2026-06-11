/**
 * Session-cookie auth for multi-user mode. Enabled automatically when MASTER_KEY is configured
 * (so secrets can be encrypted). When it's off, the server falls back to the legacy HTTP Basic
 * Auth so existing single-user deployments keep working until they opt in.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { countUsers, createUser, getSessionUser, getUserByName, listUsers, setUserPassword, type User } from "./store.js";
import { masterKeyConfigured } from "./crypto.js";

/** Constant-time check that a submitted recovery key equals the server's MASTER_KEY. */
export function verifyRecoveryKey(key: string): boolean {
  const mk = process.env.MASTER_KEY?.trim();
  if (!mk || !key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(mk);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SESSION_COOKIE = "da_session";

/** Multi-user mode is on when we can encrypt secrets at rest. */
export function authEnabled(): boolean {
  return masterKeyConfigured();
}

/**
 * Optional: seed the admin from env on first boot. If ADMIN_PASSWORD is unset, that's fine —
 * the first visitor creates the admin in-browser via the /setup screen instead.
 */
export function seedAdmin(): void {
  if (!authEnabled() || countUsers() > 0) return;
  const password = process.env.ADMIN_PASSWORD?.trim() || process.env.DASHBOARD_PASSWORD?.trim();
  if (!password) {
    console.log("[agency] multi-user on, no admin yet — create the admin in-browser on first visit.");
    return;
  }
  const username = process.env.ADMIN_USERNAME?.trim() || "admin";
  const u = createUser(username, password, "admin", process.env.ADMIN_EMAIL?.trim() || null);
  if (u) console.log(`[agency] seeded admin account "${username}" (change the password after first login)`);
}

/**
 * Forgot-password recovery for a self-hosted instance: set RESET_ADMIN_PASSWORD in env and
 * redeploy — on boot it resets the admin account's password to that value. Remove the env var
 * afterwards (otherwise every redeploy re-resets it). Targets ADMIN_USERNAME if set, else the
 * first admin user.
 */
export function resetAdminPassword(): void {
  const np = process.env.RESET_ADMIN_PASSWORD?.trim();
  if (!authEnabled() || !np) return;
  const username = process.env.ADMIN_USERNAME?.trim();
  const user = (username ? getUserByName(username) : null) || listUsers().find((u) => u.role === "admin");
  if (!user) {
    console.warn("[agency] RESET_ADMIN_PASSWORD set but no admin user found.");
    return;
  }
  setUserPassword(user.id, np);
  console.warn(`[agency] RESET_ADMIN_PASSWORD applied — password reset for "${user.username}". REMOVE this env var now.`);
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = (req.headers["cookie"] as string) || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function userFromReq(req: IncomingMessage): User | null {
  const token = parseCookies(req)[SESSION_COOKIE];
  return token ? getSessionUser(token) : null;
}

function isHttps(req: IncomingMessage): boolean {
  return (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() === "https";
}

export function setSessionCookie(req: IncomingMessage, res: ServerResponse, token: string): void {
  const secure = isHttps(req) ? "; Secure" : "";
  res.setHeader("set-cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`);
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
