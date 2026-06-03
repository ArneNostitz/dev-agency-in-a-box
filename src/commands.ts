/**
 * Control commands filed as GitHub issues, so the agency is managed from GitHub with no
 * terminal and no redeploy. File an issue in any watched repo:
 *   /add-repo <name>     -> start watching another repo (owner/name or just name)
 *   /list-repos          -> list the repos currently watched
 * The agency executes the command, comments the result, and closes the issue.
 */
import type { Config } from "./config.js";
import {
  listAllOpenIssues,
  closeIssue,
  commentOnIssue,
  repoExists,
  ensureWebhook,
  ensureCollaborator,
} from "./github.js";
import { addWatchedRepo, listWatchedRepos } from "./store.js";

export type ControlCommand = { type: "add-repo"; repo: string } | { type: "list-repos" };

/** Parse a control command from an issue's title/body, or null if it isn't one. */
export function parseControlCommand(title: string, body: string): ControlCommand | null {
  const text = `${title}\n${body}`;
  const add = /(?:^|\n)\s*\/add-repo\s+(\S+)/i.exec(text);
  if (add) return { type: "add-repo", repo: add[1].trim() };
  if (/(?:^|\n)\s*\/list-repos\b/i.test(text)) return { type: "list-repos" };
  return null;
}

function resolveRepo(raw: string, owner: string): string {
  return raw.includes("/") ? raw : `${owner}/${raw}`;
}

/** All repos currently watched: config/repos.txt ∪ the runtime list added via issues. */
export function effectiveRepos(cfg: Config): string[] {
  return [...new Set([...cfg.targetRepos, ...listWatchedRepos()])];
}

/**
 * Make sure the agency can actually operate in `repo`: invite+accept the bot as a
 * collaborator (if an admin token is configured) and register the webhook (in webhook mode).
 * Returns a short human-readable note for the confirmation comment.
 */
export async function ensureRepoAccess(cfg: Config, repo: string): Promise<string> {
  const notes: string[] = [];
  if (cfg.adminToken) {
    const c = await ensureCollaborator(repo, cfg.adminToken, cfg.githubToken);
    if (c === "added") notes.push("bot invited + accepted");
    else if (c === "failed") notes.push("⚠️ couldn't invite bot (check ADMIN_GITHUB_TOKEN access)");
  }
  if (cfg.runMode === "webhook" && cfg.publicUrl && cfg.webhookSecret) {
    const url = `${cfg.publicUrl.replace(/\/$/, "")}/webhook`;
    const w = await ensureWebhook(repo, url, cfg.webhookSecret);
    if (w === "created") notes.push("webhook registered");
  }
  return notes.length ? ` (${notes.join("; ")})` : "";
}

/** Ensure access (collaborator + webhook) across every watched repo. Run at startup. */
export async function ensureAllRepoAccess(cfg: Config): Promise<void> {
  for (const repo of effectiveRepos(cfg)) {
    const note = await ensureRepoAccess(cfg, repo);
    if (note) console.log(`[agency] ${repo}:${note}`);
  }
}

/** Scan one repo's open issues for control commands and execute them. */
export async function handleControlCommands(cfg: Config, repo: string): Promise<void> {
  const issues = await listAllOpenIssues(repo);
  for (const issue of issues) {
    const cmd = parseControlCommand(issue.title, issue.body);
    if (!cmd) continue;

    if (cmd.type === "list-repos") {
      const list = effectiveRepos(cfg).map((r) => `- ${r}`).join("\n");
      await closeIssue(repo, issue.number, `📋 Currently watching:\n\n${list}`);
      console.log(`[agency] ${repo} #${issue.number}: /list-repos`);
      continue;
    }

    // add-repo
    const target = resolveRepo(cmd.repo, cfg.owner);
    if (!(await repoExists(target))) {
      await closeIssue(
        repo,
        issue.number,
        `⚠️ Could not add \`${target}\` — it doesn't exist or my token has no access.`,
      );
      console.log(`[agency] ${repo} #${issue.number}: /add-repo ${target} -> not found`);
      continue;
    }
    addWatchedRepo(target);
    const access = await ensureRepoAccess(cfg, target);
    await closeIssue(repo, issue.number, `✅ Now watching \`${target}\`${access}. Pin \`@dev\` on an issue there to start.`);
    console.log(`[agency] ${repo} #${issue.number}: /add-repo ${target} -> watching${access}`);
  }
}
