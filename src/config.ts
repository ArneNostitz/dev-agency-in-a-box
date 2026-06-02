/**
 * Central configuration, read from environment variables.
 * Loaded via `node --env-file=.env` (see package.json scripts).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

export interface Config {
  /** Optional. If unset, the Agent SDK uses your Claude Code subscription login. */
  anthropicApiKey?: string;
  githubToken: string;
  owner: string;
  /** Full "owner/name" of the repo the agency operates on. */
  targetRepo: string;
  queueLabel: string;
  model?: string;
  /** "once" = process one issue and exit; "watch" = loop forever polling. */
  runMode: "once" | "watch";
  /** Seconds between polls in watch mode. */
  pollIntervalSeconds: number;
}

export function loadConfig(): Config {
  const owner = required("GITHUB_OWNER");
  const rawRepo = required("TARGET_REPO");
  // Accept either "name" or "owner/name".
  const targetRepo = rawRepo.includes("/") ? rawRepo : `${owner}/${rawRepo}`;

  const cfg: Config = {
    // Optional: provide an API key for pay-as-you-go, OR leave it unset and log in
    // with your Claude subscription via Claude Code (the SDK reuses those credentials).
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    githubToken: required("GITHUB_TOKEN"),
    owner,
    targetRepo,
    queueLabel: optional("QUEUE_LABEL", "agency:queue"),
    model: process.env.AGENT_MODEL?.trim() || undefined,
    runMode: process.env.RUN_MODE?.trim() === "watch" ? "watch" : "once",
    pollIntervalSeconds: Math.max(10, Number(optional("POLL_INTERVAL_SECONDS", "60")) || 60),
  };

  // Report which auth mode is in effect so it's never a mystery.
  if (cfg.anthropicApiKey) {
    console.log("[agency] auth: ANTHROPIC_API_KEY (pay-as-you-go)");
  } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    console.log("[agency] auth: CLAUDE_CODE_OAUTH_TOKEN (subscription, headless)");
  } else {
    console.log("[agency] auth: Claude Code subscription login (run `claude` and /login if this fails)");
  }

  // `gh` and `git` authenticate from GH_TOKEN; mirror the configured token into it.
  process.env.GH_TOKEN = cfg.githubToken;
  return cfg;
}
