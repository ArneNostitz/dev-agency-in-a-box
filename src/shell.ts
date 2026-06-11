/**
 * The v2 dashboard shell: a tiny HTML page with the design-token stylesheet (light + dark),
 * PWA wiring (manifest + service worker), and a Preact app loaded as an ES module from /web/app.js.
 * All the UI lives in /web/app.js (Preact + htm, no build step). The old dashboard stays at
 * /classic as a fallback while this matures.
 */
export function renderShell(): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f6f8" id="metatheme">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Dev Agency">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/web/icons/icon-192.png">
<link rel="icon" href="/web/icons/icon.svg" type="image/svg+xml">
<title>Dev Agency</title>
<style>
:root{
  --bg:#f5f6f8;--surface:#ffffff;--surface-2:#eef0f3;--ink:#1c1e22;--ink-2:#5a6069;--ink-3:#9aa0a8;
  --line:#e4e7eb;--line-2:#d3d8de;--accent:#2f6df6;--accent-weak:#e7efff;--green:#0b8a52;--green-weak:#e6f7ef;
  --amber:#a76a00;--amber-weak:#fff3da;--red:#c0392b;--red-weak:#fdeceb;--purple:#6741d9;--purple-weak:#efe9ff;
  --shadow:0 1px 2px rgba(20,20,40,.06);--radius:14px;--radius-sm:9px;
  --safe-b:env(safe-area-inset-bottom,0px);--safe-t:env(safe-area-inset-top,0px);
}
html[data-theme="dark"]{
  --bg:#0e1014;--surface:#171a1f;--surface-2:#1f242b;--ink:#e7e9ed;--ink-2:#9aa1ab;--ink-3:#6b727c;
  --line:#272c34;--line-2:#333a44;--accent:#5b8cff;--accent-weak:#172339;--green:#3ddc97;--green-weak:#10271d;
  --amber:#e0a83a;--amber-weak:#2a2110;--red:#f1746a;--red-weak:#2c1614;--purple:#a99bf5;--purple-weak:#1d1933;
  --shadow:none;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;-webkit-text-size-adjust:100%;overscroll-behavior-y:none}
a{color:var(--accent);text-decoration:none}
button{font:inherit}
.lic{display:inline-block;vertical-align:-3px}
input,select,textarea{font-size:16px}

.app{display:flex;flex-direction:column;height:100dvh}
.topbar{position:sticky;top:0;z-index:30;background:var(--surface);border-bottom:1px solid var(--line);padding:calc(8px + var(--safe-t)) 14px 8px;display:flex;align-items:center;gap:10px}
.brand{font-size:16px;font-weight:600;display:flex;align-items:center;gap:7px}
.brand .lic{color:var(--accent)}
.sub{color:var(--ink-2);font-size:12px}
.envbadge{font-size:10px;font-weight:600;letter-spacing:.05em;background:var(--amber-weak);color:var(--amber);border:1px solid var(--amber);border-radius:6px;padding:1px 6px;vertical-align:2px}
.spacer{flex:1}
.iconbtn{border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:10px;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.iconbtn:active{transform:scale(.96)}
.reposel{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line);display:flex;gap:6px;overflow-x:auto;padding:8px 12px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.reposel::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 12px;font-size:13px;color:var(--ink-2);cursor:pointer;white-space:nowrap}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.chip.dash{border-style:dashed;color:var(--accent)}
.content{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.statusline{padding:6px 14px;color:var(--ink-2);font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;animation:pulse 1.4s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(29,158,117,.5)}70%{box-shadow:0 0 0 7px rgba(29,158,117,0)}100%{box-shadow:0 0 0 0 rgba(29,158,117,0)}}
.gauge{display:inline-block;width:60px;height:6px;border-radius:3px;background:var(--line);overflow:hidden;vertical-align:middle}
.gauge i{display:block;height:100%}

