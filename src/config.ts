/**
 * Central configuration, read from environment variables and an optional
 * `config/repos.txt` file (the list of repositories the agency watches).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sStr, sNum, sBool } from "./settings.js";
import { getSecretSetting } from "./store.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, ".."); // src/ -> project root

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

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  return v === "1" || v === "true" || v === "yes";
}

/** Turn "name" or "owner/name" into a full "owner/name". */
function resolveRepo(raw: string, owner: string): string {
  const r = raw.trim();
  return r.includes("/") ? r : `${owner}/${r}`;
}

/**
 * The repositories the agency works in, gathered from (in order):
 *   1. config/repos.txt  — one "owner/name" (or "name") per line, '#' comments allowed
 *   2. TARGET_REPOS      — comma-separated env var
 *   3. TARGET_REPO       — single env var (backwards compatible)
 * To add a repo: add a line to config/repos.txt and push (Coolify auto-redeploys).
 */
function loadRepos(owner: string): string[] {
  const repos = new Set<string>();

  const file = join(projectRoot, "config", "repos.txt");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const s = line.split("#")[0].trim();
      if (s) repos.add(resolveRepo(s, owner));
    }
  }
  for (const r of (process.env.TARGET_REPOS ?? "").split(",")) {
    if (r.trim()) repos.add(resolveRepo(r, owner));
  }
  if (process.env.TARGET_REPO?.trim()) {
    repos.add(resolveRepo(process.env.TARGET_REPO, owner));
  }
  return [...repos];
}

/**
 * The "@handles" that pin the agency, from config/team.txt (plus optional HANDLES env).
 * Returned lowercased and guaranteed to start with '@'.
 */
function loadHandles(): string[] {
  const handles = new Set<string>();
  const norm = (h: string) => {
    const t = h.trim().toLowerCase().split(/[:\s]/)[0];
    if (!t) return "";
    return t.startsWith("@") ? t : `@${t}`;
  };

  const file = join(projectRoot, "config", "team.txt");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const s = line.split("#")[0].trim();
      const h = norm(s);
      if (h && h !== "@") handles.add(h);
    }
  }
  for (const h of sStr("handles", "HANDLES", "").split(",")) {
    const n = norm(h);
    if (n && n !== "@") handles.add(n);
  }
  if (handles.size === 0) handles.add("@dev");
  return [...handles];
}

function parseTrigger(v: string | undefined, requireLabel: boolean): "mention" | "label" | "any" {
  const m = v?.trim().toLowerCase();
  if (m === "mention" || m === "label" || m === "any") return m;
  return requireLabel ? "label" : "mention"; // sensible default: pin-to-start
}

export interface Config {
  /** Optional. If unset, the Agent SDK uses your Claude Code subscription login. */
  anthropicApiKey?: string;
  githubToken: string;
  owner: string;
  /** All repos the agency watches. */
  targetRepos: string[];
  /**
   * How an issue starts the agency:
   *   "mention" - the issue mentions one of `handles` (default, "pin to start")
   *   "label"   - the issue carries `queueLabel`
   *   "any"     - every new issue (aggressive)
   */
  triggerMode: "mention" | "label" | "any";
  /** Short "@handles" that pin the agency (mention mode). */
  handles: string[];
  queueLabel: string;
  /** Issues with this label are never touched (your manual opt-out). */
  ignoreLabel: string;
  model?: string;
  runMode: "once" | "watch" | "webhook";
  pollIntervalSeconds: number;
  /** Public base URL (Coolify domain) used to auto-register GitHub webhooks. */
  publicUrl?: string;
  /** Shared secret for verifying + registering GitHub webhooks. */
  webhookSecret?: string;
  /**
   * Owner/admin token used ONLY to invite the bot account as a collaborator on watched
   * repos. The bot (GITHUB_TOKEN) can't invite itself. Leave unset to invite manually.
   */
  adminToken?: string;
  /** If set, the status dashboard requires this password (HTTP Basic Auth). */
  dashboardPassword?: string;
  /** The agency's own repo (self-improvement PRs target it). */
  agencyRepo: string;
  /** Allow the agency to open playbook-improvement PRs against its own repo. */
  selfImprove: boolean;
}

