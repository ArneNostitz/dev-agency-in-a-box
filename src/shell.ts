/**
 * The v2 dashboard shell: a tiny HTML page with the design-token stylesheet (light + dark),
 * PWA wiring (manifest + service worker), and a Preact app loaded as an ES module from /web/app.js.
 * All the UI lives in /web/app.js (Preact + htm, no build step).
 */
export function renderShell(): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f6f8" id="metatheme">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Dev Agency in a Box">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/web/icons/icon-192.png">
<link rel="icon" href="/web/icons/icon.svg" type="image/svg+xml">
<title>Dev Agency in a Box</title>
<style>
:root{
  --bg:#f5f6f8;--surface:#ffffff;--surface-2:#eef0f3;--ink:#1c1e22;--ink-2:#5a6069;--ink-3:#9aa0a8;
  --line:#e4e7eb;--line-2:#d3d8de;--accent:#2f6df6;--accent-weak:#e7efff;--green:#0b8a52;--green-weak:#e6f7ef;
  --amber:#a76a00;--amber-weak:#fff3da;--red:#c0392b;--red-weak:#fdeceb;--purple:#6741d9;--purple-weak:#efe9ff;
  --shadow:0 1px 2px rgba(20,20,40,.06);--shadow-md:0 2px 8px rgba(0,0,0,.18);--radius:14px;--radius-sm:9px;
  --safe-b:env(safe-area-inset-bottom,0px);--safe-t:env(safe-area-inset-top,0px);
}
html[data-theme="dark"]{
  --bg:#0e1014;--surface:#171a1f;--surface-2:#1f242b;--ink:#e7e9ed;--ink-2:#9aa1ab;--ink-3:#6b727c;
  --line:#272c34;--line-2:#333a44;--accent:#5b8cff;--accent-weak:#172339;--green:#3ddc97;--green-weak:#10271d;
  --amber:#e0a83a;--amber-weak:#2a2110;--red:#f1746a;--red-weak:#2c1614;--purple:#a99bf5;--purple-weak:#1d1933;
  --shadow:none;--shadow-md:0 2px 10px rgba(0,0,0,.45);
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
@media(max-width:560px){.brandname{display:none}.repodrop-btn{max-width:52vw}}
.sub{color:var(--ink-2);font-size:12px}
.envbadge{font-size:10px;font-weight:600;letter-spacing:.05em;background:var(--amber-weak);color:var(--amber);border:1px solid var(--amber);border-radius:6px;padding:1px 6px;vertical-align:2px}
.spacer{flex:1}
.iconbtn{border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:10px;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.iconbtn.on{color:var(--accent);border-color:var(--accent)}
.dropwrap{position:relative;display:inline-flex}
.dropscrim{position:fixed;inset:0;z-index:40;background:transparent}
.dropmenu{position:absolute;top:calc(100% + 6px);right:0;z-index:41;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:6px;min-width:210px;max-height:64vh;overflow:auto}
.dropmenu-h{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3);padding:6px 8px 5px}
.dropmenu-item{display:flex;align-items:center;gap:7px;width:100%;text-align:left;border:none;background:transparent;color:var(--ink);padding:8px 9px;border-radius:8px;cursor:pointer;font-size:13.5px}
.dropmenu-item:hover{background:var(--surface-2)}
.dropmenu-item:disabled{cursor:default}
.dropmenu-sub{margin-left:auto;color:var(--ink-3);font-size:11.5px}
.dropmenu-foot{font-size:11.5px;color:var(--ink-3);padding:6px 8px 2px;border-top:1px solid var(--line);margin-top:4px}
.dropmenu-empty{padding:8px 9px;color:var(--ink-3);font-size:13px}
.iconbtn:active{transform:scale(.96)}
/* centered repo dropdown (selector + add/remove) */
.repodrop{flex:0 1 auto;min-width:0}
.repodrop-btn{display:inline-flex;align-items:center;gap:8px;max-width:min(60vw,360px);border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:7px 14px;font:14px inherit;font-weight:600;cursor:pointer}
.repodrop-btn:hover{border-color:var(--line-2)}
.repodrop-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.repodrop-sub{color:var(--ink-3);font-weight:400;font-size:12.5px}
.repodrop-menu{left:50%;right:auto;transform:translateX(-50%);min-width:280px;max-width:min(92vw,360px)}
.repodrop-row{display:flex;align-items:center;gap:4px;border-radius:8px}
.repodrop-row.sel{background:var(--accent-weak)}
.repodrop-pick{flex:1;display:flex;align-items:center;gap:7px;min-width:0;text-align:left;border:none;background:transparent;color:var(--ink);padding:8px 9px;border-radius:8px;cursor:pointer;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.repodrop-pick:hover{background:var(--surface-2)}
.repodrop-row.sel .repodrop-pick{color:var(--accent);font-weight:600}
.repodrop-x{border:none;background:transparent;color:var(--ink-3);cursor:pointer;display:flex;padding:6px;border-radius:8px}
.repodrop-x:hover{background:var(--red-weak);color:var(--red)}
.dropmenu-item.sel{color:var(--accent);font-weight:600;background:var(--accent-weak)}
.repodrop-add{display:flex;gap:6px;padding:2px 4px 6px}
.repodrop-add input{flex:1;min-width:0;border:1px solid var(--line);border-radius:9px;padding:7px 10px;font:13.5px inherit;background:var(--surface);color:var(--ink)}
.repodrop-avail{max-height:30vh;overflow:auto;border-top:1px solid var(--line);margin-top:2px;padding-top:2px}
.chip{flex:0 0 auto;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 12px;font-size:13px;color:var(--ink-2);cursor:pointer;white-space:nowrap}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.chip.dash{border-style:dashed;color:var(--accent)}
.content{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.statusline{padding:6px 14px;color:var(--ink-2);font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.buildstamp{font:11px ui-monospace,Menlo,monospace;color:var(--ink-3);cursor:default}
.anstat{display:inline-flex;align-items:center;gap:5px;color:var(--ink-3);cursor:default}
.andot{width:7px;height:7px;border-radius:50%;display:inline-block}
.andot.green{background:var(--green)}
.andot.amber{background:var(--amber)}
.statpop{position:relative;display:inline-flex;align-items:center}
.statlink{cursor:pointer;display:inline-flex;align-items:center;gap:5px;border-radius:6px;padding:1px 3px}
.statlink:hover{background:var(--surface-2);color:var(--ink)}
.statmenu{left:0;top:calc(100% + 6px);min-width:230px;padding:10px 12px;z-index:100}
.statmenu label{display:block;font-size:11.5px;color:var(--ink-3);margin:8px 0 3px}
.statmenu input{width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:13.5px inherit;background:var(--surface);color:var(--ink)}
.statmenu .btn{margin-top:10px;width:100%;justify-content:center}
/* model override selector (shared) */
.modelsel{max-width:150px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink-2);font:12.5px inherit;padding:4px 8px;height:30px;cursor:pointer}
.modelsel:hover{border-color:var(--line-2);color:var(--ink)}
.modelsel.sm{max-width:120px;height:24px;padding:1px 6px;font-size:11.5px;border-radius:7px}
/* agent editor */
.agentrow{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:10px 12px;margin-bottom:6px;cursor:pointer;font-size:14px}
.agentrow:hover{border-color:var(--line-2);background:var(--surface-2)}
.toolchips{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 2px}
.toolchip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:8px;padding:4px 9px;font-size:12.5px;cursor:pointer}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;animation:pulse 1.4s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(29,158,117,.5)}70%{box-shadow:0 0 0 7px rgba(29,158,117,0)}100%{box-shadow:0 0 0 0 rgba(29,158,117,0)}}
.spin{animation:dvspin .7s linear infinite;transform-origin:center}
@keyframes dvspin{to{transform:rotate(360deg)}}
/* in-flight states: a busy control disables pointer + dims slightly so a click clearly registered */
.tbtn:disabled,.cardbtn:disabled{cursor:default}
.tbtn.busy{opacity:.85;cursor:wait}
.cardbtn.busy{opacity:.8;cursor:wait}
.card.busy{cursor:wait;opacity:.92}
.card.busy:hover{box-shadow:var(--shadow)}
/* secret-health banner (MASTER_KEY mismatch / undecryptable token) */
.secbanner{margin:10px 12px 0;padding:10px 13px;border-radius:10px;border:1px solid var(--red);background:var(--red-weak);color:var(--red);font-size:13px;line-height:1.45}
.secbanner b{font-weight:680}
.gauge{display:inline-block;width:60px;height:6px;border-radius:3px;background:var(--line);overflow:hidden;vertical-align:middle}
.gauge i{display:block;height:100%}

