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
/* ── Design tokens (Dev Agency design system) ──────────────────── */
:root{
  /* Brand */
  --brand:#1d9e75;--brand-ink:#0b6f4f;
  /* Canvas */
  --bg:#f5f7f9;--surface:#ffffff;--surface-2:#eef1f4;--surface-3:#e4e8ed;
  /* Ink (three steps; --ink aliases --ink-1 for legacy rules) */
  --ink-1:#14171b;--ink-2:#545b64;--ink-3:#8b929b;--ink:#14171b;
  /* Lines */
  --line:#e5e8ec;--line-2:#d3d8de;
  /* Accent (interactive blue) */
  --accent:#2f6df6;--accent-hover:#1f5be0;--accent-weak:#e8f0ff;--accent-ink:#1b4fc4;
  /* Semantic */
  --green:#0b8a52;--green-weak:#e4f6ed;
  --amber:#a96a00;--amber-weak:#fdf0d6;
  --red:#c33729;--red-weak:#fdeae7;
  --purple:#6741d9;--purple-weak:#ece6ff;
  --info:#2f6df6;--info-weak:#e8f0ff;
  /* Interaction washes */
  --row-hover:rgba(47,109,246,.055);--row-sel:rgba(47,109,246,.11);--focus-ring:rgba(47,109,246,.28);
  /* Terminal */
  --term-bg:#0d1117;--term-ink:#d6deeb;--term-muted:#6b7686;--term-accent:#8aa0c0;
  /* Elevation */
  --shadow-xs:0 1px 2px rgba(20,22,34,.06);
  --shadow:0 1px 3px rgba(20,22,34,.08),0 1px 2px rgba(20,22,34,.04);
  --shadow-sm:0 1px 3px rgba(20,22,34,.08),0 1px 2px rgba(20,22,34,.04);
  --shadow-md:0 4px 12px rgba(20,22,34,.10),0 2px 4px rgba(20,22,34,.06);
  --shadow-lg:0 12px 32px rgba(20,22,34,.14),0 4px 8px rgba(20,22,34,.08);
  --shadow-pop:0 10px 28px rgba(0,0,0,.20),0 3px 8px rgba(0,0,0,.12);
  /* Radius */
  --radius-xs:6px;--radius-sm:8px;--radius:12px;--radius-lg:16px;--radius-xl:16px;--radius-pill:999px;
  /* Motion */
  --ease:cubic-bezier(.3,.7,.4,1);--ease-out:cubic-bezier(.16,1,.3,1);
  --dur-fast:120ms;--dur:160ms;--dur-slow:240ms;
  /* Fonts */
  --font-sans:"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
  --font-mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  /* Safe areas */
  --safe-b:env(safe-area-inset-bottom,0px);--safe-t:env(safe-area-inset-top,0px);
}
html[data-theme="dark"]{
  --brand:#25b083;--brand-ink:#4fd3a6;
  --bg:#0e1014;--surface:#171a1f;--surface-2:#1f242b;--surface-3:#272d35;
  --ink-1:#e7e9ed;--ink-2:#9aa1ab;--ink-3:#6b727c;--ink:#e7e9ed;
  --line:#262b33;--line-2:#353c46;
  --accent:#5b8cff;--accent-hover:#79a1ff;--accent-weak:#16233b;--accent-ink:#9bbcff;
  --green:#3ddc97;--green-weak:#10271d;
  --amber:#e0a83a;--amber-weak:#2a2110;
  --red:#f1746a;--red-weak:#2c1614;
  --purple:#a99bf5;--purple-weak:#1d1933;
  --info:#5b8cff;--info-weak:#16233b;
  --row-hover:rgba(91,140,255,.10);--row-sel:rgba(91,140,255,.18);--focus-ring:rgba(91,140,255,.35);
  --term-bg:#0a0c10;
  --shadow-xs:none;--shadow:0 1px 3px rgba(0,0,0,.4);--shadow-sm:0 1px 3px rgba(0,0,0,.4);
  --shadow-md:0 4px 12px rgba(0,0,0,.45);--shadow-lg:0 12px 32px rgba(0,0,0,.55);--shadow-pop:0 10px 28px rgba(0,0,0,.6),0 3px 8px rgba(0,0,0,.4);
}

