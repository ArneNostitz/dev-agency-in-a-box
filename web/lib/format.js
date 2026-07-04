// Formatting helpers — pure functions, no dependencies.

export function ago(iso) {
  if (!iso) return "";
  let s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.floor(s) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

export function hm(d) {
  try { return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; }
}

export function fmtTok(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return "" + n;
}

export function shortModel(m) {
  if (!m) return "?";
  const s = String(m);
  if (/opus/i.test(s)) return "Opus";
  if (/sonnet/i.test(s)) return "Sonnet";
  if (/haiku/i.test(s)) return "Haiku";
  if (/gemini/i.test(s)) return "Gemini";
  if (/deepseek/i.test(s)) return "DeepSeek";
  if (/glm/i.test(s)) return "GLM";
  if (/kimi/i.test(s)) return "Kimi";
  return s.replace(/^claude-/, "");
}

export function cap(s) {
  const t = String(s || "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export function usageTitle(u) {
  if (!u || !u.tokens) return "No token usage recorded yet";
  // Tokens are the universal, provider-neutral unit. We deliberately don't show $ — cost varies wildly
  // by provider/model and is $0 on subscription auth, so a dollar figure here was misleading.
  return `${fmtTok(u.tokens)} tokens${u.model ? " · " + shortModel(u.model) : ""} · ${u.runs || 0} runs`;
}

// Heat bar driven by TOKENS (not cost). Fills toward a heavy-issue reference; amber past ~60%, red
// past it — a quick "how much has this burned" glance without any provider-specific dollar figure.
export const TOK_HEAT_REF = 500000;

export function tokHeat(i) {
  const tokens = (i && i.usage && i.usage.tokens) || 0;
  const ratio = tokens / TOK_HEAT_REF;
  const pct = tokens ? Math.max(4, Math.min(100, Math.round(ratio * 100))) : 0;
  const color = ratio >= 1 ? "var(--red)" : ratio >= 0.6 ? "var(--amber)" : "var(--green)";
  return { tokens, pct, color, over: ratio >= 1 };
}
