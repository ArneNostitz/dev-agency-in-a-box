/**
 * The v2 dashboard shell: a tiny HTML page with the design-token stylesheet (light + dark),
 * PWA wiring (manifest + service worker), and a Preact app loaded as an ES module from /web/app.js.
 * All the UI lives in /web/app.js (Preact + htm, no build step).
 */
export function renderShell(): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f4f5f7" id="metatheme">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Dev Agency in a Box">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/web/icons/icon-192.png">
<link rel="icon" href="/web/icons/icon.svg" type="image/svg+xml">
<title>Dev Agency in a Box</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
/* ── Design tokens ─────────────────────────────────────────────── */
:root{
  /* Canvas */
  --bg:#f4f5f7;--surface:#ffffff;--surface-2:#f0f1f4;--surface-3:#e8eaee;
  /* Ink */
  --ink:#14171c;--ink-2:#4e5562;--ink-3:#8b93a1;
  /* Borders */
  --line:#e3e6eb;--line-2:#d0d4db;
  /* Brand accent (interactive blue) */
  --accent:#2563eb;--accent-weak:#eff3ff;--accent-hover:#1d4ed8;
  /* Semantic */
  --green:#059669;--green-weak:#ecfdf5;
  --amber:#b45309;--amber-weak:#fffbeb;
  --red:#dc2626;--red-weak:#fef2f2;
  --purple:#7c3aed;--purple-weak:#f5f3ff;
  /* Elevation */
  --shadow:0 1px 3px rgba(14,17,24,.07),0 1px 2px rgba(14,17,24,.04);
  --shadow-md:0 4px 12px rgba(14,17,24,.1),0 2px 4px rgba(14,17,24,.06);
  --shadow-lg:0 10px 32px rgba(14,17,24,.12),0 4px 8px rgba(14,17,24,.06);
  /* Radius */
  --radius:8px;--radius-sm:6px;--radius-lg:12px;--radius-xl:16px;
  /* Safe areas */
  --safe-b:env(safe-area-inset-bottom,0px);--safe-t:env(safe-area-inset-top,0px);
}
html[data-theme="dark"]{
  --bg:#0d0f12;--surface:#141720;--surface-2:#1a1e28;--surface-3:#20253200;
  --ink:#eaedf2;--ink-2:#8b93a8;--ink-3:#545d6e;
  --line:#242936;--line-2:#2e3545;
  --accent:#3b82f6;--accent-weak:#1a2540;--accent-hover:#60a5fa;
  --green:#10b981;--green-weak:#0a1f17;
  --amber:#f59e0b;--amber-weak:#1f1a0a;
  --red:#ef4444;--red-weak:#1f0a0a;
  --purple:#a78bfa;--purple-weak:#1a1040;
  --shadow:none;--shadow-md:0 4px 16px rgba(0,0,0,.4);--shadow-lg:0 12px 40px rgba(0,0,0,.5);
}

/* ── Reset & base ──────────────────────────────────────────────── */
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:var(--bg);color:var(--ink);
  font-family:"Geist",system-ui,-apple-system,sans-serif;
  font-size:14px;line-height:1.5;font-weight:400;
  -webkit-text-size-adjust:100%;overscroll-behavior-y:none;
  -webkit-font-smoothing:antialiased;
}
a{color:var(--accent);text-decoration:none}
button{font:inherit}
.lic{display:inline-block;vertical-align:-3px}
input,select,textarea{font-family:inherit;font-size:14px}

/* ── App shell ─────────────────────────────────────────────────── */
.app{display:flex;flex-direction:column;height:100dvh}

/* ── Top bar ───────────────────────────────────────────────────── */
.topbar{
  position:sticky;top:0;z-index:30;
  background:var(--surface);border-bottom:1px solid var(--line);
  padding:calc(6px + var(--safe-t)) 16px 6px;
  display:flex;align-items:center;gap:8px;
  height:48px;
}
.brand{font-size:15px;font-weight:600;display:flex;align-items:center;gap:6px}
.brand .lic{color:var(--accent)}
@media(max-width:560px){.brandname{display:none}.repodrop-btn{max-width:52vw}}
.sub{color:var(--ink-3);font-size:12px}
.envbadge{
  font-size:10px;font-weight:600;letter-spacing:.04em;
  background:var(--amber-weak);color:var(--amber);
  border:1px solid color-mix(in srgb,var(--amber) 30%,transparent);
  border-radius:5px;padding:1px 6px;vertical-align:2px;
}
.spacer{flex:1}
.iconbtn{
  border:1px solid var(--line);background:transparent;color:var(--ink-3);
  border-radius:var(--radius-sm);width:32px;height:32px;
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
  transition:border-color .12s,background .12s,color .12s;
}
.iconbtn:hover{background:var(--surface-2);color:var(--ink);border-color:var(--line-2)}
.iconbtn.on{color:var(--accent);border-color:var(--accent);background:var(--accent-weak)}
.iconbtn:active{transform:scale(.94)}

