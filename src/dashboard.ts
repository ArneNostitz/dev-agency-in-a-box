/**
 * Renders the live status dashboard (served at the agency's public URL). Shows the agents'
 * live thought-stream (via SSE), the issues in flight (with direct GitHub links), and recent
 * agent runs — all from the SQLite ledger.
 */
import type { IssueRow, RunRow, ActivityRow } from "./store.js";

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

function issueLink(repo: string, number: number): string {
  return `<a href="https://github.com/${esc(repo)}/issues/${number}" target="_blank" rel="noopener">${esc(
    repo,
  )} <b>#${number}</b></a>`;
}

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

/** One line in the thought-stream (also used client-side via the same shape). */
export function activityLineHtml(a: ActivityRow | { role: string; kind: string; text: string; repo: string; number: number }): string {
  const icon = ROLE_ICON[a.role] ?? "•";
  const where = a.number ? ` <span class="muted">${esc(a.repo)}#${a.number}</span>` : "";
  const cls = a.kind === "tool" ? "tool" : a.kind === "start" || a.kind === "done" ? "muted" : "";
  return `<div class="line ${cls}"><b>${icon} ${esc(a.role)}</b>${where} ${esc(a.text)}</div>`;
}

export function renderDashboard(
  repos: string[],
  issues: IssueRow[],
  runs: RunRow[],
  activity: ActivityRow[],
): string {
  const streamHtml = activity.length
    ? activity.map(activityLineHtml).join("")
    : `<div class="muted">No activity yet — pin <code>@dev</code> on an issue and watch it think here.</div>`;

  const issueRows = issues.length
    ? issues
        .map(
          (i) =>
            `<tr><td>${issueLink(i.repo, i.number)}</td><td>${esc(i.title ?? "")}</td>` +
            `<td>${i.role ? `${ROLE_ICON[i.role] ?? ""} ${esc(i.role)}` : ""}</td>` +
            `<td>${stateBadge(i.state ?? "")}</td><td class="muted">${ago(i.updated_at)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="muted">No issues yet — pin <code>@dev</code> on one.</td></tr>`;

  const runRows = runs.length
    ? runs
        .map(
          (r) =>
            `<tr><td>${ROLE_ICON[r.role] ?? ""} <b>${esc(r.role)}</b></td><td>${issueLink(r.repo, r.number)}</td>` +
            `<td>${esc(r.kind)}</td><td class="muted">${esc(r.model)}</td><td>${r.turns} turns</td>` +
            `<td class="muted">${ago(r.created_at)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="muted">No agent runs yet.</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dev Agency · status</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#14161a;color:#eef1f5;margin:0;padding:24px;}
  a{color:#5c7cfa;text-decoration:none} a:hover{text-decoration:underline}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:13px;color:#9aa4b2;margin:26px 0 8px;text-transform:uppercase;letter-spacing:.05em}
  .muted{color:#9aa4b2} .tool{color:#74c0fc} code{background:#1d2026;padding:1px 5px;border-radius:4px}
  .repos{color:#9aa4b2;font-size:13px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #2c313a;vertical-align:top}
  th{color:#9aa4b2;font-weight:600;font-size:12px;text-transform:uppercase}
  #stream{background:#0e1014;border:1px solid #2c313a;border-radius:8px;padding:12px;max-height:42vh;overflow:auto;font-size:13px;line-height:1.5}
  #stream .line{padding:3px 0;border-bottom:1px solid #1b1e24;white-space:pre-wrap}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#37b24d;margin-right:6px;vertical-align:middle}
  .foot{margin-top:24px;color:#5b6470;font-size:12px}
</style></head><body>
  <h1>🤖 Dev Agency — live status</h1>
  <div class="repos">Watching: ${repos.map((r) => `<code>${esc(r)}</code>`).join(" ") || "—"}</div>

  <h2><span class="dot" id="live"></span>Agent thought-stream</h2>
  <div id="stream">${streamHtml}</div>

  <h2>Issues in flight</h2>
  <table><thead><tr><th>Issue</th><th>Title</th><th>Role</th><th>State</th><th>Updated</th></tr></thead>
  <tbody>${issueRows}</tbody></table>

  <h2>Recent agent runs</h2>
  <table><thead><tr><th>Agent</th><th>Issue</th><th>Step</th><th>Model</th><th>Effort</th><th>When</th></tr></thead>
  <tbody>${runRows}</tbody></table>

  <div class="foot">Live stream via SSE · tables refresh on reload · the full conversation lives on each GitHub issue.</div>
<script>
(function(){
  var ICON={planner:"🧠",architect:"🏛",developer:"💻",reviewer:"🔍",tester:"🧪"};
  var stream=document.getElementById("stream");
  function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}
  try {
    var es=new EventSource("/events");
    es.onmessage=function(ev){
      try {
        var a=JSON.parse(ev.data);
        if(stream.querySelector(".muted") && stream.children.length===1) stream.innerHTML="";
        var icon=ICON[a.role]||"•";
        var where=a.number?(" <span class=\\"muted\\">"+esc(a.repo)+"#"+a.number+"</span>"):"";
        var cls=a.kind==="tool"?"tool":(a.kind==="start"||a.kind==="done"?"muted":"");
        var div=document.createElement("div");
        div.className="line "+cls;
        div.innerHTML="<b>"+icon+" "+esc(a.role)+"</b>"+where+" "+esc(a.text);
        stream.appendChild(div);
        while(stream.children.length>300) stream.removeChild(stream.firstChild);
        stream.scrollTop=stream.scrollHeight;
      } catch(e){}
    };
    es.onerror=function(){document.getElementById("live").style.background="#e03131";};
  } catch(e){}
  // refresh tables periodically without nuking the stream
  setInterval(function(){
    fetch(location.pathname,{headers:{"x-partial":"1"}}); // keep-alive; full reload below
  }, 60000);
})();
</script>
</body></html>`;
}
