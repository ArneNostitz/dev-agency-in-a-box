// Static brand/persona data — pure data, no imports.
//
// PROVIDER_LOGOS: maps a provider/model name to its colored SVG (vendored under /web/logos from
//   @lobehub/icons-static-svg, MIT). ProviderLogo renders it as an <img>, falling back to a
//   generic icon for anything we don't have a logo for.
//
// Avatar persona maps: one avatar file per role (a mixed-gender team). Swap a value to change who
//   represents a role. These are still consumed by core.js (Avatar / roleFromComment / commentBadge)
//   until those are extracted; exported here so the eventual Avatar.js / ProviderLogo.js can import
//   them.

// Real provider/brand logos (@lobehub/icons-static-svg, MIT) vendored under /web/logos.
export const PROVIDER_LOGOS = [
  [/claude|anthropic/i, "claude-color"],
  [/zhipu|chatglm|\bglm\b/i, "chatglm-color"],
  [/deepseek/i, "deepseek-color"],
  [/kimi|moonshot/i, "kimi-color"],
  [/gemini|google/i, "gemini-color"],
  [/mistral/i, "mistral-color"],
  [/qwen/i, "qwen-color"],
  [/openai|gpt|custom/i, "openai"],
];

// ---------- agent persona avatars ----------
// One avatar file per role (a mixed-gender team). Swap a value to change who represents a role.
export const ROLE_AVATAR = { planner: "planner-f", plan: "planner-f", decomposer: "auditor", architect: "architect", arch: "architect", developer: "developer-f", dev: "developer-f", coder: "developer-f", reviewer: "reviewer", review: "reviewer", tester: "tester", test: "tester", librarian: "librarian-f", auditor: "auditor" };
export const ROLE_WORDS = ["planner", "decomposer", "architect", "developer", "reviewer", "tester", "librarian", "auditor"];
// crop="head" → the dedicated head-only SVG (dashboard); "full" → the whole figure (detail comments).
// Full pool of persona art (heads + full). Unknown agents get a STABLE distinct one from the pool
// (so every custom/chat agent has its own face), with a couple of fitting named picks.
export const AVATAR_POOL = ["planner", "planner-f", "architect", "reviewer", "reviewer-f", "tester", "tester-f", "developer", "developer-f", "librarian", "librarian-f", "auditor", "auditor-f"];
export const NAMED_AVATAR = { "grill-me": "auditor", grill: "auditor", "spec-creator": "librarian", spec: "librarian" };
// Role badge emoji for an agency comment, rendered inline in the comment header.
export const ROLE_EMOJI = { planner: "🧠", architect: "🏛", developer: "💻", reviewer: "🔍", tester: "🧪", librarian: "📚", auditor: "🔎" };
