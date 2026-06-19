/**
 * GitHub OAuth Device Flow — the "click Authorize" login that replaces hand-made PATs (and the
 * separate bot account). One OAuth App's client_id is public, and the device flow needs no client
 * secret, so a single shipped/configured client_id lets every instance authenticate by just
 * authorizing on github.com. The resulting token acts as the connected account for everything the
 * agency does (commits, PRs, issues), so there's no second "bot" identity to invite.
 *
 * Scopes: `repo` (contents+issues+PRs on the user's repos), `workflow` (push workflow files),
 * `read:org` (list org repos in the picker).
 */
export const OAUTH_SCOPE = "repo workflow read:org";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/** GitHub's noreply email for an account — set as the commit author so commits attribute to it. */
export function noreplyEmail(id: number | string, login: string): string {
  return id ? `${id}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com`;
}

export type TokenPoll =
  | { status: "ok"; token: string }
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "error"; error: string };

/** Classify the device-token poll response (pure — the HTTP lives in pollDeviceToken). */
export function parseTokenResponse(j: Record<string, unknown>): TokenPoll {
  if (typeof j.access_token === "string" && j.access_token) return { status: "ok", token: j.access_token };
  const err = String(j.error || "");
  if (err === "authorization_pending") return { status: "pending" };
  if (err === "slow_down") return { status: "slow_down", interval: Number(j.interval) || 10 };
  if (err === "expired_token") return { status: "error", error: "The code expired — start again." };
  if (err === "access_denied") return { status: "error", error: "Authorization was denied." };
  return { status: "error", error: err || "Authorization failed." };
}

async function postJson(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Step 1: ask GitHub for a device + user code. */
export async function startDeviceFlow(clientId: string): Promise<DeviceStart> {
  const j = await postJson(DEVICE_CODE_URL, { client_id: clientId, scope: OAUTH_SCOPE });
  if (!j.device_code) throw new Error(String(j.error_description || j.error || "Couldn't start GitHub login"));
  return {
    device_code: String(j.device_code),
    user_code: String(j.user_code),
    verification_uri: String(j.verification_uri || "https://github.com/login/device"),
    expires_in: Number(j.expires_in) || 900,
    interval: Number(j.interval) || 5,
  };
}

/** Step 2: poll until the user authorizes (or it errors). */
export async function pollDeviceToken(clientId: string, deviceCode: string): Promise<TokenPoll> {
  const j = await postJson(TOKEN_URL, { client_id: clientId, device_code: deviceCode, grant_type: GRANT });
  return parseTokenResponse(j);
}

/** The authenticated account (for the connected-as label + commit attribution). */
export async function fetchGitHubUser(token: string): Promise<{ login: string; name: string; id: number }> {
  const r = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "dev-agency" },
  });
  if (!r.ok) throw new Error(`GitHub /user ${r.status}`);
  const j = (await r.json()) as { login?: string; name?: string; id?: number };
  return { login: j.login || "", name: j.name || j.login || "", id: Number(j.id) || 0 };
}
