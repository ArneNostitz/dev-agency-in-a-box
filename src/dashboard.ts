/**
 * The status dashboard — a light, mobile-first kanban.
 *
 * Board: one section per repo, with state lanes (Working / Waiting on you / Ready / Needs
 * attention / Merged) you swipe horizontally on a phone. Tapping a card opens a side-panel
 * drawer (full-screen on mobile) with: direct issue + PR links, an "Open preview" button, a
 * "Run checks" button (tester on the branch, no merge), the live agent stream for that card,
 * the full GitHub conversation (markdown-rendered), and an inline reply box that posts
 * straight to GitHub (and re-engages the agency).
 *
 * Everything is one self-contained HTML file fed by /data, /thread, /events (SSE),
 * /comment and /run-checks.
 */

/** Shared client helpers: escaping, a tiny safe markdown renderer, time, icons. */
const CLIENT_HELPERS = `
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}
  function ago(iso){if(!iso)return "";var s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);if(s<60)return Math.floor(s)+"s";if(s<3600)return Math.floor(s/60)+"m";if(s<86400)return Math.floor(s/3600)+"h";return Math.floor(s/86400)+"d";}
  var ICON={planner:"🧠",architect:"🏛",developer:"💻",reviewer:"🔍",tester:"🧪",librarian:"📚"};
  function mdInline(s){
    return s
      .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
      .replace(/(^|[^*])\\*([^*\\n]+)\\*(?!\\*)/g,'$1<em>$2</em>')
      .replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function md(src){
    var lines=esc(String(src||"")).split(/\\r?\\n/), out=[], i=0, inList=false, inCode=false, code=[];
    function closeList(){ if(inList){out.push("</ul>");inList=false;} }
    for(i=0;i<lines.length;i++){
      var ln=lines[i];
      if(/^\\s*\`\`\`/.test(ln)){
        if(inCode){ out.push("<pre><code>"+code.join("\\n")+"</code></pre>"); code=[]; inCode=false; }
        else { closeList(); inCode=true; }
        continue;
      }
      if(inCode){ code.push(ln); continue; }
      var h=/^(#{1,6})\\s+(.*)$/.exec(ln);
      if(h){ closeList(); out.push("<h5>"+mdInline(h[2])+"</h5>"); continue; }
      var li=/^\\s*[-*]\\s+(.*)$/.exec(ln);
      if(li){ if(!inList){out.push("<ul>");inList=true;} out.push("<li>"+mdInline(li[1])+"</li>"); continue; }
      if(/^\\s*$/.test(ln)){ closeList(); out.push(""); continue; }
      closeList(); out.push("<p>"+mdInline(ln)+"</p>");
    }
    if(inCode) out.push("<pre><code>"+code.join("\\n")+"</code></pre>");
    closeList();
    return out.join("");
  }
  function key(r,n){return r+"#"+n;}
  function gh(repo,n){return "https://github.com/"+repo+"/issues/"+n;}
`;

