// Dev Agency dashboard — app module (split from app.js; Preact + htm, no build step).
import { html, render, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Toasts, api, getJSON, md, setToastFn, toast, useIsDesktop } from "./core.js";
import { Board, TabBar } from "./board.js";
import { Composer, Detail } from "./detail.js";
import { GithubTokensModal, ModelsModal, Settings } from "./settings.js";
import { AddRepo, Onboarding } from "./onboarding.js";
import { SecretBanner, StatusLine, TopBar } from "./topbar.js";
import { Usage } from "./usage.js";
import { AgentEditor, SkillEditor } from "./agents.js";


// ---------- offline queue ----------
// Persists pending issues + comments in localStorage so they survive a page refresh.
const OQ_KEY = "dab_offline_q";
function oqLoad() { try { return JSON.parse(localStorage.getItem(OQ_KEY) || "[]"); } catch (e) { return []; } }
function oqSave(q) { try { localStorage.setItem(OQ_KEY, JSON.stringify(q)); } catch (e) {} }

// Track browser online/offline state reactively via the standard events.
function useOnline() {
  const [on, setOn] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const go = () => setOn(true), goff = () => setOn(false);
    window.addEventListener("online", go); window.addEventListener("offline", goff);
    return () => { window.removeEventListener("online", go); window.removeEventListener("offline", goff); };
  }, []);
  return on;
}