/* ── Dropdowns ─────────────────────────────────────────────────── */
.dropwrap{position:relative;display:inline-flex}
.dropscrim{position:fixed;inset:0;z-index:40;background:transparent}
.dropmenu{
  position:absolute;top:calc(100% + 5px);right:0;z-index:41;
  background:var(--surface);border:1px solid var(--line);
  border-radius:var(--radius-lg);box-shadow:var(--shadow-md);
  padding:4px;min-width:210px;max-height:64vh;overflow:auto;
}
.dropmenu-h{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);padding:6px 8px 4px}
.dropmenu-item{
  display:flex;align-items:center;gap:7px;width:100%;text-align:left;
  border:none;background:transparent;color:var(--ink);
  padding:7px 8px;border-radius:var(--radius-sm);cursor:pointer;font-size:13.5px;
  transition:background .1s;
}
.dropmenu-item:hover{background:var(--surface-2)}
.dropmenu-item:disabled{cursor:default;opacity:.5}
.dropmenu-sub{margin-left:auto;color:var(--ink-3);font-size:11.5px}
.dropmenu-foot{font-size:11.5px;color:var(--ink-3);padding:5px 8px 2px;border-top:1px solid var(--line);margin-top:3px}
.dropmenu-empty{padding:8px;color:var(--ink-3);font-size:13px}
.dropmenu-item.sel{color:var(--accent);font-weight:600;background:var(--accent-weak)}

/* ── Repo picker ───────────────────────────────────────────────── */
.repodrop{flex:0 1 auto;min-width:0}
.repodrop-btn{
  display:inline-flex;align-items:center;gap:6px;
  max-width:min(60vw,360px);
  border:1px solid var(--line);background:var(--surface-2);color:var(--ink);
  border-radius:999px;padding:5px 12px;font:13.5px inherit;font-weight:600;cursor:pointer;
  transition:border-color .12s,background .12s;
}
.repodrop-btn:hover{border-color:var(--line-2);background:var(--surface)}
.repodrop-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.repodrop-sub{color:var(--ink-3);font-weight:400;font-size:12px}
.repodrop-menu{left:50%;right:auto;transform:translateX(-50%);min-width:280px;max-width:min(92vw,360px)}
.repodrop-row{display:flex;align-items:center;gap:4px;border-radius:var(--radius-sm)}
.repodrop-row.sel{background:var(--accent-weak)}
.repodrop-pick{
  flex:1;display:flex;align-items:center;gap:7px;min-width:0;text-align:left;
  border:none;background:transparent;color:var(--ink);
  padding:7px 8px;border-radius:var(--radius-sm);cursor:pointer;font-size:13.5px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.repodrop-pick:hover{background:var(--surface-2)}
.repodrop-row.sel .repodrop-pick{color:var(--accent);font-weight:600}
.repodrop-x{border:none;background:transparent;color:var(--ink-3);cursor:pointer;display:flex;padding:5px;border-radius:var(--radius-sm)}
.repodrop-x:hover{background:var(--red-weak);color:var(--red)}
.repodrop-add{display:flex;gap:6px;padding:2px 4px 6px}
.repodrop-add input{flex:1;min-width:0;border:1px solid var(--line);border-radius:var(--radius-sm);padding:6px 9px;font:13.5px inherit;background:var(--surface);color:var(--ink)}
.repodrop-avail{max-height:30vh;overflow:auto;border-top:1px solid var(--line);margin-top:2px;padding-top:2px}

/* ── Chips / pills ─────────────────────────────────────────────── */
.chip{
  flex:0 0 auto;border:1px solid var(--line);background:var(--surface-2);
  border-radius:999px;padding:4px 10px;font-size:12.5px;color:var(--ink-2);
  cursor:pointer;white-space:nowrap;transition:border-color .12s,background .12s,color .12s;
}
.chip:hover{border-color:var(--line-2);color:var(--ink)}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.chip.dash{border-style:dashed;color:var(--accent);background:transparent}

/* ── Content + status bar ──────────────────────────────────────── */
.content{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.statusline{
  padding:4px 16px;color:var(--ink-3);font-size:11.5px;
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  border-bottom:1px solid var(--line);background:var(--surface);
}
.buildstamp{font:11px "Geist Mono",ui-monospace,monospace;color:var(--ink-3);cursor:default}
.anstat{display:inline-flex;align-items:center;gap:5px;color:var(--ink-3);cursor:default}
.andot{width:6px;height:6px;border-radius:50%;display:inline-block}
.andot.green{background:var(--green)}
.andot.amber{background:var(--amber)}
.statpop{position:relative;display:inline-flex;align-items:center}
.statlink{cursor:pointer;display:inline-flex;align-items:center;gap:4px;border-radius:4px;padding:1px 3px}
.statlink:hover{background:var(--surface-2);color:var(--ink)}
.statmenu{left:0;top:calc(100% + 5px);min-width:230px;padding:10px 12px;z-index:100}
.statmenu label{display:block;font-size:11px;color:var(--ink-3);margin:8px 0 3px;font-weight:500}
.statmenu input{width:100%;border:1px solid var(--line);border-radius:var(--radius-sm);padding:6px 9px;font:13.5px inherit;background:var(--surface);color:var(--ink)}
.statmenu .btn{margin-top:10px;width:100%;justify-content:center}

/* ── Model selector ────────────────────────────────────────────── */
.modelsel{
  max-width:150px;border:1px solid var(--line);border-radius:var(--radius-sm);
  background:var(--surface);color:var(--ink-2);font:12.5px inherit;
  padding:3px 7px;height:28px;cursor:pointer;transition:border-color .12s,color .12s;
}
.modelsel:hover{border-color:var(--line-2);color:var(--ink)}
.modelsel.sm{max-width:120px;height:24px;padding:1px 5px;font-size:11.5px;border-radius:5px}

/* ── Agent editor rows ─────────────────────────────────────────── */
.agentrow{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  width:100%;text-align:left;
  border:1px solid var(--line);background:var(--surface);color:var(--ink);
  border-radius:var(--radius);padding:10px 12px;margin-bottom:6px;
  cursor:pointer;font-size:13.5px;transition:border-color .12s,background .12s;
}
.agentrow:hover{border-color:var(--line-2);background:var(--surface-2)}
.toolchips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 2px}
.toolchip{
  display:inline-flex;align-items:center;gap:4px;
  border:1px solid var(--line);border-radius:var(--radius-sm);
  padding:3px 8px;font-size:12px;cursor:pointer;
  transition:border-color .12s,background .12s;
}
.toolchip:hover{border-color:var(--line-2);background:var(--surface-2)}

/* ── Live / loading indicators ─────────────────────────────────── */
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;animation:pulse 1.6s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(5,150,105,.45)}70%{box-shadow:0 0 0 8px rgba(5,150,105,0)}100%{box-shadow:0 0 0 0 rgba(5,150,105,0)}}
.spin{animation:dvspin .7s linear infinite;transform-origin:center}
@keyframes dvspin{to{transform:rotate(360deg)}}

