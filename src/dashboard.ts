/**
 * The live status dashboard. The page is a thin shell; it fetches /data (issues + runs +
 * recent activity) and renders everything client-side so the tables stay current, and it
 * subscribes to /events (SSE) for the live per-issue thought-stream. Archive hides old issues.
 */
export function renderDashboard(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dev Agency · status</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#14161a;color:#eef1f5;margin:0;padding:24px;}
  a{color:#5c7cfa;text-decoration:none} a:hover{text-decoration:underline}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:13px;color:#9aa4b2;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.05em}
  .muted{color:#9aa4b2} .tool{color:#74c0fc} code{background:#1d2026;padding:1px 5px;border-radius:4px}
  .repos{color:#9aa4b2;font-size:13px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #2c313a;vertical-align:top}
  th{color:#9aa4b2;font-weight:600;font-size:12px;text-transform:uppercase}
  details.iss{background:#0e1014;border:1px solid #2c313a;border-radius:8px;margin-bottom:8px}
  details.iss>summary{cursor:pointer;padding:8px 12px;font-size:13px;list-style:none}
  details.iss>summary::-webkit-details-marker{display:none}
  details.iss .lines{padding:4px 12px 10px;max-height:40vh;overflow:auto;font-size:13px;line-height:1.5}
  .line{padding:3px 0;border-bottom:1px solid #1b1e24;white-space:pre-wrap}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#37b24d;margin-right:6px;vertical-align:middle}
  .badge{color:#fff;padding:2px 8px;border-radius:10px;font-size:12px}
  .arch{cursor:pointer;color:#5b6470;font-size:12px;border:none;background:none}
  .arch:hover{color:#e03131}
  .foot{margin-top:24px;color:#5b6470;font-size:12px}
</style></head><body>
  <h1>🤖 Dev Agency — live status</h1>
  <div class="repos" id="repos">…</div>

  <h2><span class="dot" id="live"></span>Agent thought-stream</h2>
  <div id="stream"><div class="muted">Loading…</div></div>

  <h2>Issues in flight</h2>
  <table><tbody id="active"></tbody></table>

  <details id="donewrap"><summary class="muted" style="cursor:pointer;margin-top:14px">Done / recent</summary>
    <table><tbody id="done"></tbody></table>
  </details>

  <h2>Recent agent runs</h2>
  <table><tbody id="runs"></tbody></table>

  <div class="foot">Live stream via SSE · tables auto-update · archive hides an issue here (the GitHub issue is untouched).</div>
<script>
(function(){
  var ICON={planner:"🧠",architect:"🏛",developer:"💻",reviewer:"🔍",tester:"🧪"};
  var STATE={"agency:in-progress":"#5c7cfa","agency:awaiting-approval":"#f59f00","agency:awaiting-answer":"#f59f00","agency:ready":"#37b24d","agency:needs-attention":"#e03131"};
  var ACTIVE={"agency:in-progress":1,"agency:awaiting-approval":1,"agency:awaiting-answer":1};
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}
  function ago(iso){var s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);if(s<60)return Math.floor(s)+"s ago";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";}
  function ilink(repo,n){return '<a href="https://github.com/'+esc(repo)+'/issues/'+n+'" target="_blank" rel="noopener">'+esc(repo)+' <b>#'+n+'</b></a>';}
  function badge(st){return '<span class="badge" style="background:'+(STATE[st]||"#868e96")+'">'+esc((st||"").replace("agency:",""))+'</span>';}
  function issueRow(i){
    return '<tr><td>'+ilink(i.repo,i.number)+'</td><td>'+esc(i.title)+'</td>'+
      '<td>'+(i.role?(ICON[i.role]||"")+" "+esc(i.role):"")+'</td><td>'+badge(i.state)+'</td>'+
      '<td class="muted">'+ago(i.updated_at)+'</td>'+
      '<td><button class="arch" onclick="agencyArchive(\\''+esc(i.repo)+'\\','+i.number+')">archive</button></td></tr>';
  }
  function renderTables(d){
    document.getElementById("repos").innerHTML="Watching: "+(d.repos||[]).map(function(r){return "<code>"+esc(r)+"</code>";}).join(" ");
    var active=[],done=[];
    (d.issues||[]).forEach(function(i){ (ACTIVE[i.state]?active:done).push(i); });
    document.getElementById("active").innerHTML=active.length?active.map(issueRow).join(""):'<tr><td class="muted">Nothing in flight. Pin <code>@dev</code> on an issue.</td></tr>';
    document.getElementById("done").innerHTML=done.length?done.map(issueRow).join(""):'<tr><td class="muted">—</td></tr>';
    document.getElementById("runs").innerHTML=(d.runs||[]).length?(d.runs).map(function(r){
      return '<tr><td>'+(ICON[r.role]||"")+" <b>"+esc(r.role)+'</b></td><td>'+ilink(r.repo,r.number)+'</td><td>'+esc(r.kind)+'</td><td class="muted">'+esc(r.model)+'</td><td>'+r.turns+' turns</td><td class="muted">'+ago(r.created_at)+'</td></tr>';
    }).join(""):'<tr><td class="muted">No agent runs yet.</td></tr>';
  }
  // ---- per-issue collapsible stream ----
  var stream=document.getElementById("stream");
  function key(a){return (a.repo||"")+"#"+(a.number||0);}
  function gid(a){return "g-"+key(a).replace(/[^a-zA-Z0-9]/g,"_");}
  function ensureGroup(a){
    var id=gid(a),g=document.getElementById(id);
    if(!g){
      g=document.createElement("details"); g.className="iss"; g.id=id; g.open=true;
      g.innerHTML='<summary>'+(ICON[a.role]||"•")+" <b>"+esc(a.role)+'</b> '+esc(key(a))+'</summary><div class="lines"></div>';
      if(stream.querySelector(".muted")) stream.innerHTML="";
      stream.insertBefore(g, stream.firstChild);
    }
    return g.querySelector(".lines");
  }
  function appendLine(a){
    var lines=ensureGroup(a);
    var cls=a.kind==="tool"?"tool":(a.kind==="start"||a.kind==="done"?"muted":"");
    var div=document.createElement("div"); div.className="line "+cls;
    div.innerHTML=esc(a.text);
    lines.appendChild(div);
    while(lines.children.length>120) lines.removeChild(lines.firstChild);
    lines.scrollTop=lines.scrollHeight;
  }
  window.agencyArchive=function(repo,n){ fetch("/archive",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:repo,number:n})}).then(load); };
  function load(){ fetch("/data").then(function(r){return r.json();}).then(function(d){
    renderTables(d);
    if(d.activity){ stream.innerHTML=""; d.activity.forEach(appendLine); }
  }).catch(function(){}); }
  load(); setInterval(load, 12000);
  try{ var es=new EventSource("/events");
    es.onmessage=function(ev){ try{ appendLine(JSON.parse(ev.data)); }catch(e){} };
    es.onerror=function(){ document.getElementById("live").style.background="#e03131"; };
  }catch(e){}
})();
</script>
</body></html>`;
}
