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
    plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
    shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'
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
  .repobar{display:flex;align-items:center;gap:8px;padding:8px 14px 2px}
  .repodrop{flex:1;border:1px solid var(--line);border-radius:9px;padding:7px 11px;font:14px inherit;background:var(--card);color:var(--ink);cursor:pointer;min-width:0}
  .btn.recommended{background:var(--amber);border-color:var(--amber);color:#fff}
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
