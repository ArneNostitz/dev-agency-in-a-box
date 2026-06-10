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
  var ICONS={
    link:'<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    pr:'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
    merge:'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
    refresh:'<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    flask:'<path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.52 16h12.96"/>',
    globe:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    play:'<polygon points="6 3 20 12 6 21 6 3"/>',
    stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',
    monitor:'<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    laptop:'<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
    trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    hourglass:'<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.41L12 12l-4.41 4.42A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.41L12 12l4.41-4.42A2 2 0 0 0 17 6.17V2"/>',
    clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    layers:'<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    plus:'<path d="M5 12h14"/><path d="M12 5v14"/>'
  };
  function ic(n,sz){var s=sz||16;return '<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lic">'+(ICONS[n]||"")+'</svg>';}
  function mdInline(s){
    return s
      .replace(/!\\[([^\\]]*)\\]\\((https?:[^)\\s]+)\\)/g,'<img alt="$1" src="$2" style="max-width:100%;border-radius:8px;margin:4px 0">')
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
  .toolbar{display:flex;gap:8px;padding:8px 14px 2px}
  .toolbar input{flex:1;border:1px solid var(--line);border-radius:9px;padding:7px 11px;font:14px inherit;background:var(--card);color:var(--ink)}
  .toolbar select{border:1px solid var(--line);border-radius:9px;padding:7px 9px;font:13px inherit;background:var(--card);color:var(--ink)}
  .gauge{display:inline-block;width:64px;height:6px;border-radius:3px;background:var(--line);vertical-align:middle;overflow:hidden;margin:0 4px}
  .gauge i{display:block;height:100%;background:var(--green)}
  .wrap{padding:6px 8px 40px}
  .repo{margin:12px 6px 2px;font-weight:650;font-size:13px;color:var(--muted);display:flex;align-items:center;gap:8px}
  .repoadd{border:1px solid var(--line);background:var(--card);color:var(--accent);border-radius:7px;padding:2px 9px;font-size:12px;cursor:pointer}
  /* Mobile: sections stacked vertically; columns scroll horizontally WITHIN each section. This
     avoids the nested horizontal-in-horizontal scroll that made lanes overlap. */
  .sections{display:flex;flex-direction:column;gap:14px;padding:6px}
  .section{width:100%;border-radius:14px;padding:2px 4px 6px}
  .section .sechead{font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:650;padding:8px 10px 2px}
  .section .sechead span{color:var(--muted);font-weight:550}
  .section.attn{background:#eaf1ff;border:1px solid #d3e1ff}
  .section.attn .sechead{color:#2f5bd0}
  .section.work{background:#fff7e9;border:1px solid #f3e2c2}
  .section.work .sechead{color:#a76a00}
  .section.done{background:#eef0f2;border:1px solid var(--line);opacity:.72}
  .section.done .sechead{color:#7a828c}
  .section.done .card{background:#f6f7f9;box-shadow:none}
  .lanes{display:flex;gap:10px;padding:4px;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .lane{flex:0 0 78vw;max-width:320px}
  @media(min-width:760px){
    .sections{flex-direction:row;overflow-x:auto;align-items:flex-start}
    .section{width:auto;flex:0 0 auto}
    .lanes{overflow-x:visible}
    .lane{flex:0 0 248px}
  }
  .lic{display:inline-block;vertical-align:-3px}
  .btn.ic .lic{vertical-align:0}
  .tag .lic,.cardbtn .lic{vertical-align:-2px;width:12px;height:12px;margin-right:1px}
  .lane h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:2px 4px 8px;display:flex;justify-content:space-between}
  /* Show ~8 cards, then scroll within the lane (cards are ~84px tall). */
  .lanecards{max-height:min(72vh,672px);overflow-y:auto;padding:0 4px 2px;-webkit-overflow-scrolling:touch}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;box-shadow:var(--shadow);cursor:pointer}
  .card:active{transform:scale(.99)}
  .card .t{font-weight:560;font-size:14px;margin:1px 0 6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card .m{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:12px}
  .tag{font-size:11px;padding:1px 7px;border-radius:999px;background:#eef1f5;color:var(--muted)}
  .tag.pr{background:var(--accent-weak);color:var(--accent)} .tag.prev{background:#e9f8ef;color:var(--green)} .tag.epic{background:#efe9ff;color:#6741d9} .tag.q{background:#f0f1f3;color:#7a828c} .tag.rl{background:#fff1d6;color:#a76a00} .tag.fix{background:#fde8e8;color:#c0392b} .tag.auto{background:#e6f7ef;color:#0b8a52}
  .autoset{display:inline-flex;gap:5px;margin-left:6px}
  .autorow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:2px}
  .apill{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:999px;padding:3px 9px;font-size:12px;font-weight:540;cursor:pointer}
  .apill span{font-size:11px}
  .apill.on{background:#e6f7ef;border-color:#bfe6d2;color:#0b8a52}
  .apill.off{background:#f4f5f7;border-color:var(--line);color:#aab1bb;text-decoration:line-through}
  .ckline{display:flex;align-items:center;gap:8px;font-size:13px;margin:6px 2px;color:var(--ink)}
  .ckline input{width:auto}
  .cardbtn{border:1px solid #cdebd6;background:#e9f8ef;color:var(--green);border-radius:7px;padding:1px 8px;font-size:11px;cursor:pointer;font-weight:560}
  .cardbtn.rs{border-color:#d3def0;background:#eef3fb;color:#3b6cc9}
  .cardbtn.fx{border-color:#f3d2cf;background:#fdeceb;color:#c0392b}
  .cmdrow{display:flex;gap:6px;align-items:center}
  .cmdrow code{flex:1;overflow:auto;white-space:nowrap;background:#0f1117;color:#d7e0ee;padding:6px 8px;border-radius:7px;font-size:12px}
  .epiclist{margin:2px 0 4px} .epiclist a{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--line);font-size:13px;color:var(--ink)}
  .epiclist .st{margin-left:auto;font-size:11px;color:var(--muted)} .epiclist .ck{color:var(--green)} .epiclist .ck.o{color:#c9ced6}
  .ebar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin:6px 0}.ebar i{display:block;height:100%;background:#6741d9}
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
  .btn.danger{color:var(--red);border-color:#f0ccd1}
  .btn.armed{background:var(--amber);border-color:var(--amber);color:#fff}
  .btn.ic{padding:7px 9px;font-size:15px;line-height:1}
  .dactions{position:relative;overflow:visible}
  [data-tip]{position:relative}
  [data-tip]:hover::after{content:attr(data-tip);position:absolute;left:50%;top:calc(100% + 7px);transform:translateX(-50%);background:#0f1117;color:#fff;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:500;white-space:nowrap;z-index:60;pointer-events:none}
  [data-tip]:hover::before{content:"";position:absolute;left:50%;top:calc(100% + 2px);transform:translateX(-50%);border:5px solid transparent;border-bottom-color:#0f1117;z-index:60;pointer-events:none}
  .btn:disabled{opacity:.5}
  .dbody{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 14px 18px}
  .sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 2px 6px}
  .dstream{flex:none;background:var(--card);border-bottom:1px solid var(--line)}
  .streamhd{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);cursor:pointer;user-select:none}
  .dstream.collapsed .stream{display:none}
  .dstream .stream{margin:0 12px 10px}
  .stream{background:#0e1422;color:#cfe;border-radius:10px;padding:8px 10px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:26vh;overflow:auto}
  .stream .l{white-space:pre-wrap;border-bottom:1px solid rgba(255,255,255,.05);padding:1px 0}
  .stream .tool{color:#86c5ff} .stream .muted{color:#8aa}
  .cmt{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 11px;margin-bottom:8px}
  .cmt .h{font-size:12px;color:var(--muted);margin-bottom:2px;display:flex;gap:6px;align-items:center}
  .cmt.ag{border-color:#dbe6ff;background:#f7faff}
  .cmt .b p{margin:5px 0} .cmt .b h5{margin:8px 0 4px;font-size:14px} .cmt .b ul{margin:5px 0 5px 18px;padding:0}
  .reply{border-top:1px solid var(--line);background:var(--card);padding:10px;display:flex;gap:8px;align-items:flex-end}
  .reply textarea{flex:1;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font:14px inherit;resize:none;max-height:40vh;min-height:42px}
  .reply .btn{height:42px}
  .atts{display:flex;gap:6px;flex-wrap:wrap;padding:0 10px}.atts:empty{display:none}
  .att{position:relative}.att img{height:46px;border-radius:6px;border:1px solid var(--line)}
  .att button{position:absolute;top:-6px;right:-6px;background:#1d2430;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer}
  .att.file{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg);border:1px solid var(--line);border-radius:8px;font-size:12px;color:var(--ink)}
  .att.file button{position:static;width:auto;height:auto;background:none;color:var(--muted);border-radius:0;font-size:14px;margin-left:2px}
  .toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#1d2430;color:#fff;padding:8px 14px;border-radius:999px;font-size:13px;opacity:0;transition:opacity .2s;z-index:30}
  .toast.on{opacity:1}
  .newbtn{margin-left:auto;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:9px;padding:5px 11px;font-size:13px;font-weight:540;cursor:pointer}
  .iconbtn{border:1px solid var(--line);background:var(--card);color:var(--muted);border-radius:9px;padding:5px 9px;font-size:14px;cursor:pointer;margin-left:6px}
  .usage{border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:4px}
  .urow{display:flex;justify-content:space-between;padding:7px 11px;font-size:13px;border-bottom:1px solid var(--line)}
  .urow:last-child{border-bottom:none}.urow.tot{font-weight:650;background:var(--bg)}
  .clk{cursor:pointer;border-bottom:1px dotted var(--muted)}
  .composer{position:fixed;left:0;right:0;bottom:0;z-index:25;background:var(--card);border-top:1px solid var(--line);border-radius:16px 16px 0 0;padding:14px 14px 18px;max-height:92dvh;overflow:auto;transform:translateY(calc(100% + 48px));transition:transform .2s ease;box-shadow:0 -8px 30px rgba(15,22,35,.18);visibility:hidden;pointer-events:none}
  .composer.on{transform:translateY(0);visibility:visible;pointer-events:auto}
  @media(min-width:760px){.composer{left:auto;right:24px;bottom:24px;width:440px;border:1px solid var(--line);border-radius:16px}}
  .composer .ch{display:flex;align-items:center;margin-bottom:6px}.composer .ch .t{font-weight:650;font-size:15px}
  .composer label{display:block;font-size:12px;color:var(--muted);margin:10px 2px 4px}
  .composer input,.composer select,.composer textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:9px 11px;font:14px inherit;background:var(--bg);color:var(--ink)}
  .composer textarea{resize:vertical;min-height:96px}
  .composer .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
`;

/** The light, mobile-first kanban + detail drawer. */
export function renderDashboard(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light"><title>Dev Agency</title>
<style>${STYLE}</style></head><body>
  <div class="top">
    <h1>🤖 Dev Agency <span id="live"></span><button class="newbtn" onclick="openComposer()">+ New</button><button class="iconbtn" onclick="openSettings()" aria-label="Settings">⚙</button></h1>
    <div class="sub" id="sub">Loading…</div>
  </div>
  <div class="chips" id="repochips"></div>
  <div class="toolbar">
    <input id="q" placeholder="Search title or #number…" autocomplete="off" oninput="onSearch(this.value)">
    <select id="sort" onchange="onSort(this.value)">
      <option value="updated">Newest</option>
      <option value="number">By number</option>
      <option value="title">By name</option>
    </select>
  </div>
  <div class="wrap" id="board"><div class="empty">Loading…</div></div>

  <div class="scrim" id="scrim" onclick="closeDrawer()"></div>
  <aside class="drawer" id="drawer" aria-hidden="true">
    <div class="dhead">
      <div><div class="t" id="d_title">—</div><div class="sub" id="d_meta"></div></div>
      <button class="x" onclick="closeDrawer()" aria-label="Close">×</button>
    </div>
    <div class="dactions" id="d_actions"></div>
    <div class="dstream" id="d_streamwrap">
      <div class="streamhd" onclick="toggleStream()"><span>● Live</span><span id="d_caret">▾</span></div>
      <div class="stream" id="d_stream"></div>
    </div>
    <div class="dbody" id="d_body"></div>
    <div id="d_atts" class="atts"></div>
    <div class="reply">
      <input type="file" id="d_file" multiple style="display:none" onchange="onPickImage(event)">
      <button class="btn" title="Attach file or image" onclick="document.getElementById('d_file').click()">📎</button>
      <textarea id="d_reply" placeholder="Reply… (paste an image to attach)" rows="1"
        oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
        onpaste="onPasteImage(event)"></textarea>
      <button class="btn primary" id="d_send" onclick="sendReply()">Send</button>
    </div>
  </aside>
  <div class="scrim" id="cscrim" onclick="closeComposer()"></div>
  <div class="composer" id="composer">
    <div class="ch"><div class="t">New issue</div><button class="x" style="margin-left:auto" onclick="closeComposer()" aria-label="Close">×</button></div>
    <label>Repo</label><select id="c_repo"></select>
    <label>Assign to</label>
    <select id="c_role">
      <option value="@dev">@dev — full pipeline (plan → build → PR)</option>
      <option value="@plan">@plan — plan only</option>
      <option value="@arch">@arch — architect</option>
      <option value="@review">@review — review</option>
      <option value="@test">@test — run checks</option>
    </select>
    <label>Title</label><input id="c_title" placeholder="Short title" autocomplete="off">
    <label>Description</label><textarea id="c_body" placeholder="What needs doing? Paste an image to attach." onpaste="onPasteC(event)"></textarea>
    <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
      <input type="file" id="c_file" multiple style="display:none" onchange="onPickC(event)">
      <button class="btn" onclick="document.getElementById('c_file').click()">📎 Add file / image</button>
      <div id="c_atts" class="atts"></div>
    </div>
    <div class="row"><button class="btn" onclick="closeComposer()">Cancel</button><button class="btn primary" id="c_create" onclick="submitIssue()">Create</button></div>
  </div>
  <div class="scrim" id="rscrim" onclick="closeAddRepo()"></div>
  <div class="composer" id="addrepo">
    <div class="ch"><div class="t">Add a repo to watch</div><button class="x" style="margin-left:auto" onclick="closeAddRepo()" aria-label="Close">×</button></div>
    <input id="ar_q" placeholder="Search your repos…" autocomplete="off" oninput="filterRepos(this.value)">
    <div id="ar_list" class="usage" style="margin-top:8px;max-height:54vh;overflow:auto"><div class="urow"><span class="muted">Loading your repos…</span></div></div>
    <div class="muted" style="font-size:12px;margin-top:8px">Adding invites the bot + registers the webhook automatically.</div>
  </div>
  <div class="scrim" id="sscrim" onclick="closeSettings()"></div>
  <div class="composer" id="settings">
    <div class="ch"><div class="t">Token budget</div><button class="x" style="margin-left:auto" onclick="closeSettings()" aria-label="Close">×</button></div>
    <label>Session window (hours)</label><input id="s_win" type="number" min="1" max="168" step="1">
    <div id="s_window" class="muted" style="font-size:12px;margin:6px 2px"></div>
    <label>Window start — set it if you know when your session began</label>
    <div style="display:flex;gap:8px"><input id="s_anchor" type="datetime-local"><button class="btn" onclick="setAnchor()">Set</button></div>
    <button class="btn" style="margin-top:6px" onclick="resetWindow()">Start window now</button>
    <div class="sec" style="margin:14px 2px 4px">Used this window</div>
    <div id="s_usage" class="usage"></div>
    <label>Calibrate: enter the % the Claude app shows now</label>
    <div style="display:flex;gap:8px"><input id="s_pct" type="number" min="1" max="100" placeholder="e.g. 42"><button class="btn" onclick="calcBudget()">Set from %</button></div>
    <label>Budget — tokens per window (0 = show tokens only)</label><input id="s_budget" type="number" min="0" step="1000">
    <div class="sec" style="margin:14px 2px 4px">Automation (global default)</div>
    <div id="s_auto" class="autorow"></div>
    <div class="muted" style="font-size:12px;margin:4px 2px">Override per-repo in its header, or per-issue in the card. Auto-merge only fires when the review is approved, there are no conflicts, and checks pass.</div>
    <div class="sec" style="margin:14px 2px 4px">Pipeline</div>
    <label class="ckline"><input type="checkbox" id="s_skiparch"> Skip the architect step (faster, fewer tokens)</label>
    <label class="ckline"><input type="checkbox" id="s_gitnexus"> Use GitNexus code index (fewer research tokens)</label>
    <label>Max tokens per run (kill-switch, 0 = off)</label><input id="s_maxtok" type="number" min="0" step="50000">
    <label>Reviewer revise rounds before it asks you</label><input id="s_revrounds" type="number" min="0" max="3" step="1">
    <div class="row"><button class="btn" onclick="closeSettings()">Cancel</button><button class="btn primary" id="s_save" onclick="saveSettings()">Save</button></div>
    <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" onclick="openAgents()">✎ Edit agents &amp; playbooks →</button>
      <button class="btn" onclick="openModels()">⚡ Models &amp; providers →</button>
    </div>
  </div>
  <div class="scrim" id="mscrim" onclick="closeModels()"></div>
  <div class="composer" id="models">
    <div class="ch"><div class="t">Models &amp; providers</div><button class="x" style="margin-left:auto" onclick="closeModels()" aria-label="Close">×</button></div>
    <div class="muted" style="font-size:12px">Claude roles stay on your subscription. Assign other roles to a provider (GLM, DeepSeek, Kimi…) with a native Anthropic-compatible endpoint.</div>
    <div class="sec" style="margin:10px 2px 4px">Providers</div>
    <div id="m_providers"></div>
    <div style="display:flex;gap:8px;margin-top:6px"><select id="m_preset"></select><button class="btn" onclick="addProvider()">+ Add</button></div>
    <div class="sec" style="margin:14px 2px 4px">Which model runs each agent</div>
    <div id="m_roles"></div>
    <div class="row"><button class="btn" onclick="closeModels()">Cancel</button><button class="btn primary" id="m_save" onclick="saveModels()">Save</button></div>
  </div>
  <div class="scrim" id="ascrim" onclick="closeAgents()"></div>
  <div class="composer" id="agents">
    <div class="ch"><div class="t">Edit agents &amp; playbooks</div><button class="x" style="margin-left:auto" onclick="closeAgents()" aria-label="Close">×</button></div>
    <label>File</label><select id="a_file" onchange="loadAgent()"></select>
    <div id="a_kind" class="muted" style="font-size:12px;margin:4px 2px"></div>
    <textarea id="a_content" spellcheck="false" style="min-height:44vh;font:13px ui-monospace,Menlo,monospace"></textarea>
    <div id="a_hist" class="usage" style="display:none;margin-top:6px"></div>
    <div class="muted" style="font-size:12px;margin-top:6px">Applies live on the next agent run (stored + versioned, no redeploy).</div>
    <div class="row"><button class="btn" onclick="revertAgent()">Revert to default</button><button class="btn" onclick="toggleHist()">History</button><button class="btn primary" id="a_save" onclick="saveAgent()">Save</button></div>
  </div>
  <div class="toast" id="toast"></div>

<script>
${CLIENT_HELPERS}
(function(){
  var DATA={issues:[],active:[],activity:[],repos:[]}, repoFilter=null, open=null, query="", sortKey="updated";
  var streamStick=true; // stick the Live stream to the bottom only until the user scrolls up
  // Columns grouped into 3 sections. "Needs you" (New, Waiting/Needs attention, Ready for
  // review) is prominent; "Working" is the agency busy; "Done" is greyed out.
  var COL={new:"New", waiting:"Waiting / Needs attention", review:"Ready for review", working:"Working", done:"Done"};
  var SECTIONS=[
    {k:"attn", label:"Needs you",  cols:["new","waiting","review"]},
    {k:"work", label:"Working",    cols:["working"]},
    {k:"done", label:"Done",       cols:["done"]}
  ];
  function classify(i){
    // Auto-resume (rate-limited) and queued both stay in Working with their badge.
    if(i.active||i.queued||i.state==="agency:in-progress"||i.state==="agency:rate-limited")return "working";
    if(i.state==="agency:epic")return (i.epic&&i.epic.done>=i.epic.total)?"review":"working";
    if(i.state==="agency:awaiting-approval"||i.state==="agency:awaiting-answer"||i.state==="agency:needs-attention")return "waiting";
    if(i.state==="agency:ready")return "review";
    if(i.state==="merged"||i.state==="agency:merged"||i.state==="closed"||i.state==="done")return "done";
    return "new";
  }
  function fmtTok(n){if(n>=1e6)return (n/1e6).toFixed(2)+"M";if(n>=1e3)return Math.round(n/1e3)+"k";return ""+(n||0);}
  function matchQ(i){if(!query)return true;var q=query.toLowerCase();return (i.title||"").toLowerCase().indexOf(q)>=0||(""+i.number).indexOf(q)>=0;}
  function cmp(a,b){if(sortKey==="number")return a.number-b.number;if(sortKey==="title")return (a.title||"").localeCompare(b.title||"");return new Date(b.updated_at||0)-new Date(a.updated_at||0);}
  function toast(t){var e=document.getElementById("toast");e.textContent=t;e.classList.add("on");setTimeout(function(){e.classList.remove("on");},1800);}
  function activeKey(i){return DATA.active.some(function(a){return a.repo===i.repo&&a.number===i.number;});}
  var INFLIGHT={has:function(){return false;}};
  function queuedKey(i){return !i.active && INFLIGHT.has(i.repo+"#"+i.number);}

  function getJSON(u){return fetch(u).then(function(r){return r.json();});}
  function load(){getJSON("/data").then(function(d){
    DATA=d; INFLIGHT=new Set(d.inflight||[]);
    var RL={}; (d.rateLimited||[]).forEach(function(r){RL[r.repo+"#"+r.number]=r.resumeAt;});
    DATA.issues=(d.issues||[]).map(function(i){i.active=activeKey(i);i.queued=queuedKey(i);i.resumeAt=RL[i.repo+"#"+i.number];return i;});
    renderSub(); renderChips(); renderBoard(); if(open) refreshDrawerLive();
    if(document.getElementById("settings").classList.contains("on")) refreshSettings();
  }).catch(function(){});}

  function renderSub(){
    var n=(DATA.active||[]).length;
    document.getElementById("live").innerHTML = n? '<span class="dot"></span>' : '';
    var sp=DATA.spendToday&&DATA.spendToday.costUsd>0? ' · today $'+DATA.spendToday.costUsd.toFixed(2):'';
    var sess="", s=DATA.session;
    if(s&&(s.tokens||s.budget)){
      sess=' · <span class="clk" onclick="openSettings()">'+fmtTok(s.tokens)+' tok';
      if(s.budget>0){var pct=Math.min(100,Math.round(100*s.tokens/s.budget));
        var col=pct>=90?'var(--red)':pct>=70?'var(--amber)':'var(--green)';
        sess+=' <span class="gauge"><i style="width:'+pct+'%;background:'+col+'"></i></span> '+pct+'%';
      }
      if(s.resetsAt){ sess+=' · resets '+hm(new Date(s.resetsAt))+' ('+remain(s.resetsAt)+' left)'; }
      sess+='</span>';
    } else { sess=' · <span class="clk" onclick="openSettings()">set token budget</span>'; }
    document.getElementById("sub").innerHTML = (n? n+' working now':'Idle')+sp+sess+' · <a href="/history">history</a>';
  }
  function renderChips(){
    var repos=DATA.repos||[]; var c=document.getElementById("repochips");
    c.innerHTML='<span class="chip '+(repoFilter?'' :'on')+'" onclick="setRepo(null)">All</span>'+
      repos.map(function(r){return '<span class="chip '+(repoFilter===r?'on':'')+'" onclick="setRepo(\\''+r+'\\')">'+esc(r.split("/").pop())+'</span>';}).join("")+
      '<span class="chip" style="border-style:dashed" onclick="openAddRepo()">'+ic('plus',13)+' repo</span>';
  }
  window.setRepo=function(r){repoFilter=r;renderChips();renderBoard();};

  function isDone(i){var s=i.state||"";return s==="merged"||s==="agency:merged"||s==="closed"||s==="done";}
  function card(i){
    var tags=''; var needsFix = i.review==="changes" && !isDone(i);
    if(i.state==="agency:rate-limited") tags+='<span class="tag rl">'+ic('hourglass')+' '+(i.resumeAt?('auto-resume '+hm(new Date(i.resumeAt))):'auto-resume')+'</span>';
    if(i.queued) tags+='<span class="tag q">'+ic('clock')+' queued</span>';
    if(needsFix) tags+='<span class="tag fix">'+ic('alert')+' changes requested</span>';
    if(i.auto&&(i.auto.resume||i.auto.merge)&&!isDone(i)) tags+='<span class="tag auto" data-tip="'+(i.auto.merge?"auto-merge":"auto-resume")+' on">'+ic(i.auto.merge?'merge':'refresh')+' auto</span>';
    if(i.epic) tags+='<span class="tag epic">'+ic('layers')+' '+i.epic.done+'/'+i.epic.total+'</span>';
    if(i.pr_number) tags+='<a class="tag pr" href="'+(i.pr_url||gh(i.repo,i.pr_number))+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">'+ic('pr')+' #'+i.pr_number+'</a>';
    if(i.previewUrl) tags+='<a class="tag prev" href="'+i.previewUrl+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">'+ic('globe')+' preview</a>';
    var role=i.role?(ICON[i.role]||"")+" ":"";
    var quick='';
    if(i.state==="agency:awaiting-approval") quick+='<button class="cardbtn" onclick=\\'cardApprove('+JSON.stringify(i.repo)+','+i.number+',event)\\'>'+ic('check')+' approve</button> ';
    if(needsFix) quick+='<button class="cardbtn fx" onclick=\\'cardFix('+JSON.stringify(i.repo)+','+i.number+',event)\\'>'+ic('wrench')+' fix</button> ';
    if(i.state==="agency:needs-attention"||i.state==="agency:rate-limited") quick+='<button class="cardbtn rs" onclick=\\'cardResume('+JSON.stringify(i.repo)+','+i.number+',event)\\'>'+ic('refresh')+' resume</button> ';
    return '<div class="card" onclick=\\'openDrawer('+JSON.stringify(i.repo)+','+i.number+')\\'>'+
      '<div class="t">'+(i.active?'<span class="dot"></span> ':'')+esc(i.title||("#"+i.number))+'</div>'+
      '<div class="m">'+role+'#'+i.number+' '+tags+'<span style="margin-left:auto">'+quick+ago(i.updated_at)+'</span></div></div>';
  }
  window.cardApprove=function(repo,number,ev){
    if(ev){ev.stopPropagation();}
    fetch("/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:repo,number:number})})
      .then(function(r){if(!r.ok)throw 0; toast("Approved — building ✓"); setTimeout(load,1000);})
      .catch(function(){toast("Couldn’t approve");});
  };
  window.cardResume=function(repo,number,ev){
    if(ev){ev.stopPropagation();}
    fetch("/resume",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:repo,number:number})})
      .then(function(r){if(!r.ok)throw 0; toast("Resuming ↻"); setTimeout(load,1000);})
      .catch(function(){toast("Couldn’t resume");});
  };
  window.cardFix=function(repo,number,ev){
    if(ev){ev.stopPropagation();}
    fetch("/fix",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:repo,number:number})})
      .then(function(r){if(!r.ok)throw 0; toast("Fixing the review 🔧"); setTimeout(load,1000);})
      .catch(function(){toast("Couldn’t start fix");});
  };
  // Auto-mode pills: 3-state (inherit → on → off). repo+number = per-issue; repo only = per-repo;
  // neither = global default.
  var AUTO_LBL={resume:"auto-resume",merge:"auto-merge"};
  function autoPill(kind,repo,number,raw){
    var on=raw==="on", off=raw==="off";
    var tip=AUTO_LBL[kind]+': '+(on?"ON":off?"OFF":(number||repo?"inherit":"off"))+' — click to change';
    return '<button class="apill '+(on?"on":off?"off":"")+'" data-tip="'+tip+'" onclick=\\'cycleAuto('+JSON.stringify(kind)+','+JSON.stringify(repo||"")+','+(number||0)+',event)\\'>'+ic(kind==="resume"?"refresh":"merge",13)+'<span>'+(kind==="resume"?"resume":"merge")+'</span></button>';
  }
  function rawAuto(kind,repo,number){
    if(number){var i=findIssue(repo,number);return i&&i.auto?(kind==="resume"?i.auto.resumeRaw:i.auto.mergeRaw)||"":"";}
    if(repo){var ar=(DATA.autoRepos||{})[repo]||{};return ar[kind]||"";}
    return (DATA.auto||{})[kind]||"";
  }
  window.cycleAuto=function(kind,repo,number,ev){ if(ev)ev.stopPropagation();
    var cur=rawAuto(kind,repo||null,number||0); var order=["","on","off"]; var nx=order[(order.indexOf(cur)+1)%3];
    var payload={kind:kind,value:nx===""?"inherit":nx}; if(repo)payload.repo=repo; if(number)payload.number=number;
    fetch("/auto",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)})
      .then(function(){toast(AUTO_LBL[kind]+": "+(nx==="on"?"on":nx==="off"?"off":"inherit"));setTimeout(function(){load();if(open&&document.getElementById("d_auto"))renderDrawerAuto();if(document.getElementById("settings").classList.contains("on"))refreshSettings();},400);})
      .catch(function(){toast("Couldn’t set");});
  };
  function lane(ck,items,r){
    var inner=items.length?items.map(card).join(""):'<div class="empty">—</div>';
    return '<div class="lane"><h3>'+COL[ck]+'<span>'+(items.length||"")+'</span></h3><div class="lanecards" data-scrollk="lc:'+esc(r)+':'+ck+'">'+inner+'</div></div>';
  }
  // Signature of everything the board renders — so the 5s poll only re-renders (and disturbs your
  // scroll) when something actually changed.
  function boardSig(){
    var items=(DATA.issues||[]);
    return repoFilter+'|'+query+'|'+sortKey+'|'+(DATA.repos||[]).join(',')+'|'+items.map(function(i){
      return i.repo+'#'+i.number+':'+classify(i)+':'+(i.review||'')+':'+(i.queued?1:0)+':'+(i.active?1:0)+':'+(i.resumeAt||'')+':'+(i.epic?i.epic.done+'/'+i.epic.total:'')+':'+(i.pr_number||'')+':'+(i.previewUrl?1:0);
    }).join(',');
  }
  // Re-render without losing where the user scrolled (page + each lane's horizontal/vertical pos).
  function preserveScroll(fn){
    var pos={}, wy=window.scrollY;
    document.querySelectorAll('#board [data-scrollk]').forEach(function(el){pos[el.getAttribute('data-scrollk')]=[el.scrollLeft,el.scrollTop];});
    fn();
    document.querySelectorAll('#board [data-scrollk]').forEach(function(el){var p=pos[el.getAttribute('data-scrollk')];if(p){el.scrollLeft=p[0];el.scrollTop=p[1];}});
    window.scrollTo(window.scrollX,wy);
  }
  var _boardSig='';
  function renderBoard(force){
    var sig=boardSig();
    if(!force && sig===_boardSig) return; // nothing visible changed — leave the user's scroll alone
    _boardSig=sig;
    var repos=(DATA.repos||[]).filter(function(r){return !repoFilter||r===repoFilter;});
    var items=DATA.issues.filter(matchQ).slice().sort(cmp);
    var html=repos.map(function(r){
      var ri=items.filter(function(i){return i.repo===r;});
      var secs=SECTIONS.map(function(sec){
        var lanes=sec.cols.map(function(ck){return lane(ck,ri.filter(function(i){return classify(i)===ck;}),r);}).join("");
        var n=ri.filter(function(i){return sec.cols.indexOf(classify(i))>=0;}).length;
        return '<div class="section '+sec.k+'" data-scrollk="ln:'+esc(r)+':'+sec.k+'"><div class="sechead">'+sec.label+' <span>'+(n||"")+'</span></div><div class="lanes" data-scrollk="lns:'+esc(r)+':'+sec.k+'">'+lanes+'</div></div>';
      }).join("");
      var ar=(DATA.autoRepos||{})[r]||{};
      return '<div class="repo">'+esc(r)+
        '<span class="autoset">'+autoPill('resume',r,0,ar.resume||"")+autoPill('merge',r,0,ar.merge||"")+'</span>'+
        '<button class="repoadd" onclick=\\'openComposer('+JSON.stringify(r)+')\\'>'+ic('plus',13)+' new</button></div><div class="sections">'+secs+'</div>';
    }).join("");
    preserveScroll(function(){document.getElementById("board").innerHTML = html||'<div class="empty">No repos yet. File a /add-repo issue.</div>';});
  }
  window.onSearch=function(v){query=v;renderBoard(true);};
  window.onSort=function(v){sortKey=v;renderBoard(true);};

  // ---- add repo picker ----
  var AREPOS=[];
  function renderRepoList(q){
    var list=AREPOS.filter(function(r){return !q||r.full_name.toLowerCase().indexOf(q.toLowerCase())>=0;}).slice(0,200);
    var el=document.getElementById("ar_list");
    el.innerHTML=list.length?list.map(function(r){return '<div class="urow" style="cursor:pointer" onclick="addRepoNow(\\''+r.full_name+'\\',this)"><span>'+esc(r.full_name)+(r.private?' <span class="muted">· private</span>':'')+'</span><span class="muted">add +</span></div>';}).join(""):'<div class="urow"><span class="muted">No matching repos</span></div>';
  }
  window.openAddRepo=function(){
    AREPOS=[]; document.getElementById("ar_q").value="";
    document.getElementById("ar_list").innerHTML='<div class="urow"><span class="muted">Loading your repos…</span></div>';
    document.getElementById("addrepo").classList.add("on");
    document.getElementById("rscrim").classList.add("on");
    document.body.classList.add("noscroll");
    getJSON("/repos-available").then(function(d){AREPOS=d.repos||[];renderRepoList("");}).catch(function(){document.getElementById("ar_list").innerHTML='<div class="urow"><span class="muted">Couldn’t load repos (needs admin token)</span></div>';});
  };
  window.closeAddRepo=function(){document.getElementById("addrepo").classList.remove("on");document.getElementById("rscrim").classList.remove("on");document.body.classList.remove("noscroll");};
  window.filterRepos=function(q){renderRepoList(q);};
  window.addRepoNow=function(full,row){
    if(row)row.innerHTML='<span>'+esc(full)+'</span><span class="muted">adding…</span>';
    fetch("/add-repo",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:full})})
      .then(function(r){if(!r.ok)throw 0;return r.json();})
      .then(function(d){toast("Watching "+full.split("/").pop()+(d.note||"")); AREPOS=AREPOS.filter(function(x){return x.full_name!==full;}); renderRepoList(document.getElementById("ar_q").value); setTimeout(load,800);})
      .catch(function(){toast("Couldn’t add repo");});
  };

  // ---- token settings ----
  function modelName(m){if(/opus/i.test(m))return "Opus";if(/sonnet/i.test(m))return "Sonnet";if(/haiku/i.test(m))return "Haiku";return m||"?";}
  function hm(d){return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});}
  function remain(iso){var ms=new Date(iso).getTime()-Date.now();if(ms<=0)return "0m";var h=Math.floor(ms/3600000),m=Math.floor((ms%3600000)/60000);return (h>0?h+"h":"")+m+"m";}
  function localInput(d){var p=function(n){return (n<10?"0":"")+n;};return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());}
  function refreshSettings(){
    var s=DATA.session||{}, bm=s.byModel||[];
    var rows=bm.map(function(m){return '<div class="urow"><span>'+esc(modelName(m.model))+'</span><span>'+fmtTok(m.tokens)+' tok'+(m.costUsd>0?' · $'+m.costUsd.toFixed(2):'')+'</span></div>';}).join("");
    var tot='<div class="urow tot"><span>Total</span><span>'+fmtTok(s.tokens||0)+' tok</span></div>';
    var u=document.getElementById("s_usage"); if(u)u.innerHTML=(rows||'<div class="urow"><span class="muted">No usage yet this window</span></div>')+tot;
    var w=document.getElementById("s_window");
    if(w)w.innerHTML = s.windowStart? ((s.anchored?'Anchored':'Rolling')+' · started '+hm(new Date(s.windowStart))+', resets '+hm(new Date(s.resetsAt))) : '';
    var a=document.getElementById("s_anchor"); if(a&&!a.value&&s.windowStart)a.value=localInput(new Date(s.windowStart));
    var sa=document.getElementById("s_auto"); if(sa)sa.innerHTML=autoPill('resume',"",0,(DATA.auto||{}).resume||"")+autoPill('merge',"",0,(DATA.auto||{}).merge||"");
    var cfg=DATA.config||{};
    var sk=document.getElementById("s_skiparch"); if(sk)sk.checked=cfg.skipArchitect!=="off";
    var gn=document.getElementById("s_gitnexus"); if(gn)gn.checked=cfg.gitnexus==="on";
    var mt=document.getElementById("s_maxtok"); if(mt&&!mt.value)mt.value=cfg.maxTokensPerRun||"";
    var rr=document.getElementById("s_revrounds"); if(rr&&rr.value==="")rr.value=(cfg.maxReviseRounds!=null?cfg.maxReviseRounds:1);
  }
  window.setAnchor=function(){
    var v=document.getElementById("s_anchor").value; if(!v){toast("Pick a date & time");return;}
    fetch("/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchor:new Date(v).toISOString()})})
      .then(function(r){if(!r.ok)throw 0; toast("Window start set"); setTimeout(function(){load();setTimeout(refreshSettings,400);},300);})
      .catch(function(){toast("Couldn’t set");});
  };
  window.openSettings=function(){
    var s=DATA.session||{};
    document.getElementById("s_win").value=s.windowHours||5;
    document.getElementById("s_budget").value=s.budget||"";
    document.getElementById("s_pct").value="";
    document.getElementById("s_anchor").value="";
    document.getElementById("s_maxtok").value="";
    document.getElementById("s_revrounds").value="";
    refreshSettings();
    document.getElementById("settings").classList.add("on");
    document.getElementById("sscrim").classList.add("on");
    document.body.classList.add("noscroll");
  };
  window.resetWindow=function(){
    fetch("/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({anchorNow:true})})
      .then(function(r){if(!r.ok)throw 0; toast("Window started now"); setTimeout(function(){load();setTimeout(refreshSettings,400);},300);})
      .catch(function(){toast("Couldn’t set");});
  };
  window.closeSettings=function(){
    document.getElementById("settings").classList.remove("on");
    document.getElementById("sscrim").classList.remove("on");
    document.body.classList.remove("noscroll");
  };
  window.calcBudget=function(){
    var s=DATA.session||{}, pct=Number(document.getElementById("s_pct").value);
    if(!pct||pct<=0||!(s.tokens>0)){toast("Need a % and some usage");return;}
    var budget=Math.round(s.tokens/(pct/100));
    document.getElementById("s_budget").value=budget;
    toast("Budget ≈ "+fmtTok(budget)+" tok");
  };
  window.saveSettings=function(){
    var win=Number(document.getElementById("s_win").value)||5;
    var budget=Number(document.getElementById("s_budget").value)||0;
    var body={windowHours:win,budget:budget,
      skipArchitect:document.getElementById("s_skiparch").checked?"on":"off",
      gitnexus:document.getElementById("s_gitnexus").checked?"on":"off",
      maxTokensPerRun:Number(document.getElementById("s_maxtok").value)||0,
      maxReviseRounds:Number(document.getElementById("s_revrounds").value)||0};
    var btn=document.getElementById("s_save"); btn.disabled=true;
    fetch("/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
      .then(function(r){if(!r.ok)throw 0; toast("Saved"); closeSettings(); setTimeout(load,400);})
      .catch(function(){toast("Couldn’t save");})
      .then(function(){btn.disabled=false;});
  };

  // ---- models & providers ----
  var MDL={providers:[],roleModels:{},roles:[],presets:[]};
  function roleIcon(r){return ICON[r]||"•";}
  function renderProviders(){
    var el=document.getElementById("m_providers");
    el.innerHTML=(MDL.providers||[]).map(function(p,i){
      return '<div class="cmt"><div style="display:flex;gap:6px;align-items:center"><b>'+esc(p.name||"provider")+'</b><button class="arch" style="margin-left:auto" onclick="rmProvider('+i+')">remove</button></div>'+
        '<input placeholder="Name" value="'+esc(p.name||"")+'" oninput="MDL.providers['+i+'].name=this.value" style="margin-top:4px">'+
        '<input placeholder="Anthropic-compatible base URL" value="'+esc(p.baseUrl||"")+'" oninput="MDL.providers['+i+'].baseUrl=this.value" style="margin-top:4px">'+
        '<input placeholder="API key" value="'+esc(p.apiKey||"")+'" oninput="MDL.providers['+i+'].apiKey=this.value" type="password" style="margin-top:4px">'+
        '<input placeholder="Models (comma-separated)" value="'+esc((p.models||[]).join(", "))+'" oninput="MDL.providers['+i+'].models=this.value.split(\\',\\').map(function(s){return s.trim();}).filter(Boolean)" style="margin-top:4px">'+
      '</div>';
    }).join("")||'<div class="muted" style="font-size:12px">No providers yet.</div>';
  }
  function allModelOptions(sel){
    var opts='<option value="">Default — Claude (subscription)</option>';
    (MDL.providers||[]).forEach(function(p){(p.models||[]).forEach(function(m){var v=p.id+"|"+m;opts+='<option value="'+esc(v)+'"'+(sel===v?' selected':'')+'>'+esc(p.name)+' · '+esc(m)+'</option>';});});
    return opts;
  }
  function renderRoles(){
    var el=document.getElementById("m_roles");
    el.innerHTML=(MDL.roles||[]).map(function(r){
      var rm=MDL.roleModels[r]; var sel=rm&&rm.providerId?(rm.providerId+"|"+rm.model):"";
      return '<div class="urow"><span>'+roleIcon(r)+' '+esc(r)+'</span><select onchange="setRoleModel(\\''+r+'\\',this.value)">'+allModelOptions(sel)+'</select></div>';
    }).join("");
  }
  window.setRoleModel=function(role,val){ if(!val){delete MDL.roleModels[role];} else {var parts=val.split("|");MDL.roleModels[role]={providerId:parts[0],model:parts.slice(1).join("|")};} };
  window.rmProvider=function(i){var id=MDL.providers[i].id;MDL.providers.splice(i,1);Object.keys(MDL.roleModels).forEach(function(r){if(MDL.roleModels[r].providerId===id)delete MDL.roleModels[r];});renderProviders();renderRoles();};
  window.addProvider=function(){
    var pi=Number(document.getElementById("m_preset").value); var pre=MDL.presets[pi]||{name:"",baseUrl:"",models:[]};
    MDL.providers.push({id:"p"+Date.now().toString(36),name:pre.name,baseUrl:pre.baseUrl,apiKey:"",models:(pre.models||[]).slice()});
    renderProviders();renderRoles();
  };
  window.openModels=function(){
    closeSettings();
    getJSON("/models").then(function(d){
      MDL=d; MDL.roleModels=d.roleModels||{}; MDL.providers=d.providers||[];
      document.getElementById("m_preset").innerHTML=(d.presets||[]).map(function(pr,i){return '<option value="'+i+'">'+esc(pr.name)+'</option>';}).join("");
      renderProviders(); renderRoles();
    }).catch(function(){});
    document.getElementById("models").classList.add("on");
    document.getElementById("mscrim").classList.add("on");
    document.body.classList.add("noscroll");
  };
  window.closeModels=function(){document.getElementById("models").classList.remove("on");document.getElementById("mscrim").classList.remove("on");document.body.classList.remove("noscroll");};
  window.saveModels=function(){
    var btn=document.getElementById("m_save"); btn.disabled=true;
    fetch("/models",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({providers:MDL.providers,roleModels:MDL.roleModels})})
      .then(function(r){if(!r.ok)throw 0; toast("Saved — applies on next run"); closeModels();})
      .catch(function(){toast("Couldn’t save");})
      .then(function(){btn.disabled=false;});
  };

  // ---- agent / playbook editor (fixed vs learning, live + versioned) ----
  var AFILES=[], AREVS=[];
  function fillAgentSelect(sel){
    var s=document.getElementById("a_file");
    s.innerHTML=AFILES.map(function(f){var g=f.group==="learning"?"learning":"fixed";return '<option value="'+esc(f.path)+'">'+g+' · '+esc(f.label)+(f.edited?" ✎":"")+'</option>';}).join("");
    if(sel)s.value=sel;
  }
  function fetchAgents(sel){return getJSON("/agents").then(function(d){AFILES=d.files||[];fillAgentSelect(sel);});}
  window.openAgents=function(){
    closeSettings();
    fetchAgents().then(function(){loadAgent();}).catch(function(){});
    document.getElementById("agents").classList.add("on");
    document.getElementById("ascrim").classList.add("on");
    document.body.classList.add("noscroll");
  };
  window.closeAgents=function(){
    document.getElementById("agents").classList.remove("on");
    document.getElementById("ascrim").classList.remove("on");
    document.body.classList.remove("noscroll");
  };
  window.loadAgent=function(){
    var p=document.getElementById("a_file").value; if(!p)return;
    var f=AFILES.filter(function(x){return x.path===p;})[0]||{};
    var learning=f.group==="learning";
    document.getElementById("a_kind").innerHTML=(learning?'🤖 Learning — self-improving (the agency edits this too)':'🔒 Fixed — only you edit this')+(f.edited?' · <b>edited</b>':'');
    document.getElementById("a_hist").style.display="none";
    document.getElementById("a_content").value="Loading…";
    getJSON("/agent?path="+encodeURIComponent(p)).then(function(d){document.getElementById("a_content").value=d.content||"";AREVS=d.revisions||[];}).catch(function(){});
  };
  window.toggleHist=function(){
    var h=document.getElementById("a_hist");
    if(h.style.display!=="none"){h.style.display="none";return;}
    h.innerHTML=AREVS.length?AREVS.map(function(r){return '<div class="urow" style="cursor:pointer" onclick="loadRevision('+r.id+')"><span>'+esc(r.source||"")+(r.note?" · "+esc(r.note):"")+'</span><span class="muted">'+ago(r.created_at)+'</span></div>';}).join(""):'<div class="urow"><span class="muted">No edits yet</span></div>';
    h.style.display="block";
  };
  window.loadRevision=function(id){
    getJSON("/agent-revision?id="+id).then(function(d){document.getElementById("a_content").value=d.content||"";toast("Loaded older version — Save to apply");});
  };
  window.revertAgent=function(){
    var p=document.getElementById("a_file").value;
    fetch("/agent-revert",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:p})})
      .then(function(r){if(!r.ok)throw 0; toast("Reverted to default"); fetchAgents(p).then(loadAgent);})
      .catch(function(){toast("Couldn’t revert");});
  };
  window.saveAgent=function(){
    var p=document.getElementById("a_file").value, c=document.getElementById("a_content").value;
    var btn=document.getElementById("a_save"); btn.disabled=true;
    fetch("/agent-save",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:p,content:c})})
      .then(function(r){if(!r.ok)throw 0; toast("Saved — applies on next run"); fetchAgents(p).then(loadAgent);})
      .catch(function(){toast("Couldn’t save");})
      .then(function(){btn.disabled=false;});
  };

  // ---- composer file/image attachments ----
  var CPEND=[];
  function renderCAtts(){var el=document.getElementById("c_atts");if(el)el.innerHTML=CPEND.map(function(a,i){return attChip(a,i,"rmCAtt");}).join("");}
  window.rmCAtt=function(i){CPEND.splice(i,1);renderCAtts();};
  window.onPasteC=function(e){pasteFiles(e,CPEND,renderCAtts);};
  window.onPickC=function(e){var fs=e.target.files||[];for(var i=0;i<fs.length;i++)readAttach(fs[i],CPEND,renderCAtts);e.target.value="";};

  // ---- new issue composer ----
  window.openComposer=function(preRepo){
    var rs=document.getElementById("c_repo");
    var want=(typeof preRepo==="string"&&preRepo)?preRepo:repoFilter;
    rs.innerHTML=(DATA.repos||[]).map(function(r){return '<option value="'+esc(r)+'"'+(want===r?' selected':'')+'>'+esc(r)+'</option>';}).join("");
    CPEND=[]; renderCAtts();
    document.getElementById("composer").classList.add("on");
    document.getElementById("cscrim").classList.add("on");
    document.body.classList.add("noscroll");
    setTimeout(function(){document.getElementById("c_title").focus();},250);
  };
  window.closeComposer=function(){
    document.getElementById("composer").classList.remove("on");
    document.getElementById("cscrim").classList.remove("on");
    document.body.classList.remove("noscroll");
  };
  window.submitIssue=function(){
    var repo=document.getElementById("c_repo").value, role=document.getElementById("c_role").value;
    var title=document.getElementById("c_title").value.trim(), body=document.getElementById("c_body").value.trim();
    if(!repo||!title){toast("Repo + title needed");return;}
    var btn=document.getElementById("c_create"); btn.disabled=true;
    if(CPEND.length)toast("Uploading attachment…");
    uploadList(CPEND,repo,0)
      .then(function(mds){var full=[body].concat(mds.filter(Boolean)).filter(Boolean).join("\\n\\n");
        return fetch("/new-issue",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:repo,role:role,title:title,body:full})});})
      .then(function(r){if(!r.ok)throw 0;return r.json();})
      .then(function(d){toast("Created #"+(d.number||""));document.getElementById("c_title").value="";document.getElementById("c_body").value="";CPEND=[];renderCAtts();closeComposer();setTimeout(load,1200);})
      .catch(function(){toast("Couldn’t create");})
      .then(function(){btn.disabled=false;});
  };

  // ---- drawer ----
  function findIssue(repo,n){return DATA.issues.filter(function(i){return i.repo===repo&&i.number===n;})[0];}
  window.openDrawer=function(repo,n){
    var i=findIssue(repo,n)||{repo:repo,number:n,title:"#"+n};
    open={repo:repo,number:n,issue:i};
    document.getElementById("d_title").textContent=(i.title||("#"+n));
    document.getElementById("d_meta").innerHTML=esc(repo)+' · #'+n+(i.state?' · '+esc(i.state.replace("agency:","")):'');
    renderActions();
    var ehtml="";
    if(i.epic){var pct=Math.round(100*i.epic.done/Math.max(1,i.epic.total));
      ehtml='<div class="sec">Sub-issues — '+i.epic.done+'/'+i.epic.total+' done</div><div class="ebar"><i style="width:'+pct+'%"></i></div><div class="epiclist">'+
        (i.epic.children||[]).map(function(c){return '<a href="'+gh(i.repo,c.child)+'" target="_blank" rel="noopener"><span class="ck'+(c.closed?'':' o')+'">'+(c.closed?'✓':'○')+'</span> #'+c.child+' '+esc(c.title)+'<span class="st">'+esc(c.state||'')+'</span></a>';}).join("")+'</div>';
    }
    var sEl=document.getElementById("d_stream"); sEl.innerHTML=""; streamStick=true;
    if(!sEl._stickInit){ sEl._stickInit=true; sEl.addEventListener("scroll",function(){ streamStick = (sEl.scrollHeight - sEl.scrollTop - sEl.clientHeight) < 48; }); }
    open.appKind=undefined; open.devScript=null; open.prStatus=null; PEND=[]; renderAtts();
    getJSON("/app-info?repo="+encodeURIComponent(repo)+"&number="+n).then(function(d){if(!open||open.number!==n)return;open.appKind=d.kind;open.devScript=d.devScript;renderActions();}).catch(function(){if(open)open.appKind="unknown";renderActions();});
    // Live PR status (review verdict + conflict check) so the bar can choose Fix vs Merge.
    if(i.pr_number) getJSON("/pr-status?repo="+encodeURIComponent(repo)+"&number="+n).then(function(d){if(!open||open.number!==n)return;open.prStatus=d;renderActions();}).catch(function(){});
    document.getElementById("d_body").innerHTML=ehtml+'<div class="sec">Auto</div><div id="d_auto" class="autorow"></div><div class="sec">Conversation</div><div id="d_thread"><div class="empty">Loading…</div></div>';
    renderDrawerAuto();
    applyStreamCollapse();
    renderStream(); loadThread(true);
    document.getElementById("drawer").classList.add("on");
    document.getElementById("scrim").classList.add("on");
    document.getElementById("drawer").setAttribute("aria-hidden","false");
    document.body.classList.add("noscroll"); // lock the board behind the drawer
  };
  window.closeDrawer=function(){open=null;document.getElementById("drawer").classList.remove("on");document.getElementById("scrim").classList.remove("on");document.getElementById("drawer").setAttribute("aria-hidden","true");document.body.classList.remove("noscroll");};

  window.toggleStream=function(){
    var w=document.getElementById("d_streamwrap"); var c=w.classList.toggle("collapsed");
    try{localStorage.setItem("streamCollapsed",c?"1":"0");}catch(e){}
    document.getElementById("d_caret").textContent=c?"▸":"▾";
  };
  function applyStreamCollapse(){
    var c=false; try{c=localStorage.getItem("streamCollapsed")==="1";}catch(e){}
    var w=document.getElementById("d_streamwrap"); if(c)w.classList.add("collapsed");else w.classList.remove("collapsed");
    document.getElementById("d_caret").textContent=c?"▸":"▾";
  }
  function lineHtml(a){var c=a.kind==="tool"?"tool":(a.kind==="start"||a.kind==="done"?"muted":"");return '<div class="l '+c+'">'+esc(a.text)+'</div>';}
  function renderStream(){
    if(!open)return; var el=document.getElementById("d_stream"); if(!el)return;
    var evs=(DATA.activity||[]).filter(function(x){return x.repo===open.repo&&x.number===open.number;}).slice(-40);
    el.innerHTML=evs.length?evs.map(lineHtml).join(""):'<div class="l muted">No live activity. Tap “Run checks” or reply below.</div>';
    if(streamStick) el.scrollTop=el.scrollHeight;
  }
  function renderDrawerAuto(){
    if(!open)return; var el=document.getElementById("d_auto"); if(!el)return;
    var i=findIssue(open.repo,open.number)||{}; var a=i.auto||{};
    el.innerHTML=autoPill('resume',open.repo,open.number,a.resumeRaw||"")+autoPill('merge',open.repo,open.number,a.mergeRaw||"")+
      '<span class="muted" style="font-size:12px;margin-left:8px">now: resume '+(a.resume?"on":"off")+' · merge '+(a.merge?"on":"off")+'</span>';
  }
  function refreshDrawerLive(){renderStream(); var i=findIssue(open.repo,open.number); if(i){open.issue=i;} renderActions(); renderDrawerAuto();}

  // ---- drawer action bar (icon-only, instant tooltips; app controls folded in) ----
  function ibtn(icon,tip,onclick,cls,id){return '<button class="btn ic'+(cls?' '+cls:'')+'" data-tip="'+esc(tip)+'"'+(id?' id="'+id+'"':'')+' onclick="'+onclick+'">'+icon+'</button>';}
  function ilnk(icon,tip,href,cls){return '<a class="btn ic'+(cls?' '+cls:'')+'" data-tip="'+esc(tip)+'" href="'+href+'" target="_blank" rel="noopener">'+icon+'</a>';}
  // Pure-GitHub local run: clones via the user's own gh CLI and checks out the PR — no dashboard
  // fetch (so no auth/401) and no downloaded file (so no macOS Gatekeeper block).
  function ghRunCmd(){
    var nm=open.repo.split("/").pop(); var i=open.issue||{}; var st=i.state||"";
    var done = st==="merged"||st==="agency:merged"||st==="closed"||st==="done";
    // Merged → the work is on the default branch; the PR branch is usually deleted. Otherwise
    // check out the PR head directly via gh.
    var checkout = done ? '(git checkout main 2>/dev/null || git checkout master) && git pull -q' : 'gh pr checkout '+open.number;
    return 'd=~/.devagency/'+nm+'; gh repo clone '+open.repo+' "$d" 2>/dev/null; cd "$d" && git fetch -q && '+checkout+
      ' && { corepack enable 2>/dev/null; PM=npm; [ -f pnpm-lock.yaml ]&&PM=pnpm; [ -f yarn.lock ]&&PM=yarn; $PM install && ($PM run tauri:dev || $PM tauri dev || $PM run dev); }';
  }
  window.copyRun=function(){var s=ghRunCmd();
    function done(){toast("Copied — paste in Terminal & hit Enter");}
    function fb(){var t=document.createElement("textarea");t.value=s;t.style.position="fixed";t.style.opacity="0";document.body.appendChild(t);t.select();try{document.execCommand("copy");done();}catch(e){toast("Copy failed");}document.body.removeChild(t);}
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(s).then(done,fb);else fb();
  };
  function renderActions(){
    if(!open)return; var i=findIssue(open.repo,open.number)||open.issue||{}; open.issue=i;
    var app=i.app, kind=open.appKind, st=i.state||"";
    var done = st==="merged"||st==="agency:merged"||st==="closed"||st==="done";
    var epicDone = i.epic && i.epic.done>=i.epic.total;
    // Review/merge state for this PR (from /pr-status when loaded; verdict falls back to /data).
    var ps=open.prStatus||{}; var rv=(ps.review&&ps.review.verdict)||i.review||null;
    var merge=ps.merge||null; var conflict = merge && merge.mergeable==="conflict";
    var needsFix = rv==="changes";
    // Links are always relevant.
    var a=ilnk(ic('link'),'Open issue on GitHub',gh(open.repo,open.number));
    if(i.pr_url) a+=ilnk(ic('pr'),'Open pull request',i.pr_url);
    if(i.previewUrl) a+=ilnk(ic('globe'),'Open preview',i.previewUrl,'primary');
    // Build/approve actions only while the issue is still live.
    if(!done){
      if(st==="agency:awaiting-approval") a+=ibtn(ic('check'),'Approve &amp; build','doApprove(this)','primary');
      // Fix: only when the reviewer requested changes or there are merge conflicts. (Otherwise just
      // leave a comment — the orchestrator picks it up and routes it to the right agent.)
      if(i.pr_number && (needsFix||conflict)) a+=ibtn(ic('wrench'),conflict?(needsFix?'Fix the review &amp; resolve merge conflicts':'Resolve merge conflicts with main'):'Fix the reviewer’s requested changes','doFix(this)','primary');
      a+=ibtn(ic('refresh'),'Resume','doResume(this)','','d_resume');
      a+=ibtn(ic('flask'),'Run checks','runChecks()','','d_checks');
    }
    // Run-the-app stays available even when merged/done (runs the default branch instead).
    if(kind==="tauri") a+=ibtn(ic('laptop'),(done?'Run latest (main) on my Mac':'Run this PR on my Mac')+' — copies a Terminal command (uses your gh login)','copyRun()');
    if(kind==="web"||kind==="tauri"){
      if(app&&app.status==="running"){ a+=ilnk(ic('monitor'),'Open running preview',app.url,'primary'); a+=ibtn(ic('stop'),'Stop preview','stopAppPreview()'); }
      else if(app&&(app.status==="installing"||app.status==="starting")){ a+=ibtn(ic('clock'),'Starting preview… (watch Live stream)','stopAppPreview()'); }
      else if(app&&app.status==="error"){ a+=ibtn(ic('alert'),'Preview failed — retry','runApp()','danger'); }
      else if(kind==="web"){ a+=ibtn(ic('play'),'Run preview in the cloud (gives a link)','runApp()'); }
    }
    // Merge: hide entirely when there are conflicts (you must Fix first). When fixes are still
    // requested but it merges cleanly, offer "Merge anyway". Otherwise a normal merge.
    if(!done && !conflict){
      if(i.pr_number) a+=ibtn(ic('merge'),needsFix?'Merge anyway (skip the requested fixes)':'Merge PR','confirmAct(this,\\'merge\\')',needsFix?'':'primary');
      else if(i.epic && epicDone) a+=ibtn(ic('merge'),'Merge all sub-issues','confirmAct(this,\\'merge\\')','primary');
    }
    a+=ibtn(ic('trash'),'Delete','confirmAct(this,\\'delete\\')','danger');
    document.getElementById("d_actions").innerHTML=a;
  }
  window.doFix=function(btn){ if(!open)return; if(btn)btn.disabled=true;
    fetch("/fix",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number})})
      .then(function(r){if(!r.ok)throw 0; toast("Fixing the review 🔧"); closeDrawer(); setTimeout(load,1200);})
      .catch(function(){if(btn)btn.disabled=false;toast("Couldn’t start fix");}); };
  window.runApp=function(){ if(!open)return;
    fetch("/app-run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number})})
      .then(function(r){if(!r.ok)return r.json().then(function(d){toast(d.error||"can’t run");}); toast("Starting preview…"); setTimeout(load,800);}).catch(function(){toast("Couldn’t start");}); };
  window.stopAppPreview=function(){ if(!open)return;
    fetch("/app-stop",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number})}).then(function(){toast("Stopped");setTimeout(load,500);}); };

  // ---- file/image attachments (paste or pick; any type) ----
  function attChip(a,idx,rm){ return a.img? '<div class="att"><img src="'+a.d+'"><button onclick="'+rm+'('+idx+')">×</button></div>' : '<div class="att file">📎 '+esc(a.name||"file")+'<button onclick="'+rm+'('+idx+')">×</button></div>'; }
  function readAttach(file,arr,render){ if(!file)return; if(file.size>25*1024*1024){toast("Too big (max 25MB): "+(file.name||""));return;} var r=new FileReader(); r.onload=function(){arr.push({d:r.result,name:file.name||"file",img:/^image\\//.test(file.type)});render();}; r.readAsDataURL(file); }
  function pasteFiles(e,arr,render){ var got=false,items=(e.clipboardData||{}).items||[]; for(var i=0;i<items.length;i++){ if(items[i].kind==="file"){ readAttach(items[i].getAsFile(),arr,render); got=true; } } var fs=(e.clipboardData||{}).files||[]; for(var j=0;j<fs.length;j++){ readAttach(fs[j],arr,render); got=true; } if(got)e.preventDefault(); }
  function uploadList(arr,repo,number){ return Promise.all(arr.map(function(a){return fetch("/upload-file",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:repo,number:number,dataUrl:a.d,name:a.name})}).then(function(r){return r.ok?r.json():null;}).then(function(j){return j&&j.md;}).catch(function(){return null;});})).then(function(x){return x.filter(Boolean);}); }

  var PEND=[];
  function renderAtts(){var el=document.getElementById("d_atts");if(el)el.innerHTML=PEND.map(function(a,i){return attChip(a,i,"rmAtt");}).join("");}
  window.rmAtt=function(i){PEND.splice(i,1);renderAtts();};
  window.onPasteImage=function(e){pasteFiles(e,PEND,renderAtts);};
  window.onPickImage=function(e){var fs=e.target.files||[];for(var i=0;i<fs.length;i++)readAttach(fs[i],PEND,renderAtts);e.target.value="";};
  function uploadAtts(){return uploadList(PEND,open.repo,open.number);}

  function loadThread(scrollToEnd){
    getJSON("/thread?repo="+encodeURIComponent(open.repo)+"&number="+open.number).then(function(t){
      if(!open)return; var el=document.getElementById("d_thread"); if(!el)return;
      var parts=[];
      if(t.body) parts.push(cmtHtml({author:t.author,createdAt:t.createdAt,body:t.body,isAgency:false}));
      (t.comments||[]).forEach(function(c){parts.push(cmtHtml(c));});
      el.innerHTML=parts.length?parts.join(""):'<div class="empty">No description.</div>';
      // Open on the latest message (the bottom of the conversation).
      if(scrollToEnd){var body=document.getElementById("d_body");if(body)setTimeout(function(){body.scrollTop=body.scrollHeight;},60);}
    }).catch(function(){});
  }
  function cmtHtml(c){
    return '<div class="cmt'+(c.isAgency?' ag':'')+'"><div class="h">'+(c.isAgency?'🤖 ':'')+esc(c.author||"")+
      ' · '+ago(c.createdAt)+'</div><div class="b">'+md(c.body)+'</div></div>';
  }

  // Two-tap confirm for destructive actions (no modal — phone-friendly).
  window.confirmAct=function(btn,kind){
    if(btn.dataset.armed){ btn.dataset.armed=""; doAct(kind,btn); return; }
    var orig=btn.innerHTML; btn.dataset.armed="1"; btn.classList.add("armed");
    btn.innerHTML=kind==="merge"?"Confirm merge?":"Confirm delete?";
    setTimeout(function(){if(btn.dataset.armed){btn.dataset.armed="";btn.classList.remove("armed");btn.innerHTML=orig;}},3000);
  };
  function doAct(kind,btn){
    if(!open)return; btn.disabled=true;
    fetch(kind==="merge"?"/merge":"/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number})})
      .then(function(r){if(!r.ok)throw 0; toast(kind==="merge"?"Merged 🚀":"Deleted"); closeDrawer(); load();})
      .catch(function(){btn.disabled=false;btn.classList.remove("armed");toast("Couldn’t "+kind);});
  }
  window.doApprove=function(btn){
    if(!open)return; btn.disabled=true;
    fetch("/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number})})
      .then(function(r){if(!r.ok)throw 0; toast("Approved — building ✓"); closeDrawer(); setTimeout(load,1200);})
      .catch(function(){btn.disabled=false;toast("Couldn’t approve");});
  };
  window.doResume=function(btn){
    if(!open)return; btn.disabled=true;
    fetch("/resume",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number})})
      .then(function(r){if(!r.ok)throw 0; toast("Resumed ⟳");setTimeout(load,1200);})
      .catch(function(){toast("Couldn’t resume");})
      .then(function(){setTimeout(function(){btn.disabled=false;},2000);});
  };
  window.runChecks=function(){
    if(!open)return; var b=document.getElementById("d_checks"); b.disabled=true;
    fetch("/run-checks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number,title:(open.issue&&open.issue.title)||""})})
      .then(function(){toast("Running checks…");setTimeout(function(){b.disabled=false;},4000);})
      .catch(function(){b.disabled=false;});
  };
  window.sendReply=function(){
    if(!open)return; var ta=document.getElementById("d_reply"); var body=ta.value.trim();
    if(!body && !PEND.length)return;
    var btn=document.getElementById("d_send"); btn.disabled=true;
    if(PEND.length)toast("Uploading image…");
    uploadAtts().then(function(mds){
      var full=[body].concat(mds).filter(Boolean).join("\\n\\n");
      return fetch("/comment",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:open.repo,number:open.number,body:full})});
    }).then(function(r){if(!r.ok)throw 0; ta.value="";ta.style.height="auto";PEND=[];renderAtts();toast("Sent");setTimeout(function(){loadThread(true);},900);})
      .catch(function(){toast("Couldn’t send");})
      .then(function(){btn.disabled=false;});
  };

  // SSE: append live lines to the open drawer in real time.
  try{var es=new EventSource("/events");
    es.onmessage=function(ev){try{var a=JSON.parse(ev.data);
      DATA.activity.push(a); if(DATA.activity.length>500)DATA.activity.shift();
      if(open&&a.repo===open.repo&&a.number===open.number){var el=document.getElementById("d_stream");if(el){el.insertAdjacentHTML("beforeend",lineHtml(a));if(streamStick)el.scrollTop=el.scrollHeight;}}
    }catch(e){}};
  }catch(e){}

  load(); setInterval(load,5000);
  document.addEventListener("keydown",function(e){if(e.key==="Escape"){closeDrawer();closeComposer();closeSettings();closeAgents();closeAddRepo();closeModels();}});
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