/* ── Busy / in-flight states ───────────────────────────────────── */
.tbtn:disabled,.cardbtn:disabled{cursor:default}
.tbtn.busy{opacity:.8;cursor:wait}
.cardbtn.busy{opacity:.75;cursor:wait}
.card.busy{cursor:wait;opacity:.9}
.card.busy:hover{box-shadow:var(--shadow);transform:none}

/* ── Secrets health banner ─────────────────────────────────────── */
.secbanner{
  margin:8px 12px 0;padding:10px 12px;
  border-radius:var(--radius);border:1px solid var(--red);
  background:var(--red-weak);color:var(--red);font-size:13px;line-height:1.45;
}
.secbanner b{font-weight:700}
.gauge{display:inline-block;width:56px;height:5px;border-radius:3px;background:var(--line);overflow:hidden;vertical-align:middle}
.gauge i{display:block;height:100%}

/* ── Board ─────────────────────────────────────────────────────── */
.board{padding:10px 12px}
.col{margin-bottom:12px}
.colhead{
  display:flex;align-items:center;gap:7px;
  font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:var(--ink-3);padding:4px 4px 8px;
}
.planned-actions{display:flex;gap:8px;padding:0 4px 8px}
.planned-actions .colbtn{flex:1;justify-content:center}
.colbtn{
  display:inline-flex;align-items:center;gap:5px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink-2);
  border-radius:var(--radius-sm);padding:7px 10px;
  font:12.5px inherit;font-weight:500;text-transform:none;letter-spacing:0;
  cursor:pointer;white-space:nowrap;transition:border-color .12s,background .12s,color .12s;
}
.colbtn:hover:not(:disabled){border-color:var(--line-2);color:var(--ink);background:var(--surface-2)}
.colbtn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.colbtn.primary:hover:not(:disabled){background:var(--accent-hover);border-color:var(--accent-hover)}
.colbtn:disabled{opacity:.4;cursor:default}
.colhead .n{color:var(--ink-3);font-weight:400}

/* ── Cards ─────────────────────────────────────────────────────── */
.cards{display:flex;flex-direction:column;gap:6px}
.card{
  background:var(--surface);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow);
  padding:10px 12px;cursor:pointer;
  display:flex;flex-direction:column;gap:6px;
  transition:border-color .15s,box-shadow .15s,transform .12s;
}
.card:hover{border-color:var(--line-2);box-shadow:var(--shadow-md);transform:translateY(-1px)}
.card:active{transform:scale(.99);box-shadow:var(--shadow)}
.card.active-now{border-left:2px solid var(--accent)}
.card-h{display:flex;align-items:center;gap:5px;min-height:16px}
.card-repo{font-size:10.5px;color:var(--ink-3);font-weight:500}
.card-title{font-weight:500;font-size:13.5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--ink)}
.card-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap;color:var(--ink-3);font-size:11.5px}
.card-f{
  display:flex;align-items:center;gap:5px;flex-wrap:wrap;
  justify-content:flex-end;border-top:1px solid var(--line);padding-top:8px;
}
.card-f .cardbtn{margin-left:0}
.card-subs{display:flex;flex-direction:column;border-top:1px solid var(--line);padding-top:5px}
.subtoggle{
  display:flex;align-items:center;gap:5px;width:100%;text-align:left;
  border:none;background:transparent;color:var(--ink-2);
  font-size:11.5px;font-weight:500;cursor:pointer;padding:2px;
}
.subtoggle .chev{display:inline-flex;color:var(--ink-3);transition:transform .15s}
.subtoggle.open .chev{transform:rotate(90deg)}
.subtoggle .n{margin-left:auto;color:var(--ink-3);font-weight:400}
.sublist{display:flex;flex-direction:column;gap:1px;margin-top:3px}
.subrow{
  display:flex;align-items:center;gap:6px;width:100%;text-align:left;
  border:none;background:transparent;color:var(--ink);
  padding:4px 4px;border-radius:5px;cursor:pointer;font-size:12px;
  transition:background .1s;
}
.subrow:hover{background:var(--surface-2)}
.subdot{flex:0 0 auto;width:7px;height:7px;border-radius:50%}
.subnum{flex:0 0 auto;color:var(--ink-3);font-size:10.5px}
.subttl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.substate{flex:0 0 auto;font-size:10px;color:var(--ink-3)}