/* ── Reset & base ──────────────────────────────────────────────── */
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:var(--bg);color:var(--ink-1);
  font-family:var(--font-sans);font-size:14px;line-height:1.55;font-weight:400;
  -webkit-text-size-adjust:100%;overscroll-behavior-y:none;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
  font-feature-settings:"cv01","ss01";
}
a{color:var(--accent);text-decoration:none}
a:hover{color:var(--accent-hover)}
button{font:inherit;color:inherit}
code,pre,kbd,samp{font-family:var(--font-mono)}
.lic{display:inline-block;vertical-align:-3px}
.tnum,[data-tnum]{font-variant-numeric:tabular-nums}
input,select,textarea{font-family:inherit;font-size:14px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--radius-xs)}
*{scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}
*::-webkit-scrollbar{width:9px;height:9px}
*::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:var(--radius-pill);border:2px solid var(--bg)}
*::-webkit-scrollbar-thumb:hover{background:var(--ink-3)}
::selection{background:var(--accent-weak);color:var(--ink-1)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

/* ── App shell ─────────────────────────────────────────────────── */
.app{display:flex;flex-direction:column;height:100dvh;max-width:100vw;overflow:hidden;background:var(--bg);color:var(--ink-1)}
.spacer{flex:1}
.muted{color:var(--ink-3)}
/* ── Design-system primitives (da-*) ───────────────────────────── */
.da-btn,.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--font-sans);font-size:14px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;user-select:none;border:1px solid var(--line);background:var(--surface);color:var(--ink-1);border-radius:var(--radius-sm);padding:0 16px;height:38px;transition:background var(--dur-fast) var(--ease),border-color var(--dur-fast) var(--ease),color var(--dur-fast) var(--ease),transform var(--dur-fast) var(--ease)}
.da-btn:hover,.btn:hover{border-color:var(--line-2);background:var(--surface-2)}
.da-btn:active,.btn:active{transform:scale(.975)}
.da-btn:disabled,.da-btn[aria-disabled="true"],.btn:disabled{opacity:.5;pointer-events:none}
.da-btn--sm,.btn.sm{height:30px;padding:0 12px;font-size:13px;border-radius:var(--radius-xs)}
.da-btn--lg,.btn.lg{height:46px;padding:0 24px;font-size:16px}
.da-btn--block,.btn.block{display:flex;width:100%}
.da-btn--primary,.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.da-btn--primary:hover,.btn.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.da-btn--success,.btn.green{background:var(--green);border-color:var(--green);color:#fff}
.da-btn--success:hover,.btn.green:hover{filter:brightness(1.06);background:var(--green)}
.da-btn--danger,.btn.danger{background:var(--surface);border-color:var(--red-weak);color:var(--red)}
.da-btn--danger:hover,.btn.danger:hover{background:var(--red-weak);border-color:var(--red)}
.da-btn--ghost,.btn.ghost{background:transparent;border-color:transparent;color:var(--ink-2)}
.da-btn--ghost:hover,.btn.ghost:hover{background:var(--surface-2);color:var(--ink-1)}

.da-iconbtn,.iconbtn{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;flex:0 0 auto;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:var(--radius-sm);transition:background var(--dur-fast) var(--ease),color var(--dur-fast) var(--ease),border-color var(--dur-fast) var(--ease),transform var(--dur-fast) var(--ease)}
.da-iconbtn:hover,.iconbtn:hover{background:var(--surface-2);color:var(--ink-1);border-color:var(--line-2)}
.da-iconbtn:active,.iconbtn:active{transform:scale(.94)}
.da-iconbtn:disabled,.iconbtn:disabled{opacity:.45;pointer-events:none}
.da-iconbtn--on,.iconbtn.on{color:var(--accent);border-color:var(--accent);background:var(--accent-weak)}
.da-iconbtn--ghost,.iconbtn.ghost{border-color:transparent;background:transparent}
.da-iconbtn--ghost:hover,.iconbtn.ghost:hover{background:var(--surface-2)}
.da-iconbtn--sm,.iconbtn-sm{width:30px;height:30px;border-radius:var(--radius-xs)}

.da-badge,.bdg{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;line-height:1.5;border-radius:var(--radius-pill);padding:2px 9px;white-space:nowrap;background:var(--surface-2);color:var(--ink-2)}
.da-badge--outline{background:transparent;border:1px solid var(--line);color:var(--ink-3)}
.da-badge--accent{background:var(--accent-weak);color:var(--accent)}
.da-badge--green{background:var(--green-weak);color:var(--green)}
.da-badge--amber{background:var(--amber-weak);color:var(--amber)}
.da-badge--red{background:var(--red-weak);color:var(--red)}
.da-badge--purple{background:var(--purple-weak);color:var(--purple)}
.da-badge__dot{width:6px;height:6px;border-radius:50%;background:currentColor}

.da-avatar{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:50%;overflow:hidden;background:var(--surface-2);border:1px solid var(--line);line-height:0}
.da-avatar img{width:100%;height:100%;object-fit:cover;object-position:center;display:block}
.da-avatar--head{background:transparent;border-color:transparent}
.da-avatar--head img{object-fit:contain}

/* legacy avatar wrapper (core.js Avatar) — frameless head art */
.avi{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;line-height:0;overflow:visible}
.avi img{width:100%;height:100%;object-fit:contain;object-position:center;display:block}
.avi.full img{object-fit:contain;object-position:bottom}

.da-input,.da-textarea,.da-select{width:100%;font-family:var(--font-sans);font-size:14px;color:var(--ink-1);background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-sm);padding:0 12px;height:38px;outline:none;transition:border-color var(--dur-fast) var(--ease),box-shadow var(--dur-fast) var(--ease)}
.da-textarea{height:auto;min-height:84px;padding:12px;resize:vertical;line-height:1.55}
.da-input::placeholder,.da-textarea::placeholder{color:var(--ink-3)}
.da-input:hover,.da-textarea:hover,.da-select:hover{border-color:var(--line-2)}
.da-input:focus,.da-textarea:focus,.da-select:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--focus-ring)}
.da-select{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:34px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238b929b' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
.da-field{display:flex;flex-direction:column;gap:8px}
.da-label{font-size:13px;font-weight:500;color:var(--ink-2)}
.da-hint{font-size:12px;color:var(--ink-3)}

.da-switch{position:relative;display:inline-flex;align-items:center;flex:0 0 auto;width:38px;height:22px;border-radius:var(--radius-pill);background:var(--line-2);border:none;cursor:pointer;padding:0;transition:background var(--dur) var(--ease)}
.da-switch__knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform var(--dur) var(--ease)}
.da-switch--on{background:var(--green)}
.da-switch--on .da-switch__knob{transform:translateX(16px)}
.da-switch--accent.da-switch--on{background:var(--accent)}

/* ── Status chips (canonical state palette) ────────────────────── */
.da-status,.statuschip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;line-height:1.5;border-radius:var(--radius-pill);padding:2px 10px;white-space:nowrap}
.da-status__dot,.statuschip .dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}
.da-status--live .da-status__dot,.statuschip.live .dot{animation:da-pulse 1.4s infinite}
.s-planned{background:var(--surface-2);color:var(--ink-2)}
.s-working{background:var(--accent-weak);color:var(--accent)}
.s-ready{background:var(--green-weak);color:var(--green)}
.s-attn{background:var(--amber-weak);color:var(--amber)}
.s-changes,.s-conflict{background:var(--red-weak);color:var(--red)}
.s-done{background:var(--surface-2);color:var(--ink-3)}
.s-epic{background:var(--purple-weak);color:var(--purple)}
.s-auto{background:var(--amber-weak);color:var(--amber)}
@keyframes da-pulse{0%{box-shadow:0 0 0 0 currentColor}70%{box-shadow:0 0 0 5px transparent}100%{box-shadow:0 0 0 0 transparent}}

.da-progress{width:100%;height:7px;border-radius:var(--radius-pill);background:var(--surface-3);overflow:hidden}
.da-progress__fill{height:100%;border-radius:var(--radius-pill);background:var(--accent);transition:width var(--dur-slow) var(--ease)}
.da-progress--green .da-progress__fill{background:var(--green)}
.da-progress--amber .da-progress__fill{background:var(--amber)}
.spin{animation:da-spin .7s linear infinite;transform-origin:center;color:var(--accent)}
@keyframes da-spin{to{transform:rotate(360deg)}}

.da-empty,.empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:48px 20px;color:var(--ink-2)}
.da-empty__icon{width:48px;height:48px;border-radius:var(--radius);background:var(--surface-2);color:var(--ink-3);display:inline-flex;align-items:center;justify-content:center}
.da-empty__title{font-size:16px;font-weight:600;color:var(--ink-1)}
.da-empty__desc{font-size:13px;color:var(--ink-2);max-width:320px;line-height:1.55}
/* ── Top bar ───────────────────────────────────────────────────── */
.topbar{flex:none;display:flex;align-items:center;gap:8px;padding:calc(10px + var(--safe-t)) 16px 10px;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:30}
.brand{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:600;letter-spacing:-.01em;flex:0 0 auto}
.brand .lic,.brand img{width:26px;height:26px;border-radius:7px;color:var(--brand)}
.brand b{color:var(--brand);font-weight:600}
.brandname b{color:var(--brand)}
@media(max-width:560px){.brandname{display:none}}
.envbadge{font-size:10px;font-weight:600;letter-spacing:.04em;background:var(--amber-weak);color:var(--amber);border:1px solid color-mix(in srgb,var(--amber) 30%,transparent);border-radius:5px;padding:1px 6px}
.sub{color:var(--ink-3);font-size:12px}