const STYLE = `
  :root{
    --bg:#f6f7f9; --card:#ffffff; --ink:#1d2430; --muted:#6b7480; --line:#e5e8ec;
    --accent:#2f6df6; --accent-weak:#e8f0ff; --green:#1f9d57; --amber:#c77700; --red:#d1495b;
    --shadow:0 1px 2px rgba(20,30,50,.06),0 4px 14px rgba(20,30,50,.06);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
  body.noscroll{overflow:hidden}
  .drawer{height:100dvh}
  a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
  code{background:#f0f2f5;padding:1px 5px;border-radius:5px;font-size:.88em}
  pre{background:#f0f2f5;padding:10px 12px;border-radius:8px;overflow:auto;margin:6px 0} pre code{background:none;padding:0}
  .top{position:sticky;top:0;z-index:5;background:rgba(246,247,249,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:10px 14px}
  .top h1{font-size:16px;margin:0;display:flex;align-items:center;gap:8px}
  .sub{color:var(--muted);font-size:12px;margin-top:3px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;animation:p 1.3s infinite}
  @keyframes p{0%{box-shadow:0 0 0 0 rgba(31,157,87,.5)}70%{box-shadow:0 0 0 7px rgba(31,157,87,0)}100%{box-shadow:0 0 0 0 rgba(31,157,87,0)}}
  .chips{display:flex;gap:6px;overflow:auto;padding:8px 14px 2px;-webkit-overflow-scrolling:touch}
  .chip{flex:0 0 auto;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:5px 11px;font-size:13px;color:var(--muted);cursor:pointer}
  .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .wrap{padding:6px 8px 40px}
  .repo{margin:10px 6px 4px;font-weight:650;font-size:13px;color:var(--muted);display:flex;align-items:center;gap:8px}
  .lanes{display:flex;gap:10px;overflow-x:auto;padding:6px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
  .lane{flex:0 0 78vw;max-width:330px;scroll-snap-align:start}
  @media(min-width:760px){.lane{flex:0 0 270px}}
  .lane h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:2px 4px 8px;display:flex;justify-content:space-between}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;box-shadow:var(--shadow);cursor:pointer}
  .card:active{transform:scale(.99)}
  .card .t{font-weight:560;font-size:14px;margin:1px 0 6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card .m{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:12px}
  .tag{font-size:11px;padding:1px 7px;border-radius:999px;background:#eef1f5;color:var(--muted)}
  .tag.pr{background:var(--accent-weak);color:var(--accent)} .tag.prev{background:#e9f8ef;color:var(--green)}
  .empty{color:#aeb6c0;font-size:12px;padding:8px 4px}
  /* drawer */
  .scrim{position:fixed;inset:0;background:rgba(15,22,35,.34);opacity:0;pointer-events:none;transition:opacity .18s;z-index:20}
  .scrim.on{opacity:1;pointer-events:auto}
  .drawer{position:fixed;top:0;right:0;height:100%;width:100%;max-width:520px;background:var(--bg);z-index:21;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s ease;box-shadow:-8px 0 30px rgba(15,22,35,.18)}
  .drawer.on{transform:translateX(0)}
  .dhead{padding:12px 14px;border-bottom:1px solid var(--line);background:var(--card);display:flex;gap:10px;align-items:flex-start}
  .dhead .x{margin-left:auto;font-size:22px;line-height:1;color:var(--muted);background:none;border:none;cursor:pointer;padding:0 2px}
  .dhead .t{font-weight:650;font-size:15px}
  .dactions{display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--card)}
  .btn{border:1px solid var(--line);background:var(--card);border-radius:9px;padding:7px 11px;font-size:13px;color:var(--ink);cursor:pointer;display:inline-flex;gap:6px;align-items:center;font-weight:540}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
  .btn:disabled{opacity:.5}
  .dbody{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 14px 18px}
  .sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 2px 6px}
  .stream{background:#0e1422;color:#cfe;border-radius:10px;padding:8px 10px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:30vh;overflow:auto}
  .stream .l{white-space:pre-wrap;border-bottom:1px solid rgba(255,255,255,.05);padding:1px 0}
  .stream .tool{color:#86c5ff} .stream .muted{color:#8aa}
  .cmt{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 11px;margin-bottom:8px}
  .cmt .h{font-size:12px;color:var(--muted);margin-bottom:2px;display:flex;gap:6px;align-items:center}
  .cmt.ag{border-color:#dbe6ff;background:#f7faff}
  .cmt .b p{margin:5px 0} .cmt .b h5{margin:8px 0 4px;font-size:14px} .cmt .b ul{margin:5px 0 5px 18px;padding:0}
  .reply{border-top:1px solid var(--line);background:var(--card);padding:10px;display:flex;gap:8px;align-items:flex-end}
  .reply textarea{flex:1;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font:14px inherit;resize:none;max-height:40vh;min-height:42px}
  .reply .btn{height:42px}
  .toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#1d2430;color:#fff;padding:8px 14px;border-radius:999px;font-size:13px;opacity:0;transition:opacity .2s;z-index:30}
  .toast.on{opacity:1}
`;