/* ── Status chips ──────────────────────────────────────────────── */
.statuschip{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:500;border-radius:999px;padding:2px 8px}
.s-planned{background:var(--surface-2);color:var(--ink-3)}
.s-working{background:var(--accent-weak);color:var(--accent)}
.s-ready{background:var(--green-weak);color:var(--green)}
.s-changes{background:var(--red-weak);color:var(--red)}
.s-attn{background:var(--amber-weak);color:var(--amber)}
.s-auto{background:var(--green-weak);color:var(--green)}
.s-conflict{background:var(--amber-weak);color:var(--amber)}
.s-done{background:var(--surface-2);color:var(--ink-3)}
.s-epic{background:var(--purple-weak);color:var(--purple)}

/* ── Tags + card actions ───────────────────────────────────────── */
.tagk{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;color:var(--ink-3);border:1px solid var(--line);border-radius:999px;padding:1px 7px}
.cardbtn{
  margin-left:auto;border:1px solid var(--line);background:var(--surface);
  color:var(--accent);border-radius:var(--radius-sm);
  padding:3px 10px;font-size:12px;font-weight:500;cursor:pointer;
  display:inline-flex;align-items:center;gap:4px;
  transition:border-color .12s,background .12s,color .12s;
}
.cardbtn:hover{border-color:var(--accent);background:var(--accent-weak)}
.cardbtn.play{color:var(--green);border-color:var(--green-weak);background:var(--green-weak)}
.cardbtn.play:hover{border-color:var(--green);background:color-mix(in srgb,var(--green) 15%,transparent)}
.cardbtn.fix{color:var(--red);border-color:var(--red-weak);background:var(--red-weak)}
.cardbtn.fix:hover{border-color:var(--red)}
.cardbtn.stop{color:var(--amber);border-color:var(--amber-weak)}
.cardbtn.stop:hover{border-color:var(--amber);background:var(--amber-weak)}
.testres{font-size:12px;margin:5px 2px 0;line-height:1.4}
.testres.ok{color:var(--green)}
.testres.bad{color:var(--red)}
.empty{color:var(--ink-3);font-size:13px;padding:12px;text-align:center}

/* ── Mobile bottom tabs ────────────────────────────────────────── */
.tabbar{
  position:sticky;bottom:0;z-index:25;display:grid;grid-template-columns:repeat(4,1fr);
  background:var(--surface);border-top:1px solid var(--line);padding-bottom:var(--safe-b);
}
.tab{border:none;background:none;color:var(--ink-3);padding:9px 2px 8px;font-size:10px;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;transition:color .12s}
.tab .lic{font-size:0}
.tab.on{color:var(--accent)}
.tab .bdg{font-size:10px;min-width:16px}

/* ── Buttons ───────────────────────────────────────────────────── */
.btn{
  border:1px solid var(--line);background:var(--surface);color:var(--ink);
  border-radius:var(--radius-sm);padding:8px 12px;font-size:13.5px;font-weight:500;
  cursor:pointer;display:inline-flex;align-items:center;gap:6px;justify-content:center;
  transition:border-color .12s,background .12s,color .12s,box-shadow .12s;
}
.btn:hover{border-color:var(--line-2);background:var(--surface-2)}
.btn:active{transform:scale(.98)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.btn.green{background:var(--green);border-color:var(--green);color:#fff}
.btn.danger{color:var(--red);border-color:color-mix(in srgb,var(--red) 30%,transparent)}
.btn.danger:hover{background:var(--red-weak)}
.btn.warn{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 30%,transparent)}
.btn.busy{opacity:.65;cursor:wait}
.btn.ghost{background:transparent;border-color:transparent}
.btn.ghost:hover{background:var(--surface-2);border-color:var(--line)}
.btn[disabled]{opacity:.4;pointer-events:none}

/* ── Forms ─────────────────────────────────────────────────────── */
label{display:block;font-size:12.5px;font-weight:500;color:var(--ink-2);margin:12px 0 4px}
input,select,textarea{
  width:100%;border:1px solid var(--line);background:var(--surface);color:var(--ink);
  border-radius:var(--radius-sm);padding:8px 10px;outline:none;
  transition:border-color .12s,box-shadow .12s;
}
input:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}
select{cursor:pointer}
textarea{resize:vertical;min-height:64px}
.ckline{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink);margin:9px 0}
.ckline input{width:auto}