/* repo picker */
.repodrop{flex:0 1 auto;min-width:0}
.repodrop-btn{display:inline-flex;align-items:center;gap:8px;max-width:min(60vw,360px);border:1px solid var(--line);background:var(--surface);color:var(--ink-1);border-radius:var(--radius-pill);padding:6px 12px;font:500 13.5px var(--font-sans);cursor:pointer;white-space:nowrap}
.repodrop-btn:hover{border-color:var(--line-2)}
.repodrop-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.repodrop-sub{color:var(--ink-3);font-weight:400;font-size:12px}

/* ── View bar (Chat | List | Board) + stat strip ──────────────── */
.viewbar{flex:none;display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
.viewseg{display:inline-flex;background:var(--surface-2);border-radius:var(--radius-sm);padding:3px;gap:2px;flex:0 0 auto}
.viewseg button{display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--ink-2);font:500 13px var(--font-sans);padding:6px 12px;border-radius:var(--radius-xs);cursor:pointer}
.viewseg button.on{background:var(--surface);color:var(--ink-1);box-shadow:var(--shadow-xs)}

/* ── Content + split ───────────────────────────────────────────── */
.content{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0}
/* ── Workspace / resizable Split ──────────────────────────────── */
.workspace{flex:1;min-height:0;display:flex;overflow:hidden;position:relative}
.workspace__single{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.splitx{flex:1;min-height:0;display:flex;overflow:hidden}
.splitx__pane{min-width:0;overflow:hidden;display:flex;flex-direction:column}
.splitx__grip{flex:0 0 7px;cursor:col-resize;display:flex;align-items:center;justify-content:center;background:transparent;position:relative}
.splitx__grip:hover .splitx__grip-line,.splitx__grip:active .splitx__grip-line{background:var(--accent)}
.splitx__grip-line{width:1px;height:100%;background:var(--line);transition:background var(--dur-fast) var(--ease)}
.slot{flex:1;min-height:0;min-width:0;overflow:hidden;display:flex;flex-direction:column}
.slot--chat{border-right:1px solid var(--line);background:var(--bg)}
.slot--detail{border-left:1px solid var(--line);background:var(--bg)}
.slot--main{background:var(--bg)}
/* ── Slide-over overlays (chat / detail on smaller widths) ─────── */
.overlay{position:fixed;inset:0;z-index:50;display:flex}
.overlay__scrim{position:absolute;inset:0;background:rgba(8,10,14,.45)}
.overlay__panel{position:absolute;top:0;bottom:0;background:var(--bg);box-shadow:var(--shadow-lg);display:flex;flex-direction:column;animation:slidein var(--dur) var(--ease)}
.overlay__panel--chat{left:0;width:min(440px,92vw);border-right:1px solid var(--line)}
.overlay__panel--detail{right:0;width:min(900px,100vw);border-left:1px solid var(--line)}
@keyframes slidein{from{transform:translateX(-12px);opacity:.6}to{transform:none;opacity:1}}
.overlay--detail .overlay__panel{animation:slideinR var(--dur) var(--ease)}
@keyframes slideinR{from{transform:translateX(12px);opacity:.6}to{transform:none;opacity:1}}
.listbar__stats{display:flex;align-items:center}
.slot .detail{position:static;inset:auto;z-index:auto;flex:1;width:auto;box-shadow:none;border-left:none}
.slot--detail .detail{border-left:none}
.slot .pane,.slot .orch,.slot>div{flex:1;min-height:0}
.overlay__panel--detail .detail{position:static;inset:auto;width:100%;flex:1;box-shadow:none}
.overlay__panel--chat .orch{flex:1;min-height:0}


/* ── At-a-glance stat strip ────────────────────────────────────── */
.pt-overview{display:flex;align-items:center;gap:6px;flex-wrap:nowrap}
.pt-overview-top{gap:6px}
.pt-stat{display:flex;flex-direction:column;gap:2px;align-items:flex-start;border:1px solid var(--line);background:var(--surface);border-radius:var(--radius-sm);padding:6px 12px;cursor:pointer;transition:border-color var(--dur-fast) var(--ease),background var(--dur-fast) var(--ease);min-width:74px}
.pt-overview-top .pt-stat{padding:4px 10px;min-width:0}
.pt-stat:hover{border-color:var(--line-2)}
.pt-stat.on{border-color:var(--accent);background:var(--accent-weak)}
.pt-stat.zero{opacity:.55}
.pt-stat-n{font-size:20px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--ink-1)}
.pt-overview-top .pt-stat-n{font-size:16px}
.pt-stat-l{font-size:10.5px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3);display:inline-flex;align-items:center;gap:4px}
.pt-stat-attention.on,.pt-stat-attention .pt-stat-n{color:var(--amber)}
.pt-stat-attention .pt-stat-n{color:var(--amber)}
.pt-stat-running .pt-stat-n{color:var(--accent)}
.pt-stat-done .pt-stat-n{color:var(--ink-3)}
.pt-stat-spend{cursor:default;margin-left:auto}
.pt-stat-spend .pt-stat-n{font-family:var(--font-mono);color:var(--green)}

/* ── List toolbar ──────────────────────────────────────────────── */
.listbar{position:sticky;top:0;z-index:6;display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
.listbar__count{font-size:12px;color:var(--ink-3);font-weight:500}
.pt-needsyou{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--amber);background:var(--amber-weak);border-radius:var(--radius-pill);padding:3px 10px}
.seg{display:inline-flex;background:var(--surface-2);border-radius:var(--radius-sm);padding:3px;gap:2px}
.segbtn{display:inline-flex;align-items:center;gap:5px;border:none;background:transparent;color:var(--ink-2);border-radius:var(--radius-xs);height:28px;padding:0 9px;font:500 12.5px var(--font-sans);cursor:pointer}
.segbtn:hover{color:var(--ink-1)}
.segbtn.on{background:var(--surface);color:var(--ink-1);box-shadow:var(--shadow-xs)}
.segx{font-weight:600}
.colbtn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:var(--radius-sm);height:32px;padding:0 11px;font:500 12.5px var(--font-sans);cursor:pointer}
.colbtn:hover{border-color:var(--line-2);color:var(--ink-1)}
.colbtn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.colbtn.primary:hover{background:var(--accent-hover)}
.colbtn:disabled{opacity:.5;cursor:default}

