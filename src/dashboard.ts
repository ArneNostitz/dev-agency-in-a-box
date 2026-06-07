/**
 * The live status dashboard. The main page is focused on what's running *now* (one clean
 * stream card per active issue/PR) and what's waiting on you. The firehose, recent runs, and
 * done/archived issues live on /history. Both fetch /data and subscribe to /events (SSE).
 */
const SHARED_CSS = `
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#14161a;color:#eef1f5;margin:0;padding:24px;}
  a{color:#5c7cfa;text-decoration:none} a:hover{text-decoration:underline}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:13px;color:#9aa4b2;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.05em}
  .muted{color:#9aa4b2} .tool{color:#74c0fc} code{background:#1d2026;padding:1px 5px;border-radius:4px}
  .topline{color:#9aa4b2;font-size:13px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #2c313a;vertical-align:top}
  th{color:#9aa4b2;font-weight:600;font-size:12px;text-transform:uppercase}
  .badge{color:#fff;padding:2px 8px;border-radius:10px;font-size:12px}
  .nowbar{border-radius:8px;padding:12px 16px;margin:12px 0;font-size:15px}
  .nowbar.active{background:#10261a;border:1px solid #2b8a3e}
  .nowbar.idle{background:#1d2026;border:1px solid #2c313a;color:#9aa4b2;font-size:13px}
  .pulse{display:inline-block;width:10px;height:10px;border-radius:50%;background:#37b24d;margin-right:8px;vertical-align:middle;animation:pulse 1.2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(55,178,77,.6)}70%{box-shadow:0 0 0 8px rgba(55,178,77,0)}100%{box-shadow:0 0 0 0 rgba(55,178,77,0)}}
  .card{background:#0e1014;border:1px solid #2c313a;border-radius:8px;margin-bottom:12px}
  .cardhead{padding:9px 14px;border-bottom:1px solid #2c313a;font-size:14px}
  .card .lines{padding:6px 14px 10px;max-height:38vh;overflow:auto;font-size:13px;line-height:1.55}
  .line{padding:2px 0;white-space:pre-wrap;border-bottom:1px solid #16181d}
  details.iss{background:#0e1014;border:1px solid #2c313a;border-radius:8px;margin-bottom:8px}
  details.iss>summary{cursor:pointer;padding:8px 12px;font-size:13px;list-style:none}
  details.iss .lines{padding:4px 12px 10px;max-height:32vh;overflow:auto;font-size:13px;line-height:1.5}
  .arch{cursor:pointer;color:#5b6470;font-size:12px;border:none;background:none}
  .arch:hover{color:#e03131}
  .foot{margin-top:24px;color:#5b6470;font-size:12px}
`;

const SHARED_JS = `
  var ICON={planner:"🧠",architect:"🏛",developer:"💻",reviewer:"🔍",tester:"🧪",librarian:"📚"};
  var STATE={"agency:in-progress":"#5c7cfa","agency:awaiting-approval":"#f59f00","agency:awaiting-answer":"#f59f00","agency:ready":"#37b24d","agency:needs-attention":"#e03131"};
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}
  function ago(iso){var s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);if(s<60)return Math.floor(s)+"s ago";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";}
  function ilink(repo,n){if(!n)return '<a href="https://github.com/'+esc(repo)+'/pulls" target="_blank" rel="noopener">'+esc(repo)+'</a>';return '<a href="https://github.com/'+esc(repo)+'/issues/'+n+'" target="_blank" rel="noopener">'+esc(repo)+' <b>#'+n+'</b></a>';}
  function spend(d){var s=d.spendToday;return (s&&s.costUsd>0)?' · today: $'+s.costUsd.toFixed(2)+' ('+s.runs+' runs)':'';}
  function badge(st){return '<span class="badge" style="background:'+(STATE[st]||"#868e96")+'">'+esc((st||"").replace("agency:",""))+'</span>';}
  function key(r,n){return r+"#"+n;}
  function lineHtml(a){var cls=a.kind==="tool"?"tool":(a.kind==="start"||a.kind==="done"?"muted":"");return '<div class="line '+cls+'">'+esc(a.text)+'</div>';}
  function getJSON(cb){fetch("/data").then(function(r){return r.json();}).then(cb).catch(function(){});}
  function sse(onEvent){ try{var es=new EventSource("/events"); es.onmessage=function(ev){try{onEvent(JSON.parse(ev.data));}catch(e){}}; es.onerror=function(){var d=document.getElementById("live"); if(d)d.style.background="#e03131";};}catch(e){} }
`;

