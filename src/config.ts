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
  anthropicApiKey: string;
  githubToken: string;
  owner: string;
  /** Full "owner/name" of the repo the agency operates on. */
  targetRepo: string;
  queueLabel: string;
  model?: string;
}

export function loadConfig(): Config {
  const owner = required("GITHUB_OWNER");
  const rawRepo = required("TARGET_REPO");
  // Accept either "name" or "owner/name".
  const targetRepo = rawRepo.includes("/") ? rawRepo : `${owner}/${rawRepo}`;

  const cfg: Config = {
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    githubToken: required("GITHUB_TOKEN"),
    owner,
    targetRepo,
    queueLabel: optional("QUEUE_LABEL", "agency:queue"),
    model: process.env.AGENT_MODEL?.trim() || undefined,
  };

  // `gh` and `git` authenticate from GH_TOKEN; mirror the configured token into it.
  process.env.GH_TOKEN = cfg.githubToken;
  return cfg;
}