.menuwrap{position:relative;display:inline-flex}
.menu{position:absolute;top:calc(100% + 6px);right:0;z-index:81;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-md);padding:5px;min-width:184px}
.menu--left{right:auto;left:0}
.menu__h{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3);padding:5px 8px}
.menu__item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:transparent;color:var(--ink-1);padding:7px 9px;border-radius:7px;cursor:pointer;font-size:13px}
.menu__item:hover{background:var(--surface-2)}
.menu__item.on{color:var(--accent)}
.menu__item .menu__ck{margin-left:auto;color:var(--accent)}
.pane{flex:1;overflow-y:auto}
.pane__body{padding:16px}
.pane-list{max-width:820px;margin:0 auto;width:100%}
.is-split .pane-list,.split-left .pane-list{max-width:none;margin:0}

/* ── List section + issue row ──────────────────────────────────── */
.listsec{margin-bottom:20px}
.listsec__h{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2);margin:0 4px 8px}
.listsec__h .n{color:var(--ink-3);font-weight:500;margin-left:auto}
.listsec__sub{color:var(--ink-3);font-weight:400;text-transform:none;letter-spacing:0}
.listsec__h .ic{display:inline-flex}
.rows{display:flex;flex-direction:column;gap:6px}

.irow{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:11px 14px;cursor:pointer;transition:border-color var(--dur-fast) var(--ease),box-shadow var(--dur-fast) var(--ease)}
.irow:hover{border-color:var(--line-2);box-shadow:var(--shadow-sm)}
.irow.sel{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-weak)}
.irow.live{border-left:3px solid var(--accent)}
.irow.prow-child{margin-left:22px}
.irow__head{display:flex;align-items:center;gap:8px}
.irow__crumbs{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--ink-3);min-width:0;white-space:nowrap;overflow:hidden}
.irow__crumbs .irow__repo{color:var(--ink-2);font-weight:500;display:inline-flex;align-items:center;gap:4px}
.irow__repo-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.irow__epic{display:inline-flex;align-items:center;gap:3px;color:var(--purple)}
.irow__num{font-family:var(--font-mono);color:var(--ink-3)}
.irow__headr{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 0 auto}
.irow__body{display:flex;align-items:flex-start;gap:10px;margin-top:9px}
.irow__fig{width:34px;height:46px;flex:0 0 auto;display:flex;align-items:flex-end;justify-content:center}
.irow__fig img{height:100%;width:auto;object-fit:contain;display:block}
.irow__exp{border:none;background:transparent;color:var(--ink-3);cursor:pointer;display:inline-flex;padding:2px;border-radius:5px}
.irow__exp:hover{background:var(--surface-2);color:var(--ink-1)}
.irow__exp.open{transform:rotate(90deg)}
.irow__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.irow__title{font-size:14px;font-weight:500;color:var(--ink-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.irow__excerpt{font-size:13px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.irow__act-role{color:var(--ink-3);font-weight:500;text-transform:capitalize}
.irow__time{font-size:12px;color:var(--ink-3)}
.irow__actions{display:none;align-items:center;gap:6px}
.irow:hover .irow__actions{display:flex}
.irow:hover .irow__time{display:none}
.irow__foot{display:flex;align-items:center;gap:10px;margin-top:10px}
.irow__cost{display:flex;align-items:center;gap:8px;min-width:0}
.irow__pr{display:inline-flex;align-items:center;gap:3px;font-family:var(--font-mono);font-size:11.5px;color:var(--accent)}
.irow__elapsed{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--ink-3);flex:0 0 auto}
.irow__flow{max-height:0;overflow:hidden;opacity:0;margin-top:0;padding-left:30px;padding-top:0;transition:max-height var(--dur) var(--ease),opacity var(--dur) var(--ease),margin var(--dur) var(--ease)}
.irow:hover .irow__flow{max-height:58px;opacity:1;margin-top:8px;padding-top:9px}
.irow__byagent{display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--purple);background:var(--purple-weak);border-radius:var(--radius-pill);padding:1px 7px}
.irow__lock{display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--amber)}
/* ── Shared: bare head, heat bar, workflow timeline ────────────── */
.barehead{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;line-height:0}
.barehead img{width:100%;height:100%;object-fit:contain}
.heat{display:inline-flex;align-items:center;gap:6px}
.heat__track{width:44px;height:5px;border-radius:var(--radius-pill);background:var(--surface-3);overflow:hidden}
.heat__fill{display:block;height:100%;border-radius:var(--radius-pill)}
.heat__lbl{font-family:var(--font-mono);font-size:11.5px;font-variant-numeric:tabular-nums}

