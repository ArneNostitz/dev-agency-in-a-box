/**
 * Classify how a selected provider authenticates, so a run picks the right credential.
 *
 * Two kinds of provider:
 *   - A pi provider carries its own `apiKey` + a `piKey` (pi's built-in provider name). Auth = "apiKey".
 *   - Claude-native (no provider, or one with no key/piKey) authenticates via the saved Claude
 *     subscription token / Anthropic API key → "subscription", or "missing" if none is saved.
 *
 * This is the single place that decides which is which, used by resolveRoute() and the preflight.
 */
export interface ProviderShape {
  piKey?: string;
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
  // A pi provider brings its own key + a piKey (or, for legacy rows, a baseUrl we infer from).
  if (p && p.apiKey && (p.piKey || p.baseUrl)) return "apiKey";
  // Claude-native: no provider key, and either no piKey/baseUrl or the Anthropic endpoint → the
  // subscription token (or Anthropic API key) is the credential.
  const claudeNative = !p || (!p.apiKey && (!p.piKey && (!p.baseUrl || ANTHROPIC_HOST.test(p.baseUrl))));
  if (claudeNative) return hasClaudeCred ? "subscription" : "missing";
  // Has a piKey/baseUrl but no key (half-configured) → can't run.
  return "missing";
}