/* board */
.board{padding:8px}
.col{margin-bottom:14px}
.colhead{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2);padding:6px 8px}
.planned-actions{display:flex;gap:8px;padding:2px 8px 8px}
.planned-actions .colbtn{flex:1;justify-content:center}
.colbtn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:8px;padding:8px 10px;font:12.5px inherit;font-weight:600;text-transform:none;letter-spacing:0;cursor:pointer;white-space:nowrap}
.colbtn:hover:not(:disabled){border-color:var(--line-2);color:var(--ink)}
.colbtn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.colbtn:disabled{opacity:.5;cursor:default}
.colhead .n{color:var(--ink-3);font-weight:500}
.cards{display:flex;flex-direction:column;gap:8px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:7px}
.card:active{transform:scale(.992)}
.card.active-now{border-left:3px solid var(--accent)}
.card-h{display:flex;align-items:center;gap:6px;min-height:18px}
.card-repo{font-size:11px;color:var(--ink-3);font-weight:540}
.card-title{font-weight:540;font-size:14.5px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--ink-3);font-size:12px}
.card-f{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;border-top:1px solid var(--line);padding-top:8px}
.card-f .cardbtn{margin-left:0}
.card-subs{display:flex;flex-direction:column;border-top:1px solid var(--line);padding-top:5px}
.subtoggle{display:flex;align-items:center;gap:6px;width:100%;text-align:left;border:none;background:transparent;color:var(--ink-2);font-size:12px;font-weight:560;cursor:pointer;padding:2px}
.subtoggle .chev{display:inline-flex;color:var(--ink-3);transition:transform .15s}
.subtoggle.open .chev{transform:rotate(90deg)}
.subtoggle .n{margin-left:auto;color:var(--ink-3);font-weight:500}
.sublist{display:flex;flex-direction:column;gap:1px;margin-top:3px}
.subrow{display:flex;align-items:center;gap:7px;width:100%;text-align:left;border:none;background:transparent;color:var(--ink);padding:4px 5px;border-radius:7px;cursor:pointer;font-size:12.5px}
.subrow:hover{background:var(--surface-2)}
.subdot{flex:0 0 auto;width:8px;height:8px;border-radius:50%}
.subnum{flex:0 0 auto;color:var(--ink-3);font-size:11px}
.subttl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.substate{flex:0 0 auto;font-size:10.5px;color:var(--ink-3)}
.statuschip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:540;border-radius:999px;padding:2px 9px}
.s-planned{background:var(--surface-2);color:var(--ink-2)}
.s-working{background:var(--accent-weak);color:var(--accent)}
.s-ready{background:var(--green-weak);color:var(--green)}
.s-changes{background:var(--red-weak);color:var(--red)}
.s-attn{background:var(--amber-weak);color:var(--amber)}
.s-auto{background:var(--green-weak);color:var(--green)}
.s-conflict{background:var(--amber-weak);color:var(--amber)}
.s-done{background:var(--surface-2);color:var(--ink-3)}
.s-epic{background:var(--purple-weak);color:var(--purple)}
.tagk{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--ink-3);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.cardbtn{margin-left:auto;border:1px solid var(--line);background:var(--surface);color:var(--accent);border-radius:8px;padding:3px 10px;font-size:12px;font-weight:540;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
.cardbtn.play{color:var(--green);border-color:var(--green-weak);background:var(--green-weak)}
.cardbtn.fix{color:var(--red);border-color:var(--red-weak);background:var(--red-weak)}
.cardbtn.stop{color:var(--amber);border-color:var(--amber)}
.testres{font-size:12px;margin:6px 2px 0;line-height:1.4}
.testres.ok{color:var(--green)}
.testres.bad{color:var(--red)}
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
.btn.warn{color:var(--amber);border-color:var(--amber)}
.btn.busy{opacity:.7;cursor:wait}
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

/* token usage */
.useg-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.useg-tab{border:1px solid var(--line);background:transparent;color:var(--ink-2);padding:5px 11px;border-radius:999px;cursor:pointer;font-size:12.5px}
.useg-tab.on{background:var(--accent);border-color:var(--accent);color:#fff}
.useg-totals{display:flex;gap:10px;margin-bottom:6px}
.useg-big{flex:1;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.useg-big b{font-size:22px;font-weight:700;line-height:1.1}
.useg-big span{font-size:11.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.04em}
.useg-sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);margin:18px 0 7px;font-weight:600}
.useg-row,.useg-issue{display:grid;grid-template-columns:minmax(0,1fr) 34% auto;align-items:center;gap:9px;padding:5px 0;font-size:13px}
.useg-issue{width:100%;text-align:left;border:none;background:transparent;color:var(--ink);cursor:pointer;border-radius:7px}
.useg-issue:hover{background:var(--surface-2)}
.useg-row-l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.useg-row-r{text-align:right;color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.useg-track{height:7px;border-radius:999px;background:var(--surface-2);overflow:hidden}
.useg-track i{display:block;height:100%;border-radius:999px;background:var(--accent)}
.dusage{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;padding:8px 11px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2);font-size:12.5px;color:var(--ink-2)}
.dusage span{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}
.conflictbox{border:1px solid var(--amber);border-radius:12px;padding:12px 14px;margin-bottom:12px;background:color-mix(in srgb,var(--amber) 10%,var(--surface))}
.conflictbox-h{display:flex;align-items:center;gap:7px;font-weight:600;color:var(--amber);font-size:14px}
.conflictbox-b{font-size:13px;color:var(--ink-2);margin:6px 0}
.conflictbox-files{margin:6px 0 10px;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:3px}
.conflictbox-files li a{display:inline-flex;align-items:center;gap:5px;font:12.5px ui-monospace,Menlo,monospace;color:var(--ink-2);text-decoration:none}
.conflictbox-files li a:hover{color:var(--accent);text-decoration:underline}

/* detail */
.dscrim{position:fixed;inset:0;z-index:44;background:transparent}
.prbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--green);background:var(--green-weak);border-radius:12px;padding:9px 11px;margin:6px 0 4px}
.prbar-l{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:13.5px;margin-right:auto}
.prbar .btn{padding:6px 11px;font-size:13px}
.epicbox{border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin-bottom:6px;background:var(--surface)}
.epicalldone{color:var(--green);font-weight:600;text-transform:none;letter-spacing:0}
.epiclist{display:flex;flex-direction:column;gap:2px}
.epicrow{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:transparent;color:var(--ink);padding:6px 7px;border-radius:8px;cursor:pointer;font-size:13.5px}
.epicrow:hover{background:var(--surface-2)}
.epicck{flex:0 0 auto;display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:50%}
.epicck.done{background:var(--green-weak);color:var(--green)}
.epicck.open{border:1px solid var(--line);color:var(--ink-3)}
.epicnum{flex:0 0 auto;color:var(--ink-3);font-size:12px}
.epictitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.detail{position:fixed;inset:0;z-index:45;background:var(--bg);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s ease}
.detail.on{transform:translateX(0)}
.dhead{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--line);padding:calc(10px + var(--safe-t)) 12px 10px;display:flex;align-items:center;gap:10px}
.dhead .tt{font-size:15px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmeta{color:var(--ink-3);font-size:12px;font-weight:400}
.dtoolbar{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--line);display:flex;gap:6px;align-items:center;padding:8px 12px;flex-wrap:wrap}
.toolmore{display:flex;flex-direction:column;gap:4px;min-width:200px}
.toolmore-row{display:flex}
.toolmore-row>*{flex:1;width:100%}
.toolmore .tbtn{width:100%;height:36px;justify-content:flex-start;padding:0 12px;gap:8px}
.toolmore .autotog{width:100%;justify-content:space-between}
.tbtn{flex:0 0 auto;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:9px;width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;gap:0;cursor:pointer;position:relative}
.tbtn:has(.tlabel){width:auto;padding:0 13px;gap:7px}
.tlabel{font-size:13px;font-weight:600;white-space:nowrap}
.tbtn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.tbtn.green{background:var(--green);border-color:var(--green);color:#fff}
.tbtn.danger{color:var(--red);border-color:var(--red-weak)}
.tbtn.warn{color:var(--amber);border-color:var(--amber)}
.tbtn.auto.on{background:var(--green-weak);border-color:var(--green);color:var(--green)}
.tbtn.auto.off{color:var(--ink-3);opacity:.6}
.tbtn.armed{background:var(--red);border-color:var(--red);color:#fff}
.tbtn.green.armed{background:#b45309;border-color:#b45309;color:#fff}
.tbsep{flex:0 0 auto;align-self:stretch;width:1px;margin:6px 3px;background:var(--line)}
/* obvious ON/OFF toggle switch (auto-resume / auto-merge) */
.autotog{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;border:none;background:transparent;color:var(--ink-2);height:38px;padding:0 8px;cursor:pointer;font-size:13px;font-weight:560}
.autotog-l{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.autotog-sw{position:relative;width:32px;height:18px;border-radius:999px;background:var(--line);transition:background .15s;flex:0 0 auto}
.autotog-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.autotog.on{color:var(--green)}
.autotog.on .autotog-sw{background:var(--green)}
.autotog.on .autotog-knob{transform:translateX(14px)}
.autotog.busy{opacity:.7;cursor:wait}
.tbtn[data-tip]:hover::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg);font-size:11px;white-space:nowrap;padding:3px 7px;border-radius:6px;z-index:60}
.dpanes{flex:1;display:flex;flex-direction:column;overflow:hidden}
.dpane{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 14px}
.dpanes>.dpane{flex:1 1 auto;min-height:0}
.dpane.side{display:flex;flex-direction:column;overflow:hidden}
.dstream{flex:1 1 auto;min-height:140px;background:#0d1117;color:#d6deeb;border-radius:10px;padding:9px 11px;font:12px/1.5 ui-monospace,Menlo,monospace;overflow:auto;white-space:pre-wrap;word-break:break-word}
.dstream .l.tool{color:#8aa0c0}.dstream .l.muted{color:#6b7686}
.sec{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3);margin:0 2px 9px}
.setgrp{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:13px 14px;margin-bottom:12px}
.setgrp .sec{margin-top:0}
.cmt{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:9px 11px;margin-bottom:8px}
.cmt.ag{background:var(--surface-2)}
.cmt.skel{opacity:.55}
.cmt .h{font-size:12px;color:var(--ink-2);margin-bottom:4px;display:flex;align-items:center;gap:6px}
.avi{display:inline-block;flex:0 0 auto;overflow:hidden;vertical-align:middle;line-height:0}
.avi img{width:100%;height:100%;display:block}
.avi.head img{object-fit:contain;object-position:center}
.avi.full img{object-fit:contain;object-position:center top}
.cmt.incoming{border-left:3px solid var(--accent)}
.cmt .h .cmt-in{display:inline-flex;align-items:center;color:var(--accent);vertical-align:middle}
.cmt .h .cmt-edit-btn{margin-left:auto;opacity:0;transition:opacity .15s;padding:2px}
.cmt:hover .h .cmt-edit-btn{opacity:1}
.cmt .b,.composer .b{font-size:14px}
.cmt .b pre,.composer .b pre{background:var(--bg);padding:8px 10px;border-radius:8px;overflow:auto;font-size:12px}
.cmt .b code,.composer .b code{background:var(--bg);padding:1px 5px;border-radius:5px;font-size:.9em}
.cmt .b img,.composer .b img{max-width:100%;border-radius:8px}
.cmt .b h1,.composer .b h1{font-size:1.35em;font-weight:700;margin:.5em 0 .2em;border-bottom:1px solid var(--line);padding-bottom:.2em}
.cmt .b h2,.composer .b h2{font-size:1.15em;font-weight:700;margin:.45em 0 .2em;border-bottom:1px solid var(--line);padding-bottom:.15em}
.cmt .b h3,.composer .b h3{font-size:1.05em;font-weight:600;margin:.4em 0 .15em}
.cmt .b h4,.cmt .b h5,.cmt .b h6,.composer .b h4,.composer .b h5,.composer .b h6{font-size:1em;font-weight:600;margin:.3em 0 .1em}
.cmt .b ul,.cmt .b ol,.composer .b ul,.composer .b ol{margin:.35em 0;padding-left:1.5em}
.cmt .b li,.composer .b li{margin:.1em 0}
.cmt .b blockquote,.composer .b blockquote{border-left:3px solid var(--line-2);margin:.35em 0;padding:.1em .7em;color:var(--ink-2)}
.cmt .b blockquote p{margin:.15em 0}
.cmt .b hr{border:none;border-top:1px solid var(--line);margin:.6em 0}
.cmt .b p{margin:.3em 0}
.cmt-edit-ta{width:100%;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);font:inherit;font-size:14px;padding:8px 10px;resize:vertical;min-height:80px;box-sizing:border-box}
.cmt-edit-row{display:flex;gap:6px;margin-top:6px;justify-content:flex-end}
.scroll-fab-wrap{position:sticky;bottom:8px;display:flex;justify-content:center;pointer-events:none;margin-top:4px}
.scroll-fab-wrap.top{bottom:auto;top:8px;margin-top:0;margin-bottom:4px}
.scroll-fab{pointer-events:auto;background:var(--surface)!important;border:1px solid var(--line)!important;box-shadow:var(--shadow);border-radius:50%!important;width:32px!important;height:32px!important;display:flex;align-items:center;justify-content:center}
.dcompose{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--line);padding:10px 12px calc(10px + var(--safe-b))}
.composer{display:flex;flex-direction:column;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:11px 13px;box-shadow:0 1px 3px rgba(0,0,0,.05);transition:border-color .15s,box-shadow .15s}
.composer:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-weak,rgba(47,109,246,.12))}
.composer textarea{border:none;background:transparent;resize:none;outline:none;width:100%;font:inherit;font-size:14.5px;line-height:1.5;color:var(--ink);min-height:22px;max-height:200px;padding:0;overflow-y:auto}
.composer textarea::placeholder{color:var(--ink-3)}
.composer-row{display:flex;align-items:center;gap:8px}
.composer-row .spacer{flex:1}
.composer-icon{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;color:var(--ink-2);cursor:pointer;flex:0 0 auto}
.composer-icon:hover{background:var(--surface-2)}
.composer-atts{display:flex;flex-wrap:wrap;gap:4px}
.composer .btn{padding:7px 13px;font-size:13.5px}
.autorow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.apill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:999px;padding:5px 11px;font-size:13px;cursor:pointer}
.apill.on{background:var(--green-weak);border-color:var(--green);color:var(--green)}
.apill.off{color:var(--ink-3);text-decoration:line-through}
.att{display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border-radius:8px;padding:3px 7px;font-size:12px;margin:4px 4px 0 0}
.att img{height:28px;border-radius:5px}
.muted{color:var(--ink-2)}
.toast-stack{position:fixed;bottom:calc(74px + var(--safe-b));right:16px;z-index:80;display:flex;flex-direction:column-reverse;gap:8px;max-width:min(340px,calc(100vw - 32px));pointer-events:none}
.toast-item{display:flex;align-items:center;gap:8px;background:var(--ink);color:var(--bg);padding:9px 13px;border-radius:10px;font-size:13px;line-height:1.4;box-shadow:var(--shadow-md);animation:toastin .18s ease;pointer-events:auto}
.toast-item.t-error{background:var(--red);color:#fff}
.toast-x{margin-left:auto;background:transparent;border:none;color:inherit;opacity:.75;cursor:pointer;padding:0 0 0 8px;font-size:15px;line-height:1;flex-shrink:0}
.toast-x:hover{opacity:1}
@keyframes toastin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
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
  .dpane.chat{flex:1 1 auto;border-right:1px solid var(--line)}
  .dpane.side{flex:0 0 46%;width:46%;max-width:520px}
  .sheet.bottom{left:50%;top:50%;right:auto;bottom:auto;width:min(620px,92vw);max-height:88dvh;border-radius:16px;border:1px solid var(--line);transform:translate(-50%,-50%) scale(.97);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s ease}
  .sheet.bottom.on{transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:auto}
}
.norepo{padding:48px 20px;display:flex;flex-direction:column;align-items:center;text-align:center}
.searchrow{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:10px;padding:0 8px;margin:6px 0}
.searchrow .searchic{color:var(--ink-3);flex:0 0 auto}
.searchrow input{border:none;background:none;padding:9px 4px;flex:1}
.searchrow input:focus{border:none}
.repolist{max-height:42vh;overflow-y:auto;-webkit-overflow-scrolling:touch}
/* onboarding wizard */
.onboard{position:fixed;inset:0;z-index:60;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch}
.ob{max-width:580px;margin:0 auto;width:100%;padding:calc(28px + var(--safe-t)) 20px calc(28px + var(--safe-b))}
.obdots{display:flex;gap:6px;justify-content:center;margin-bottom:22px}
.obdot{width:7px;height:7px;border-radius:50%;background:var(--line)}
.obdot.on{background:var(--accent)} .obdot.done{background:var(--green)}
.obki{width:52px;height:52px;border-radius:14px;background:var(--accent-weak);color:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.obh{font-size:22px;font-weight:600;margin:2px 0 6px}
.obsub{color:var(--ink-2);margin-bottom:8px;line-height:1.6}
.obsteps{background:var(--surface-2);border-radius:12px;padding:13px 15px;font-size:14px;line-height:1.7;white-space:pre-wrap;margin:14px 0;color:var(--ink)}
.oblink{display:inline-flex;align-items:center;gap:6px;margin:2px 0 8px;font-weight:540}
.obnav{display:flex;gap:8px;margin-top:20px}
.obnav .btn{flex:1}
.obpick{display:flex;flex-direction:column;gap:8px;margin:14px 0}
.obchip{border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:12px 14px;cursor:pointer;font-size:15px;display:flex;align-items:center;gap:10px;font-weight:540}
.obchip .lic{color:var(--ink-3)}
.obchip.on{border-color:var(--accent);background:var(--accent-weak);color:var(--accent)} .obchip.on .lic{color:var(--accent)}
.obchip small{display:block;font-weight:400;color:var(--ink-2);font-size:12px;margin-top:1px}
.obchip .ck{margin-left:auto;color:var(--accent)}
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
