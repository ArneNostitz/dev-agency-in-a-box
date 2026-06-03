/**
 * Renders the live status dashboard (served at the agency's public URL) so you can watch
 * the agents work: which issues are in flight, their state, and the recent agent runs with
 * model + turns. Reads straight from the SQLite ledger. Auto-refreshes.
 */
import type { IssueRow, RunRow } from "./store.js";

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const ROLE_ICON: Record<string, string> = {
  planner: "🧠",
  architect: "🏛",
  developer: "💻",
  reviewer: "🔍",
  tester: "🧪",
};

function stateBadge(state: string): string {
  const map: Record<string, string> = {
    "agency:in-progress": "#5c7cfa",
    "agency:awaiting-approval": "#f59f00",
    "agency:awaiting-answer": "#f59f00",
    "agency:ready": "#37b24d",
    "agency:needs-attention": "#e03131",
  };
  const color = map[state] ?? "#868e96";
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:10px;font-size:12px">${esc(
    state.replace("agency:", ""),
  )}</span>`;
}

export function renderDashboard(repos: string[], issues: IssueRow[], runs: RunRow[]): string {
  const issueRows = issues.length
    ? issues
        .map(
          (i) =>
            `<tr><td>${esc(i.repo)} <b>#${i.number}</b></td><td>${esc(i.title ?? "")}</td>` +
            `<td>${i.role ? `${ROLE_ICON[i.role] ?? ""} ${esc(i.role)}` : ""}</td>` +
            `<td>${stateBadge(i.state ?? "")}</td><td class="muted">${ago(i.updated_at)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="muted">No issues yet — pin <code>@dev</code> on one.</td></tr>`;

  const runRows = runs.length
    ? runs
        .map(
          (r) =>
            `<tr><td>${ROLE_ICON[r.role] ?? ""} <b>${esc(r.role)}</b></td><td>${esc(r.repo)} #${r.number}</td>` +
            `<td>${esc(r.kind)}</td><td class="muted">${esc(r.model)}</td><td>${r.turns} turns</td>` +
            `<td class="muted">${ago(r.created_at)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="muted">No agent runs yet.</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Dev Agency · status</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#14161a;color:#eef1f5;margin:0;padding:24px;}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;color:#9aa4b2;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.05em}
  .muted{color:#9aa4b2} code{background:#1d2026;padding:1px 5px;border-radius:4px}
  .repos{color:#9aa4b2;font-size:13px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #2c313a;vertical-align:top}
  th{color:#9aa4b2;font-weight:600;font-size:12px;text-transform:uppercase}
  .foot{margin-top:24px;color:#5b6470;font-size:12px}
</style></head><body>
  <h1>🤖 Dev Agency — live status</h1>
  <div class="repos">Watching: ${repos.map((r) => `<code>${esc(r)}</code>`).join(" ") || "—"}</div>
  <h2>Issues in flight</h2>
  <table><thead><tr><th>Issue</th><th>Title</th><th>Role</th><th>State</th><th>Updated</th></tr></thead>
  <tbody>${issueRows}</tbody></table>
  <h2>Recent agent runs</h2>
  <table><thead><tr><th>Agent</th><th>Issue</th><th>Step</th><th>Model</th><th>Effort</th><th>When</th></tr></thead>
  <tbody>${runRows}</tbody></table>
  <div class="foot">Auto-refreshes every 10s · the full conversation lives on each GitHub issue.</div>
</body></html>`;
}