/* ── Sheets / modals ───────────────────────────────────────────── */
.scrim{position:fixed;inset:0;background:rgba(8,10,14,.45);z-index:40;opacity:0;pointer-events:none;transition:opacity .18s;backdrop-filter:blur(2px)}
.scrim.on{opacity:1;pointer-events:auto}
.sheet{position:fixed;z-index:50;background:var(--surface);transition:transform .22s ease;display:flex;flex-direction:column}
.sheet .sh{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);font-weight:600;font-size:15px}
.sheet .sb{padding:14px 16px;overflow-y:auto;-webkit-overflow-scrolling:touch}
.sheet .sf{padding:12px 16px calc(12px + var(--safe-b));border-top:1px solid var(--line);display:flex;gap:8px;justify-content:flex-end;background:var(--surface)}
.sheet.bottom{left:0;right:0;bottom:0;max-height:92dvh;border-radius:var(--radius-xl) var(--radius-xl) 0 0;transform:translateY(110%)}
.sheet.bottom.on{transform:translateY(0)}
.row{display:flex;gap:8px;margin-top:14px}
.row .btn{flex:1}

/* ── Token usage panel ─────────────────────────────────────────── */
.useg-tabs{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.useg-tab{border:1px solid var(--line);background:transparent;color:var(--ink-2);padding:4px 10px;border-radius:999px;cursor:pointer;font-size:12px;transition:all .12s}
.useg-tab:hover{border-color:var(--line-2);color:var(--ink)}
.useg-tab.on{background:var(--accent);border-color:var(--accent);color:#fff}
.useg-totals{display:flex;gap:8px;margin-bottom:6px}
.useg-big{flex:1;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.useg-big b{font-size:22px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.useg-big span{font-size:10.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
.useg-sec{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);margin:18px 0 7px;font-weight:600}
.useg-row,.useg-issue{display:grid;grid-template-columns:minmax(0,1fr) 34% auto;align-items:center;gap:8px;padding:5px 0;font-size:12.5px}
.useg-issue{width:100%;text-align:left;border:none;background:transparent;color:var(--ink);cursor:pointer;border-radius:var(--radius-sm)}
.useg-issue:hover{background:var(--surface-2)}
.useg-row-l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.useg-row-r{text-align:right;color:var(--ink-2);font-family:"Geist Mono",ui-monospace,monospace;font-size:12px;white-space:nowrap}
.useg-track{height:5px;border-radius:999px;background:var(--surface-2);overflow:hidden}
.useg-track i{display:block;height:100%;border-radius:999px;background:var(--accent)}
.dusage{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;padding:8px 11px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-2);font-size:12px;color:var(--ink-2)}
.dusage span{display:inline-flex;align-items:center;gap:5px;font-family:"Geist Mono",ui-monospace,monospace;font-size:11.5px}
.conflictbox{border:1px solid var(--amber);border-radius:var(--radius);padding:12px 14px;margin-bottom:12px;background:var(--amber-weak)}
.conflictbox-h{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--amber);font-size:13.5px}
.conflictbox-b{font-size:12.5px;color:var(--ink-2);margin:6px 0}
.conflictbox-files{margin:6px 0 10px;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:3px}
.conflictbox-files li a{display:inline-flex;align-items:center;gap:5px;font:12px "Geist Mono",ui-monospace,monospace;color:var(--ink-2);text-decoration:none}
.conflictbox-files li a:hover{color:var(--accent);text-decoration:underline}

/* ── Detail panel ──────────────────────────────────────────────── */
.dscrim{position:fixed;inset:0;z-index:44;background:transparent}
.prbar{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  border:1px solid var(--green);background:var(--green-weak);
  border-radius:var(--radius);padding:8px 11px;margin:6px 0 4px;
}
.prbar-l{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:13px;margin-right:auto}
.prbar .btn{padding:5px 10px;font-size:12.5px}
.epicbox{border:1px solid var(--line);border-radius:var(--radius);padding:8px 10px;margin-bottom:6px;background:var(--surface)}
.epicalldone{color:var(--green);font-weight:600;text-transform:none;letter-spacing:0}
.epiclist{display:flex;flex-direction:column;gap:2px}
.epicrow{
  display:flex;align-items:center;gap:7px;width:100%;text-align:left;
  border:none;background:transparent;color:var(--ink);
  padding:5px 6px;border-radius:var(--radius-sm);cursor:pointer;font-size:13px;
  transition:background .1s;
}
.epicrow:hover{background:var(--surface-2)}
.epicck{flex:0 0 auto;display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;border-radius:50%}
.epicck.done{background:var(--green-weak);color:var(--green)}
.epicck.open{border:1px solid var(--line);color:var(--ink-3)}
.epicnum{flex:0 0 auto;color:var(--ink-3);font-size:11.5px}
.epictitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.detail{
  position:fixed;inset:0;z-index:45;background:var(--bg);
  display:flex;flex-direction:column;
  transform:translateX(100%);transition:transform .22s cubic-bezier(.4,0,.2,1);
}
.detail.on{transform:translateX(0)}
.dhead{
  position:sticky;top:0;background:var(--surface);
  border-bottom:1px solid var(--line);
  padding:calc(10px + var(--safe-t)) 14px 10px;
  display:flex;align-items:center;gap:8px;
}
.dhead .tt{font-size:14.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmeta{color:var(--ink-3);font-size:11.5px;font-weight:400}
.dtoolbar{
  position:sticky;top:0;background:var(--surface);
  border-bottom:1px solid var(--line);
  display:flex;gap:5px;align-items:center;padding:7px 12px;flex-wrap:wrap;
}
.toolmore{display:flex;flex-direction:column;gap:4px;min-width:200px}
.toolmore-row{display:flex}
.toolmore-row>*{flex:1;width:100%}
.toolmore .tbtn{width:100%;height:34px;justify-content:flex-start;padding:0 11px;gap:7px}
.toolmore .autotog{width:100%;justify-content:space-between}
.tbtn{
  flex:0 0 auto;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);
  border-radius:var(--radius-sm);width:34px;height:34px;
  display:inline-flex;align-items:center;justify-content:center;gap:0;
  cursor:pointer;position:relative;transition:border-color .12s,background .12s,color .12s;
}
.tbtn:hover{background:var(--surface-2);color:var(--ink);border-color:var(--line-2)}
.tbtn:has(.tlabel){width:auto;padding:0 11px;gap:6px}
.tlabel{font-size:12.5px;font-weight:500;white-space:nowrap}
.tbtn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.tbtn.primary:hover{background:var(--accent-hover)}
.tbtn.green{background:var(--green);border-color:var(--green);color:#fff}
.tbtn.danger{color:var(--red);border-color:color-mix(in srgb,var(--red) 30%,transparent)}
.tbtn.danger:hover{background:var(--red-weak)}
.tbtn.warn{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 30%,transparent)}
.tbtn.warn:hover{background:var(--amber-weak)}
.tbtn.auto.on{background:var(--green-weak);border-color:var(--green);color:var(--green)}
.tbtn.auto.off{color:var(--ink-3);opacity:.55}
.tbtn.armed{background:var(--red);border-color:var(--red);color:#fff}
.tbtn.green.armed{background:#b45309;border-color:#b45309;color:#fff}
.tbsep{flex:0 0 auto;align-self:stretch;width:1px;margin:5px 2px;background:var(--line)}

/* ── Toggle switch ─────────────────────────────────────────────── */
.autotog{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;
  border:none;background:transparent;color:var(--ink-2);
  height:34px;padding:0 6px;cursor:pointer;font-size:12.5px;font-weight:500;
  transition:color .12s;
}
.autotog-l{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.autotog-sw{position:relative;width:30px;height:17px;border-radius:999px;background:var(--line);transition:background .15s;flex:0 0 auto}
.autotog-knob{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}
.autotog.on{color:var(--green)}
.autotog.on .autotog-sw{background:var(--green)}
.autotog.on .autotog-knob{transform:translateX(13px)}
.autotog.busy{opacity:.65;cursor:wait}

/* ── Tooltip ───────────────────────────────────────────────────── */
.tbtn[data-tip]:hover::after{
  content:attr(data-tip);position:absolute;top:calc(100% + 6px);left:50%;
  transform:translateX(-50%);
  background:var(--ink);color:var(--bg);
  font-size:11px;white-space:nowrap;padding:3px 7px;border-radius:5px;z-index:60;
  pointer-events:none;
}

/* ── Detail panes ──────────────────────────────────────────────── */
.dpanes{flex:1;display:flex;flex-direction:column;overflow:hidden}
.dpane{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 14px}
.dpanes>.dpane{flex:1 1 auto;min-height:0}
.dpane.side{display:flex;flex-direction:column;overflow:hidden}
.dstream{
  flex:1 1 auto;min-height:140px;
  background:#0d1117;color:#c9d1d9;
  border-radius:var(--radius);padding:9px 11px;
  font:12px/1.5 "Geist Mono",ui-monospace,monospace;
  overflow:auto;white-space:pre-wrap;word-break:break-word;
}
.dstream .l.tool{color:#79c0ff}.dstream .l.muted{color:#6e7681}

/* ── Settings ──────────────────────────────────────────────────── */
.sec{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);margin:0 0 8px}
.setgrp{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px;margin-bottom:10px}
.setgrp .sec{margin-top:0}

/* ── Comment thread ────────────────────────────────────────────── */
.cmt{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:9px 11px;margin-bottom:7px}
.cmt.ag{background:var(--surface-2)}
.cmt.skel{opacity:.5}
.cmt .h{font-size:11.5px;color:var(--ink-3);margin-bottom:4px;display:flex;align-items:center;gap:6px}
.avi{display:inline-block;flex:0 0 auto;overflow:hidden;vertical-align:middle;line-height:0}
.avi img{width:100%;height:100%;display:block}
.avi.head img{object-fit:contain;object-position:center}
.avi.full img{object-fit:contain;object-position:center top}
.cmt.incoming{border-left:2px solid var(--accent)}
.cmt .h .cmt-in{display:inline-flex;align-items:center;color:var(--accent);vertical-align:middle}
.cmt .h .cmt-edit-btn{margin-left:auto;opacity:0;transition:opacity .15s;padding:2px}
.cmt:hover .h .cmt-edit-btn{opacity:1}
.cmt .b{font-size:13.5px;line-height:1.6}
.cmt .b pre{background:var(--bg);padding:8px 10px;border-radius:var(--radius-sm);overflow:auto;font-size:12px;font-family:"Geist Mono",ui-monospace,monospace}
.cmt .b code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.88em;font-family:"Geist Mono",ui-monospace,monospace}
.cmt .b img{max-width:100%;border-radius:var(--radius-sm)}
.cmt .b h1{font-size:1.3em;font-weight:700;margin:.5em 0 .2em;border-bottom:1px solid var(--line);padding-bottom:.2em}
.cmt .b h2{font-size:1.12em;font-weight:700;margin:.45em 0 .2em;border-bottom:1px solid var(--line);padding-bottom:.15em}
.cmt .b h3{font-size:1.02em;font-weight:600;margin:.4em 0 .15em}
.cmt .b h4,.cmt .b h5,.cmt .b h6{font-size:1em;font-weight:600;margin:.3em 0 .1em}
.cmt .b ul,.cmt .b ol{margin:.35em 0;padding-left:1.5em}
.cmt .b li{margin:.1em 0}
.cmt .b blockquote{border-left:2px solid var(--line-2);margin:.35em 0;padding:.1em .75em;color:var(--ink-2)}
.cmt .b blockquote p{margin:.15em 0}
.cmt .b hr{border:none;border-top:1px solid var(--line);margin:.6em 0}
.cmt .b p{margin:.3em 0}
.cmt-edit-ta{width:100%;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg);color:var(--ink);font:inherit;font-size:13.5px;padding:8px 10px;resize:vertical;min-height:80px;box-sizing:border-box}
.cmt-edit-row{display:flex;gap:6px;margin-top:6px;justify-content:flex-end}

/* ── Scroll FAB ────────────────────────────────────────────────── */
.scroll-fab-wrap{position:sticky;bottom:8px;display:flex;justify-content:center;pointer-events:none;margin-top:4px}
.scroll-fab-wrap.top{bottom:auto;top:8px;margin-top:0;margin-bottom:4px}
.scroll-fab{pointer-events:auto;background:var(--surface)!important;border:1px solid var(--line)!important;box-shadow:var(--shadow);border-radius:50%!important;width:32px!important;height:32px!important;display:flex;align-items:center;justify-content:center}

/* ── Composer ──────────────────────────────────────────────────── */
.dcompose{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--line);padding:10px 12px calc(10px + var(--safe-b))}
.composer{
  display:flex;flex-direction:column;gap:8px;
  background:var(--surface);border:1px solid var(--line);
  border-radius:var(--radius-lg);padding:10px 12px;
  box-shadow:var(--shadow);transition:border-color .15s,box-shadow .15s;
}
.composer:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}
.composer textarea{border:none;background:transparent;resize:none;outline:none;width:100%;font:inherit;font-size:14px;line-height:1.5;color:var(--ink);min-height:22px;max-height:200px;padding:0;overflow-y:auto}
.composer textarea::placeholder{color:var(--ink-3)}
.composer-row{display:flex;align-items:center;gap:7px}
.composer-row .spacer{flex:1}
.composer-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:var(--radius-sm);color:var(--ink-3);cursor:pointer;flex:0 0 auto;transition:background .12s,color .12s}
.composer-icon:hover{background:var(--surface-2);color:var(--ink)}
.composer-atts{display:flex;flex-wrap:wrap;gap:4px}
.composer .btn{padding:6px 12px;font-size:13px}
.autorow{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.apill{
  display:inline-flex;align-items:center;gap:5px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink-2);
  border-radius:999px;padding:4px 10px;font-size:12.5px;cursor:pointer;
  transition:all .12s;
}
.apill:hover{border-color:var(--line-2);color:var(--ink)}
.apill.on{background:var(--green-weak);border-color:var(--green);color:var(--green)}
.apill.off{color:var(--ink-3);text-decoration:line-through}
.att{display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border-radius:var(--radius-sm);padding:3px 7px;font-size:11.5px;margin:3px 3px 0 0}
.att img{height:26px;border-radius:4px}
.muted{color:var(--ink-2)}