/** The focused main dashboard: what's running now + what's waiting on you. */
export function renderDashboard(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Dev Agency · status</title>
<style>${SHARED_CSS}</style></head><body>
  <h1>🤖 Dev Agency</h1>
  <div class="topline"><span id="repos">…</span> · <a href="/history">history →</a></div>
  <div id="now" class="nowbar idle">…</div>
  <h2><span class="pulse" id="live" style="width:8px;height:8px"></span>Live work</h2>
  <div id="cards"><div class="muted">Loading…</div></div>
  <h2>Waiting on you</h2>
  <table><tbody id="waiting"></tbody></table>
  <div class="foot">Streams are live · <a href="/history">full history, recent runs &amp; done issues →</a></div>
<script>${SHARED_JS}
(function(){
  var ACT=[], activeKeys=new Set();
  function renderNow(list){var now=document.getElementById("now");
    if(list&&list.length){now.className="nowbar active";
      now.innerHTML='<span class="pulse"></span><b>Working now ('+list.length+')</b><br>'+list.map(function(a){return (ICON[a.role]||"")+' <b>'+esc(a.role)+'</b> on '+ilink(a.repo,a.number)+(a.title?' — '+esc(a.title):'')+' <span class="muted">('+esc(a.kind)+', '+ago(new Date(a.since).toISOString())+')</span>';}).join("<br>");
    }else{now.className="nowbar idle";now.innerHTML='● Idle — nothing running. Waiting for work or your reply.';}}
  function gid(k){return "c-"+k.replace(/[^a-zA-Z0-9]/g,"_");}
  function render(d){
    ACT=d.active||[]; activeKeys=new Set(ACT.map(function(a){return key(a.repo,a.number);}));
    document.getElementById("repos").innerHTML="Watching "+(d.repos||[]).map(function(r){return "<code>"+esc(r)+"</code>";}).join(" ")+spend(d);
    renderNow(ACT);
    var cards=document.getElementById("cards");
    if(!ACT.length){cards.innerHTML='<div class="muted">Nothing running right now.</div>';}
    else{cards.innerHTML=ACT.map(function(a){var k=key(a.repo,a.number);
      var evs=(d.activity||[]).filter(function(x){return key(x.repo,x.number)===k;}).slice(-40);
      var body=evs.length?evs.map(lineHtml).join(""):'<div class="line muted">Warming up — first agent turn can take a minute…</div>';
      return '<div class="card" id="'+gid(k)+'"><div class="cardhead">'+(ICON[a.role]||"")+' <b>'+esc(a.role)+'</b> · '+ilink(a.repo,a.number)+(a.title?' — '+esc(a.title):'')+' <span class="muted">('+esc(a.kind)+')</span></div><div class="lines">'+body+'</div></div>';
    }).join("");
      ACT.forEach(function(a){var el=document.getElementById(gid(key(a.repo,a.number)));if(el){var l=el.querySelector(".lines");l.scrollTop=l.scrollHeight;}});}
    var waiting=(d.issues||[]).filter(function(i){return i.state==="agency:awaiting-approval"||i.state==="agency:awaiting-answer";});
    document.getElementById("waiting").innerHTML=waiting.length?waiting.map(function(i){
      return '<tr><td>'+ilink(i.repo,i.number)+'</td><td>'+esc(i.title)+'</td><td>'+badge(i.state)+'</td><td class="muted">'+ago(i.updated_at)+'</td></tr>';
    }).join(""):'<tr><td class="muted">Nothing waiting on you. 🎉</td></tr>';
  }
  function tick(){getJSON(render);} tick(); setInterval(tick,5000);
  sse(function(a){ if(!activeKeys.has(key(a.repo,a.number)))return; var el=document.getElementById(gid(key(a.repo,a.number))); if(!el)return;
    var l=el.querySelector(".lines"); l.insertAdjacentHTML("beforeend",lineHtml(a)); while(l.children.length>50)l.removeChild(l.firstChild); l.scrollTop=l.scrollHeight; });
})();
</script></body></html>`;
}

/** History: the full firehose, recent runs, and all (incl. done) issues with archive. */
export function renderHistory(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Dev Agency · history</title>
<style>${SHARED_CSS}</style></head><body>
  <h1>🤖 Dev Agency — history</h1>
  <div class="topline"><a href="/">← live status</a></div>
  <h2><span class="pulse" id="live" style="width:8px;height:8px"></span>Recent activity (all)</h2>
  <div id="stream"><div class="muted">Loading…</div></div>
  <h2>Recent agent runs</h2>
  <table><tbody id="runs"></tbody></table>
  <h2>All issues</h2>
  <table><tbody id="issues"></tbody></table>
<script>${SHARED_JS}
(function(){
  var stream=document.getElementById("stream"), activeKeys=new Set();
  function gid(k){return "g-"+k.replace(/[^a-zA-Z0-9]/g,"_");}
  function render(d){
    activeKeys=new Set((d.active||[]).map(function(a){return key(a.repo,a.number);}));
    // group activity by issue
    var groups={};
    (d.activity||[]).forEach(function(a){var k=key(a.repo,a.number);(groups[k]=groups[k]||[]).push(a);});
    var keys=Object.keys(groups);
    stream.innerHTML=keys.length?keys.map(function(k){var evs=groups[k];var last=evs[evs.length-1];
      return '<details class="iss" '+(activeKeys.has(k)?"open":"")+'><summary>'+(ICON[last.role]||"•")+' <b>'+esc(last.role)+'</b> '+esc(k)+' <span class="muted">('+evs.length+' events)</span></summary><div class="lines">'+evs.slice(-60).map(lineHtml).join("")+'</div></details>';
    }).join(""):'<div class="muted">No activity yet.</div>';
    document.getElementById("runs").innerHTML=(d.runs||[]).length?(d.runs).map(function(r){
      return '<tr><td>'+(ICON[r.role]||"")+" <b>"+esc(r.role)+'</b></td><td>'+ilink(r.repo,r.number)+'</td><td>'+esc(r.kind)+'</td><td class="muted">'+esc(r.model)+'</td><td>'+r.turns+' turns</td><td class="muted">'+(r.cost_usd>0?'$'+r.cost_usd.toFixed(2):'—')+'</td><td class="muted">'+ago(r.created_at)+'</td></tr>';
    }).join(""):'<tr><td class="muted">No runs yet.</td></tr>';
    document.getElementById("issues").innerHTML=(d.issues||[]).length?(d.issues).map(function(i){
      return '<tr><td>'+ilink(i.repo,i.number)+'</td><td>'+esc(i.title)+'</td><td>'+(i.role?(ICON[i.role]||"")+" "+esc(i.role):"")+'</td><td>'+badge(i.state)+'</td><td class="muted">'+ago(i.updated_at)+'</td><td><button class="arch" onclick="ax(\\''+esc(i.repo)+'\\','+i.number+')">archive</button></td></tr>';
    }).join(""):'<tr><td class="muted">—</td></tr>';
  }
  window.ax=function(repo,n){fetch("/archive",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:repo,number:n})}).then(function(){getJSON(render);});};
  function tick(){getJSON(render);} tick(); setInterval(tick,8000);
  sse(function(){ /* tables refresh on tick; keep it calm here */ });
})();
</script></body></html>`;
}
