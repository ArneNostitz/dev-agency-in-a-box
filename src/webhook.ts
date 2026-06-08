/**
 * Event-driven mode (RUN_MODE=webhook): instead of polling every N seconds, run an
 * HTTP server that GitHub calls the instant an issue is opened/labeled/reopened.
 *
 * Configure a GitHub webhook (repo or org Settings -> Webhooks):
 *   Payload URL : https://<your-coolify-domain>/webhook
 *   Content type: application/json
 *   Secret      : same value as GITHUB_WEBHOOK_SECRET
 *   Events      : "Issues" (at least)
 *
 * The server verifies the signature, then triggers a processing pass. A safety poll
 * still runs occasionally so nothing is missed if a webhook delivery is dropped.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import { recentRuns, recentIssues, recentActivity, archiveIssue, spendSince, recordIssueState, recordPr } from "./store.js";
import { renderDashboard, renderHistory } from "./dashboard.js";
import { subscribe, getActive } from "./activity.js";
import { effectiveRepos } from "./commands.js";
import { getThreadFull, commentAsHuman, mergePrForBranch, closeIssue, deleteIssueHard, findPrForBranch } from "./github.js";
import { previewUrlFor, runChecksNow } from "./preview.js";
import { dispatch } from "./pool.js";

type ProcessAll = (cfg: Config) => Promise<number>;
type Resume = (repo: string, number: number) => Promise<void>;

/** Gate the dashboard with HTTP Basic Auth if DASHBOARD_PASSWORD is set. */
function checkAuth(cfg: Config, req: IncomingMessage, res: ServerResponse): boolean {
  if (!cfg.dashboardPassword) return true;
  const m = /^Basic (.+)$/.exec((req.headers["authorization"] as string) ?? "");
  if (m) {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    const a = Buffer.from(pass);
    const b = Buffer.from(cfg.dashboardPassword);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  res.writeHead(401, { "www-authenticate": 'Basic realm="dev-agency"' });
  res.end("Authentication required.");
  return false;
}

function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!secret) return true; // no secret configured -> skip verification (not recommended)
  if (!header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// "unlabeled" lets you retrigger an issue instantly: remove its agency:* label and it
// becomes actionable again (the @handle in the body re-pins it) — no need to rewrite anything.
const RELEVANT_ACTIONS = new Set(["opened", "reopened", "labeled", "unlabeled", "edited"]);
const PR_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review", "edited"]);

export async function runWebhook(cfg: Config, processAll: ProcessAll, resume?: Resume): Promise<void> {
  const port = Number(process.env.PORT?.trim() || "3000");
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim() || "";
  // Catches 👍 reactions (GitHub doesn't webhook those) and anything a delivery missed.
  const safetyPollMs = Math.max(30, cfg.pollIntervalSeconds) * 1000;

  // Serialize processing: a single chain, with a "pending" flag to coalesce bursts.
  let running = false;
  let pending = false;
  async function trigger(reason: string): Promise<void> {
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending) {
        pending = false;
        console.log(`[agency] processing (trigger: ${reason})`);
        const n = await processAll(cfg);
        console.log(`[agency] processed ${n} issue(s).`);
      }
    } catch (err) {
      console.error("[agency] processing error:", (err as Error).message);
    } finally {
      running = false;
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET") {
      const url = (req.url ?? "/").split("?")[0];
      if (url === "/health") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("dev-agency: ok");
        return;
      }
      if (!checkAuth(cfg, req, res)) return;

      if (url === "/events") {
        // Server-sent events: live thought-stream from the agents.
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        const unsub = subscribe((e) => {
          try {
            res.write(`data: ${JSON.stringify(e)}\n\n`);
          } catch {
            /* client gone */
          }
        });
        const keepalive = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch {
            /* ignore */
          }
        }, 25000);
        req.on("close", () => {
          clearInterval(keepalive);
          unsub();
        });
        return;
      }

      if (url === "/data") {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        void (async () => {
          const issues = recentIssues(60);
          // Backfill PR links for delivered issues opened before PR linkage existed (one-time:
          // we persist what we find, so later polls read it straight from the DB).
          for (const i of issues) {
            if (!i.pr_number && i.state === "agency:ready") {
              try {
                const pr = await findPrForBranch(i.repo, `agency/issue-${i.number}`);
                if (pr) {
                  i.pr_number = pr.number;
                  i.pr_url = pr.url;
                  recordPr(i.repo, i.number, pr.number, pr.url);
                }
              } catch {
                /* ignore */
              }
            }
          }
          const enriched = issues.map((i) => ({
            ...i,
            previewUrl: i.pr_number ? previewUrlFor(i.repo, i.pr_number, `agency/issue-${i.number}`) : null,
          }));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              repos: effectiveRepos(cfg),
              active: getActive(),
              issues: enriched,
              runs: recentRuns(40),
              activity: recentActivity(400),
              spendToday: spendSince(midnight.toISOString()),
            }),
          );
        })();
        return;
      }

      // Side-panel: the full GitHub conversation for one issue/PR.
      if (url === "/thread") {
        const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const repo = q.get("repo") ?? "";
        const number = Number(q.get("number"));
        if (!repo || !number) {
          res.writeHead(400).end("{}");
          return;
        }
        void getThreadFull(repo, number)
          .then((t) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(t)))
          .catch(() => res.writeHead(200, { "content-type": "application/json" }).end("{}"));
        return;
      }

      // Live status dashboard (client fetches /data + /events). No-store so a redeploy's new
      // UI shows up immediately instead of the browser serving a stale cached page.
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
      });
      res.end(url === "/history" ? renderHistory() : renderDashboard());
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    // Dashboard actions (password-protected, not GitHub webhooks).
    const path = (req.url ?? "").split("?")[0];
    if (["/archive", "/comment", "/run-checks", "/merge", "/delete", "/resume"].includes(path)) {
      if (!checkAuth(cfg, req, res)) return;
      void readBody(req).then(async (body) => {
        let p: { repo?: string; number?: number; body?: string; title?: string } = {};
        try {
          p = JSON.parse(body.toString("utf8"));
        } catch {
          /* ignore */
        }
        const repo = p.repo ?? "";
        const number = Number(p.number);
        const ok = (payload = '{"ok":true}') =>
          res.writeHead(200, { "content-type": "application/json" }).end(payload);

        if (path === "/archive") {
          if (repo && number) archiveIssue(repo, number);
          return ok();
        }
        if (path === "/comment") {
          // Inline reply -> posts to GitHub as the human (no agency marker) so it re-engages.
          if (!repo || !number || !p.body?.trim()) return res.writeHead(400).end("{}");
          try {
            // Post under the owner's account (admin token) so it shows your name, not the bot's.
            await commentAsHuman(repo, number, p.body.trim(), cfg.adminToken);
            void trigger("dashboard-comment");
            return ok();
          } catch (err) {
            return res.writeHead(500).end(JSON.stringify({ error: (err as Error).message }));
          }
        }
        if (path === "/merge") {
          // One-tap merge: squash the issue's PR, delete the branch, close + mark merged.
          if (!repo || !number) return res.writeHead(400).end("{}");
          const r = await mergePrForBranch(repo, `agency/issue-${number}`);
          if (r.ok) {
            await closeIssue(repo, number, `🚀 Merged ${r.msg} from the dashboard.`).catch(() => {});
            recordIssueState(repo, number, { state: "merged" });
            return ok();
          }
          return res.writeHead(409).end(JSON.stringify({ error: r.msg }));
        }
        if (path === "/delete") {
          // Try a real delete (owner-only); otherwise close + hide from the board.
          if (!repo || !number) return res.writeHead(400).end("{}");
          const r = await deleteIssueHard(repo, number, cfg.adminToken);
          if (!r.ok) await closeIssue(repo, number).catch(() => {});
          archiveIssue(repo, number);
          return ok(JSON.stringify({ ok: true, deleted: r.ok }));
        }
        if (path === "/resume") {
          // Unstick an issue and re-run it, whatever state it's in.
          if (!repo || !number || !resume) return res.writeHead(400).end("{}");
          await resume(repo, number).catch(() => {});
          return ok();
        }
        // /run-checks -> run the tester on the issue's branch now (no merge).
        if (!repo || !number) return res.writeHead(400).end("{}");
        dispatch(`${repo}#checks-${number}`, () => runChecksNow(repo, number, p.title ?? ""));
        return ok();
      });
      return;
    }

    void readBody(req).then((body) => {
      if (!verifySignature(secret, body, req.headers["x-hub-signature-256"] as string)) {
        console.warn("[agency] rejected webhook: bad signature");
        res.writeHead(401).end("bad signature");
        return;
      }
      const event = req.headers["x-github-event"] as string;
      let payload: {
        action?: string;
        pull_request?: { merged?: boolean; head?: { ref?: string } };
        repository?: { full_name?: string };
      } = {};
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        /* ignore */
      }
      const action = payload.action ?? "";
      // Respond immediately; process in the background.
      res.writeHead(202).end("accepted");

      if (event === "ping") {
        console.log("[agency] webhook ping ok");
      } else if (event === "issues" && RELEVANT_ACTIONS.has(action)) {
        void trigger(`issues.${action}`);
      } else if (event === "issue_comment" && action === "created") {
        // A new comment may be an answer/approval to resume a paused issue. (The agency's own
        // comments are ignored downstream — they don't count as a human reply.)
        void trigger("issue_comment");
      } else if ((event === "check_suite" || event === "workflow_run") && action === "completed") {
        // CI finished — react instantly to fix failures.
        void trigger(`${event}.completed`);
      } else if (event === "pull_request" && action === "closed") {
        // Merged on GitHub directly -> move the linked issue to "merged" right away.
        const ref = payload.pull_request?.head?.ref ?? "";
        const full = payload.repository?.full_name ?? "";
        const m = /^agency\/issue-(\d+)$/.exec(ref);
        if (payload.pull_request?.merged && full && m) {
          recordIssueState(full, Number(m[1]), { state: "merged" });
          console.log(`[agency] ${full} #${m[1]} -> merged (PR closed)`);
        }
        void trigger("pull_request.closed");
      } else if (event === "pull_request" && PR_ACTIONS.has(action)) {
        void trigger(`pull_request.${action}`);
      } else if (event === "push") {
        // Base-branch (or any) push can create/clear merge conflicts.
        void trigger("push");
      }
    });
  });

  server.listen(port, () => {
    console.log(`[agency] mode: webhook, listening on :${port} (POST /webhook)`);
  });

  // Webhook + collaborator registration happens in main() via ensureAllRepoAccess before
  // this server starts. Here we just serve and process.

  // Drain anything already queued at startup, then keep a slow safety poll.
  await trigger("startup");
  setInterval(() => void trigger("safety-poll"), safetyPollMs);
}