/** The light, mobile-first kanban + detail drawer. */
export function renderDashboard(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light"><title>Dev Agency</title>
<style>${STYLE}</style></head><body>
  <div class="top">
    <h1>🤖 Dev Agency <span id="live"></span></h1>
    <div class="sub" id="sub">Loading…</div>
  </div>
  <div class="chips" id="repochips"></div>
  <div class="wrap" id="board"><div class="empty">Loading…</div></div>

  <div class="scrim" id="scrim" onclick="closeDrawer()"></div>
  <aside class="drawer" id="drawer" aria-hidden="true">
    <div class="dhead">
      <div><div class="t" id="d_title">—</div><div class="sub" id="d_meta"></div></div>
      <button class="x" onclick="closeDrawer()" aria-label="Close">×</button>
    </div>
    <div class="dactions" id="d_actions"></div>
    <div class="dbody" id="d_body"></div>
    <div class="reply">
      <textarea id="d_reply" placeholder="Reply… (posts to GitHub)" rows="1"
        oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
      <button class="btn primary" id="d_send" onclick="sendReply()">Send</button>
    </div>
  </aside>
  <div class="toast" id="toast"></div>

<script>
${CLIENT_HELPERS}
(function(){
  var DATA={issues:[],active:[],activity:[],repos:[]}, repoFilter=null, open=null;
  var COLS=[
    {k:"working",  label:"Working",        match:function(i){return i.active||i.state==="agency:in-progress";}},
    {k:"waiting",  label:"Waiting on you",  match:function(i){return i.state==="agency:awaiting-approval"||i.state==="agency:awaiting-answer";}},
    {k:"ready",    label:"Ready · PR",      match:function(i){return i.state==="agency:ready";}},
    {k:"attention",label:"Needs attention", match:function(i){return i.state==="agency:needs-attention";}},
    {k:"merged",   label:"Merged",          match:function(i){return i.state==="merged"||i.state==="agency:merged";}}
  ];
  function toast(t){var e=document.getElementById("toast");e.textContent=t;e.classList.add("on");setTimeout(function(){e.classList.remove("on");},1800);}
  function activeKey(i){return DATA.active.some(function(a){return a.repo===i.repo&&a.number===i.number;});}

  function getJSON(u){return fetch(u).then(function(r){return r.json();});}
  function load(){getJSON("/data").then(function(d){
    DATA=d; DATA.issues=(d.issues||[]).map(function(i){i.active=activeKey(i);return i;});
    renderSub(); renderChips(); renderBoard(); if(open) refreshDrawerLive();
  }).catch(function(){});}

  function renderSub(){
    var n=(DATA.active||[]).length;
    document.getElementById("live").innerHTML = n? '<span class="dot"></span>' : '';
    var sp=DATA.spendToday&&DATA.spendToday.costUsd>0? ' · today $'+DATA.spendToday.costUsd.toFixed(2):'';
    document.getElementById("sub").innerHTML = (n? n+' working now':'Idle')+sp+' · <a href="/history">history</a>';
  }
  function renderChips(){
    var repos=DATA.repos||[]; var c=document.getElementById("repochips");
    c.innerHTML='<span class="chip '+(repoFilter?'' :'on')+'" onclick="setRepo(null)">All</span>'+
      repos.map(function(r){return '<span class="chip '+(repoFilter===r?'on':'')+'" onclick="setRepo(\\''+r+'\\')">'+esc(r.split("/").pop())+'</span>';}).join("");
  }
  window.setRepo=function(r){repoFilter=r;renderChips();renderBoard();};

  function card(i){
    var tags='';
    if(i.pr_number) tags+='<span class="tag pr">PR #'+i.pr_number+'</span>';
    if(i.previewUrl) tags+='<span class="tag prev">preview</span>';
    var role=i.role?(ICON[i.role]||"")+" ":"";
    return '<div class="card" onclick=\\'openDrawer('+JSON.stringify(i.repo)+','+i.number+')\\'>'+
      '<div class="t">'+(i.active?'<span class="dot"></span> ':'')+esc(i.title||("#"+i.number))+'</div>'+
      '<div class="m">'+role+'#'+i.number+' '+tags+'<span style="margin-left:auto">'+ago(i.updated_at)+'</span></div></div>';
  }
  function renderBoard(){
    var repos=(DATA.repos||[]).filter(function(r){return !repoFilter||r===repoFilter;});
    var byRepo={}; repos.forEach(function(r){byRepo[r]=[];});
    DATA.issues.forEach(function(i){ if(byRepo[i.repo]) byRepo[i.repo].push(i); });
    var html=repos.map(function(r){
      var items=byRepo[r]||[];
      var lanes=COLS.map(function(col){
        var inCol=items.filter(col.match);
        return '<div class="lane"><h3>'+col.label+'<span>'+(inCol.length||"")+'</span></h3>'+
          (inCol.length?inCol.map(card).join(""):'<div class="empty">—</div>')+'</div>';
      }).join("");
      return '<div class="repo">'+esc(r)+'</div><div class="lanes">'+lanes+'</div>';
    }).join("");
    document.getElementById("board").innerHTML = html||'<div class="empty">No repos yet. File a /add-repo issue.</div>';
  }

  // ---- drawer ----
  function findIssue(repo,n){return DATA.issues.filter(function(i){return i.repo===repo&&i.number===n;})[0];}
  window.openDrawer=function(repo,n){
    var i=findIssue(repo,n)||{repo:repo,number:n,title:"#"+n};
    open={repo:repo,number:n,issue:i};
    document.getElementById("d_title").textContent=(i.title||("#"+n));
    document.getElementById("d_meta").innerHTML=esc(repo)+' · #'+n+(i.state?' · '+esc(i.state.replace("agency:","")):'');
    var a='<a class="btn" href="'+gh(repo,n)+'" target="_blank" rel="noopener">Issue ↗</a>';
    if(i.pr_url) a+='<a class="btn" href="'+i.pr_url+'" target="_blank" rel="noopener">PR ↗</a>';
    if(i.previewUrl) a+='<a class="btn primary" href="'+i.previewUrl+'" target="_blank" rel="noopener">Open preview ↗</a>';
    a+='<button class="btn" id="d_checks" onclick="runChecks()">▶ Run checks</button>';
    document.getElementById("d_actions").innerHTML=a;
    document.getElementById("d_body").innerHTML='<div class="sec">Live</div><div class="stream" id="d_stream"></div><div class="sec">Conversation</div><div id="d_thread"><div class="empty">Loading…</div></div>';
    renderStream(); loadThread();
    document.getElementById("drawer").classList.add("on");
    document.getElementById("scrim").classList.add("on");
    document.getElementById("drawer").setAttribute("aria-hidden","false");
    document.body.classList.add("noscroll"); // lock the board behind the drawer
  };
  window.closeDrawer=function(){open=null;document.getElementById("drawer").classList.remove("on");document.getElementById("scrim").classList.remove("on");document.getElementById("drawer").setAttribute("aria-hidden","true");document.body.classList.remove("noscroll");};

  function lineHtml(a){var c=a.kind==="tool"?"tool":(a.kind==="start"||a.kind==="done"?"muted":"");return '<div class="l '+c+'">'+esc(a.text)+'</div>';}
  function renderStream(){
    if(!open)return; var el=document.getElementById("d_stream"); if(!el)return;
    var evs=(DATA.activity||[]).filter(function(x){return x.repo===open.repo&&x.number===open.number;}).slice(-40);
    el.innerHTML=evs.length?evs.map(lineHtml).join(""):'<div class="l muted">No live activity. Tap “Run checks” or reply below.</div>';
    el.scrollTop=el.scrollHeight;
  }
  function refreshDrawerLive(){renderStream(); var i=findIssue(open.repo,open.number); if(i){open.issue=i;}}

  function loadThread(){
    getJSON("/thread?repo="+encodeURIComponent(open.repo)+"&number="+open.number).then(function(t){
      if(!open)return; var el=document.getElementById("d_thread"); if(!el)return;
      var parts=[];
      if(t.body) parts.push(cmtHtml({author:t.author,createdAt:t.createdAt,body:t.body,isAgency:false}));
      (t.comments||[]).forEach(function(c){parts.push(cmtHtml(c));});
      el.innerHTML=parts.length?parts.join(""):'<div class="empty">No description.</div>';
    }).catch(function(){});
  }
  function cmtHtml(c){
    return '<div class="cmt'+(c.isAgency?' ag':'')+'"><div class="h">'+(c.isAgency?'🤖 ':'')+esc(c.author||"")+
      ' · '+ago(c.createdAt)+'</div><div class="b">'+md(c.body)+'</div></div>';
  }

  window.runChecks=function(){
    if(!open)return; var b=document.getElementById("d_checks"); b.disabled=true;
    fetch("/run-checks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number,title:(open.issue&&open.issue.title)||""})})
      .then(function(){toast("Running checks…");setTimeout(function(){b.disabled=false;},4000);})
      .catch(function(){b.disabled=false;});
  };
  window.sendReply=function(){
    if(!open)return; var ta=document.getElementById("d_reply"); var body=ta.value.trim(); if(!body)return;
    var btn=document.getElementById("d_send"); btn.disabled=true;
    fetch("/comment",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number,body:body})})
      .then(function(r){if(!r.ok)throw 0; ta.value="";ta.style.height="auto";toast("Sent");setTimeout(loadThread,900);})
      .catch(function(){toast("Couldn’t send");})
      .then(function(){btn.disabled=false;});
  };

  // SSE: append live lines to the open drawer in real time.
  try{var es=new EventSource("/events");
    es.onmessage=function(ev){try{var a=JSON.parse(ev.data);
      DATA.activity.push(a); if(DATA.activity.length>500)DATA.activity.shift();
      if(open&&a.repo===open.repo&&a.number===open.number){var el=document.getElementById("d_stream");if(el){el.insertAdjacentHTML("beforeend",lineHtml(a));el.scrollTop=el.scrollHeight;}}
    }catch(e){}};
  }catch(e){}

  load(); setInterval(load,5000);
  document.addEventListener("keydown",function(e){if(e.key==="Escape")closeDrawer();});
})();
</script></body></html>`;
}

/** History: the full firehose, recent runs (with cost), and all issues with archive. Light. */
export function renderHistory(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<title>Dev Agency · history</title><style>${STYLE}
  table{width:100%;border-collapse:collapse;font-size:13px;background:var(--card);border-radius:10px;overflow:hidden}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)} th{color:var(--muted);font-size:11px;text-transform:uppercase}
  details{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:6px 0;padding:2px 4px}
  summary{cursor:pointer;padding:7px 8px;font-size:13px} .ln{font:12px ui-monospace,Menlo,monospace;padding:1px 8px;color:#475}
  .arch{cursor:pointer;color:var(--muted);border:none;background:none;font-size:12px}.arch:hover{color:var(--red)}
</style></head><body>
  <div class="top"><h1>🤖 Dev Agency — history</h1><div class="sub"><a href="/">← board</a></div></div>
  <div class="wrap">
    <div class="sec" style="margin:8px 4px">Recent activity</div><div id="stream"><div class="empty">Loading…</div></div>
    <div class="sec" style="margin:14px 4px 6px">Recent runs</div><table><tbody id="runs"></tbody></table>
    <div class="sec" style="margin:14px 4px 6px">All issues</div><table><tbody id="issues"></tbody></table>
  </div>
<script>
${CLIENT_HELPERS}
(function(){
  function getJSON(u,cb){fetch(u).then(function(r){return r.json();}).then(cb).catch(function(){});}
  function render(d){
    var groups={};(d.activity||[]).forEach(function(a){(groups[key(a.repo,a.number)]=groups[key(a.repo,a.number)]||[]).push(a);});
    var ks=Object.keys(groups);
    document.getElementById("stream").innerHTML=ks.length?ks.map(function(k){var e=groups[k],last=e[e.length-1];
      return '<details><summary>'+(ICON[last.role]||"•")+' '+esc(k)+' · '+e.length+' events</summary>'+e.slice(-60).map(function(a){return '<div class="ln">'+esc(a.text)+'</div>';}).join("")+'</details>';}).join(""):'<div class="empty">No activity yet.</div>';
    document.getElementById("runs").innerHTML=(d.runs||[]).map(function(r){
      return '<tr><td>'+(ICON[r.role]||"")+' '+esc(r.role)+'</td><td><a href="'+gh(r.repo,r.number)+'" target="_blank">'+esc(r.repo.split("/").pop())+' #'+r.number+'</a></td><td>'+esc(r.kind)+'</td><td>'+r.turns+'t</td><td>'+(r.cost_usd>0?'$'+r.cost_usd.toFixed(2):'—')+'</td><td>'+ago(r.created_at)+'</td></tr>';}).join("")||'<tr><td class="empty">No runs.</td></tr>';
    document.getElementById("issues").innerHTML=(d.issues||[]).map(function(i){
      return '<tr><td><a href="'+gh(i.repo,i.number)+'" target="_blank">'+esc(i.repo.split("/").pop())+' #'+i.number+'</a></td><td>'+esc(i.title||"")+'</td><td>'+esc((i.state||"").replace("agency:",""))+'</td><td>'+ago(i.updated_at)+'</td><td><button class="arch" onclick="ax(\\''+i.repo+'\\','+i.number+')">archive</button></td></tr>';}).join("")||'<tr><td class="empty">—</td></tr>';
  }
  window.ax=function(repo,n){fetch("/archive",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:repo,number:n})}).then(function(){getJSON("/data",render);});};
  function tick(){getJSON("/data",render);} tick(); setInterval(tick,8000);
})();
</script></body></html>`;
}
