/**
 * "See it / test it without merging."
 *
 *  - Preview URL: if the watched repo is a Coolify app with PR preview deployments enabled,
 *    Coolify auto-deploys each PR to a URL. We just surface it. Set PREVIEW_URL_TEMPLATE with
 *    placeholders {owner} {repo} {repofull} {pr} {branch}, e.g.
 *      PREVIEW_URL_TEMPLATE=https://{repo}-pr-{pr}.preview.example.com
 *
 *  - Run checks on demand: clone the PR branch and run the Tester, streaming to the dashboard
 *    and posting a short result to the thread — no merge required.
 */
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runRole } from "./agents/roleAgent.js";
import { cloneRepo, commentOnIssue } from "./github.js";
import { setActive, clearActive } from "./activity.js";
import { recordRun } from "./store.js";
import { sStr } from "./settings.js";

/** Build a preview URL for a PR from PREVIEW_URL_TEMPLATE, or null if not configured. */
export function previewUrlFor(repoFull: string, prNumber: number, branch: string): string | null {
  const tmpl = sStr("preview_url_template", "PREVIEW_URL_TEMPLATE", "");
  if (!tmpl || !prNumber) return null;
  const [owner, repo] = repoFull.includes("/") ? repoFull.split("/") : ["", repoFull];
  return tmpl
    .replace(/\{owner\}/g, owner)
    .replace(/\{repofull\}/g, repoFull)
    .replace(/\{repo\}/g, repo)
    .replace(/\{pr\}/g, String(prNumber))
    .replace(/\{branch\}/g, branch);
}

/**
 * Run the project's checks on an issue's branch right now (no merge). Streams to the activity
 * feed under the issue number and posts a compact result comment. Best-effort.
 */
export async function runChecksNow(repo: string, issueNumber: number, title = ""): Promise<void> {
  const branch = `agency/issue-${issueNumber}`;
  const workdir = join(process.cwd(), ".work", repo.replace("/", "__"), `checks-${issueNumber}`);
  setActive(repo, issueNumber, "issue", "tester", title || `checks #${issueNumber}`);
  try {
    await rm(workdir, { recursive: true, force: true });
    await mkdir(join(workdir, ".."), { recursive: true });
    await cloneRepo(repo, workdir);
    const test = await runRole("tester", {
      workdir,
      repo,
      issueNumber,
      task:
        `Check out branch \`${branch}\` (\`git fetch origin ${branch} && git checkout ${branch}\`) and run the ` +
        `project's checks (install if needed, then typecheck, lint, test, build via \`npm run --if-present\` or ` +
        `the documented commands). Report each check's status and the first actionable error if any failed.`,
    });
    recordRun(repo, issueNumber, "tester", test.model, test.turns, "checks", test.costUsd);
    await commentOnIssue(repo, issueNumber, `🧪 **Checks (on demand)**\n\n${test.text}`);
  } catch (err) {
    await commentOnIssue(repo, issueNumber, `❌ Couldn't run checks: ${(err as Error).message.slice(0, 300)}`).catch(
      () => {},
    );
  } finally {
    clearActive(repo, issueNumber);
  }
}
