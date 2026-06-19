/**
 * Classify how a selected provider authenticates, so a run picks the right credential.
 *
 * A "Claude (Subscription)" / Claude-native provider has NO apiKey of its own — it authenticates
 * via the stored Claude OAuth token (or the Anthropic API key), not provider.apiKey. Third-party
 * Anthropic-compatible providers (GLM, DeepSeek, Kimi, …) carry their own apiKey + baseUrl. This
 * is the single place that decides which is which, used by both resolveRoute() and the preflight.
 */
export interface ProviderShape {
  baseUrl?: string;
  apiKey?: string;
}
export type ProviderAuth = "subscription" | "apiKey" | "missing";

const ANTHROPIC_HOST = /(^|\/\/)(api\.)?anthropic\.com(\/|$)/i;

/**
 * @param p             the selected provider row (null/undefined = the implicit Claude default)
 * @param hasClaudeCred whether a Claude subscription token or Anthropic API key is saved
 */
export function providerAuth(p: ProviderShape | null | undefined, hasClaudeCred: boolean): ProviderAuth {
  // A real third-party provider brings BOTH its own key and endpoint.
  if (p && p.apiKey && p.baseUrl) return "apiKey";
  // Claude-native: no provider key, and either no endpoint or the Anthropic endpoint → the
  // subscription token (or Anthropic API key) is the credential.
  const claudeNative = !p || (!p.apiKey && (!p.baseUrl || ANTHROPIC_HOST.test(p.baseUrl)));
  if (claudeNative) return hasClaudeCred ? "subscription" : "missing";
  // Has a baseUrl but no key (or other half-configured combo) → can't run.
  return "missing";
}