.flow{display:flex;align-items:flex-start}
.flow__step{display:flex;flex-direction:column;align-items:center;gap:3px;position:relative}
.flow__dot{width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:var(--surface-3);color:#fff;border:1.5px solid var(--line-2)}
.flow__step.done .flow__dot{background:var(--green);border-color:var(--green)}
.flow__step.current .flow__dot{background:var(--accent);border-color:var(--accent)}
.flow__step.blocked .flow__dot,.flow__step.attention .flow__dot{background:var(--amber);border-color:var(--amber)}
.flow__step.pending .flow__dot{background:var(--surface);border-color:var(--line-2)}
.flow__dot.pulse{animation:flowpulse 1.4s infinite}
@keyframes flowpulse{0%{box-shadow:0 0 0 0 rgba(47,109,246,.5)}70%{box-shadow:0 0 0 6px rgba(47,109,246,0)}100%{box-shadow:0 0 0 0 rgba(47,109,246,0)}}
.flow__lbl{font-size:10px;color:var(--ink-3);white-space:nowrap}
.flow__step.current .flow__lbl{color:var(--accent);font-weight:600}
.flow__step.done .flow__lbl{color:var(--ink-2)}
.flow__line{height:2px;flex:1;min-width:20px;background:var(--line-2);margin:7px 2px 0}
.flow__line.on{background:var(--green)}
.flow__loop{position:absolute;top:-8px;right:-8px;font-size:9px;font-weight:700;color:var(--amber);background:var(--amber-weak);border-radius:var(--radius-pill);padding:0 4px;line-height:1.6}
.flow--compact .flow__dot{width:12px;height:12px;border-width:1.5px}
.flow--compact .flow__line{min-width:14px;margin-top:5px}
.flow__dot--face{position:relative;width:26px;height:26px;margin-top:-5px;background:transparent;border:none;overflow:visible;padding:0}
.flow__step.current .flow__dot--face{background:transparent;border-color:transparent}
.flow__face{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center;display:block}
.flow__face .avi{width:100%!important;height:100%!important}
.flow__face .avi img{object-fit:contain}
.flow--compact .flow__dot--face{width:20px;height:20px;margin-top:-4px}
.tl-idle,.tl-epic-lbl{font-size:12px;color:var(--ink-3)}
.tl-epic{display:flex;flex-direction:column;gap:4px;width:100%;max-width:200px}
.tl-epic-track{height:6px;border-radius:var(--radius-pill);background:var(--surface-3);overflow:hidden}
.tl-epic-fill{height:100%;background:var(--purple);border-radius:var(--radius-pill)}
.tl-epic-lbl{display:inline-flex;align-items:center;gap:5px}

/* ── Board ─────────────────────────────────────────────────────── */
.board{padding:16px;overflow-y:auto;flex:1}
.board-cols,.board-bands{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-items:start}
.bcol__h,.colhead,.band-head{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-2);padding:4px 6px 10px}
.bcol__h .n,.colhead .n,.band-head .n{color:var(--ink-3);margin-left:auto;font-weight:500}
.bcol__cards,.cards,.band-cards{display:flex;flex-direction:column;gap:8px}
.bcard,.card{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-xs);padding:11px 12px;cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:border-color var(--dur-fast) var(--ease),box-shadow var(--dur-fast) var(--ease)}
.bcard:hover,.card:hover{border-color:var(--line-2);box-shadow:var(--shadow-sm)}
.bcard.sel,.card.sel{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-weak)}
.bcard.live,.card.live{border-left:3px solid var(--accent)}
.bcard__h,.card-h{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--ink-3)}
.bcard__title,.card-title{font-size:13.5px;font-weight:500;line-height:1.35;color:var(--ink-1);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-num,.card-repo{font-family:var(--font-mono);color:var(--ink-3);font-size:11px}
.card-excerpt{font-size:12px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.bcard__flow{max-height:0;overflow:hidden;opacity:0;padding-top:0;transition:max-height var(--dur) var(--ease),opacity var(--dur) var(--ease)}
.bcard:hover .bcard__flow{max-height:30px;opacity:1;padding-top:9px}
.bcard__f,.card-f{display:flex;align-items:center;gap:8px;border-top:1px solid var(--line);padding-top:8px}
.card-f-l{display:flex;align-items:center;gap:8px}
.card-f-r{margin-left:auto;display:flex;align-items:center;gap:8px}
.bcard__crumbs{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--ink-3)}
.bcard__crumbs .card-repo{color:var(--ink-2);font-weight:500}
.wfchip{display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--purple);background:var(--purple-weak);border-radius:var(--radius-pill);padding:1px 7px;white-space:nowrap}
.bcard__actions{position:absolute;right:10px;bottom:10px;display:flex;align-items:center;gap:6px;opacity:0;transform:translateY(2px);pointer-events:none;background:var(--surface);box-shadow:-12px 0 12px 4px var(--surface);transition:opacity var(--dur-fast) var(--ease),transform var(--dur-fast) var(--ease)}
.bcard:hover .bcard__actions{opacity:1;transform:none;pointer-events:auto}
@media(max-width:880px){.board-cols,.board-bands{grid-template-columns:1fr 1fr}}

/* ── Tab bar (mobile board) ───────────────────────────────────── */
.tabbar{flex:none;display:flex;border-top:1px solid var(--line);background:var(--surface);padding-bottom:var(--safe-b)}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;border:none;background:transparent;color:var(--ink-3);padding:8px 4px;font-size:11px;cursor:pointer}
.tab.on{color:var(--accent)}

/* ── Row hover action menu (list) ─────────────────────────────── */
.rowmenu{position:fixed;z-index:81;display:flex;gap:2px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-sm);box-shadow:var(--shadow-md);padding:3px}
.rowmenu-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;background:transparent;color:var(--ink-2);border-radius:var(--radius-xs);cursor:pointer}
.rowmenu-btn:hover{background:var(--surface-2);color:var(--ink-1)}
.rowmenu-btn.primary{color:var(--accent)}
.rowmenu-btn.danger{color:var(--red)}

/* ── Detail drawer ─────────────────────────────────────────────── */
.detail{position:fixed;top:0;right:0;bottom:0;left:auto;z-index:50;background:var(--bg);display:flex;flex-direction:column;width:min(900px,100vw);box-shadow:var(--shadow-lg);border-left:1px solid var(--line)}
.split-right .detail{position:static;inset:auto;z-index:auto;flex:1;width:auto;box-shadow:none;border-left:none}
.dscrim{position:fixed;inset:0;z-index:49;background:rgba(8,10,14,.5)}
.dhead,.dh{flex:none;display:flex;align-items:flex-start;gap:10px;padding:14px 16px;background:var(--surface);border-bottom:1px solid var(--line)}
.dh__t{flex:1;min-width:0}
.dh__title,.dtitle{font-size:15px;font-weight:600;line-height:1.35}
.dh__meta,.dmeta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-3);margin-top:4px;flex-wrap:wrap}
.dh__num{font-family:var(--font-mono)}
.dclose{margin-left:auto}
.dtoolbar{flex:none;display:flex;align-items:center;gap:6px;padding:9px 16px;background:var(--surface);border-bottom:1px solid var(--line);flex-wrap:wrap}
.dstatus{flex:none;display:flex;flex-direction:column;gap:10px;padding:12px 16px 0}
.dstatus:empty{display:none}
.dflow{padding:2px 0 4px}
.dtabs{flex:none;display:flex;gap:2px;padding:10px 16px 0;border-bottom:1px solid var(--line);background:var(--surface)}
.dtabs button,.tbtn{display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--ink-2);font:500 13px var(--font-sans);padding:8px 12px;border-bottom:2px solid transparent;cursor:pointer;margin-bottom:-1px}
.dtabs button.on,.tbtn.on{color:var(--ink-1);border-bottom-color:var(--accent)}
.dtabs button:disabled{color:var(--ink-3);cursor:default}
.dbody{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.dpanes{flex:1;min-height:0;display:flex;flex-direction:row;overflow:hidden}
.dpane{flex:1;min-width:0;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.dpane.chat{flex:1 1 auto}
.dpane.side{flex:0 0 44%;max-width:520px;border-left:1px solid var(--line);background:var(--surface)}
.epicbox{border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px;background:var(--surface)}
.epicbox-h,.epicbox__h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.epicrow,.epicck{display:flex;align-items:center;gap:8px;padding:5px 2px;font-size:13px;cursor:pointer;border-radius:var(--radius-xs)}
.epicrow:hover{background:var(--surface-2)}
.epicnum{font-family:var(--font-mono);color:var(--ink-3)}
.epictitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.prbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--green);background:var(--green-weak);border-radius:var(--radius);padding:10px 13px}
.prbar-l,.prbar__l{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:13.5px;color:var(--green);margin-right:auto}
.att,.attnbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--amber);background:var(--amber-weak);border-radius:var(--radius);padding:10px 13px}
.attnbar__l{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:13.5px;color:var(--amber);margin-right:auto}
.conflictbox{border:1px solid var(--red);background:var(--red-weak);border-radius:var(--radius);padding:10px 13px;display:flex;flex-direction:column;gap:8px}
.conflictbox-h{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:13.5px;color:var(--red)}

