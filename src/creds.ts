/**
 * Resolve the credentials the agency runs with. Interim single-identity model: the first admin's
 * encrypted, dashboard-stored secrets drive execution, falling back to env vars. (Becomes truly
 * per-user/per-repo with the rest of task 28.) Read live so setting a token in the dashboard takes
 * effect without a redeploy.
 */
import { listUsers, getUserSecret } from "./store.js";
import { sStr } from "./settings.js";

/**
 * No client id is shipped: each deployment registers its OWN GitHub OAuth App and sets the id in
 * Settings → GitHub (or via GITHUB_OAUTH_CLIENT_ID). This is what makes the GitHub "Authorize"
 * screen show the operator's OWN app/owner name instead of someone else's — and keeps every
 * instance on its own OAuth App, rate limits and control.
 */
export const DEFAULT_GITHUB_OAUTH_CLIENT_ID = "";

function agencyAdminId(): number | null {
  try {
    const admin = listUsers().find((u) => u.role === "admin");
    return admin ? admin.id : null;
  } catch {
    return null;
  }
}
function adminSecret(key: string): string | null {
  const id = agencyAdminId();
  return id ? getUserSecret(id, key) : null;
}

/** Single OAuth-device-flow token. When present it IS the bot AND the owner — no separate bot. */
export function githubOAuthToken(): string {
  return adminSecret("github_oauth_token") || process.env.GITHUB_OAUTH_TOKEN?.trim() || "";
}
/** The OAuth App client id for the device flow (public). Setting/env override the shipped default. */
export function githubOAuthClientId(): string {
  return sStr("github_oauth_client_id", "GITHUB_OAUTH_CLIENT_ID", DEFAULT_GITHUB_OAUTH_CLIENT_ID).trim();
}
/** The connected account, for the "connected as" label + commit attribution (author = its noreply). */
export function githubIdentity(): { login: string; name: string; id: string } | null {
  const login = sStr("github_user_login", "", "").trim();
  if (!login) return null;
  return { login, name: sStr("github_user_name", "", login).trim() || login, id: sStr("github_user_id", "", "").trim() };
}
/** Bot token for the agency's own GitHub actions (commits, PRs, labels). OAuth token wins. */
export function ghBotToken(): string {
  return githubOAuthToken() || adminSecret("github_bot_token") || process.env.GITHUB_TOKEN?.trim() || "";
}
/** "Acts as you" owner token. With OAuth the single token is both — falls back to a separate PAT. */
export function ghUserToken(): string {
  return githubOAuthToken() || adminSecret("github_user_token") || process.env.ADMIN_GITHUB_TOKEN?.trim() || "";
}
/** Claude subscription token for the Agent SDK (subscription auth). */
export function claudeToken(): string {
  return adminSecret("claude_token") || process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || "";
}
/** Anthropic pay-as-you-go API key (alternative to the subscription token). */
export function anthropicApiKey(): string {
  return adminSecret("anthropic_api_key") || process.env.ANTHROPIC_API_KEY?.trim() || "";
}
export function ghOwner(): string {
  return sStr("github_owner", "GITHUB_OWNER", "");
}
/** True once we have a GitHub token to act with — gates all GitHub work + scanning. */
export function githubReady(): boolean {
  return Boolean(ghBotToken());
}
