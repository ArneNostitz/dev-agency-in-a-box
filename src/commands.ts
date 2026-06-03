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

async function maybeRegisterWebhook(cfg: Config, repo: string): Promise<string> {
  if (cfg.runMode !== "webhook" || !cfg.publicUrl || !cfg.webhookSecret) return "";
  const url = `${cfg.publicUrl.replace(/\/$/, "")}/webhook`;
  const r = await ensureWebhook(repo, url, cfg.webhookSecret);
  return r === "created" ? " (webhook registered)" : r === "exists" ? " (webhook already set)" : "";
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
    const hook = await maybeRegisterWebhook(cfg, target);
    await closeIssue(repo, issue.number, `✅ Now watching \`${target}\`${hook}. Pin \`@dev\` on an issue there to start.`);
    console.log(`[agency] ${repo} #${issue.number}: /add-repo ${target} -> watching${hook}`);
  }
}