function parseRunMode(v: string | undefined): "once" | "watch" | "webhook" {
  const m = v?.trim();
  return m === "watch" || m === "webhook" ? m : "once";
}

export function loadConfig(): Config {
  // Not required at boot anymore: in multi-user mode these come from the dashboard (per-user),
  // and even single-user should start the dashboard so you can configure it rather than
  // crash-loop. We warn instead, and the scan loop simply no-ops until credentials + repos exist.
  const owner = sStr("github_owner", "GITHUB_OWNER", ""); // dashboard Operations → env → empty
  const targetRepos = loadRepos(owner);
  if (targetRepos.length === 0) {
    // Not fatal: repos added at runtime via /add-repo live in the SQLite watch list.
    console.warn(
      "[agency] no repos in config/repos.txt or TARGET_REPOS — relying on the /add-repo watch list.",
    );
  }

  const cfg: Config = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    githubToken: optional("GITHUB_TOKEN", ""),
    owner,
    targetRepos,
    // Operational settings are DB-first (dashboard-managed) with the env var as a fallback.
    triggerMode: parseTrigger(sStr("trigger_mode", "TRIGGER_MODE", ""), bool("REQUIRE_LABEL", false)),
    handles: loadHandles(),
    queueLabel: sStr("queue_label", "QUEUE_LABEL", "agency:queue"),
    ignoreLabel: sStr("ignore_label", "IGNORE_LABEL", "agency:ignore"),
    model: process.env.AGENT_MODEL?.trim() || undefined,
    runMode: parseRunMode(process.env.RUN_MODE),
    pollIntervalSeconds: Math.max(10, sNum("poll_interval_seconds", "POLL_INTERVAL_SECONDS", 60)),
    publicUrl: sStr("public_url", "PUBLIC_URL", "") || undefined,
    webhookSecret: getSecretSetting("github_webhook_secret") || process.env.GITHUB_WEBHOOK_SECRET?.trim() || undefined,
    adminToken: process.env.ADMIN_GITHUB_TOKEN?.trim() || undefined,
    dashboardPassword: process.env.DASHBOARD_PASSWORD?.trim() || undefined,
    agencyRepo: resolveRepo(sStr("agency_repo", "AGENCY_REPO", "dev-agency"), owner),
    selfImprove: sBool("self_improve", "SELF_IMPROVE", true),
  };

  if (cfg.anthropicApiKey) {
    console.log("[agency] auth: ANTHROPIC_API_KEY (pay-as-you-go)");
  } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    console.log("[agency] auth: CLAUDE_CODE_OAUTH_TOKEN (subscription, headless)");
  } else {
    console.log("[agency] auth: Claude Code subscription login (run `claude` and /login if this fails)");
  }
  if (process.env.ANTHROPIC_BASE_URL?.trim()) {
    console.log(`[agency] model endpoint: ${process.env.ANTHROPIC_BASE_URL.trim()} (custom provider/router)`);
  }
  const triggerDesc =
    cfg.triggerMode === "mention"
      ? `mention ${cfg.handles.join(" / ")}`
      : cfg.triggerMode === "label"
        ? `label "${cfg.queueLabel}"`
        : "any new issue";
  console.log(
    `[agency] watching ${cfg.targetRepos.length} repo(s): ${cfg.targetRepos.join(", ")} ` +
      `(trigger: ${triggerDesc})`,
  );

  if (!cfg.owner || !cfg.githubToken) {
    console.warn(
      "[agency] GITHUB_OWNER/GITHUB_TOKEN not set — the dashboard will start, but the agency " +
        "can't act on GitHub until they're configured (these move to per-user credentials).",
    );
  }
  // `gh` and `git` authenticate from GH_TOKEN; mirror the configured token into it.
  if (cfg.githubToken) process.env.GH_TOKEN = cfg.githubToken;
  return cfg;
}