.cmt{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:10px 12px}
.cmt.ag{background:var(--surface-2)}
.cmt.human{border-left:3px solid var(--accent)}
.cmt-h,.cmt__h{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink-2);margin-bottom:5px}
.cmt-role,.cmt__role{font-weight:600;color:var(--ink-1)}
.cmt__at{margin-left:auto;color:var(--ink-3)}
.cmt-in,.cmt__b{font-size:13.5px;color:var(--ink-1)}
.cmt-in p,.cmt__b p{margin:.3em 0}
.cmt-in p:first-child,.cmt__b p:first-child{margin-top:0}
.cmt-in ol,.cmt-in ul,.cmt__b ol,.cmt__b ul{margin:.35em 0;padding-left:1.4em}
.cmt-in code,.cmt__b code{font-family:var(--font-mono);font-size:.88em;background:var(--bg);padding:1px 5px;border-radius:5px}

.dstream,.stream{background:var(--term-bg);color:var(--term-ink);border-radius:var(--radius);padding:11px 13px;font:12px/1.55 var(--font-mono);white-space:pre-wrap;word-break:break-word;display:flex;flex-direction:column;gap:2px}
.stream__h{color:var(--term-muted);margin-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.dstream .tool,.stream .tool{color:var(--term-accent)}
.dstream .muted,.stream .muted{color:var(--term-muted)}

.dusage{display:flex;align-items:center;gap:14px;padding:9px 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-2);font-size:12.5px;color:var(--ink-2);flex-wrap:wrap}
.dusage span{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}

.dcompose{flex:none;padding:12px 16px;border-top:1px solid var(--line);background:var(--bg)}
.composer{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:10px 12px;display:flex;flex-direction:column;gap:8px;transition:border-color var(--dur-fast) var(--ease),box-shadow var(--dur-fast) var(--ease)}
.composer:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--focus-ring)}
.composer textarea{border:none;background:transparent;resize:none;outline:none;width:100%;font:14px/1.5 var(--font-sans);color:var(--ink-1);min-height:22px}
.composer textarea::placeholder{color:var(--ink-3)}
.composer-row,.composer__row{display:flex;align-items:center;gap:8px}
.composer-icon,.composer__icon{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;background:transparent;color:var(--ink-3);border-radius:8px;cursor:pointer}
.composer-icon:hover,.composer__icon:hover{background:var(--surface-2);color:var(--ink-2)}
.composer-atts{display:flex;flex-wrap:wrap;gap:6px}

/* ── Status line ───────────────────────────────────────────────── */
.statusline{flex:none;display:flex;align-items:center;gap:12px;padding:6px 16px calc(6px + var(--safe-b));border-top:1px solid var(--line);background:var(--surface);font-size:11.5px;color:var(--ink-3)}
.statusline .live{display:inline-flex;align-items:center;gap:5px;color:var(--green)}
.statusline .dot{width:7px;height:7px;border-radius:50%;background:var(--green)}
.buildstamp{font-family:var(--font-mono);margin-left:auto}

