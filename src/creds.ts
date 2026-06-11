/**
 * Resolve the credentials the agency runs with. Interim single-identity model: the first admin's
 * encrypted, dashboard-stored secrets drive execution, falling back to env vars. (Becomes truly
 * per-user/per-repo with the rest of task 28.) Read live so setting a token in the dashboard takes
 * effect without a redeploy.
 */
import { listUsers, getUserSecret } from "./store.js";
import { sStr } from "./settings.js";

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

/** Bot token for the agency's own GitHub actions (commits, PRs, labels). */
export function ghBotToken(): string {
  return adminSecret("github_bot_token") || process.env.GITHUB_TOKEN?.trim() || "";
}
/** "Acts as you" owner token (comment/create issues under the human's account, invite the bot). */
export function ghUserToken(): string {
  return adminSecret("github_user_token") || process.env.ADMIN_GITHUB_TOKEN?.trim() || "";
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