/* board */
.board{padding:8px}
.col{margin-bottom:14px}
.colhead{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2);padding:6px 8px}
.colhead .n{color:var(--ink-3);font-weight:500}
.cards{display:flex;flex-direction:column;gap:8px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:11px 13px;cursor:pointer}
.card:active{transform:scale(.992)}
.card .t{font-weight:540;font-size:15px;line-height:1.35;margin-bottom:7px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;color:var(--ink-3);font-size:12px}
.statuschip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:540;border-radius:999px;padding:2px 9px}
.s-planned{background:var(--surface-2);color:var(--ink-2)}
.s-working{background:var(--accent-weak);color:var(--accent)}
.s-ready{background:var(--green-weak);color:var(--green)}
.s-changes{background:var(--red-weak);color:var(--red)}
.s-attn{background:var(--amber-weak);color:var(--amber)}
.s-auto{background:var(--green-weak);color:var(--green)}
.s-done{background:var(--surface-2);color:var(--ink-3)}
.s-epic{background:var(--purple-weak);color:var(--purple)}
.tagk{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--ink-3);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.cardbtn{margin-left:auto;border:1px solid var(--line);background:var(--surface);color:var(--accent);border-radius:8px;padding:3px 10px;font-size:12px;font-weight:540;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.cardbtn.play{color:var(--green);border-color:var(--green-weak);background:var(--green-weak)}
.cardbtn.fix{color:var(--red);border-color:var(--red-weak);background:var(--red-weak)}
.empty{color:var(--ink-3);font-size:13px;padding:10px;text-align:center}

/* mobile bottom column tabs */
.tabbar{position:sticky;bottom:0;z-index:25;display:grid;grid-template-columns:repeat(4,1fr);background:var(--surface);border-top:1px solid var(--line);padding-bottom:var(--safe-b)}
.tab{border:none;background:none;color:var(--ink-3);padding:9px 2px 8px;font-size:10.5px;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer}
.tab .lic{font-size:0}
.tab.on{color:var(--accent)}
.tab .bdg{font-size:10px;min-width:16px}

/* buttons + forms */
.btn{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:9px 13px;font-size:14px;font-weight:540;cursor:pointer;display:inline-flex;align-items:center;gap:6px;justify-content:center}
.btn:active{transform:scale(.98)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.green{background:var(--green);border-color:var(--green);color:#fff}
.btn.danger{color:var(--red);border-color:var(--red-weak)}
.btn.ghost{background:transparent}
.btn[disabled]{opacity:.5;pointer-events:none}
label{display:block;font-size:13px;color:var(--ink-2);margin:12px 2px 5px}
input,select,textarea{width:100%;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:10px 12px;outline:none}
input:focus,select,textarea:focus{border-color:var(--accent)}
textarea{resize:vertical;min-height:64px}
.ckline{display:flex;align-items:center;gap:9px;font-size:14px;color:var(--ink);margin:9px 2px}
.ckline input{width:auto}

/* sheets / modals */
.scrim{position:fixed;inset:0;background:rgba(8,10,14,.5);z-index:40;opacity:0;pointer-events:none;transition:opacity .18s}
.scrim.on{opacity:1;pointer-events:auto}
.sheet{position:fixed;z-index:50;background:var(--surface);transition:transform .22s ease;display:flex;flex-direction:column}
.sheet .sh{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);font-weight:600}
.sheet .sb{padding:14px 16px;overflow-y:auto;-webkit-overflow-scrolling:touch}
.sheet .sf{padding:12px 16px calc(12px + var(--safe-b));border-top:1px solid var(--line);display:flex;gap:8px;justify-content:flex-end;background:var(--surface)}
/* bottom-sheet on mobile */
.sheet.bottom{left:0;right:0;bottom:0;max-height:92dvh;border-radius:18px 18px 0 0;transform:translateY(110%)}
.sheet.bottom.on{transform:translateY(0)}
.row{display:flex;gap:8px;margin-top:14px}
.row .btn{flex:1}

/* detail */
.detail{position:fixed;inset:0;z-index:45;background:var(--bg);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s ease}
.detail.on{transform:translateX(0)}
.dhead{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--line);padding:calc(10px + var(--safe-t)) 12px 10px;display:flex;align-items:center;gap:10px}
.dhead .tt{font-size:15px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmeta{color:var(--ink-3);font-size:12px;font-weight:400}
.dtoolbar{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--line);display:flex;gap:6px;align-items:center;padding:8px 12px;overflow-x:auto;scrollbar-width:none}
.dtoolbar::-webkit-scrollbar{display:none}
.tbtn{flex:0 0 auto;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:9px;width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative}
.tbtn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.tbtn.green{background:var(--green);border-color:var(--green);color:#fff}
.tbtn.danger{color:var(--red);border-color:var(--red-weak)}
.tbtn[data-tip]:hover::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg);font-size:11px;white-space:nowrap;padding:3px 7px;border-radius:6px;z-index:60}
.dpanes{flex:1;display:flex;flex-direction:column;overflow:hidden}
.dpane{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 14px}
.dstream{background:#0d1117;color:#d6deeb;border-radius:10px;padding:9px 11px;font:12px/1.5 ui-monospace,Menlo,monospace;max-height:34vh;overflow:auto;white-space:pre-wrap;word-break:break-word}
.dstream .l.tool{color:#8aa0c0}.dstream .l.muted{color:#6b7686}
.sec{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3);margin:14px 2px 7px}
.cmt{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:9px 11px;margin-bottom:8px}
.cmt.ag{background:var(--surface-2)}
.cmt .h{font-size:12px;color:var(--ink-2);margin-bottom:4px}
.cmt .b{font-size:14px}
.cmt .b pre{background:var(--bg);padding:8px 10px;border-radius:8px;overflow:auto;font-size:12px}
.cmt .b code{background:var(--bg);padding:1px 5px;border-radius:5px;font-size:.9em}
.cmt .b img{max-width:100%;border-radius:8px}
.dcompose{position:sticky;bottom:0;background:var(--surface);border-top:1px solid var(--line);padding:8px 10px calc(8px + var(--safe-b));display:flex;gap:8px;align-items:flex-end}
.dcompose textarea{min-height:42px;max-height:140px;border-radius:20px;padding:9px 14px}
.autorow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.apill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:999px;padding:5px 11px;font-size:13px;cursor:pointer}
.apill.on{background:var(--green-weak);border-color:var(--green);color:var(--green)}
.apill.off{color:var(--ink-3);text-decoration:line-through}
.att{display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border-radius:8px;padding:3px 7px;font-size:12px;margin:4px 4px 0 0}
.att img{height:28px;border-radius:5px}
.muted{color:var(--ink-2)}
.toast{position:fixed;left:50%;bottom:calc(74px + var(--safe-b));transform:translateX(-50%) translateY(20px);background:var(--ink);color:var(--bg);padding:9px 15px;border-radius:11px;font-size:13px;opacity:0;pointer-events:none;transition:.2s;z-index:80}
.toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
.cmdbox{display:flex;gap:6px;align-items:center;margin-top:6px}
.cmdbox code{flex:1;background:#0d1117;color:#d6deeb;border-radius:8px;padding:7px 9px;font:12px ui-monospace,Menlo,monospace;overflow:auto;white-space:nowrap}

/* desktop */
@media(min-width:880px){
  .tabbar{display:none}
  .board{max-width:1500px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-items:start;padding:14px}
  .col{margin:0}
  .cards{max-height:calc(100dvh - 200px);overflow-y:auto;padding-right:2px}
  .detail{left:auto;right:0;width:min(1080px,92vw);box-shadow:-8px 0 30px rgba(0,0,0,.18)}
  .dpanes{flex-direction:row}
  .dpane.chat{flex:1;border-right:1px solid var(--line)}
  .dpane.side{width:46%;max-width:520px}
  .dstream{max-height:30vh}
  .sheet.bottom{left:auto;right:24px;bottom:24px;width:440px;max-height:84dvh;border-radius:16px;border:1px solid var(--line);transform:translateY(calc(100% + 40px))}
  .sheet.bottom.on{transform:translateY(0)}
}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style>
</head>
<body>
<div id="root" aria-busy="true"></div>
<script>
(function(){try{var t=localStorage.getItem("theme")||(matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);var m=document.getElementById("metatheme");if(m)m.setAttribute("content",t==="dark"?"#0e1014":"#f5f6f8");}catch(e){}})();
if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){});});}
</script>
<script type="module">
import { mount } from "/web/app.js";
mount(document.getElementById("root"));
</script>
</body></html>`;
}