/* ── Toasts ────────────────────────────────────────────────────── */
.toast-stack{position:fixed;bottom:calc(70px + var(--safe-b));right:14px;z-index:80;display:flex;flex-direction:column-reverse;gap:6px;max-width:min(340px,calc(100vw - 28px));pointer-events:none}
.toast-item{
  display:flex;align-items:center;gap:8px;
  background:var(--ink);color:var(--bg);
  padding:9px 12px;border-radius:var(--radius);
  font-size:13px;line-height:1.4;box-shadow:var(--shadow-md);
  animation:toastin .18s ease;pointer-events:auto;
}
.toast-item.t-error{background:var(--red);color:#fff}
.toast-x{margin-left:auto;background:transparent;border:none;color:inherit;opacity:.7;cursor:pointer;padding:0 0 0 8px;font-size:14px;line-height:1;flex-shrink:0}
.toast-x:hover{opacity:1}
@keyframes toastin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.cmdbox{display:flex;gap:6px;align-items:center;margin-top:6px}
.cmdbox code{flex:1;background:#0d1117;color:#c9d1d9;border-radius:var(--radius-sm);padding:7px 9px;font:12px "Geist Mono",ui-monospace,monospace;overflow:auto;white-space:nowrap}

/* ── Desktop overrides ─────────────────────────────────────────── */
@media(min-width:880px){
  .tabbar{display:none}
  .board{max-width:1600px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-items:start;padding:14px 16px}
  .col{margin:0}
  .cards{max-height:calc(100dvh - 192px);overflow-y:auto;padding-right:2px}
  .detail{left:auto;right:0;width:min(1080px,92vw);box-shadow:var(--shadow-lg)}
  .dpanes{flex-direction:row}
  .dpane.chat{flex:1 1 auto;border-right:1px solid var(--line)}
  .dpane.side{flex:0 0 46%;width:46%;max-width:520px}
  .sheet.bottom{
    left:50%;top:50%;right:auto;bottom:auto;
    width:min(620px,92vw);max-height:88dvh;
    border-radius:var(--radius-xl);border:1px solid var(--line);
    transform:translate(-50%,-50%) scale(.97);opacity:0;pointer-events:none;
    transition:opacity .18s,transform .18s cubic-bezier(.4,0,.2,1);
  }
  .sheet.bottom.on{transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:auto}
}

/* ── Misc ──────────────────────────────────────────────────────── */
.norepo{padding:48px 20px;display:flex;flex-direction:column;align-items:center;text-align:center}
.searchrow{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:var(--radius-sm);padding:0 8px;margin:6px 0;background:var(--surface)}
.searchrow .searchic{color:var(--ink-3);flex:0 0 auto}
.searchrow input{border:none;background:none;padding:8px 4px;flex:1;box-shadow:none}
.searchrow input:focus{border:none;box-shadow:none}
.repolist{max-height:42vh;overflow-y:auto;-webkit-overflow-scrolling:touch}

/* ── Onboarding ────────────────────────────────────────────────── */
.onboard{position:fixed;inset:0;z-index:60;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch}
.ob{max-width:560px;margin:0 auto;width:100%;padding:calc(32px + var(--safe-t)) 20px calc(32px + var(--safe-b))}
.obdots{display:flex;gap:5px;justify-content:center;margin-bottom:24px}
.obdot{width:6px;height:6px;border-radius:50%;background:var(--line)}
.obdot.on{background:var(--accent)}.obdot.done{background:var(--green)}
.obki{width:48px;height:48px;border-radius:var(--radius);background:var(--accent-weak);color:var(--accent);display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.obh{font-size:22px;font-weight:700;margin:2px 0 6px;letter-spacing:-.02em}
.obsub{color:var(--ink-2);margin-bottom:8px;line-height:1.6;font-size:14.5px}
.obsteps{background:var(--surface-2);border-radius:var(--radius);padding:12px 15px;font-size:13.5px;line-height:1.7;white-space:pre-wrap;margin:14px 0;color:var(--ink);border:1px solid var(--line)}
.oblink{display:inline-flex;align-items:center;gap:6px;margin:2px 0 8px;font-weight:500}
.obnav{display:flex;gap:8px;margin-top:20px}
.obnav .btn{flex:1}
.obpick{display:flex;flex-direction:column;gap:7px;margin:14px 0}
.obchip{
  border:1px solid var(--line);background:var(--surface);border-radius:var(--radius);
  padding:12px 14px;cursor:pointer;font-size:14.5px;
  display:flex;align-items:center;gap:10px;font-weight:500;
  transition:border-color .12s,background .12s,color .12s;
}
.obchip:hover{border-color:var(--line-2);background:var(--surface-2)}
.obchip .lic{color:var(--ink-3)}
.obchip.on{border-color:var(--accent);background:var(--accent-weak);color:var(--accent)}.obchip.on .lic{color:var(--accent)}
.obchip small{display:block;font-weight:400;color:var(--ink-2);font-size:12px;margin-top:1px}
.obchip .ck{margin-left:auto;color:var(--accent)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style>
</head>
<body>
<div id="root" aria-busy="true"></div>
<script>
(function(){try{var t=localStorage.getItem("theme")||(matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);var m=document.getElementById("metatheme");if(m)m.setAttribute("content",t==="dark"?"#0d0f12":"#f4f5f7");}catch(e){}})();
if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){});});}
</script>
<script type="module">
import { mount } from "/web/app.js";
mount(document.getElementById("root"));
</script>
</body></html>`;
}
