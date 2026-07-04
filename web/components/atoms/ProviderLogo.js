// Real provider/brand logos (@lobehub/icons-static-svg, MIT) vendored under /web/logos. Maps a
// provider/model name to its colored SVG; ProviderLogo renders it as an <img>, falling back to a
// generic icon for anything we don't have a logo for.
import { html } from "/web/vendor/standalone.mjs";
import { Icon } from "./Icon.js";

const PROVIDER_LOGOS = [
  [/claude|anthropic/i, "claude-color"],
  [/zhipu|chatglm|\bglm\b/i, "chatglm-color"],
  [/deepseek/i, "deepseek-color"],
  [/kimi|moonshot/i, "kimi-color"],
  [/gemini|google/i, "gemini-color"],
  [/mistral/i, "mistral-color"],
  [/qwen/i, "qwen-color"],
  [/openai|gpt|custom/i, "openai"],
];

export function providerLogoSrc(name) {
  const n = String(name || "");
  for (const [re, file] of PROVIDER_LOGOS) if (re.test(n)) return "/web/logos/" + file + ".svg";
  return null;
}

export function ProviderLogo({ name, size = 16 }) {
  const src = providerLogoSrc(name);
  return src
    ? html`<img class="plogo" src=${src} width=${size} height=${size} alt=${name || "model"} loading="lazy"/>`
    : html`<${Icon} name="flask" size=${size}/>`;
}