/* ── Global tooltip ────────────────────────────────────────────── */
.gtip{position:fixed;z-index:301;transform:translate(-50%,-100%);background:var(--ink-1);color:var(--surface);font-size:11.5px;font-weight:500;padding:4px 8px;border-radius:6px;pointer-events:none;white-space:nowrap;box-shadow:var(--shadow-md)}
html[data-theme="dark"] .gtip{background:#000;color:#fff}
.tip{cursor:default}

/* ── Secondary components ── */
.topbar{position:sticky;top:0;z-index:30;background:var(--surface);border-bottom:1px solid var(--line);padding:calc(8px + var(--safe-t)) 14px 8px;display:flex;align-items:center;gap:10px}
.brand{font-size:16px;font-weight:600;display:flex;align-items:center;gap:7px}
.brand .lic{color:var(--accent)}
@media(max-width:560px){.brandname{display:none}.repodrop-btn{max-width:52vw}}
.sub{color:var(--ink-2);font-size:12px}
.envbadge{font-size:10px;font-weight:600;letter-spacing:.05em;background:var(--amber-weak);color:var(--amber);border:1px solid var(--amber);border-radius:6px;padding:1px 6px;vertical-align:2px}
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
/* secret-health banner (MASTER_KEY mismatch / undecryptable token) */
.secbanner{margin:10px 12px 0;padding:10px 13px;border-radius:10px;border:1px solid var(--red);background:var(--red-weak);color:var(--red);font-size:13px;line-height:1.45}
.secbanner b{font-weight:680}
.gauge{display:inline-block;width:60px;height:6px;border-radius:3px;background:var(--line);overflow:hidden;vertical-align:middle}
.gauge i{display:block;height:100%}
/* board controls toolbar */
.bctrl{display:flex;align-items:center;gap:8px;padding:10px 14px 4px;flex-wrap:wrap}
/* board */
.board{padding:8px}
.col{margin-bottom:14px}
.planned-actions{display:flex;gap:8px;padding:2px 8px 8px}
.planned-actions .colbtn{flex:1;justify-content:center}
.statusdot{flex:0 0 auto;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff}
/* instant custom tooltip — pops the moment you hover, no delay */
.tip{position:relative}
/* tooltip text is rendered by the global fixed .gtip (never clipped); .tip just marks an anchor */
.iconbtn-sm{flex:0 0 auto;width:28px;height:28px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
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
.tagk{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--ink-3);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.modelrow{display:flex;align-items:center;gap:8px;padding:8px 2px;border-bottom:1px solid var(--line)}
.modelrow-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px}
.testres{font-size:12px;margin:6px 2px 0;line-height:1.4}
.testres.ok{color:var(--green)}
.testres.bad{color:var(--red)}
/* mobile bottom column tabs */
.tabbar{position:sticky;bottom:0;z-index:25;display:grid;grid-template-columns:repeat(4,1fr);background:var(--surface);border-top:1px solid var(--line);padding-bottom:var(--safe-b)}
/* buttons + forms */
.btn{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:9px 13px;font-size:14px;font-weight:540;cursor:pointer;display:inline-flex;align-items:center;gap:6px;justify-content:center}
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
/* detail */
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
.tbtn{flex:0 0 auto;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:9px;width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;gap:0;cursor:pointer;position:relative}
.tbtn:has(.tlabel){width:auto;padding:0 13px;gap:7px}
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
.sec{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-3);margin:0 2px 9px}
.setgrp{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:13px 14px;margin-bottom:12px}
.setgrp .sec{margin-top:0}
.scroll-fab-wrap{position:sticky;bottom:8px;display:flex;justify-content:center;pointer-events:none;margin-top:4px}
.scroll-fab-wrap.top{bottom:auto;top:8px;margin-top:0;margin-bottom:4px}
.scroll-fab{pointer-events:auto;background:var(--surface)!important;border:1px solid var(--line)!important;box-shadow:var(--shadow);border-radius:50%!important;width:32px!important;height:32px!important;display:flex;align-items:center;justify-content:center}
/* MarkdownArea: rendered-markdown overlay behind a transparent-text textarea (live inline preview). */
.mdarea{position:relative}
.mdarea-preview{position:absolute;inset:0;z-index:0;pointer-events:none;color:var(--ink);font:inherit;font-family:inherit;font-size:14.5px;line-height:1.5;letter-spacing:normal;white-space:pre-wrap;word-break:break-word;overflow:hidden;padding:0;margin:0;border:0}
.mdarea-preview>div{min-height:1.5em}
.mdarea-preview .mde{visibility:hidden}
.mdarea-preview .mdh{font-weight:700;color:var(--accent)}
.mdarea-preview .mdh2{opacity:.92}
.mdarea-preview .mdh3{opacity:.84}
.mdarea-preview .mdh4{opacity:.76}
.mdarea-preview .mdh5{opacity:.68}
.mdarea-preview .mdh6{opacity:.6}
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
.autorow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.apill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:999px;padding:5px 11px;font-size:13px;cursor:pointer}
.apill.on{background:var(--green-weak);border-color:var(--green);color:var(--green)}
.apill.off{color:var(--ink-3)}
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
  .sheet.bottom{left:50%;top:50%;right:auto;bottom:auto;width:min(620px,92vw);max-height:88dvh;border-radius:16px;border:1px solid var(--line);transform:translate(-50%,-50%) scale(.97);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s ease}
  .sheet.bottom.on{transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:auto}
}
@media(max-width:879px){
  .detail{left:0;right:0;width:100vw;box-shadow:none}
  .dpanes{flex-direction:column;overflow-y:auto}
  .dpane{padding:12px 14px;overflow:visible}
  .dpane.side{flex:1;max-width:none;border-left:none;border-top:1px solid var(--line)}
  .board-cols,.board-bands,.board.group-repo{grid-template-columns:1fr 1fr}
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
.onboard{position:fixed;inset:0;z-index:60;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch}
.ob{max-width:580px;margin:0 auto;width:100%;padding:calc(28px + var(--safe-t)) 20px calc(28px + var(--safe-b))}
.obdots{display:flex;gap:6px;justify-content:center;margin-bottom:22px}
.obdot{width:7px;height:7px;border-radius:50%;background:var(--line)}
.obdot.on{background:var(--accent)}
.obdot.done{background:var(--green)}
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
.obchip.on{border-color:var(--accent);background:var(--accent-weak);color:var(--accent)}
.obchip.on .lic{color:var(--accent)}
.obchip small{display:block;font-weight:400;color:var(--ink-2);font-size:12px;margin-top:1px}
.obchip .ck{margin-left:auto;color:var(--accent)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
/* ── v4 view switcher ── */
.viewseg{display:inline-flex;gap:2px;background:var(--surface-2);border:1px solid var(--line);border-radius:11px;padding:3px}
'
/* ── master-detail + chat split workspace ── */
.content.is-split{overflow:hidden;display:flex;flex-direction:column;padding:0}
.chat-split .split-left{flex:none;width:min(460px,40vw);min-width:340px;overflow:hidden;border-right:1px solid var(--line);border-left:none}
.chat-split .split-right{flex:1;overflow-y:auto;overflow-x:hidden}
.chat-split .orch{height:100%;max-width:none;border:none;border-radius:0;overflow:hidden}
/* ── table: new columns, header icons, category dot, greying, open row ── */
.ptable th.pt-c,.ptable th.pt-h-tl{white-space:nowrap}
/* greyed-out done/merged rows — whole row mutes (Figma: inactive rows) */
.prow-done .pt-title,.prow-done .pt-c-repo,.prow-done .pt-c-num,.prow-done .pt-c-pr a{color:var(--ink-3)}
/* compact (detail docked beside): drop the wide columns so the list stays usable */
.ptable-compact .pt-c-repo,.ptable-compact th.pt-c-repo,.ptable-compact .pt-c-pr,.ptable-compact th.pt-c-pr,.ptable-compact .pt-timeline,.ptable-compact th.pt-h-tl{display:none}
/* ── table row polish (Figma table) ── */
.prow>td{vertical-align:middle}
/* ── sticky, nicer header (Figma) ── */
.ptable thead th{position:sticky;top:0;z-index:3;background:var(--surface);box-shadow:inset 0 -1px 0 var(--line);padding:9px 12px}
/* ── overview stat strip (data-driven "what needs me?") ── */
.pt-overview{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
@media(max-width:760px){.pt-overview-top{display:none}}
@media(max-width:760px){.pt-stat{min-width:0;flex:1 1 28%;padding:9px 10px}.pt-stat-n{font-size:21px}.pt-stat-spend{flex-basis:100%;margin-left:0}}
/* ── v4 rich progress table ── */
.ptable-wrap{padding:0 0 22px;max-width:100%;overflow:visible}
/* timeline */
.tl{display:flex;align-items:center}
@keyframes tlpulse{0%,100%{box-shadow:0 0 0 0 var(--accent-weak)}50%{box-shadow:0 0 0 4px var(--accent-weak)}}
/* status field */
.pt-status{white-space:nowrap}
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
.obub-txt p{margin:0 0 8px}
.obub-txt p:last-child{margin:0}
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
@media(max-width:760px){.orch{height:calc(100vh - 190px);border-radius:0;border-left:none;border-right:none}.obub-body{max-width:92%}}
/* ── FINAL table look (v1.7.6) ── */
.prow:hover>td{background:var(--row-hover)}
/* sticky regions: page chrome + controls + table header stay; ONLY rows scroll */
.content.view-list{overflow:hidden;display:flex;flex-direction:column;padding:0}
.view-list .ptable-wrap{flex:1;min-height:0;display:flex;flex-direction:column;padding:0 16px 0}
.chat-split .split-right{overflow:hidden}
/* docked compact list scrolls sideways instead of hiding columns */
.ptable-compact .pt-c-repo,.ptable-compact th.pt-c-repo,.ptable-compact .pt-c-pr,.ptable-compact th.pt-c-pr,.ptable-compact .pt-timeline,.ptable-compact th.pt-h-tl,.ptable-compact .pt-c-cost,.ptable-compact th.pt-c-cost,.ptable-compact .pt-c-est,.ptable-compact th.pt-c-est,.ptable-compact .pt-c-when,.ptable-compact th.pt-c-when{display:table-cell}
/* ── floating row action menu (cursor-anchored) ── */
.rowmenu{position:fixed;z-index:70;display:inline-flex;align-items:center;gap:2px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow-md);padding:4px}
.rowmenu-btn{flex:0 0 auto;border:none;background:transparent;color:var(--ink-2);border-radius:7px;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.rowmenu-btn:hover{background:var(--surface-2);color:var(--ink)}
.rowmenu-btn.primary{background:var(--accent-weak);color:var(--accent)}
.rowmenu-btn.primary:hover{background:var(--accent);color:#fff}
.rowmenu-btn.danger{color:var(--red)}
.rowmenu-btn.danger:hover{background:var(--red-weak);color:var(--red)}

/* ── Board card details (design-system aligned) ───────────────── */
.statusdot{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex:0 0 auto}
.card-hicons{margin-left:auto;display:inline-flex;align-items:center;gap:6px}
.card-hicon{display:inline-flex;color:var(--ink-3)}
.card-byagent{display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--purple);background:var(--purple-weak);border-radius:var(--radius-pill);padding:1px 7px}
.card-del{border:none;background:transparent;color:var(--ink-3);cursor:pointer;display:inline-flex;padding:2px;border-radius:5px}
.card-del:hover{background:var(--red-weak);color:var(--red)}
.card-m,.card-meta{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ink-3);flex-wrap:wrap}
.card-time{font-size:11px;color:var(--ink-3)}
.card-pr{display:inline-flex;align-items:center;gap:3px;font-family:var(--font-mono);font-size:11px;color:var(--accent)}
.role{font-size:11px;color:var(--ink-2);text-transform:capitalize;display:inline-flex;align-items:center;gap:4px}
.cardbtn,.cta{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid var(--line);background:var(--surface);color:var(--ink-1);border-radius:var(--radius-xs);height:30px;padding:0 11px;font:500 12.5px var(--font-sans);cursor:pointer}
.cardbtn:hover,.cta:hover{border-color:var(--line-2);background:var(--surface-2)}
.cardbtn.play,.cta.play{background:var(--accent);border-color:var(--accent);color:#fff}
.cardbtn.play:hover,.cta.play:hover{background:var(--accent-hover)}
.cardbtn.stop,.cta.stop{background:var(--surface);border-color:var(--red-weak);color:var(--red)}
.cardbtn.stop:hover,.cta.stop:hover{background:var(--red-weak);border-color:var(--red)}
.cardbtn.fix,.cta.fix{background:var(--amber);border-color:var(--amber);color:#fff}
.cardbtn.busy,.card.busy{opacity:.7;pointer-events:none}
.planned-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.chev{transition:transform var(--dur-fast) var(--ease);display:inline-flex}
.chev.open{transform:rotate(90deg)}

/* sub-issue list on epic cards */
.card-subs{display:flex;flex-direction:column;gap:2px;margin-top:4px;border-top:1px solid var(--line);padding-top:8px}
.subtoggle{display:inline-flex;align-items:center;gap:5px;border:none;background:transparent;color:var(--ink-2);font:500 12px var(--font-sans);cursor:pointer;padding:2px 0}
.sublist{display:flex;flex-direction:column;gap:1px}
.subrow{display:flex;align-items:center;gap:7px;padding:4px 4px;border-radius:var(--radius-xs);cursor:pointer;font-size:12.5px}
.subrow:hover{background:var(--surface-2)}
.subdot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.subnum{font-family:var(--font-mono);color:var(--ink-3);font-size:11px}
.subttl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.substate{font-size:10.5px;color:var(--ink-3)}

/* board column band variant */
.band{display:flex;flex-direction:column;gap:8px}

/* setup progress bar */
.setupbar{display:flex;flex-direction:column;gap:4px;margin:8px 0}
.setupbar-track{height:6px;border-radius:var(--radius-pill);background:var(--surface-3);overflow:hidden}
.setupbar-fill{height:100%;background:var(--green);border-radius:var(--radius-pill)}
.setupbar-lbl{font-size:11.5px;color:var(--ink-3)}


/* ── Misc: split wrappers, edit rows, conflict/epic detail, orch pstat ── */
.list-split,.chat-split{flex:1;display:flex;min-height:0;overflow:hidden}
.segwrap{display:inline-flex;align-items:center;gap:6px}
.segctl{display:inline-flex;background:var(--surface-2);border-radius:var(--radius-sm);padding:3px;gap:2px}
.cmt-edit-row{display:flex;align-items:center;gap:6px;margin-top:6px}
.cmt-edit-ta{width:100%;min-height:64px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--surface);color:var(--ink-1);padding:8px 10px;font:14px/1.5 var(--font-sans);resize:vertical}
.cmt-edit-ta:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--focus-ring);outline:none}
.cmt-edit-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:var(--radius-xs);height:28px;padding:0 9px;font:500 12.5px var(--font-sans);cursor:pointer}
.cmt-edit-btn:hover{border-color:var(--line-2);color:var(--ink-1)}
.conflictbox-b{font-size:13px;color:var(--ink-1)}
.conflictbox-files{display:flex;flex-direction:column;gap:3px;font-family:var(--font-mono);font-size:12px;color:var(--red)}
.epiclist{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.epicalldone{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--green);font-weight:500}
/* orchestrator inline status pill */
.pstat{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;border-radius:var(--radius-pill);padding:2px 9px;background:var(--surface-2);color:var(--ink-2)}
.pstat-running,.pstat-working{background:var(--accent-weak);color:var(--accent)}
.pstat-attention{background:var(--amber-weak);color:var(--amber)}
.pstat-ready{background:var(--green-weak);color:var(--green)}
.pstat-done{background:var(--surface-2);color:var(--ink-3)}
.pstat-planned{background:var(--surface-2);color:var(--ink-2)}
.pstat-queued{background:var(--surface-2);color:var(--ink-2)}

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
