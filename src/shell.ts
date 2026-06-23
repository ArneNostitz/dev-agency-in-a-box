/**
 * The v2 dashboard shell: a tiny HTML page with the design-token stylesheet (light + dark),
 * PWA wiring (manifest + service worker), and a Preact app loaded as an ES module from /web/app.js.
 * All the UI lives in /web/app.js (Preact + htm, no build step).
 */
import { versionInfo } from "./version.js";

export const SHELL_CSS = `:root{
  --bg:#f5f6f8;--surface:#ffffff;--surface-2:#eef0f3;--ink:#1c1e22;--ink-2:#5a6069;--ink-3:#9aa0a8;
  --line:#e4e7eb;--line-2:#d3d8de;--accent:#2f6df6;--accent-weak:#e7efff;--green:#0b8a52;--green-weak:#e6f7ef;
  --amber:#a76a00;--amber-weak:#fff3da;--red:#c0392b;--red-weak:#fdeceb;--purple:#6741d9;--purple-weak:#efe9ff;--row-hover:rgba(18,28,48,.035);--row-sel:rgba(47,109,246,.07);--hair:#edeef1;
  --shadow:0 1px 2px rgba(20,20,40,.06);--shadow-md:0 2px 8px rgba(0,0,0,.18);--radius:14px;--radius-sm:9px;
  --safe-b:env(safe-area-inset-bottom,0px);--safe-t:env(safe-area-inset-top,0px);
}
html[data-theme="dark"]{
  --bg:#0e1014;--surface:#171a1f;--surface-2:#1f242b;--ink:#e7e9ed;--ink-2:#9aa1ab;--ink-3:#6b727c;
  --line:#272c34;--line-2:#333a44;--accent:#5b8cff;--accent-weak:#172339;--green:#3ddc97;--green-weak:#10271d;
  --amber:#e0a83a;--amber-weak:#2a2110;--red:#f1746a;--red-weak:#2c1614;--purple:#a99bf5;--purple-weak:#1d1933;--row-hover:rgba(255,255,255,.04);--row-sel:rgba(91,140,255,.13);--hair:#23272e;
  --shadow:none;--shadow-md:0 2px 10px rgba(0,0,0,.45);
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;-webkit-text-size-adjust:100%;overscroll-behavior-y:none}
a{color:var(--accent);text-decoration:none}
button{font:inherit}
.lic{display:inline-block;vertical-align:-3px}
input,select,textarea{font-size:16px}

.app{display:flex;flex-direction:column;height:100dvh;max-width:100vw;overflow-x:hidden}
html,body{overflow-x:hidden}
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
.dropscrim{position:fixed;inset:0;z-index:80;background:transparent}
.dropmenu{position:absolute;top:calc(100% + 6px);right:0;z-index:81;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:6px;min-width:210px;max-height:64vh;overflow:auto}
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
.topbtns{display:flex;align-items:center;gap:2px}
.topburger{display:none}
@media(max-width:680px){.topbtns{display:none}.topburger{display:inline-flex}}
.repodrop-btn{display:inline-flex;align-items:center;gap:8px;max-width:min(60vw,360px);border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:7px 14px;font:14px inherit;font-weight:600;cursor:pointer}
.repodrop-btn:hover{border-color:var(--line-2)}
.repodrop-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.repodrop-sub{color:var(--ink-3);font-weight:400;font-size:12.5px}
.repodrop-menu{left:50%;right:auto;transform:translateX(-50%);min-width:300px;max-width:min(92vw,380px)}
.repodrop-head{display:none}
@media(max-width:560px){.repodrop-head{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:15px;padding:4px 4px 10px;border-bottom:1px solid var(--line);margin-bottom:6px;position:sticky;top:0;background:var(--surface)}}
@media(max-width:560px){.repodrop-menu{position:fixed;inset:0;transform:none;width:auto;min-width:0;max-width:none;max-height:none;border:none;border-radius:0;padding:10px 12px calc(12px + var(--safe-b))}.repodrop-ctl{position:static;opacity:1;pointer-events:auto;background:none;padding-left:0;margin-left:auto}.repodrop-row{flex-wrap:wrap}}
.repodrop-row{position:relative;display:flex;align-items:center;border-radius:8px}
.repodrop-row.sel{background:var(--accent-weak)}
.repodrop-row:hover{background:var(--surface-2)}
.repodrop-pick{flex:1;display:flex;align-items:baseline;gap:6px;min-width:0;text-align:left;border:none;background:transparent;color:var(--ink);padding:9px 10px;border-radius:8px;cursor:pointer;font-size:14px;overflow:hidden;white-space:nowrap}
.repodrop-rowner{color:var(--ink-3);font-size:12px;flex:0 0 auto}
.repodrop-rname{font-weight:600;overflow:hidden;text-overflow:ellipsis}
.repodrop-row.sel .repodrop-pick .repodrop-rname{color:var(--accent)}
/* per-repo controls overlay on the right; revealed on hover (desktop) or when selected (tap = mobile) */
.repodrop-ctl{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:4px;padding-left:14px;opacity:0;pointer-events:none;transition:opacity .12s;background:linear-gradient(90deg,transparent,var(--surface) 14px)}
.repodrop-row:hover .repodrop-ctl{opacity:1;pointer-events:auto;background:linear-gradient(90deg,transparent,var(--surface-2) 14px)}
.repodrop-row.sel .repodrop-ctl{opacity:1;pointer-events:auto;background:linear-gradient(90deg,transparent,var(--accent-weak) 14px)}
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
.statusline{flex:none;padding:5px 14px calc(5px + var(--safe-b));color:var(--ink-3);font-size:11.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid var(--line);background:var(--surface)}
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

/* board controls toolbar */
.bctrl{display:flex;align-items:center;gap:8px;padding:10px 14px 4px;flex-wrap:wrap}
.bctrl-group{display:flex;align-items:center;gap:6px}
.bctrl-label{font-size:11.5px;color:var(--ink-3);font-weight:540;white-space:nowrap}
.bctrl select{font:12.5px inherit;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:4px 8px;cursor:pointer}
.bctrl select:focus{outline:none;border-color:var(--accent)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden}
.seg .segbtn{border:none;border-right:1px solid var(--line);border-radius:0;height:30px}
.seg .segbtn:last-child{border-right:none}
.segbtn{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:9px;padding:5px 9px;cursor:pointer;font:12px inherit;height:30px}
.segbtn.on{background:var(--accent-weak);color:var(--accent)}
.segbtn:hover:not(.on){background:var(--surface-2);color:var(--ink)}
.segdir{margin:0 -2px 0 -3px}
.segx{font-weight:540;font-size:11.5px}

/* board */
.board{padding:8px}
.board-bands{max-width:1500px;margin:0 auto;padding:14px;display:flex;flex-direction:column;gap:16px}
.band{border:1px solid var(--line);border-radius:14px;background:var(--surface-2);padding:10px 12px}
.band-head{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink);margin:0 2px 8px}
.band-head .n{color:var(--ink-3);font-weight:500}
.band-cols{display:flex;flex-direction:column;gap:10px}
.band-cards{max-height:520px;overflow-y:auto;padding-right:2px}
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
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:7px;width:100%;max-width:560px;margin-inline:auto}
.card:active{transform:scale(.992)}
.card.active-now{border-left:3px solid var(--accent)}
.card-h{display:flex;align-items:center;gap:6px;min-height:18px;overflow:hidden;white-space:nowrap}
.statusdot{flex:0 0 auto;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff}
.card-repo{font-size:11px;color:var(--ink-3);font-weight:540;overflow:hidden;text-overflow:ellipsis;min-width:0}
.card-num{font-size:11px;color:var(--ink-3);flex:0 0 auto}
.card-hicons{margin-left:auto;display:flex;align-items:center;gap:6px;flex:0 0 auto}
.card-hicon{display:inline-flex;align-items:center;color:var(--ink-3)}
.card-byagent{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:600;color:var(--accent);background:var(--accent-weak);border-radius:999px;padding:1px 7px}
.card-m{display:flex;flex-direction:column;gap:3px}
.card-title{font-weight:560;font-size:14.5px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{display:flex;align-items:flex-start;gap:6px;font-size:11.5px;color:var(--ink-3);min-height:20px}
.card-meta .role{flex:0 0 auto;font-weight:560;color:var(--ink-2);text-transform:capitalize}
.card-excerpt{flex:1;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.35}
.card-time{margin-left:auto;color:var(--ink-3);font-size:12px}
/* instant custom tooltip — pops the moment you hover, no delay */
.tip{position:relative}
/* tooltip text is rendered by the global fixed .gtip (never clipped); .tip just marks an anchor */
.iconbtn-sm{flex:0 0 auto;width:28px;height:28px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.iconbtn-sm:hover{background:var(--surface-2)}
.iconbtn-sm:disabled{cursor:default;opacity:.6}
/* per-card LLM picker (custom dropdown) */
.mp{position:relative;display:inline-flex;flex:0 0 auto}
.mpscrim{position:fixed;inset:0;z-index:44}
.mpmenu{position:absolute;bottom:calc(100% + 6px);left:0;z-index:46;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:5px;min-width:170px;max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:1px}
.mpitem{display:flex;align-items:center;gap:7px;width:100%;text-align:left;border:none;background:transparent;color:var(--ink);padding:6px 8px;border-radius:7px;cursor:pointer;font-size:12.5px;white-space:nowrap}
.mpitem:hover{background:var(--surface-2)}
.mpitem.on{color:var(--accent);font-weight:560}
.plogo{display:inline-block;object-fit:contain;border-radius:4px;vertical-align:middle;flex:0 0 auto}
/* workspace setup progress bar (clone + index) — real % streamed from the backend */
.setupbar{margin:2px 0}
.setupbar-track{height:6px;border-radius:999px;background:var(--surface-2);overflow:hidden}
.setupbar-fill{height:100%;background:var(--accent);border-radius:999px;transition:width .25s ease}
.setupbar-lbl{display:inline-flex;align-items:center;gap:4px;margin-top:3px;font-size:11px;color:var(--ink-3)}
.card-f{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:nowrap;border-top:1px solid var(--line);padding-top:8px}
.card-f-l{display:flex;align-items:center;gap:6px}
.card-f-r{display:flex;align-items:center;gap:6px}
.card-pr{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--ink-3);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:1px 7px}
.card-pr:hover{color:var(--accent);border-color:var(--accent)}
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
.modelrow{display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid var(--line)}
.modelrow-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px}
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
.dtoolbar{position:sticky;top:0;z-index:20;background:var(--surface);border-bottom:1px solid var(--line);display:flex;gap:6px;align-items:center;padding:8px 12px;flex-wrap:wrap}
.toolmore{display:flex;flex-direction:column;gap:4px;min-width:200px}
.toolmore-row{display:flex}
.toolmore-row>*{flex:1;width:100%}
.toolmore .tbtn{width:100%;height:36px;justify-content:flex-start;padding:0 12px;gap:8px}
.toolmore .autotog{width:100%;justify-content:space-between}
/* clean dropdown menu (More) */
.dropmenu.menu{padding:5px;min-width:208px}
.menu-item{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:none;background:transparent;color:var(--ink);height:38px;padding:0 10px;border-radius:9px;cursor:pointer;font-size:13.5px;font-weight:500}
.menu-item:hover{background:var(--surface-2)}
.menu-item:disabled{cursor:default;opacity:.7}
.menu-item .ti,.menu-item>svg{flex:0 0 auto;color:var(--ink-2)}
.menu-item .mi-label{flex:1;white-space:nowrap}
.menu-item .mi-val{color:var(--ink-3);font-size:12.5px;font-weight:500}
.menu-item.danger{color:var(--red)}
.menu-item.danger .ti,.menu-item.danger>svg{color:var(--red)}
.menu-item.danger:hover{background:var(--red-weak,rgba(220,60,60,.1))}
.menu-item .mi-switch{position:relative;width:34px;height:19px;border-radius:999px;background:var(--line-2);transition:background .15s;flex:0 0 auto}
.menu-item .mi-switch.on{background:var(--green)}
.menu-item .mi-knob{position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.menu-item .mi-switch.on .mi-knob{transform:translateX(15px)}
.menu-sep{height:1px;background:var(--line);margin:5px 8px}
/* card perm-delete X */
.card-del{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:6px;background:transparent;color:var(--ink-3);cursor:pointer;padding:0}
.card-del:hover{background:var(--red-weak,rgba(220,60,60,.12));color:var(--red)}
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

.segwrap{display:flex;justify-content:center;padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--line)}
.segctl{display:inline-flex;background:var(--surface-2);border-radius:10px;padding:3px;gap:2px}
.segbtn{border:none;background:transparent;color:var(--ink-2);font:13.5px inherit;font-weight:600;padding:7px 20px;border-radius:8px;cursor:pointer;transition:color .12s}
.segbtn.on{background:var(--surface);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.dpanes{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.dpane{overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:12px 14px;min-width:0;max-width:100%}
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
.avi.custom{border-radius:50%;overflow:hidden}
.avi.custom img{object-fit:cover;object-position:center}
.avi.full img{object-fit:contain;object-position:center top}
.cmt.incoming{border-left:3px solid var(--accent)}
.cmt .h .cmt-in{display:inline-flex;align-items:center;color:var(--accent);vertical-align:middle}
.cmt .h .cmt-role{font-weight:600;color:var(--ink)}
.cmt .h .cmt-edit-btn{margin-left:auto;opacity:0;transition:opacity .15s;padding:2px}
.cmt:hover .h .cmt-edit-btn{opacity:1}
.cmt .b,.composer .b{font-size:14px;overflow-wrap:anywhere;word-break:break-word;min-width:0}
.cmt .b pre,.composer .b pre{white-space:pre-wrap;word-break:break-word;max-width:100%}
.cmt,.cmt .h,.cmt .h>span{min-width:0;max-width:100%;overflow-wrap:anywhere}
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
/* MarkdownArea: rendered-markdown overlay behind a transparent-text textarea (live inline preview). */
.mdarea{position:relative}
.mdarea-preview{position:absolute;inset:0;z-index:0;pointer-events:none;color:var(--ink);font:inherit;font-family:inherit;font-size:14.5px;line-height:1.5;letter-spacing:normal;white-space:pre-wrap;word-break:break-word;overflow:hidden;padding:0;margin:0;border:0}
.mdarea-preview>div{min-height:1.5em}
.mdarea-preview .mde{visibility:hidden}
.mdarea-preview .mdh{font-weight:700;color:var(--accent)}
.mdarea-preview .mdh2{opacity:.92}.mdarea-preview .mdh3{opacity:.84}.mdarea-preview .mdh4{opacity:.76}.mdarea-preview .mdh5{opacity:.68}.mdarea-preview .mdh6{opacity:.6}
.mdarea-preview .mdb,.mdarea-preview .mdo{color:var(--ink-2)}
.mdarea-preview .mdq{color:var(--ink-2);font-style:italic}
.mdarea-preview .mdc{color:var(--ink-3);font-family:ui-monospace,Menlo,monospace}
.mdarea-preview a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.mdarea-preview code{background:var(--surface-2);padding:1px 5px;border-radius:5px;font-size:.9em;font-family:ui-monospace,Menlo,monospace}
.mdarea-preview strong{font-weight:700}
.mdarea-preview img{max-width:100%;border-radius:8px}
.mdarea textarea{position:relative;z-index:1;background:transparent;color:transparent!important;caret-color:var(--ink)}
.mdarea textarea::selection{background:var(--accent-weak)}
.mdarea textarea::placeholder{color:var(--ink-3)}
.composer-row{display:flex;align-items:center;gap:8px}
.composer-row .spacer{flex:1}
.composer-icon{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;color:var(--ink-2);cursor:pointer;flex:0 0 auto}
.composer-icon:hover{background:var(--surface-2)}
.composer-atts{display:flex;flex-wrap:wrap;gap:4px}
.composer .btn{padding:7px 13px;font-size:13.5px}
.autorow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.apill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:999px;padding:5px 11px;font-size:13px;cursor:pointer}
.apill.on{background:var(--green-weak);border-color:var(--green);color:var(--green)}
.apill.off{color:var(--ink-3)}
.att{display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border-radius:8px;padding:3px 7px;font-size:12px;margin:4px 4px 0 0}
.att img{height:28px;border-radius:5px}
.muted{color:var(--ink-2)}
.toast-stack{position:fixed;bottom:calc(74px + var(--safe-b));right:16px;z-index:80;display:flex;flex-direction:column-reverse;gap:8px;max-width:min(340px,calc(100vw - 32px));pointer-events:none}
.toast-item{position:relative;overflow:visible;display:flex;align-items:center;gap:8px;background:var(--ink);color:var(--bg);padding:9px 13px;border-radius:10px;font-size:13px;line-height:1.4;box-shadow:var(--shadow-md);animation:toastin .18s ease;pointer-events:auto}
.toast-item.t-error{background:var(--red);color:#fff}
.toast-item>span{min-width:0;overflow-wrap:anywhere;word-break:break-word;padding-left:12px}
.toast-x{position:absolute;top:-7px;left:-7px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;background:var(--surface);color:var(--ink-2);border:1.5px solid var(--line);border-radius:50%;font-size:11px;line-height:1;cursor:pointer;padding:0;box-shadow:var(--shadow)}
.toast-x:hover{background:var(--surface-2);color:var(--ink);border-color:var(--line-2)}
.toast-msg-link{color:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.toast-msg-link:hover{opacity:.85}
.toast-msg-path{font-family:ui-monospace,Menlo,monospace;cursor:pointer}
.toast-msg-path:hover{opacity:.85}
@keyframes toastin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.cmdbox{display:flex;gap:6px;align-items:center;margin-top:6px}
.cmdbox code{flex:1;background:#0d1117;color:#d6deeb;border-radius:8px;padding:7px 9px;font:12px ui-monospace,Menlo,monospace;overflow:auto;white-space:nowrap}

/* desktop */
@media(min-width:880px){
  .tabbar{display:none}
  .board{max-width:1500px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-items:start;padding:14px}
  .board.group-repo{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
  .band-cols{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .col{margin:0}
  .cards{max-height:calc(100dvh - 200px);overflow-y:auto;padding-right:2px}
  .detail{left:0;right:0;width:auto;box-shadow:none}
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

/* atomic custom Select (native-select replacement; menu is fixed-positioned → never clipped) */
.sel{position:relative;display:inline-flex}
.sel-btn{display:inline-flex;align-items:center;gap:6px;font:12.5px inherit;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:4px 9px;cursor:pointer}
.sel-btn:hover{border-color:var(--line-2)}
.sel-btn:disabled{opacity:.6;cursor:default}
.sel-btn.iconbtn-sm{width:28px;height:28px;padding:0;justify-content:center}
.sel-btn.iconbtn{width:36px;height:36px;padding:0;justify-content:center;color:var(--ink-2)}
.sel-cur{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sel-caret{color:var(--ink-3);margin-left:auto}
.sel-menu{position:fixed;z-index:301;max-width:calc(100vw - 16px);background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.20),0 3px 8px rgba(0,0,0,.12);padding:5px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;display:flex;flex-direction:column;gap:1px;animation:selpop .1s ease-out}
.sel-menu::-webkit-scrollbar{width:8px}
.sel-menu::-webkit-scrollbar-thumb{background:var(--line-2,var(--line));border-radius:8px;border:2px solid var(--surface)}
@keyframes selpop{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
.sel-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:transparent;color:var(--ink);padding:6px 9px;border-radius:7px;cursor:pointer;font:13px inherit;white-space:nowrap}
.sel-item:hover{background:var(--surface-2)}
.sel-item.on{color:var(--accent);font-weight:560}
.sel-itxt{flex:1}
.sel-hint{color:var(--ink-3);font-size:11px}
.sel-badge{margin-left:auto;flex:0 0 auto;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:1px 6px;border-radius:999px}
.b-wf{background:var(--accent-weak);color:var(--accent)}
.b-role{background:var(--surface-2);color:var(--ink-2)}
.b-chat{background:var(--amber-weak);color:var(--amber)}
.b-code{background:var(--green-weak);color:var(--green)}
/* one global fixed tooltip for every [data-tip] (escapes every scroll container) */
.modal-scrim{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:20px}
.modal{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);width:min(560px,94vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;animation:modalpop .14s ease-out}
.modal-sm{width:min(440px,94vw)}
.modal-lg{width:min(820px,94vw)}
@keyframes modalpop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
.modal-h{padding:15px 18px;border-bottom:1px solid var(--line);font-weight:600;font-size:15px}
.modal-b{padding:16px 18px;overflow-y:auto}
.modal-f{padding:12px 18px;border-top:1px solid var(--line);display:flex;gap:8px;justify-content:flex-end;background:var(--surface)}
/* workflow builder */
.bld{position:fixed;inset:0;z-index:60;background:var(--bg);display:flex;flex-direction:column;animation:bldin .18s ease}
@keyframes bldin{from{opacity:0}to{opacity:1}}
.bld-top{display:flex;align-items:center;gap:10px;padding:11px 16px;background:var(--surface);border-bottom:1px solid var(--line);flex:none}
.bld-title{font-weight:600;font-size:15px}
.bld-name{font-weight:600;font-size:15px;border:none;background:transparent;color:var(--ink);padding:6px 8px;border-radius:8px;min-width:140px}
.bld-name:hover,.bld-name:focus{background:var(--surface-2);outline:none}
.bld-trig-edit{display:inline-flex;align-items:center;gap:1px;background:var(--surface-2);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--ink-2)}
.bld-top .bld-trig{background:var(--accent-weak);color:var(--accent);border-radius:999px;padding:4px 11px;font-size:12.5px;font-weight:600}
.bld-trig-edit .at{opacity:.6}
.bld-trig-edit input{border:none;background:transparent;color:var(--accent);font-size:12px;width:84px;padding:2px}
.bld-trig-edit input:focus{outline:none}
.bld-body{flex:1;display:flex;min-height:0}
/* rail */
.bld-rail{width:188px;flex:none;background:var(--surface);border-right:1px solid var(--line);overflow-y:auto;padding:12px 12px 24px}
.bld-rail-sec{font-size:11px;font-weight:600;letter-spacing:.03em;color:var(--ink-3);text-transform:uppercase;margin:14px 2px 8px;display:flex;align-items:center;gap:6px}
.bld-rail-sec:first-child{margin-top:2px}
.bld-hint{font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink-3)}
.bld-pills{display:flex;flex-direction:column;gap:6px}
.bld-pill{display:flex;align-items:center;gap:7px;width:100%;text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 10px;font-size:12.5px;color:var(--ink);cursor:pointer;transition:border-color .12s,background .12s}
.bld-pill span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bld-pill:hover{border-color:var(--accent);background:var(--accent-weak)}
.bld-pill .ti,.bld-pill svg{flex:none;color:var(--ink-3)}
.bld-pill.on{border-color:var(--accent);background:var(--accent-weak);color:var(--accent)}
.bld-pill.on svg{color:var(--accent)}
.bld-pill.ghost{border-style:dashed;color:var(--ink-2);justify-content:center}
.bld-pill.hook .phase{font-size:10px;font-weight:700;text-transform:uppercase;border-radius:5px;padding:1px 5px;flex:none}
.bld-pill.hook .phase.pre{background:var(--accent-weak);color:var(--accent)}
.bld-pill.hook .phase.post{background:var(--green-weak);color:var(--green)}
/* canvas */
.bld-canvas{flex:1;overflow:auto;background:var(--bg);background-image:radial-gradient(var(--line) 1px,transparent 1px);background-size:24px 24px}
.bld-flow{position:relative;margin:0 auto}
.bld-wires{position:absolute;left:0;top:0;pointer-events:none}
.bld-node{position:absolute;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:9px 11px;cursor:pointer;display:flex;flex-direction:column;gap:5px;box-shadow:0 1px 2px rgba(0,0,0,.04);transition:border-color .12s,box-shadow .12s;box-sizing:border-box}
.bld-node:hover{border-color:var(--line-2)}
.bld-node.sel{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-weak)}
.bld-node-h{display:flex;align-items:center;gap:7px}
.bld-hrow{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-height:20px}
.bld-srow{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-height:20px;margin:5px 0}
.bld-srow .bld-hk{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;background:var(--accent-weak);color:var(--accent);border-radius:6px;padding:2px 4px 2px 7px;max-width:120px;overflow:hidden}
.bld-srow .bld-hk button{border:none;background:none;color:inherit;cursor:pointer;display:inline-flex;padding:0;opacity:.6}
.bld-hlbl.sk{background:var(--accent-weak);color:var(--accent);display:inline-flex;align-items:center;padding:2px 5px}
.bld-insp-wf{border-top:1px solid var(--line);margin-top:14px;padding-top:12px}
/* external (outside-node) half-height hook slots */
.bld-slot{position:absolute;display:flex;align-items:center;gap:4px;padding:0 8px;border:1px dashed var(--line-2);border-radius:8px;background:var(--surface-2);overflow:hidden}
.bld-slot .bld-hlbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-radius:4px;padding:1px 5px;flex:0 0 auto}
.bld-slot.pre .bld-hlbl{background:var(--accent-weak);color:var(--accent)}
.bld-slot.post .bld-hlbl{background:var(--green-weak);color:var(--green)}
.bld-slot .bld-hk{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1px 4px 1px 7px;color:var(--ink-2);max-width:120px;overflow:hidden}
.bld-slot .bld-hk button{border:none;background:none;color:inherit;cursor:pointer;display:inline-flex;padding:0;opacity:.55}
.bld-slot .bld-hk button:hover{opacity:1}
/* skills inside the node — a vertical list that grows the card one row at a time */
.bld-sk-list{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.bld-skchip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;background:var(--accent-weak);color:var(--accent);border-radius:7px;padding:3px 5px 3px 8px}
.bld-skchip-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bld-skchip button{border:none;background:none;color:inherit;cursor:pointer;display:inline-flex;padding:0;opacity:.6}
.bld-skchip button:hover{opacity:1}
.bld-skadd{align-self:flex-start;border:1px dashed var(--line-2);border-radius:7px;background:transparent;color:var(--ink-3);font-size:11.5px;font-weight:600;padding:3px 9px;gap:3px}
.bld-skadd:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-weak)}
.bld-skadd .sel-caret{display:none}
.bld-hrow.pre{margin-bottom:4px}
.bld-hrow.post{margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)}
.bld-hlbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-radius:4px;padding:1px 5px;flex:0 0 auto}
.bld-hrow.pre .bld-hlbl{background:var(--accent-weak);color:var(--accent)}
.bld-hrow.post .bld-hlbl{background:var(--green-weak);color:var(--green)}
.bld-hrow .bld-hk{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;background:var(--surface-2);border-radius:6px;padding:2px 4px 2px 7px;color:var(--ink-2);max-width:110px;overflow:hidden}
.bld-hrow .bld-hk button{border:none;background:none;color:inherit;cursor:pointer;display:inline-flex;padding:0;opacity:.55}
.bld-hrow .bld-hk button:hover{opacity:1}
.bld-hadd{width:22px;height:20px;border:1px dashed var(--line-2);border-radius:6px;background:transparent;color:var(--ink-3);padding:0;display:inline-flex;align-items:center;justify-content:center}
.bld-hadd:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-weak)}
.bld-hadd .sel-caret{display:none}
.bld-node-num{flex:0 0 auto;width:18px;height:18px;border-radius:50%;background:var(--surface-2);color:var(--ink-2);font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.bld-node.sel .bld-node-num{background:var(--accent);color:#fff}
.bld-node{cursor:grab}
.bld-node:active{cursor:grabbing}
.bld-node.dragging{opacity:.4}
.bld-grip{position:absolute;top:6px;right:6px;color:var(--ink-3);display:inline-flex;cursor:grab;padding:2px;border-radius:5px}
.bld-node:hover .bld-grip{color:var(--ink-2)}
.bld-grip:hover{background:var(--surface-2)}
.bld-grip:hover{color:var(--ink-2)}
.bld-drop{position:absolute;height:3px;border-radius:3px;background:var(--accent);box-shadow:0 0 0 3px var(--accent-weak);z-index:3;pointer-events:none}
.bld-node-name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bld-agentsel{border:none;background:transparent;padding:2px 4px;border-radius:7px;gap:3px;min-width:0}
.bld-agentsel:hover{background:var(--surface-2)}
.bld-agentsel-c{color:var(--ink-3);flex:0 0 auto}
.bld-node-task{font-size:11.5px;color:var(--ink-2);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 0 auto}
.bld-node-task .ph{color:var(--ink-3);font-style:italic}
.bld-node-tags{display:flex;gap:5px;margin-top:auto}
.bld-node-tags .t{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;color:var(--ink-2);background:var(--surface-2);border-radius:6px;padding:1px 6px}
.bld-node-tags .t.skill{color:var(--accent);background:var(--accent-weak)}
.bld-node-tags .t.loop{color:var(--amber);background:var(--amber-weak,rgba(217,119,6,.12))}
.bld-node-tags .t.branch{color:var(--ink-2)}
.bld-node-tags .t.approve{color:var(--accent);background:var(--accent-weak)}
.bld-flowmark{position:absolute;z-index:2;display:inline-flex;align-items:center;gap:4px;width:128px;justify-content:center;font-size:11px;font-weight:600;border-radius:999px;padding:3px 8px;border:1px solid var(--line-2);background:var(--surface)}
.bld-flowmark.approve{color:var(--accent);border-color:var(--accent);background:var(--accent-weak)}
.bld-flowmark.stop{color:var(--ink-2)}
.bld-node-tags .t.stop{color:var(--ink-2)}
.bld-hooks{position:absolute;display:flex;flex-direction:column;justify-content:center;gap:5px}
.bld-hooks.left{align-items:flex-end}
.bld-hooks.right{align-items:flex-start}
.bld-hk{display:inline-flex;align-items:center;gap:5px;font-size:11px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:3px 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-2)}
.bld-hk .phase{font-size:9px;font-weight:700;text-transform:uppercase;border-radius:4px;padding:1px 4px;flex:0 0 auto}
.bld-hk .phase.pre{background:var(--accent-weak);color:var(--accent)}
.bld-hk .phase.post{background:var(--green-weak);color:var(--green)}
.bld-gate{position:absolute;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:600;color:var(--ink-2);background:var(--surface);border:1px solid var(--line-2);border-radius:999px;padding:2px 8px;white-space:nowrap;z-index:2}
.bld-add{position:absolute;border:1.5px dashed var(--line-2);border-radius:14px;background:transparent;color:var(--ink-3);cursor:pointer;display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;font-size:12px;font-weight:600;transition:border-color .12s,color .12s,background .12s}
.bld-add:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-weak)}
/* inspector */
.bld-insp{width:340px;flex:none;background:var(--surface);border-left:1px solid var(--line);overflow-y:auto;padding:16px}
.bld-insp-h{display:flex;align-items:center;gap:9px;padding-bottom:12px;border-bottom:1px solid var(--line);margin-bottom:12px}
.bld-insp-name{font-weight:600;font-size:14px}
.bld-link{border:none;background:none;color:var(--accent);font-size:11.5px;cursor:pointer;padding:0}
.bld-lbl{display:block;font-size:11px;font-weight:600;color:var(--ink-3);text-transform:uppercase;letter-spacing:.03em;margin:12px 0 6px}
.bld-ta{width:100%;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);font-family:inherit;font-size:13.5px;line-height:1.5;padding:9px 10px;resize:vertical;box-sizing:border-box}
.bld-ta:focus,.bld-num:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-weak)}
.bld-num{width:100%;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);font-family:inherit;font-size:13.5px;padding:9px 10px;box-sizing:border-box}
.agm-top{display:flex;gap:14px;align-items:flex-start;margin-bottom:6px}
.agm-avatar{position:relative;flex:0 0 auto;width:56px;height:56px;border-radius:50%;overflow:hidden;cursor:pointer;border:1px solid var(--line);background:var(--surface-2);display:flex;align-items:center;justify-content:center}
.agm-avatar img{width:100%;height:100%;object-fit:cover}
.agm-avatar-edit{position:absolute;right:0;bottom:0;width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;border:2px solid var(--surface)}
.agm-tools{display:flex;flex-wrap:wrap;gap:6px}
.agm-tool{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;border:1px solid var(--line);border-radius:999px;padding:4px 10px;cursor:pointer;color:var(--ink-2)}
.agm-tool.on{border-color:var(--accent);background:var(--accent-weak);color:var(--accent)}
.agm-tool input{display:none}
.bld-ta:focus{outline:none;border-color:var(--accent)}
.bld-chips{display:flex;flex-wrap:wrap;gap:5px}
.bld-chip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;background:var(--surface-2);border-radius:7px;padding:3px 4px 3px 8px}
.bld-chip.skill{background:var(--accent-weak);color:var(--accent)}
.bld-chip button{border:none;background:none;color:inherit;cursor:pointer;display:inline-flex;padding:0;opacity:.6}
.bld-chip button:hover{opacity:1}
/* list */
.bld-listwrap{flex:1;overflow-y:auto;padding:20px}
.bld-sec-head{display:flex;align-items:center;justify-content:space-between;max-width:920px;margin:26px auto 12px;font-size:15px;font-weight:600}
.bld-card.agent .bld-card-h{margin-bottom:9px}
.bld-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;max-width:920px;margin:0 auto}
.bld-card{text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:14px;cursor:pointer;transition:border-color .12s,box-shadow .12s}
.bld-card:hover{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-weak)}
.bld-card-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}
.bld-card-acts{display:flex;gap:4px;opacity:0;transition:opacity .12s}
.bld-card:hover .bld-card-acts{opacity:1}
.iconbtn-sm.danger:hover{background:var(--red-weak);color:var(--red)}
.bld-trig{font-size:11.5px;color:var(--accent);background:var(--accent-weak);border-radius:999px;padding:2px 9px}
.bld-trig.sk{color:var(--green);background:var(--green-weak);display:inline-flex;align-items:center;gap:3px}
.bld-hk-phase{font-size:10.5px;font-weight:700;text-transform:uppercase;border-radius:5px;padding:2px 7px}
.bld-hk-phase.pre{background:var(--accent-weak);color:var(--accent)}
.bld-hk-phase.post{background:var(--green-weak);color:var(--green)}
.bld-builtin{font-size:10.5px;color:var(--ink-3)}
.bld-card-name{font-weight:600;font-size:15px;margin-bottom:9px}
.bld-card-flow{display:flex;align-items:center;gap:3px;color:var(--ink-3);margin-bottom:8px;flex-wrap:wrap}
.bld-card-meta{font-size:12px;color:var(--ink-2)}
.bld-empty{color:var(--ink-3);font-size:13.5px;text-align:center;padding:30px}
.bld-empty.sm{padding:6px 2px;text-align:left;font-size:12px}

.wf-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:10px 12px;margin-bottom:7px;cursor:pointer}
.wf-row:hover{border-color:var(--accent)}
.wf-name{flex:1;display:flex;align-items:center;gap:6px}
.wf-flow{display:flex;flex-direction:column;gap:8px}
.wf-step{border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:9px 10px;display:flex;flex-direction:column;gap:7px}
.wf-step-h{display:flex;align-items:center;gap:6px}
.wf-grip{color:var(--ink-3);cursor:grab;flex:0 0 auto}
.wf-num{width:18px;height:18px;border-radius:50%;background:var(--accent-weak);color:var(--accent);font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.wf-instr{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;padding:6px 8px;resize:vertical}
.wf-attach{display:flex;gap:12px;flex-wrap:wrap}
.wf-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.wf-chip{display:inline-flex;align-items:center;gap:3px;font-size:11px;padding:2px 7px;border-radius:999px;cursor:pointer}
.wf-gate{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap}
.gtip{position:fixed;z-index:400;transform:translate(-50%,-100%);background:var(--ink);color:var(--bg);font-size:11px;font-weight:500;padding:3px 7px;border-radius:6px;white-space:nowrap;pointer-events:none;max-width:280px;overflow:hidden;text-overflow:ellipsis;box-shadow:var(--shadow)}
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

/* ── v4 view switcher ── */
.viewseg{display:inline-flex;gap:2px;background:var(--surface-2);border:1px solid var(--line);border-radius:11px;padding:3px}
.viewseg button{display:inline-flex;align-items:center;gap:5px;border:none;background:transparent;color:var(--ink-2);padding:4px 10px;border-radius:7px;font:12px inherit;font-weight:600;cursor:pointer}
.viewseg button.on{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
.viewbar{display:flex;align-items:center;gap:10px;padding:8px 14px 0}
'
/* ── master-detail + chat split workspace ── */
.content.is-split{overflow:hidden;display:flex;flex-direction:column;padding:0}
.split{flex:1;display:flex;min-height:0;width:100%}
.split-left{flex:1;min-width:0;overflow-y:auto}
.split-right{flex:none;width:min(660px,46vw);min-width:380px;overflow-y:auto;border-left:1px solid var(--line);background:var(--surface)}
.chat-split .split-left{flex:none;width:min(460px,40vw);min-width:340px;overflow:hidden;border-right:1px solid var(--line);border-left:none}
.chat-split .split-right{flex:1;overflow-y:auto}
.chat-split .orch{height:100%;max-width:none;border:none;border-radius:0}
.detail.docked{position:relative;inset:auto;transform:none;height:100%;width:100%;z-index:auto;box-shadow:none;border:none}
.detail.docked .detail-close,.detail.docked .dt-back{display:inline-flex}
/* ── table: new columns, header icons, category dot, greying, open row ── */
.ptable th.pt-c,.ptable th.pt-h-tl{white-space:nowrap}
.ptable thead th .ti,.ptable thead th svg{vertical-align:-2px;opacity:.6;margin-right:2px}
.ptable th.pt-sortable{cursor:pointer;user-select:none}
.ptable th.pt-sortable:hover{color:var(--ink-2)}
.ptable th.pt-sortable.on{color:var(--accent)}
.pt-c{font-size:13px;color:var(--ink-2);white-space:nowrap;vertical-align:middle;padding:11px 12px;border-top:1px solid var(--line)}
.pt-c-repo{color:var(--ink);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt-repo-dot{width:8px;height:8px;border-radius:50%;display:inline-block;vertical-align:middle;margin-right:6px}
.pt-c-num{color:var(--ink-3);font-variant-numeric:tabular-nums}
.pt-c-pr a.pt-pr{display:inline-flex;align-items:center;gap:3px;color:var(--accent);font-variant-numeric:tabular-nums}
.pt-dash{color:var(--line-2)}
.pt-activity{font-size:11.5px;color:var(--ink-3);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60ch}
.pt-act-role{color:var(--accent);font-weight:600}
.prow-open>td{background:var(--row-sel)}
.prow-open .pt-title{color:var(--accent)}
.prow-open:hover>td{background:var(--row-sel)}
/* greyed-out done/merged rows — whole row mutes (Figma: inactive rows) */
.prow-done .pt-title,.prow-done .pt-c-repo,.prow-done .pt-c-num,.prow-done .pt-c-pr a{color:var(--ink-3)}
.prow-done .pt-repo-dot{opacity:.4}
/* compact (detail docked beside): drop the wide columns so the list stays usable */
.ptable-compact .pt-c-repo,.ptable-compact th.pt-c-repo,.ptable-compact .pt-c-pr,.ptable-compact th.pt-c-pr,.ptable-compact .pt-timeline,.ptable-compact th.pt-h-tl{display:none}
.ptable-compact .pt-when{display:none}
.ptable-compact .pt-c-cost,.ptable-compact th.pt-c-cost{display:none}
.pt-c-cost{text-align:right;white-space:nowrap;padding:11px 12px}
.pt-cost{font-variant-numeric:tabular-nums;font-weight:600;display:inline-flex;align-items:center;gap:3px;justify-content:flex-end}
.pt-cost-ok{color:var(--ink-2)}
.pt-cost-warn{color:var(--amber)}
.pt-cost-hot{color:var(--red)}
.pt-cost-est{display:block;font-size:10.5px;color:var(--ink-3);font-variant-numeric:tabular-nums}


/* ── table row polish (Figma table) ── */
.prow>td{vertical-align:middle}
.pt-title-row{display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:nowrap}
.pt-title{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--ink)}
.prow:hover .pt-title{overflow:visible;max-width:none;position:relative;z-index:6;background:var(--surface);box-shadow:10px 0 10px -6px rgba(0,0,0,.18);padding-right:10px;border-radius:4px}
.prow-open:hover .pt-title,.prow-open .pt-title{background:var(--accent-weak)}
.pt-issue{max-width:0;width:40%}
.pt-c-when{color:var(--ink-3);font-size:12px;white-space:nowrap}
.pt-act{text-align:right;white-space:nowrap}
.pt-act-open{opacity:0;border:none;background:transparent;color:var(--ink-3);cursor:pointer;padding:4px;border-radius:7px;vertical-align:middle;transition:opacity .12s}
.prow:hover .pt-act-open{opacity:1}
.pt-act-open:hover{background:var(--surface-2);color:var(--ink)}
.ptable-compact .pt-c-when,.ptable-compact th.pt-c-when{display:none}
/* ── sticky, nicer header (Figma) ── */
.ptable thead th{position:sticky;top:0;z-index:3;background:var(--surface);box-shadow:inset 0 -1px 0 var(--line);padding:9px 12px}
.ptable thead th.pt-sortable.on::after{content:"";display:inline-block;margin-left:5px;border:3px solid transparent;border-top-color:var(--accent);vertical-align:1px}

/* ── overview stat strip (data-driven "what needs me?") ── */
.pt-overview{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.pt-overview-top{margin-bottom:0;gap:6px}
.pt-overview-top .pt-stat{min-width:0;padding:5px 10px;border-radius:10px;flex-direction:row;align-items:baseline;gap:6px}
.pt-overview-top .pt-stat-n{font-size:16px}
.pt-overview-top .pt-stat-l{font-size:10px}
.pt-overview-top .pt-stat-spend{margin-left:0}
@media(max-width:760px){.pt-overview-top{display:none}}
.pt-stat{display:flex;flex-direction:column;gap:3px;min-width:96px;border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:11px 14px;cursor:pointer;text-align:left;transition:border-color .12s ease,transform .12s ease,box-shadow .12s ease}
.pt-stat:hover{border-color:var(--line-2);transform:translateY(-1px)}
.pt-stat.on{box-shadow:0 0 0 2px var(--accent) inset;border-color:var(--accent)}
.pt-stat-n{font-size:26px;font-weight:700;line-height:1;letter-spacing:-.02em;color:var(--ink);display:inline-flex;align-items:center}
.pt-stat-l{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--ink-3);text-transform:uppercase;letter-spacing:.03em}
.pt-stat.zero{opacity:.55}
.pt-stat.zero:hover{opacity:.8}
.pt-stat-attention{background:var(--amber-weak);border-color:transparent}
.pt-stat-attention .pt-stat-n{color:var(--amber)}.pt-stat-attention .pt-stat-l{color:var(--amber)}
.pt-stat-attention.zero{background:var(--green-weak)}
.pt-stat-attention.zero .pt-stat-n,.pt-stat-attention.zero .pt-stat-l{color:var(--green)}
.pt-stat-running .pt-stat-n{color:var(--accent)}
.pt-stat-running:not(.zero) .pt-stat-l{color:var(--accent)}
.pt-stat-running:not(.zero){animation:tlpulse 1.6s ease-in-out infinite}
.pt-stat-done .pt-stat-n,.pt-stat-spend .pt-stat-n{color:var(--ink-3);font-weight:600}
.pt-stat-spend{cursor:default;margin-left:auto}
.pt-stat-spend:hover{transform:none;border-color:var(--line)}
@media(max-width:760px){.pt-stat{min-width:0;flex:1 1 28%;padding:9px 10px}.pt-stat-n{font-size:21px}.pt-stat-spend{flex-basis:100%;margin-left:0}}
/* ── v4 rich progress table ── */
.ptable-wrap{padding:0 0 22px;max-width:100%;overflow:visible}
.ptable-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.pt-needsyou{display:inline-flex;align-items:center;gap:5px;color:var(--amber);font-size:12.5px;font-weight:600}
.ptable{width:100%;border-collapse:separate;border-spacing:0;font-size:14px}
.ptable thead th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3);font-weight:600;padding:0 12px 8px}
.ptable .pt-h-tl{width:34%}
.prow{cursor:pointer}
.prow>td{border-top:1px solid var(--line);padding:11px 12px;vertical-align:middle;background:var(--surface)}
.prow:hover>td{background:var(--row-hover)}
.prow-attention>td{box-shadow:inset 3px 0 0 var(--amber)}
.prow-done .pt-title{color:var(--ink-3);font-weight:500}
.prow-done .pt-timeline,.prow-done .pt-av{opacity:.55}
.prow-done .pstat-done{opacity:.85}
.pt-group>td{background:var(--surface-2);padding:6px 12px;border-top:1px solid var(--line);position:sticky;top:0}
.pt-group-l{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2);font-weight:700}
.pt-group-n{font-size:11px;color:var(--ink-3);margin-left:6px}
.prow-attention>td:first-child{box-shadow:inset 3px 0 0 var(--amber)}
.pt-issue{max-width:0;width:42%}
.pt-title-row{display:flex;align-items:center;gap:7px;min-width:0}
.pt-av{display:inline-flex;flex:none}
.pt-title{font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt-byagent{flex:none;display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:600;color:var(--accent);background:var(--accent-weak);border-radius:999px;padding:1px 7px}
.pt-exp{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:none;background:transparent;color:var(--ink-3);cursor:pointer;padding:0;border-radius:5px;transition:transform .12s ease}
.pt-exp:hover{background:var(--surface-2);color:var(--ink)}
.pt-exp.open{transform:rotate(90deg)}
.prow-child>td{background:var(--bg)}
.prow-child:hover>td{background:var(--row-hover)}
.pt-issue-child{padding-left:30px!important;position:relative}
.pt-issue-child .pt-title{font-weight:500}
.prow-child .pt-issue-child::before{content:"";position:absolute;left:14px;top:0;bottom:0;width:1px;background:var(--line)}
.pt-sub{color:var(--ink-3);font-size:12px;margin-top:2px;display:flex;align-items:center;gap:4px}
.pt-pr{display:inline-flex;align-items:center;gap:3px}
.pt-lock{display:inline-flex;align-items:center;gap:3px;color:var(--accent)}
/* timeline */
.tl{display:flex;align-items:center}
.tl-nd{width:17px;height:17px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;border:1.5px solid var(--line-2);color:var(--ink-3);background:var(--surface)}
.tl-num{font-size:11px;font-weight:600}
.tl-seg{width:13px;height:2px;background:var(--line-2)}
.tl-cell{position:relative;display:inline-flex;align-items:center}
.tl-loop{position:absolute;top:-10px;left:50%;transform:translateX(-50%);font-size:9px;font-weight:700;color:var(--amber);background:var(--amber-weak);border-radius:6px;padding:0 3px;line-height:1.35;white-space:nowrap;z-index:1;cursor:default}
.tl-seg.on{background:var(--green)}
.tl-done{background:var(--green-weak);border-color:var(--green);color:var(--green)}
.tl-running{background:var(--accent-weak);border-color:var(--accent);color:var(--accent);animation:tlpulse 1.4s ease-in-out infinite}
.tl-queued{border-color:var(--accent);color:var(--accent);border-style:dashed}
.tl-attention{background:var(--amber-weak);border-color:var(--amber);color:var(--amber)}
.tl-pending{}
@keyframes tlpulse{0%,100%{box-shadow:0 0 0 0 var(--accent-weak)}50%{box-shadow:0 0 0 4px var(--accent-weak)}}
.tl-idle{color:var(--ink-3);font-size:12.5px;font-style:italic}
.tl-epic{display:flex;align-items:center;gap:8px}
.tl-epic-track{width:120px;height:6px;border-radius:999px;background:var(--surface-2);overflow:hidden}
.tl-epic-fill{height:100%;background:var(--purple);border-radius:999px}
.tl-epic-lbl{display:inline-flex;align-items:center;gap:4px;color:var(--ink-2);font-size:12px}
/* status field */
.pt-status{white-space:nowrap}
.pstat{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px}
.pstat-running{background:var(--accent-weak);color:var(--accent)}
.pstat-attention{background:var(--amber-weak);color:var(--amber)}
.pstat-ready{background:var(--green-weak);color:var(--green)}
.pstat-queued{background:var(--surface-2);color:var(--ink-2)}
.pstat-planned{background:var(--surface-2);color:var(--ink-2)}
.pstat-done{background:var(--surface-2);color:var(--ink-3)}
.pt-when{display:block;color:var(--ink-3);font-size:11px;margin-top:3px}
.pt-act{text-align:right;white-space:nowrap}
@media(max-width:760px){
  .ptable .pt-h-tl,.pt-timeline{display:none}
  .pt-issue{width:auto}
  .pt-act-lbl{display:none}
}

/* ── v4 Orchestrator chat ── */
.orch{display:flex;flex-direction:column;height:calc(100vh - 220px);min-height:420px;max-width:860px;margin:0 auto;border:1px solid var(--line);border-radius:16px;background:var(--surface);overflow:hidden}
.orch-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line)}
.orch-title{display:flex;align-items:center;gap:7px;font-weight:600;color:var(--ink)}
.orch-repo{font-size:12px;font-weight:600;color:var(--accent);background:var(--accent-weak);border-radius:999px;padding:2px 9px}
.orch-head .iconbtn{margin-left:auto}
.orch-scroll{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:14px}
.orch-live{border-bottom:1px solid var(--line);background:var(--surface-2);padding:8px 12px;max-height:34%;overflow-y:auto}
.orch-live-h{display:flex;align-items:center;gap:6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2);font-weight:600;margin-bottom:6px}
.orch-live-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 var(--accent-weak);animation:tlpulse 1.4s ease-in-out infinite}
.orch-live-rows{display:flex;flex-direction:column;gap:4px}
.orch-live-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:transparent;color:var(--ink);padding:4px 6px;border-radius:8px;cursor:pointer;font-size:13px}
.orch-live-row:hover{background:var(--surface)}
.orch-live-ttl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.orch-empty{margin:auto;text-align:center;max-width:440px;color:var(--ink-2)}
.orch-empty .obki{width:54px;height:54px;border-radius:16px;background:var(--accent-weak);color:var(--accent);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
.orch-empty .obh{font-size:17px;font-weight:600;color:var(--ink);margin-bottom:6px}
.orch-empty .obsub{font-size:14px;line-height:1.6}
.obub{display:flex;gap:10px;max-width:100%}
.obub-av{flex:none;width:26px;height:26px;border-radius:50%;overflow:hidden}
.obub-body{min-width:0;max-width:88%}
.obub-user{flex-direction:row-reverse}
.obub-user .obub-body{max-width:80%}
.obub-txt{padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.6;word-wrap:break-word;overflow-wrap:anywhere}
.obub-orch .obub-txt{background:var(--surface-2);color:var(--ink);border-top-left-radius:4px}
.obub-user .obub-txt{background:var(--accent);color:#fff;border-top-right-radius:4px;white-space:pre-wrap}
.obub-txt p{margin:0 0 8px}.obub-txt p:last-child{margin:0}
.obub-txt pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;overflow:auto;font-size:12.5px}
.obub-txt code{font-family:ui-monospace,Menlo,monospace;font-size:.92em}
.obub-think{color:var(--ink-2);display:inline-flex;align-items:center;gap:7px}
/* proposal card */
.oprop{margin-top:10px;border:1px solid var(--accent);background:var(--accent-weak);border-radius:14px;padding:12px 14px}
.oprop-h{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--accent);font-size:13.5px;margin-bottom:9px}
.oprop-wf{display:flex;align-items:center;gap:8px;margin-bottom:9px}
.oprop-wf label{font-size:12px;color:var(--ink-2);font-weight:600}
.oprop-wf select{flex:1;border:1px solid var(--line);border-radius:9px;padding:6px 9px;font:13px inherit;background:var(--surface);color:var(--ink)}
.oprop-list{margin:0 0 10px;padding-left:20px;display:flex;flex-direction:column;gap:6px}
.oprop-list li{font-size:13.5px;color:var(--ink)}
.oprop-t{font-weight:600;display:block}
.oprop-s{display:block;color:var(--ink-2);font-size:12.5px}
.oprop-actions{display:flex}
.oprop-foot{font-size:11.5px;color:var(--ink-2);margin-top:8px}
.oprop-done{border-color:var(--green);background:var(--green-weak)}
.oprop-done .oprop-h{color:var(--green)}
.oprop-created{display:flex;flex-direction:column;gap:4px;margin-bottom:6px}
.oprop-link{text-align:left;border:none;background:transparent;color:var(--accent);font-size:13px;cursor:pointer;padding:2px 0;font-weight:500}
.orch-compose{display:flex;gap:8px;align-items:flex-end;padding:10px 12px;border-top:1px solid var(--line);background:var(--surface)}
.orch-compose textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:14.5px inherit;background:var(--bg);color:var(--ink);max-height:160px;line-height:1.5}
.orch-compose textarea:focus{outline:none;border-color:var(--accent)}
.orch-send{width:42px;height:42px;padding:0;flex:none;border-radius:12px;display:inline-flex;align-items:center;justify-content:center}
@media(max-width:760px){.orch{height:calc(100vh - 190px);border-radius:0;border-left:none;border-right:none}.obub-body{max-width:92%}}`;

export function renderShell(): string {
  const __VER__ = encodeURIComponent(versionInfo().sha || versionInfo().version || "dev");
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
<link rel="stylesheet" href="/app.css?v=${__VER__}">
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