// ---------- App ----------
function App() {
  const isDesktop = useIsDesktop();
  const [data, setData] = useState({ issues: [], repos: [], active: [], activity: [], session: {}, config: {}, auto: {}, autoRepos: {} });
  const [repoFilter, setRepoFilter] = useState(null);
  const [tab, setTab] = useState("planned");
  const [openKey, setOpenKey] = useState(null); // "repo#number"
  const [sheet, setSheet] = useState(null); // "composer" | "settings"
  const [composerRepo, setComposerRepo] = useState(null);
  const [theme, setTheme] = useState(document.documentElement.getAttribute("data-theme") || "light");
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const [pending, setPending] = useState([]); // optimistic new issues
  const [detailError, setDetailError] = useState(null); // inline error for the open detail
  const overridesRef = useRef({}); // "repo#n" -> {state, t}
  const busyRef = useRef({}); // "action:repo#n" -> ts, while a request is in flight
  const openIssueRef = useRef(null); // last-known open issue, so polls don't flicker the detail closed
  const liveRef = useRef([]); // SSE-appended activity since last poll
  const [, forceTick] = useState(0);
  const isOnline = useOnline();
  const [offlineQ, setOfflineQ] = useState(oqLoad);
  const [syncing, setSyncing] = useState(false);
  const flushingRef = useRef(false);

  useEffect(() => {
    setToastFn((t, kind) => {
      const id = ++toastIdRef.current;
      setToasts((ts) => ts.concat({ id, msg: t, kind: kind || "info" }));
      if ((kind || "info") !== "error") setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2000);
    });
  }, []);

  function load() {
    getJSON("/data").then((d) => {
      liveRef.current = [];
      // prune stale optimistic overrides (server has caught up after ~10s)
      const ov = overridesRef.current, now = Date.now();
      Object.keys(ov).forEach((k) => { if (now - ov[k].t > 10000) delete ov[k]; });
      setData(d);
      // drop optimistic pendings that now exist on the server
      setPending((ps) => ps.filter((p) => !(d.issues || []).some((i) => i.repo === p.repo && (i.number === p.number || (i.title || "") === p.title))));
    }).catch(() => {});
  }
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let es; try { es = new EventSource("/events"); es.onmessage = (ev) => { try { const a = JSON.parse(ev.data); liveRef.current = liveRef.current.concat(a).slice(-200);
      // Surface run failures the user would otherwise only see on GitHub: an agent error is pushed
      // as a "done" line starting with ❌ (e.g. a misconfigured model or a real rate-limit).
      (Array.isArray(a) ? a : [a]).forEach((x) => { if (x && (x.kind === "error" || (x.kind === "done" && typeof x.text === "string" && x.text.trim().startsWith("❌")))) toast(String(x.text || "Run failed").replace(/^❌\s*/, ""), "error"); });
      forceTick((x) => x + 1); } catch (e) {} }; } catch (e) {}
    return () => { try { es && es.close(); } catch (e) {} };
  }, []);

  // Push an item onto the offline queue (issues or comments).
  function oqPush(item) {
    const q = oqLoad().concat(Object.assign({}, item, { _qid: Date.now() + Math.random() }));
    oqSave(q); setOfflineQ(q);
  }

  // Flush the offline queue as soon as we (re)connect. Processes items in order; stops on first failure.
  useEffect(() => {
    if (!isOnline || flushingRef.current) return;
    const q = oqLoad();
    if (!q.length) return;
    flushingRef.current = true;
    setSyncing(true);
    (async () => {
      for (const item of q) {
        try {
          if (item.type === "issue") {
            const d = await api("/new-issue", { repo: item.repo, role: item.role, title: item.title, body: item.body || "", start: !!item.start, ...(item.model ? { model: item.model } : {}) });
            if (d && d.number && item.tmpNum) setPending((ps) => ps.map((p) => p.number === item.tmpNum ? Object.assign({}, p, { number: d.number, _offline: false }) : p));
          } else if (item.type === "comment") {
            await api("/comment", { repo: item.repo, number: item.number, body: item.body, ...(item.model ? { model: item.model } : {}) });
          }
          const remaining = oqLoad().filter((x) => x._qid !== item._qid);
          oqSave(remaining); setOfflineQ(remaining);
        } catch (e) { break; }
      }
    })().finally(() => { flushingRef.current = false; setSyncing(false); setTimeout(load, 600); });
  }, [isOnline]);

  function setThemeP(t) { setTheme(t); try { localStorage.setItem("theme", t); } catch (e) {} document.documentElement.setAttribute("data-theme", t); const m = document.getElementById("metatheme"); if (m) m.setAttribute("content", t === "dark" ? "#0e1014" : "#f5f6f8"); }

  // merge server issues with optimistic overrides + pendings
  const repos = data.repos || [];
  const ov = overridesRef.current;
  let issues = (data.issues || []).map((i) => { const o = ov[i.repo + "#" + i.number]; return o ? Object.assign({}, i, o.patch) : i; });
  issues = issues.concat(pending.filter((p) => !issues.some((i) => i.repo === p.repo && i.number === p.number)));
  // Wire active/queued per issue: active = agent genuinely running now; queued = in-progress state but no live run.
  const activeSet = new Set((data.active || []).map((a) => a.repo + "#" + a.number));
  issues = issues.map((i) => {
    const key = i.repo + "#" + i.number;
    const isActive = i.running || activeSet.has(key);
    if (isActive) return Object.assign({}, i, { active: true });
    if ((i.state || "") === "working") return Object.assign({}, i, { queued: true });
    return i;
  });
  // Repos with a running audit — drives the spinner on the top-bar Audit dropdown. (The audit itself
  // is now a real GitHub tracking issue, so it shows as a normal card + detail.)
  const auditRepos = (data.active || []).filter((a) => a.role === "auditor").map((a) => a.repo);
  const shown = issues.filter((i) => !repoFilter || i.repo === repoFilter);
  const activity = (data.activity || []).concat(liveRef.current);

  function override(repo, number, patch) { ov[repo + "#" + number] = { patch, t: Date.now() }; forceTick((x) => x + 1); }

  // In-flight tracking: while an action waits on the server/GitHub, its button shows a spinner,
  // is disabled, and repeat clicks are ignored — no more "did that register?" multi-clicking.
  const bkey = (action, repo, number) => action + ":" + repo + "#" + number;
  function setBusy(k, on) { if (on) busyRef.current[k] = Date.now(); else delete busyRef.current[k]; forceTick((x) => x + 1); }
  function guard(action, repo, number, run) {
    const k = bkey(action, repo, number);
    if (busyRef.current[k]) return Promise.resolve(); // already running — ignore the extra click
    setBusy(k, true);
    return Promise.resolve().then(run).finally(() => setBusy(k, false));
  }

  // actions (optimistic + reconcile). Each is guarded: spins + blocks until the server responds.
  const act = {
    isBusy: (action, repo, number) => Boolean(busyRef.current[bkey(action, repo, number)]),
    start(repo, number, model) { return guard("start", repo, number, () => { override(repo, number, { state: "working" }); return api("/start", { repo, number, ...(model ? { model } : {}) }).then(() => toast("Starting" + (model ? ` with model ${model.model}` : "") + "…")).catch(() => { toast("Couldn’t start", "error"); delete ov[repo + "#" + number]; }).then(load); }); },
    approve(repo, number, model) { return guard("approve", repo, number, () => { override(repo, number, { state: "working" }); return api("/approve", { repo, number, ...(model ? { model } : {}) }).then(() => toast("Approved" + (model ? ` with model ${model.model}` : "") + " — building")).catch(() => toast("Couldn’t approve", "error")).then(load); }); },
    resume(repo, number, model) { return guard("resume", repo, number, () => { override(repo, number, { state: "working" }); return api("/resume", { repo, number, ...(model ? { model } : {}) }).then(() => toast("Resuming" + (model ? ` with model ${model.model}` : "") + "…")).catch(() => toast("Couldn’t resume", "error")).then(load); }); },
    stop(repo, number) { return guard("stop", repo, number, () => { override(repo, number, { state: "planned" }); return api("/stop", { repo, number }).then(() => toast("Stopped — moved to Planned")).catch(() => toast("Couldn’t stop", "error")).then(load); }); },
    cancel(repo, number) { return guard("cancel", repo, number, () => { override(repo, number, { state: "planned", active: false }); return api("/cancel", { repo, number }).then(() => toast("Reset to Planned")).catch((e) => toast((e && e.message) || "Couldn’t cancel", "error")).then(load); }); },
    updateIssue(repo, number) { return guard("update", repo, number, () => api("/refresh-issue", { repo, number }).then(() => toast("Updated from GitHub")).catch((e) => toast((e && e.message) || "Couldn’t update", "error")).then(load)); },
    fix(repo, number, model) { return guard("fix", repo, number, () => { override(repo, number, { state: "working", active: true }); return api("/fix", { repo, number, ...(model ? { model } : {}) }).then(() => toast("Fixing the review" + (model ? ` with model ${model.model}` : "") + "…")).catch(() => toast("Couldn’t fix", "error")).then(load); }); },
    merge(repo, number) { return guard("merge", repo, number, () => api("/merge", { repo, number }).then((r) => { toast("Merged"); load(); return r; }).catch(() => toast("Couldn’t merge — conflicts?", "error"))); },
    close(repo, number) { return guard("close", repo, number, () => { override(repo, number, { state: "closed" }); return api("/close", { repo, number }).then(() => { toast("Closed"); setOpenKey(null); }).catch((e) => toast((e && e.message) || "Couldn’t close", "error")).then(load); }); },
    closeNotPlanned(repo, number) { return guard("close-not-planned", repo, number, () => { override(repo, number, { state: "done" }); return api("/close-not-planned", { repo, number }).then(() => { toast("Closed as not planned"); setOpenKey(null); }).catch((e) => toast((e && e.message) || "Couldn’t close", "error")).then(load); }); },
    createPr(repo, number) { return guard("createPr", repo, number, () => { override(repo, number, { state: "review" }); return api("/create-pr", { repo, number }).then((r) => toast(r && r.url ? "PR opened" : "PR opened")).catch((e) => toast((e && e.message) || "Couldn’t open PR", "error")).then(load); }); },
    del(repo, number) { return guard("del", repo, number, () => { override(repo, number, { state: "done" }); return api("/delete", { repo, number }).then(() => { toast("Deleted"); setOpenKey(null); }).catch(() => toast("Couldn’t delete", "error")).then(load); }); },
    runChecks(repo, number, title) { return guard("runChecks", repo, number, () => api("/run-checks", { repo, number, title }).then(() => toast("Running checks…")).catch(() => toast("Couldn’t run checks", "error"))); },

    setAuto(kind, value, repo, number) { return guard("auto-" + kind, repo || "global", number || 0, () => { const b = { kind, value }; if (repo) b.repo = repo; if (number) b.number = number; return api("/auto", b).then(() => { toast("auto-" + kind + ": " + value); }).then(load); }); },
    audit(repo) { return guard("audit", repo, 0, () => api("/audit", { repo }).then(() => toast("Auditing " + repo.split("/").pop() + " — proposed issues will appear in Planned")).catch((e) => toast((e && e.message) || "Couldn’t start the audit", "error"))); },
  };

  function dismissToast(id) { setToasts((ts) => ts.filter((t) => t.id !== id)); }

  function openComposer(repo) { setComposerRepo(repo || repoFilter || (repos[0] || null)); setSheet("composer"); }
  function createIssue(repo, role, title, body, start, atts, model) {
    const tmpNum = -Date.now();
    const tmp = { repo, number: tmpNum, title, role, state: start ? "working" : "planned", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _tmp: true, _offline: !isOnline };
    setPending((ps) => ps.concat(tmp)); setSheet(null);
    if (!isOnline) {
      // Offline: queue the issue (attachments are skipped — network required for uploads)
      toast("Queued offline — will create when back online");
      oqPush({ type: "issue", repo, role, title, body: body || "", start: !!start, model: model || null, tmpNum, tmpRepo: repo });
      return;
    }
    toast(start ? "Creating & starting…" : "Added to Planned");
    if (start) { setOpenKey(repo + "#" + tmpNum); setDetailError(null); }
    Promise.all((atts || []).map((a) => api("/upload-file", { repo, number: 0, dataUrl: a.dataUrl, name: a.name }).then((j) => j && j.md).catch(() => null)))
      .then((mds) => { const full = [body].concat(mds.filter(Boolean)).filter(Boolean).join("\n\n"); return api("/new-issue", { repo, role, title, body: full, start: !!start, ...(model ? { model } : {}) }); })
      .then((d) => {
        if (start && d && d.number) setOpenKey(repo + "#" + d.number);
        setPending((ps) => ps.map((p) => (p === tmp ? Object.assign({}, p, { number: d.number || p.number }) : p)));
        setTimeout(load, 700);
      })
      .catch((e) => {
        if (e instanceof TypeError) {
          // Network error mid-flight — queue and mark offline
          oqPush({ type: "issue", repo, role, title, body: body || "", start: !!start, model: model || null, tmpNum, tmpRepo: repo });
          setPending((ps) => ps.map((p) => p === tmp ? Object.assign({}, p, { _offline: true }) : p));
          toast("Network error — issue queued offline");
        } else {
          const msg = (e && e.message) || "Couldn’t create";
          if (start) { setDetailError(msg); } else { toast(msg, "error"); }
          setPending((ps) => ps.filter((p) => p !== tmp));
        }
      });
  }

  // Keep the open detail mounted across polls. The issue object is re-fetched every 5s; if it's
  // briefly absent from the freshly-polled list, fall back to the last-known copy (scoped to the
  // same openKey) so the panel doesn't flicker/close. Also lets us open a sub-issue that isn't in
  // the polled list via a small stub.
  const foundOpen = openKey ? issues.find((i) => i.repo + "#" + i.number === openKey) : null;
  if (foundOpen) openIssueRef.current = foundOpen;
  const cachedOpen = openIssueRef.current && openIssueRef.current.repo + "#" + openIssueRef.current.number === openKey ? openIssueRef.current : null;
  const open = openKey ? foundOpen || cachedOpen : null;
  // Open any issue's detail by repo+number (used by the sub-issue checklist). Seeds a stub so a
  // child that isn't in the polled list still opens (the detail loads its own thread/PR/app info).
  function openIssue(r, n, title) {
    const key = r + "#" + n;
    if (!issues.some((i) => i.repo + "#" + i.number === key)) openIssueRef.current = { repo: r, number: n, title: title || "#" + n, state: "" };
    setOpenKey(key);
  }
  const working = (data.active || []).length;

  return html`
    <div class="app">
      <${TopBar} working=${working} scanning=${data.scanning} env=${data.env} theme=${theme} setTheme=${setThemeP} onSettings=${() => setSheet("settings")} onUsage=${() => setSheet("usage")} onAgents=${() => setSheet("agents")} repos=${repos} repoFilter=${repoFilter} setRepoFilter=${setRepoFilter} reload=${load} auto=${data.auto || {}} autoRepos=${data.autoRepos || {}} setAuto=${act.setAuto}/>
      ${data.secretsHealth ? html`<${SecretBanner} h=${data.secretsHealth} onFix=${() => setSheet("settings")}/>` : null}
      <${StatusLine} working=${working} session=${data.session} spend=${data.spendToday} analyzer=${data.analyzer} reload=${load} offlineQ=${offlineQ} syncing=${syncing}/>
      <div class="content">
        <${Board} issues=${shown} repos=${repos} repoFilter=${repoFilter} tab=${tab} isDesktop=${isDesktop} onOpen=${(i) => setOpenKey(i.repo + "#" + i.number)} onOpenChild=${openIssue} onAddRepo=${() => setSheet("addrepo")} onAddIssue=${(r) => openComposer(r)} onAnalyze=${(r) => act.audit(r)} auditRepos=${auditRepos} act=${act} data=${data}/>
      </div>
      ${!isDesktop && html`<${TabBar} issues=${shown} tab=${tab} setTab=${setTab}/>`}
      ${open && html`<div class="dscrim" onClick=${() => setOpenKey(null)}></div>`}
      ${open && html`<${Detail} key=${openKey} issue=${open} activity=${activity} act=${act} isDesktop=${isDesktop} startError=${detailError} onClose=${() => { setOpenKey(null); setDetailError(null); }} onOpenIssue=${openIssue} data=${data} isOnline=${isOnline} onQueueComment=${oqPush}/>`}
      ${sheet === "composer" && html`<${Composer} repos=${repos} repo=${composerRepo} setRepo=${setComposerRepo} onClose=${() => setSheet(null)} onCreate=${createIssue} data=${data}/>`}
      ${sheet === "settings" && html`<${Settings} data=${data} onClose=${() => setSheet(null)} reload=${load} openGithubTokens=${() => setSheet("github")} openModels=${() => setSheet("models")}/>`}
      ${sheet === "github" && html`<${GithubTokensModal} secretKeys=${data.secretKeys || []} github=${data.github} onClose=${() => setSheet("settings")} reload=${load}/>`}
      ${sheet === "models" && html`<${ModelsModal} onClose=${() => setSheet("settings")} reload=${load}/>`}
      ${sheet === "addrepo" && html`<${AddRepo} repos=${repos} onClose=${() => setSheet(null)} reload=${load}/>`}
      ${sheet === "usage" && html`<${Usage} onClose=${() => setSheet(null)} onOpenIssue=${openIssue}/>`}
      ${sheet === "agents" && html`<${AgentEditor} data=${data} onClose=${() => setSheet(null)} onSkills=${() => setSheet("skills")} reload=${load}/>`}
      ${sheet === "skills" && html`<${SkillEditor} data=${data} onClose=${() => setSheet("agents")} reload=${load}/>`}
      ${data.user && data.onboarded === false && html`<${Onboarding} repos=${repos} github=${data.github} reload=${load}/>`}
      <${Toasts} toasts=${toasts} onDismiss=${dismissToast}/>
    </div>`;
}

export function mount(root) { root.removeAttribute("aria-busy"); render(html`<${App}/>`, root); }
