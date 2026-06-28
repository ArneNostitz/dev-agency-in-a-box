// Dev Agency dashboard — detail module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Breadcrumb } from "./ui.js";
import { Avatar, Icon, Modal, ProviderLogo, Select, Sheet, Spinner, agentOptions, agentOnlyOptions, workflowOptions, ago, statusChip, api, commentBadge, defaultModelLabel, fmtTok, getJSON, getSetupProgress, ghUrl, isDone, md, MarkdownArea, readAttach, roleFromComment, shortModel, stripBadge, toast, tokHeat, usageTitle } from "./core.js";


// ---------- Detail ----------
export function Detail({ issue, activity, act, isDesktop, startError, onClose, onOpenIssue, data, isOnline = true, onQueueComment, docked = false }) {
  const [tab, setTab] = useState("chat"); // mobile sub-tab: chat | stream
  const [thread, setThread] = useState(null);
  const [pr, setPr] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [reply, setReply] = useState("");
  const [replyAgent, setReplyAgent] = useState(""); // address a specific agent in chat
  // Preselect who you're talking to: the RUNNING agent while it works (a comment = a nudge), or the
  // NEXT-in-line agent when parked "needs you" (so your reply briefs the right teammate).
  const roleHandle = (role) => role ? ("@" + String(role).toLowerCase().replace("developer","dev").replace("planner","plan").replace("reviewer","review").replace("tester","test").replace("architect","arch")) : "";
  useEffect(() => {
    const runningNow = !!(issue.running || issue.active || issue.queued);
    if (runningNow && issue.role) setReplyAgent(roleHandle(issue.role));
    else if (issue.blocked && issue.lastRole) {
      // next-in-line: a tiny plan→dev→test→review order map.
      const order = ["planner", "developer", "tester", "reviewer"];
      const i2 = order.indexOf(String(issue.lastRole).toLowerCase());
      const next = i2 >= 0 && i2 < order.length - 1 ? order[i2 + 1] : issue.lastRole;
      setReplyAgent(roleHandle(next));
    }
  }, [issue.running, issue.active, issue.queued, issue.role, issue.blocked, issue.lastRole]);
  const [atts, setAtts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(""); // two-tap confirm: which destructive action is armed
  const [moreOpen, setMoreOpen] = useState(false); // toolbar "More" overflow menu
  const [modelOverride, setModelOverride] = useState(
    issue.modelOverride ? issue.modelOverride.providerId + "/" + issue.modelOverride.model : ""
  );
  const providers = data?.providers || [];
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ value: p.id + "/" + m, label: p.name + " · " + m, short: m, provider: p.name })));
  // Per-issue workflow pin (persisted via /issue-workflow; honored on resume). Empty = auto-resolve.
  const wfOpts = workflowOptions(data && data.workflows);
  const [issueWf, setIssueWf] = useState(issue.workflowId || "");
  useEffect(() => { setIssueWf(issue.workflowId || ""); }, [issue.workflowId]);
  const defWfId = (data && data.defaultWorkflowId) || "full-build";
  const defWf = wfOpts.find((w) => w.value === defWfId);
  const wfSelOpts = [{ value: "", label: "Default" + (defWf ? " · " + defWf.label : ""), icon: "sparkles" }].concat(wfOpts.map((w) => ({ value: w.value, label: w.label, avatar: w.avatar, hint: "workflow", hintCls: "b-wf" })));
  // The workflow name to SHOW while the agency runs (read-only): the pinned one, else — for a solo
  // single-role pin (e.g. @dev) — that one role, else the default workflow. (Solo runs were wrongly
  // labelled "Full build" because they have no workflow object and fell through to the default.)
  const soloRole = issue.soloRole;
  const activeWfName = (issueWf && (wfOpts.find((w) => w.value === issueWf) || {}).label)
    || (soloRole ? (soloRole.charAt(0).toUpperCase() + soloRole.slice(1) + " only") : ("Default" + (defWf ? " · " + defWf.label : "")));
  const pinWorkflow = (id) => { setIssueWf(id); issue.workflowId = id || null; api("/issue-workflow", { repo, number, workflowId: id || "" }).catch((err) => toast("Couldn't set workflow: " + ((err && err.message) || ""), "error")); };
  // Run a workflow now: pin it, then start (planned) or resume (existing branch).
  const runWorkflow = (id) => { pinWorkflow(id || ""); const planned = issue.state === "planned" || issue.state === "notPlanned" || !issue.state; (planned ? act.start(repo, number) : act.resume(repo, number)); setRunWfOpen(false); };
  const [runWfOpen, setRunWfOpen] = useState(false);
  const defModelLabel = defaultModelLabel(data);
  // The "Default" option gets a neutral sparkles glyph (not a provider logo) and names what default
  // resolves to — so it never looks like a specific provider is pinned.
  const modelSelOpts = [{ value: "", label: "Default model", hint: defModelLabel, icon: "sparkles" }].concat(modelOpts.map((o) => ({ value: o.value, label: o.short, logo: o.provider, hint: o.provider })));
  const modelTrigger = (cur) => (cur && cur.logo)
    ? html`<span class="tip" data-tip=${cur.label} style="display:inline-flex"><${ProviderLogo} name=${cur.logo} size=${16}/></span>`
    : html`<span class="tip" data-tip=${"Default model · " + defModelLabel} style="display:inline-flex"><${Icon} name="sparkles" size=${16}/></span>`;
  const agentSelOpts = [{ value: "", label: "Just comment", icon: "messages" }].concat(agentOnlyOptions(data && data.agentDefs));
  const [pendingComments, setPendingComments] = useState([]); // optimistic skeleton comments
  const [chatAtBottom, setChatAtBottom] = useState(true);
  const [chatAtTop, setChatAtTop] = useState(true);
  const [streamAtBottom, setStreamAtBottom] = useState(true);
  const armRef = useRef(null);
  const streamRef = useRef(null);
  const stickRef = useRef(true);
  const chatRef = useRef(null);
  const taRef = useRef(null); // compose textarea (auto-grows with content)
  const didScrollRef = useRef(false); // scroll the conversation to the newest message once, on open
  const updateModelOverride = (val) => {
    setModelOverride(val);
    let mo = null;
    if (val) {
      const parts = val.split("/");
      mo = { providerId: parts[0], model: parts.slice(1).join("/") };
    }
    issue.modelOverride = mo;
    api("/model-override", { repo, number, model: mo }).catch((err) => {
      toast("Failed to save model override: " + err.message);
    });
  };
  const repo = issue.repo, number = issue.number;
  // Persist the reply draft per-issue so it survives navigating away and reopening.
  const draftKey = "draft:reply:" + repo + "#" + number;
  useEffect(() => { try { setReply(localStorage.getItem(draftKey) || ""); } catch (e) {} }, [draftKey]);
  useEffect(() => { try { if (reply) localStorage.setItem(draftKey, reply); else localStorage.removeItem(draftKey); } catch (e) {} }, [reply, draftKey]);
  useEffect(() => {
    if (thread && !didScrollRef.current && chatRef.current) {
      didScrollRef.current = true;
      requestAnimationFrame(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; });
    }
  }, [thread]);
  function confirmAct(key, fn) {
    if (armed === key) { clearTimeout(armRef.current); setArmed(""); fn(); return; }
    setArmed(key); clearTimeout(armRef.current); armRef.current = setTimeout(() => setArmed(""), 3000);
  }
  function onChatScroll(e) {
    const el = e.target;
    setChatAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
    setChatAtTop(el.scrollTop < 60);
  }

  function loadThread() {
    getJSON("/thread?repo=" + encodeURIComponent(repo) + "&number=" + number)
      .then((t) => {
        if (t && Array.isArray(t.comments)) {
          setThread(t);
        } else {
          const errMsg = (t && t.error) || "No thread data received from GitHub — the issue may not exist yet or the token lacks access.";
          setThread({ _err: errMsg });
          toast(errMsg);
        }
      })
      .catch((e) => {
        const errMsg = (e && e.message) || "Couldn't load thread. Check network and GitHub token.";
        setThread((prev) => prev || { _err: errMsg });
        toast(errMsg);
      });
  }
  useEffect(() => {
    setModelOverride(issue.modelOverride ? issue.modelOverride.providerId + "/" + issue.modelOverride.model : "");
  }, [issue.modelOverride?.providerId, issue.modelOverride?.model]);
  useEffect(() => {
    setThread(null); setPr(null); setAppInfo(null); setAtts([]); setPendingComments([]); stickRef.current = true;
    if (issue._audit) return; // the audit has no GitHub thread/PR — stream-only view below
    loadThread();
    if (issue.pr_number) getJSON("/pr-status?repo=" + encodeURIComponent(repo) + "&number=" + number).then(setPr).catch(() => {});
    getJSON("/app-info?repo=" + encodeURIComponent(repo) + "&number=" + number).then(setAppInfo).catch(() => setAppInfo({ kind: "unknown" }));
    const t = setInterval(loadThread, 6000); return () => clearInterval(t);
  }, [repo, number, issue._audit, issue.pr_number]);

  // Coalesce consecutive "delta" fragments (live partial-text "typing") from the same role into one
  // growing line so the stream reads as a paragraph, not 50 single-token rows. Non-delta events pass through.
  const stream = (() => {
    const raw = activity.filter((a) => a.repo === repo && a.number === number);
    const out = [];
    for (const a of raw) {
      const prev = out[out.length - 1];
      if (a.kind === "delta" && prev && prev.kind === "delta" && prev.role === a.role) {
        out[out.length - 1] = { ...prev, text: (prev.text || "") + (a.text || "") };
      } else out.push(a);
    }
    return out.slice(-60);
  })();
  useEffect(() => { const el = streamRef.current; if (el && stickRef.current) el.scrollTop = el.scrollHeight; });

  const review = (pr && pr.review && pr.review.verdict) || issue.review || null;
  // Live conflict signal once /pr-status loads; before that, fall back to the stored flag from /data
  // so the box shows immediately on open.
  const conflict = pr ? Boolean(pr.merge && pr.merge.mergeable === "conflict") : Boolean(issue.conflict);
  const conflictFiles = (pr && pr.conflict && pr.conflict.files) || (issue.conflict && issue.conflict.files) || [];
  const needsFix = review === "changes";
  const done = isDone(issue);
  const st = issue.state || "";
  const running = !!(issue.running || issue.active || issue.queued); // a Claude run is executing right now

  function send() {
    if (!reply.trim() && !atts.length) return;
    const textToSend = (replyAgent ? replyAgent + " " : "") + reply;
    const mo = modelOverride ? (() => { const parts = modelOverride.split("/"); return { providerId: parts[0], model: parts.slice(1).join("/") }; })() : null;
    // If offline, queue without a skeleton (comment appears after flush + thread reload).
    if (!isOnline) {
      if (onQueueComment) onQueueComment({ type: "comment", repo, number, body: textToSend, model: mo || null });
      toast("Queued offline — will send when back online");
      setReply(""); setAtts([]);
      if (taRef.current) taRef.current.style.height = "auto";
      return;
    }
    setBusy(true);
    // Optimistic skeleton: show the comment immediately before the server confirms
    const skelId = Date.now();
    setPendingComments((ps) => ps.concat({ _skel: true, id: skelId, author: "you", createdAt: new Date().toISOString(), body: textToSend }));
    // Scroll to bottom so the skeleton is visible
    requestAnimationFrame(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; });
    // Upload attachments SEQUENTIALLY — each one commits to the repo via the GitHub Contents API,
    // and concurrent commits to the same branch collide (non-fast-forward), so a parallel upload
    // silently drops all but one. One at a time, each commit builds on the last.
    atts.reduce((chain, a) => chain.then(async (acc) => {
      const j = await api("/upload-file", { repo, number, dataUrl: a.d, name: a.name }).catch(() => null);
      acc.push(j && j.md ? { md: j.md, refId: a.refId } : null);
      return acc;
    }), Promise.resolve([]))
      .then((results) => {
        // Replace inline [image N] references with their uploaded markdown
        let full = textToSend;
        const appended = [];
        for (const r of results.filter(Boolean)) {
          if (r.refId && r.md) full = full.split("[" + r.refId + "]").join(r.md);
          else if (r.md) appended.push(r.md);
        }
        if (appended.length) full = [full].concat(appended).filter(Boolean).join("\n\n");
        return api("/comment", { repo, number, body: full, ...(mo ? { model: mo } : {}) });
      })
      .then(() => {
        setReply(""); setAtts([]);
        if (taRef.current) taRef.current.style.height = "auto";
        toast(running ? "Queued — the agent will pick it up when the run finishes" : "Sent");
        setTimeout(() => { setPendingComments((ps) => ps.filter((p) => p.id !== skelId)); loadThread(); }, 800);
      })
      .catch((e) => {
        if (e instanceof TypeError) {
          // Network error mid-flight — queue the comment and clear the skeleton
          if (onQueueComment) onQueueComment({ type: "comment", repo, number, body: textToSend, model: mo || null });
          toast("Network error — comment queued offline");
        } else {
          toast((e && e.message) || "Couldn’t send", "error");
        }
        setPendingComments((ps) => ps.filter((p) => p.id !== skelId));
      })
      .finally(() => setBusy(false));
  }
  function editComment(id, body) {
    return api("/comment-edit", { repo, number, commentId: id, body })
      .then(() => { toast("Comment updated"); setTimeout(loadThread, 400); });
  }
  function pickFiles(e) { const fs = e.target.files || []; for (let i = 0; i < fs.length; i++) readAttach(fs[i], (a) => setAtts((x) => x.concat(a))); e.target.value = ""; }
  function onPaste(e) {
    const items = (e.clipboardData || {}).items || [];
    const files = [];
    for (let i = 0; i < items.length; i++) if (items[i].kind === "file") { const f = items[i].getAsFile(); if (f) files.push(f); }
    if (!files.length) return; // plain text paste — let the browser handle it
    // We handle the file(s) ourselves; stop the browser ALSO pasting the clipboard's text/plain
    // (e.g. Clop drops the local file PATH), which raced our token and corrupted the caret.
    e.preventDefault();
    for (const file of files) {
      if (/^image\//.test(file.type)) {
        // Inline image: insert a reference token at the caret so the image lands in context
        const imgNum = atts.filter((a) => a.img).length + 1;
        const refId = "image " + imgNum;
        const ta = taRef.current;
        if (ta) {
          const start = ta.selectionStart || 0, end = ta.selectionEnd || 0;
          const token = "[" + refId + "]";
          setReply((prev) => prev.slice(0, start) + token + prev.slice(end));
          // Restore caret after the inserted token
          requestAnimationFrame(() => { if (ta) { const pos = start + token.length; ta.selectionStart = ta.selectionEnd = pos; ta.focus(); } });
        }
        readAttach(file, (a) => setAtts((x) => x.concat(Object.assign({}, a, { name: refId, refId }))));
      } else {
        readAttach(file, (a) => setAtts((x) => x.concat(a)));
      }
    }
  }

  // toolbar actions. Text labels show on desktop (and on a confirm-armed destructive button).
  const lbl = (t) => html`<span class="tlabel">${t}</span>`;
  const au = issue.auto || {};
  // Obvious ON/OFF toggle switch. Reflects the effective state; clicking flips it (explicit on/off).
  const autoToggle = (kind) => {
    const on = kind === "resume" ? au.resume : au.merge;
    const busy = act.isBusy("auto-" + kind, repo, number);
    return html`<button class=${"menu-item" + (busy ? " busy" : "")} disabled=${busy} onClick=${() => act.setAuto(kind, on ? "off" : "on", repo, number)}>
      <${Icon} name=${kind === "resume" ? "refresh" : "merge"} size=${15}/><span class="mi-label">Auto-${kind}</span>
      <span class=${"mi-switch" + (on ? " on" : "")}><span class="mi-knob"></span></span>
    </button>`;
  };
  const tb = []; // info buttons (left)
  const tbLeft = []; // destructive actions (stop / cancel / park)
  const tbRight = []; // positive CTAs (start / approve / fix / merge / …)
  // A toolbar icon that swaps to a spinner + disables while its action is in flight.
  const bz = (a) => act.isBusy(a, repo, number);
  const tico = (a, name) => bz(a) ? html`<${Spinner} size=${18}/>` : html`<${Icon} name=${name}/>`;
  // Run-the-app actions live in the issue toolbar (was a separate "Run the app" tile).
  const runAppBtns = html`<${RunApp} repo=${repo} number=${number} appInfo=${appInfo} issue=${issue} done=${done}/>`;
  // Compact icon-only links (tooltips carry the meaning) so the toolbar stays uncluttered.
  if (issue.pr_url) tb.push(html`<a class="tbtn" data-tip="Open PR" href=${issue.pr_url} target="_blank" rel="noopener"><${Icon} name="pr"/></a>`);
  if (issue.previewUrl) tb.push(html`<a class="tbtn primary" data-tip="Open preview" href=${issue.previewUrl} target="_blank" rel="noopener"><${Icon} name="globe"/></a>`);
  // Re-pull this single issue (title + whole conversation) from GitHub.
  if (!done) {
    // Decide actions from FACTS, not the (possibly stale) state label:
    //  • running  — something is actually executing right now (live registry), so the only
    //               meaningful action is Stop. A restart can leave the label "in-progress" while
    //               nothing runs — that must NOT show Stop.
    //  • hasPr    — a PR exists → the goal is Merge (or Fix/Resolve if blocked). Never Create PR/Close.
    //  • approved — reviewer approved but no PR yet → Create PR (token-free).
    const hasPr = !!issue.pr_number;
    const parked = !st || st === "notPlanned" || st === "planned";
    const awaiting = issue.blocked === "awaitingApproval";
    const approved = review === "approved";

    const parts = modelOverride ? modelOverride.split("/") : [];
    const mo = parts.length >= 2 ? { providerId: parts[0], model: parts.slice(1).join("/") } : null;

    const bStop = () => html`<button class=${"tbtn warn" + (bz("stop") ? " busy" : "")} disabled=${bz("stop")} data-tip="Stop & halt — parks at needs-attention (press Resume to continue; Cancel resets to Planned)" onClick=${() => act.stop(repo, number)}>${tico("stop", "stop")}${lbl(bz("stop") ? "Stopping…" : "Stop")}</button>`;
    const bApprove = () => html`<button class=${"tbtn primary" + (bz("approve") ? " busy" : "")} disabled=${bz("approve")} data-tip="Approve the plan & build" onClick=${() => act.approve(repo, number, mo).then(onClose)}>${tico("approve", "check")}${lbl("Approve")}</button>`;
    const bResume = () => html`<button class=${"tbtn" + (bz("resume") ? " busy" : "")} disabled=${bz("resume")} data-tip="Re-run the agent on this issue" onClick=${() => act.resume(repo, number, mo)}>${tico("resume", "refresh")}${lbl(bz("resume") ? "Resuming…" : "Resume")}</button>`;
    const bFix = () => html`<button class=${"tbtn primary" + (bz("fix") ? " busy" : "")} disabled=${bz("fix")} data-tip=${conflict ? "Resolve merge conflicts" : "Address the review's requested changes"} onClick=${() => act.fix(repo, number, mo).then(onClose)}>${tico("fix", "wrench")}${lbl(conflict ? "Resolve" : "Fix")}</button>`;
    const bCreatePr = () => html`<button class=${"tbtn green" + (bz("createPr") ? " busy" : "")} disabled=${bz("createPr")} data-tip="Open a PR from the approved branch (no AI / no tokens)" onClick=${() => act.createPr(repo, number)}>${tico("createPr", "pr")}${lbl(bz("createPr") ? "Opening PR…" : "Create PR")}</button>`;
    const bMerge = (anyway) => { const ma = armed === "merge", mb = bz("merge"); return html`<button class=${"tbtn green" + (ma ? " armed" : "") + (mb ? " busy" : "")} disabled=${mb} data-tip=${ma ? "Tap again to merge" : anyway ? "Merge despite requested changes" : "Merge the PR & close the issue"} onClick=${() => confirmAct("merge", () => act.merge(repo, number).then(onClose))}>${mb ? html`<${Spinner} size=${18}/>` : html`<${Icon} name="merge"/>`}${(isDesktop || ma) ? html`<span class="tlabel">${mb ? "Merging…" : ma ? "Confirm merge" : anyway ? "Merge anyway" : "Merge"}</span>` : null}</button>`; };
    const bClose = (epic) => { const ca = armed === "close", cb = bz("close"); const epicAllDone = issue.epic && issue.epic.done >= issue.epic.total; const clabel = ca ? "Confirm" : cb ? "Closing…" : epic ? (epicAllDone ? "Complete" : "Close epic") : "Close"; return html`<button class=${"tbtn" + (epic ? " green" : "") + (ca ? " armed" : "") + (cb ? " busy" : "")} disabled=${cb} data-tip=${ca ? "Tap again to close" : epic ? "Merge any remaining sub-PRs & close this epic" : "Close this issue (mark it done, no PR)"} onClick=${() => confirmAct("close", () => act.close(repo, number).then(onClose))}>${cb ? html`<${Spinner} size=${18}/>` : html`<${Icon} name="check"/>`}${(isDesktop || ca) ? html`<span class="tlabel">${clabel}</span>` : null}</button>`; };

    // Cancel → reset to Planned even when there's a PR / work in flight (the branch/PR stays on GitHub).
    const bCancel = () => html`<button class=${"tbtn warn" + (bz("cancel") ? " busy" : "")} disabled=${bz("cancel")} data-tip="Reset to Planned — discards the agency state but keeps the branch/PR on GitHub" onClick=${() => act.cancel(repo, number).then(onClose)}>${tico("cancel", "planned")}${lbl(bz("cancel") ? "Cancelling…" : "Cancel")}</button>`;

    // KISS: ONE state-relevant PRIMARY action stays in the bar. Everything secondary (reset-to-Planned,
    // close & archive, create-PR, update, run-checks, budget, delete) lives in the hamburger.
    if (running) {
      tbRight.push(bStop()); // a run is executing → the only meaningful action is Stop
    } else if (hasPr) {
      if (conflict) tbRight.push(bFix());
      else if (needsFix) tbRight.push(bFix());
      else tbRight.push(bMerge(false));
    } else if (parked) {
      tbRight.push(bResume()); // a started-but-parked issue continues with Resume (no Start/Play)
    } else if (awaiting) {
      tbRight.push(bApprove());
    } else if (issue.epic) {
      tbRight.push(bClose(true));
    } else if (approved) {
      tbRight.push(bCreatePr());
    } else {
      tbRight.push(bResume());
    }
  }
  // Less-frequent controls live behind a "More" menu so the bar stays tidy.
  const da = armed === "del", db = bz("del");
  const moreItems = [];
  const ca2 = armed === "close", cb2 = bz("close");
  // Secondary actions (KISS): the bar shows one primary action; everything else lives here.
  if (!done) moreItems.push(html`<button class=${"menu-item" + (bz("runChecks") ? " busy" : "")} disabled=${bz("runChecks")} onClick=${() => act.runChecks(repo, number, issue.title)}>${bz("runChecks") ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="flask" size=${15}/>`}<span class="mi-label">Run checks</span></button>`);
  moreItems.push(html`<button class=${"menu-item" + (bz("update") ? " busy" : "")} disabled=${bz("update")} onClick=${() => act.updateIssue(repo, number).then(loadThread)}>${bz("update") ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="refresh" size=${15}/>`}<span class="mi-label">${bz("update") ? "Updating…" : "Update from GitHub"}</span></button>`);
  if (!done) { moreItems.push(autoToggle("resume")); moreItems.push(autoToggle("merge")); }
  moreItems.push({ sep: true });
  // Reset to Planned — discards agency state, keeps the branch/PR.
  if (!done) moreItems.push(html`<button class=${"menu-item" + (bz("cancel") ? " busy" : "")} disabled=${bz("cancel")} onClick=${() => act.cancel(repo, number).then(onClose)}>${bz("cancel") ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="planned" size=${15}/>`}<span class="mi-label">${bz("cancel") ? "Resetting…" : "Reset to Planned"}</span></button>`);
  // Close & archive — close the issue (NOT a merge); archive icon makes that clear.
  if (!done) moreItems.push(html`<button class=${"menu-item" + (cb2 ? " busy" : "")} disabled=${cb2} onClick=${() => confirmAct("close", () => act.close(repo, number).then(onClose))}>${cb2 ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="archive" size=${15}/>`}<span class="mi-label">${cb2 ? "Closing…" : ca2 ? "Tap again to close" : "Close & archive"}</span></button>`);
  // Per-issue budget (#67) — ONE control: unlimited / a $ cap / default, set from a single prompt.
  const isUnlimited = !!issue.budget?.unlimited;
  const budgetVal = isUnlimited ? "Unlimited" : (issue.budget?.maxCostUsd != null ? "$" + issue.budget.maxCostUsd : "Default");
  const setBudget = () => {
    const v = prompt("Per-issue budget — a max in USD (e.g. 5), \"unlimited\", or blank for the global default:", isUnlimited ? "unlimited" : (issue.budget?.maxCostUsd ?? ""));
    if (v == null) return;
    const t = v.trim().toLowerCase();
    const budget = t === "unlimited" ? { unlimited: true } : t === "" ? {} : (() => { const n = Number(t.replace(/^\$/, "")); return Number.isFinite(n) && n >= 0 ? { maxCostUsd: n } : {}; })();
    api("/issue-budget", { repo, number, budget }).then(() => { toast("Budget updated"); loadThread(); }).catch(() => toast("Couldn’t set budget", "error"));
  };
  moreItems.push(html`<button class="menu-item" onClick=${setBudget}><${Icon} name="chart" size=${15}/><span class="mi-label">Budget</span><span class="mi-val">${budgetVal}</span></button>`);
  moreItems.push({ sep: true });
  moreItems.push(html`<button class=${"menu-item danger" + (db ? " busy" : "")} disabled=${db} onClick=${() => confirmAct("del", () => act.del(repo, number))}>${db ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="trash" size=${15}/>`}<span class="mi-label">${db ? "Deleting…" : da ? "Tap again to delete" : "Delete"}</span></button>`);

  const streamPane = html`<div class="dpane side">
    ${startError ? html`<div class="secbanner">⚠ ${startError}</div>` : null}
    ${(() => { const sp = getSetupProgress(stream); if (!sp) return null; const pct = sp.percent == null ? null : sp.percent; return html`<div class="setupbar" title=${sp.phase}><div class="setupbar-track"><div class="setupbar-fill" style=${pct == null ? "width:100%" : "width:" + pct + "%"}></div></div><span class="setupbar-lbl">${pct == null ? html`<${Spinner} size=${11}/> ` : pct + "% · "}${sp.phase}</span></div>`; })()}
    <div class="dstream" ref=${streamRef} onScroll=${(e) => { const el = e.target; const atB = el.scrollHeight - el.scrollTop - el.clientHeight < 50; stickRef.current = atB; setStreamAtBottom(atB); }}>
      ${stream.length ? stream.map((a, idx) => { const ts = a.ts || (a.created_at ? new Date(a.created_at).getTime() : 0); const tstr = ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : ""; return html`<div key=${idx} class=${"l " + (a.kind === "tool" ? "tool" : a.kind === "start" || a.kind === "done" ? "muted" : a.kind === "delta" ? "delta" : "")}>${tstr ? html`<span class="l-ts">${tstr}</span> ` : null}${a.text}</div>`; }) : html`<div class="l muted">${startError ? "Failed to start." : "No live activity yet."}</div>`}
      ${!streamAtBottom ? html`<div class="scroll-fab-wrap"><button class="iconbtn scroll-fab" title="Scroll to bottom" onClick=${() => { const el = streamRef.current; if (el) el.scrollTop = el.scrollHeight; }}><${Icon} name="chevdown" size=${14}/></button></div>` : null}
    </div>
  </div>`;

  const prBar = issue.pr_url ? (() => {
    const ma = armed === "merge", mb = bz("merge");
    return html`<div class="prbar">
      <span class="prbar-l"><${Icon} name="pr" size=${15}/> PR #${issue.pr_number}${review === "approved" ? html` · <span style="color:var(--green)">approved</span>` : review === "changes" ? html` · <span style="color:var(--red)">changes requested</span>` : ""}</span>
      <a class="btn ghost" href=${issue.pr_url} target="_blank" rel="noopener"><${Icon} name="link" size=${14}/> Open on GitHub</a>
      ${conflict ? html`<span class="muted" style="font-size:12px">conflicts — resolve first</span>`
        : review === "changes" ? html`<button class=${"btn " + (bz("fix") ? "" : "primary")} disabled=${bz("fix")} onClick=${() => act.fix(repo, number).then(onClose)}>${bz("fix") ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="wrench" size=${14}/>`} Fix</button>` : null}
      ${!conflict ? html`<button class=${"btn green" + (mb ? " busy" : "")} disabled=${mb} onClick=${() => confirmAct("merge", () => act.merge(repo, number).then(onClose))}>${mb ? html`<${Spinner} size=${14}/> Merging…` : html`<${Icon} name="merge" size=${14}/> ${ma ? "Confirm merge" : review === "changes" ? "Merge anyway" : "Merge"}`}</button>` : null}
    </div>`;
  })() : null;
  const conflictBox = conflict ? html`<div class="conflictbox">
    <div class="conflictbox-h"><${Icon} name="merge" size=${15}/> Merge conflicts with main</div>
    <div class="conflictbox-b">This PR can't be merged until the conflicts are resolved.${conflictFiles.length ? html` ${conflictFiles.length} conflicting file${conflictFiles.length > 1 ? "s" : ""}:` : ""}</div>
    ${conflictFiles.length ? html`<ul class="conflictbox-files">${conflictFiles.map((f) => html`<li key=${f}><a href=${"https://github.com/" + repo + "/blob/agency/issue-" + number + "/" + f} target="_blank" rel="noopener"><${Icon} name="link" size=${11}/> ${f}</a></li>`)}</ul>` : null}
    <button class=${"btn primary" + (bz("fix") ? " busy" : "")} disabled=${bz("fix")} onClick=${() => act.fix(repo, number)}>${bz("fix") ? html`<${Spinner} size=${14}/> Resolving…` : html`<${Icon} name="wrench" size=${14}/> Fix merge conflicts`}</button>
  </div>` : null;

  const chatPane = html`<div class="dpane chat" ref=${chatRef} onScroll=${onChatScroll}>
    ${!chatAtTop ? html`<div class="scroll-fab-wrap top"><button class="iconbtn scroll-fab" title="Scroll to top" onClick=${() => { chatRef.current.scrollTop = 0; }}><${Icon} name="chevup" size=${16}/></button></div>` : null}
    ${issue.epic ? html`<${EpicChecklist} epic=${issue.epic} repo=${repo} onOpen=${onOpenIssue} onClose=${() => act.close(repo, number).then(onClose)} closing=${act.isBusy("close", repo, number)}/>` : null}
    ${conflictBox}
    ${issue.blocked === "held" ? html`<div class="heldbar">
      <span class="heldbar__l"><${Icon} name="clock" size=${15}/> Workflow on hold${(issue.steers && issue.steers.length) ? html` · ${issue.steers.length} steer${issue.steers.length > 1 ? "s" : ""} queued` : ""}</span>
      <button class=${"btn primary" + (bz("resume") ? " busy" : "")} disabled=${bz("resume")} onClick=${() => act.resume(repo, number)}>${bz("resume") ? html`<${Spinner} size=${14}/>` : html`<${Icon} name="play" size=${14}/>`} Resume</button>
    </div>` : null}
    <div class="sec">Conversation</div>
    ${thread === null ? html`<div class="muted">Loading…</div>`
      : thread._err ? html`<div class="muted" style="color:var(--red);display:flex;align-items:center;gap:8px">${thread._err} <button class="btn" onClick=${loadThread}>Retry</button></div>`
      : html`<div>
        ${thread.body ? html`<${Comment} author=${thread.author} createdAt=${thread.createdAt} body=${thread.body} isAgency=${false}/>` : null}
        ${(() => {
          const cs = thread.comments || [];
          // Index of the LAST human (non-agency) comment — only that one is editable.
          let lastHumanIdx = -1;
          for (let n = 0; n < cs.length; n++) if (!cs[n].isAgency) lastHumanIdx = n;
          // How many agent comments follow that last human comment.
          const agentsAfter = lastHumanIdx >= 0 ? cs.slice(lastHumanIdx + 1).filter((x) => x.isAgency).length : 0;
          return cs.map((c, n) => {
            const isLastHuman = n === lastHumanIdx;
            // Editable only on the last human comment, and only while ≤1 agent has replied after it.
            const editable = isLastHuman && agentsAfter <= 1;
            // If exactly one agent replied, editing must halt that agent. If >1, no edit — only stop.
            const onEditFn = editable ? editComment : null;
            const onStop = (isLastHuman && agentsAfter >= 1 && running) ? (() => act.stop(repo, number)) : null;
            // editable+1-agent: saving the edit should also halt that one agent so it re-reads the edit.
            return html`<${Comment} key=${c.localId || c.id || c.createdAt} id=${c.id} author=${c.author} createdAt=${c.createdAt} body=${c.body} isAgency=${c.isAgency} incoming=${c.incoming} avatars=${(data && data.config && data.config.avatars) !== "off"} onEdit=${onEditFn} editable=${editable} agentsAfter=${isLastHuman ? agentsAfter : 0} onStopAgent=${onStop}/>`;
          });
        })()}
        ${pendingComments.map((p) => html`<${Comment} key=${"skel-" + p.id} author=${p.author} createdAt=${p.createdAt} body=${p.body} isAgency=${false} isSkel=${true}/>`)}
      </div>`}
    ${!chatAtBottom ? html`<div class="scroll-fab-wrap"><button class="iconbtn scroll-fab" title="Scroll to bottom" onClick=${() => { chatRef.current.scrollTop = chatRef.current.scrollHeight; }}><${Icon} name="chevdown" size=${16}/></button></div>` : null}
    ${prBar}
  </div>`;

  return html`<div class=${"detail on" + (docked ? " docked" : "")}>
    <div class="dhead dh">
      <div class="dh__t">
        <div class="dh__title">${issue.title || "#" + number}</div>
        <div class="dh__meta dmeta">
          <${Breadcrumb} repo=${repo} number=${number} parent=${issue.epic && issue.epic.parent}/>
          ${(() => { const sc = statusChip(issue); return html`<span class=${"da-status " + sc.cls}><span class="da-status__dot"></span>${sc.label}</span>`; })()}
          ${(() => {
            const h = tokHeat(issue);
            if (!h.tokens) return null;
            return html`<span class="heat tip" data-tip=${usageTitle(issue.usage)}>
              <span class="heat__track"><span class="heat__fill" style=${"width:" + h.pct + "%;background:" + h.color}></span></span>
              <span class="heat__lbl" style=${"color:" + (h.over ? "var(--red)" : "var(--ink-2)")}>${fmtTok(h.tokens)}</span>
            </span>`;
          })()}
          <a href=${ghUrl(repo, number)} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()} class="dh__gh" style="display:inline-flex;align-items:center;gap:3px">GitHub<${Icon} name="link" size=${12}/></a>
        </div>
      </div>
      <button class="iconbtn ghost dclose" aria-label="Close" data-tip="Close" onClick=${onClose}><${Icon} name="x" size=${18}/></button>
    </div>
    <div class="dtoolbar">
      ${wfOpts.length ? (running
        ? html`<span class="wfctl wfctl--running tip" data-tip="Workflow running — stop the issue to switch"><${Icon} name="loader" size=${14} cls="spin"/> <span class="wfctl__name">${activeWfName}</span></span>`
        : html`<span class="wfctl">
            <button class="wfctl__play tip" data-tip=${"Run " + (issueWf ? "this workflow" : "the default workflow") + " on this issue"} onClick=${() => runWorkflow(issueWf || "")}><${Icon} name="play" size=${15}/></button>
            <${Select} value=${issueWf} options=${wfSelOpts} onChange=${pinWorkflow} menuAlign="left" btnClass="wfctl__sel" placeholder="Default"/>
          </span>`) : null}
      <span class="dtoolbar__sep"></span>
      ${tb}
      ${tbLeft}
      <span style="flex:1"></span>
      ${modelOpts.length ? html`<${Select} value=${modelOverride} options=${modelSelOpts} onChange=${updateModelOverride} menuAlign="right" btnClass="iconbtn" trigger=${modelTrigger}/>` : null}
      ${runAppBtns}
      ${tbRight}
      ${moreItems.length ? html`<span class="dropwrap">
        <button class="tbtn" data-tip="More actions" onClick=${() => setMoreOpen((o) => !o)}><${Icon} name=${moreOpen ? "x" : "menu"}/></button>
        ${moreOpen ? html`<div class="dropscrim" onClick=${() => setMoreOpen(false)}></div><div class="dropmenu menu">${moreItems.map((it, i) => it && it.sep ? html`<div key=${i} class="menu-sep"></div>` : html`<span key=${i}>${it}</span>`)}</div>` : null}
      </span>` : null}
    </div>
    ${!isDesktop ? html`<div class="segwrap"><div class="segctl">
      <button class=${"segbtn" + (tab === "chat" ? " on" : "")} onClick=${() => setTab("chat")}>Chat</button>
      <button class=${"segbtn" + (tab === "stream" ? " on" : "")} onClick=${() => setTab("stream")}>Stream</button>
    </div></div>` : null}
    <div class="dpanes">
      ${isDesktop ? html`${chatPane}${streamPane}` : tab === "chat" ? chatPane : streamPane}
    </div>
    <div class="dcompose">
      <div class="composer">
        ${atts.length ? html`<div class="composer-atts">${atts.map((a, idx) => html`<span class="att" key=${idx}>${a.img ? html`<img src=${a.d}/>` : html`<span><${Icon} name="paperclip" size=${12}/> ${a.name}</span>`}<button class="iconbtn" style="width:18px;height:18px;border:none" onClick=${() => setAtts((x) => x.filter((_, j) => j !== idx))}>×</button></span>`)}</div>` : null}
        <${MarkdownArea} value=${reply} taRef=${taRef} placeholder=${running ? "Message the agent…  (queued until the run finishes)" : "Reply…  (Cmd+Enter sends, paste image to embed)"} onInput=${(v) => setReply(v)} onPaste=${onPaste} onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}/>
        <div class="composer-row">
          <label class="composer-icon tip" data-tip="Attach a file"><${Icon} name="paperclip" size=${18}/><input type="file" multiple style="display:none" onChange=${pickFiles}/></label>
          <${Select} value=${replyAgent} options=${agentSelOpts} onChange=${setReplyAgent} placeholder="Just comment"/>
          ${modelOpts && modelOpts.length ? html`<${Select} value=${modelOverride} options=${modelSelOpts} onChange=${updateModelOverride} btnClass="iconbtn" trigger=${modelTrigger}/>` : null}
          <span class="spacer"></span>
          ${running ? html`<button class=${"btn tip" + (bz("hold") ? " busy" : "")} data-tip="Interrupt & steer — pauses the workflow at the next safe break and folds your message into the next step" disabled=${bz("hold")} onClick=${() => { const t = reply.trim(); act.hold(repo, number, t); if (t) setReply(""); }}>${bz("hold") ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="stop" size=${15}/>`} Interrupt</button>` : null}
          <button class=${"btn primary" + (busy ? " busy" : "")} disabled=${busy} title=${running ? "Send a nudge to the running agent (no interruption)" : "Send"} onClick=${send}>${busy ? html`<${Spinner} size=${15}/>` : running ? html`<${Icon} name="messages" size=${15}/>` : html`<${Icon} name="send" size=${15}/>`} ${running ? "Nudge" : "Send"}</button>
        </div>
      </div>
    </div>
  </div>`;
}
function Comment({ id, author, createdAt, body, isAgency, isSkel, incoming, avatars = true, onEdit, editable = false, agentsAfter = 0, onStopAgent = null }) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(body || "");
  const [saving, setSaving] = useState(false);
  function startEdit() { setEditVal(body || ""); setEditing(true); }
  function cancelEdit() { setEditing(false); }
  function save() {
    if (!onEdit || !editVal.trim() || saving) return;
    setSaving(true);
    onEdit(id, editVal.trim()).then(() => { setEditing(false); setSaving(false); if (agentsAfter >= 1 && onStopAgent) onStopAgent(); }).catch(() => setSaving(false));
  }
  return html`<div class=${"cmt " + (isAgency ? "ag" : "") + (isSkel ? " skel" : "") + (incoming ? " incoming" : "")}>
    <div class="h">
      ${isAgency && avatars ? html`<span class="cmt-av"><${Avatar} role=${roleFromComment(body)} size=${28} crop="head"/></span>` : null}
      <span>${incoming ? html`<span class="cmt-in" title="Incoming — posted on GitHub"><${Icon} name="incoming" size=${12}/></span> ` : ""}${(() => { const bd = isAgency ? commentBadge(body) : null; return bd ? html`<span class="cmt-role">${bd.emoji} ${bd.name}</span> · ` : ""; })()}${author || ""} · ${isSkel ? "just now" : ago(createdAt)}</span>
      ${id && !isSkel && editable && onEdit ? html`<button class="iconbtn cmt-edit-btn tip" data-tip=${agentsAfter === 1 ? "Edit — this halts the agent that replied" : "Edit comment"} onClick=${startEdit}><${Icon} name="edit" size=${13}/></button>` : null}
      ${id && !isSkel && !editable && onStopAgent ? html`<button class="iconbtn cmt-edit-btn tip" data-tip="An agent has already replied — can't edit. Stop the agent instead." onClick=${onStopAgent}><${Icon} name="stop" size=${13}/></button>` : null}
    </div>
    ${editing ? html`
      <textarea class="cmt-edit-ta" value=${editVal} onInput=${(e) => setEditVal(e.target.value)}></textarea>
      <div class="cmt-edit-row">
        <button class="btn" onClick=${cancelEdit}>Cancel</button>
        <button class="btn primary" disabled=${saving} onClick=${save}>${saving ? html`<${Spinner} size=${13}/>` : "Save"}</button>
      </div>
    ` : html`<div class="b" dangerouslySetInnerHTML=${{ __html: md(isAgency ? stripBadge(body) : body) }}></div>`}
  </div>`;
}

// Epic parent: a checklist of every sub-issue (✓ done / ○ open), each a link to its detail page,
// plus a one-click "Complete & close" once they're all done.
function EpicChecklist({ epic, repo, onOpen, onClose, closing }) {
  const all = epic.total > 0 && epic.done >= epic.total;
  const kids = (epic.children || []).slice().sort((a, b) => (a.closed === b.closed ? a.child - b.child : a.closed ? 1 : -1));
  return html`<div class="epicbox">
    <div class="sec" style="margin:10px 2px 6px">Sub-issues ${epic.done}/${epic.total}${all ? html` · <span class="epicalldone">all done ✓</span>` : null}</div>
    <div class="epiclist">
      ${kids.map((c) => html`<button class="epicrow" key=${c.child} onClick=${() => onOpen(repo, c.child, c.title)} data-tip="Open sub-issue">
        <span class=${"epicck " + (c.closed ? "done" : "open")}><${Icon} name=${c.closed ? "check" : "planned"} size=${14}/></span>
        <span class="epicnum">#${c.child}</span>
        <span class="epictitle">${c.title || "#" + c.child}</span>
      </button>`)}
    </div>
    ${all ? html`<button class="btn green" disabled=${closing} onClick=${onClose} style="margin-top:9px;width:100%;justify-content:center">${closing ? html`<${Spinner} size=${15}/> Closing…` : html`<${Icon} name="check" size=${15}/> Complete & close epic`}</button>` : null}
  </div>`;
}

function RunApp({ repo, number, appInfo, issue, done }) {
  if (!appInfo || appInfo.kind === "unknown" || appInfo.kind === "none") return null;
  const kind = appInfo.kind, app = issue.app;
  function copyRun() {
    const nm = repo.split("/").pop();
    const checkout = done ? "(git checkout main 2>/dev/null || git checkout master) && git pull -q" : "gh pr checkout " + number;
    const cmd = 'd=~/.devagency/' + nm + '; gh repo clone ' + repo + ' "$d" 2>/dev/null; cd "$d" && git fetch -q && ' + checkout + ' && { corepack enable 2>/dev/null; PM=npm; [ -f pnpm-lock.yaml ]&&PM=pnpm; [ -f yarn.lock ]&&PM=yarn; $PM install && ($PM run tauri:dev || $PM tauri dev || $PM run dev); }';
    (navigator.clipboard ? navigator.clipboard.writeText(cmd) : Promise.reject()).then(() => toast("Copied — paste in Terminal & Enter"), () => toast("Copy failed"));
  }
  return html`${kind === "tauri" ? html`<button class="tbtn tip" data-tip="Run on my Mac — copies a one-liner to clone, checkout & launch this branch" onClick=${copyRun}><${Icon} name="laptop"/><span class="tlabel">Run on my Mac</span></button>` : null}
    ${app && app.status === "running" ? html`<a class="tbtn tip" data-tip="Open the running app" href=${app.url} target="_blank" rel="noopener"><${Icon} name="monitor"/><span class="tlabel">Open app</span></a><button class="tbtn tip" data-tip="Stop the app" onClick=${() => api("/app-stop", { repo, number }).then(() => toast("Stopped"))}><${Icon} name="stop"/></button>`
      : app && (app.status === "installing" || app.status === "starting") ? html`<span class="tbtn" style="pointer-events:none">⏳ ${app.status}…</span>`
      : kind === "web" ? html`<button class="tbtn tip" data-tip="Run a web preview" onClick=${() => api("/app-run", { repo, number }).then((r) => toast(r && r.error ? r.error : "Starting preview…")).catch(() => toast("Couldn’t start", "error"))}><${Icon} name="play"/><span class="tlabel">Run preview</span></button>` : null}`;
}

// ---------- Composer ----------
export function Composer({ repos, repo, setRepo, onClose, onCreate, data }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const ndraftKey = "draft:newissue:" + (repo || "_");
  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(ndraftKey) || "{}"); if (d.title) setTitle(d.title); if (d.body) setBody(d.body); } catch (e) {} }, [ndraftKey]);
  useEffect(() => { try { if (title || body) localStorage.setItem(ndraftKey, JSON.stringify({ title, body })); else localStorage.removeItem(ndraftKey); } catch (e) {} }, [title, body, ndraftKey]);
  const [role, setRole] = useState("@dev");
  const [atts, setAtts] = useState([]);
  const providers = data?.providers || [];
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ providerId: p.id, model: m, label: p.name + " · " + m, short: m, provider: p.name })));
  const [model, setModel] = useState(
    data?.globalModel ? data.globalModel.providerId + "/" + data.globalModel.model : ""
  );
  const taRef = useRef(null);
  function submit(start) {
    if (!repo || !title.trim()) { toast("Repo + title needed"); return; }
    let modelOverride = null;
    if (model) {
      const [providerId, mName] = model.split("/");
      modelOverride = { providerId, model: mName };
    }
    onCreate(repo, role, title.trim(), body.trim(), start, atts.map((a) => ({ dataUrl: a.d, name: a.name, refId: a.refId })), modelOverride);
    try { localStorage.removeItem(ndraftKey); } catch (e) {}
  }
  function pick(e) { const fs = e.target.files || []; for (let i = 0; i < fs.length; i++) readAttach(fs[i], (a) => setAtts((x) => x.concat(a))); e.target.value = ""; }
  function onPaste(e) {
    const items = (e.clipboardData || {}).items || [];
    const files = [];
    for (let i = 0; i < items.length; i++) if (items[i].kind === "file") { const f = items[i].getAsFile(); if (f) files.push(f); }
    if (!files.length) return; // plain text paste — let the browser handle it
    // Handle the file(s) ourselves; stop the browser ALSO pasting the clipboard's text/plain (the
    // local file PATH from tools like Clop), which raced our token and corrupted the caret.
    e.preventDefault();
    for (const file of files) {
      if (/^image\//.test(file.type)) {
        const imgNum = atts.filter((a) => a.img).length + 1;
        const refId = "image " + imgNum;
        const ta = taRef.current;
        if (ta) {
          const start = ta.selectionStart || 0, end = ta.selectionEnd || 0;
          const token = "[" + refId + "]";
          setBody((prev) => prev.slice(0, start) + token + prev.slice(end));
          requestAnimationFrame(() => { if (ta) { const pos = start + token.length; ta.selectionStart = ta.selectionEnd = pos; ta.focus(); } });
        }
        readAttach(file, (a) => setAtts((x) => x.concat(Object.assign({}, a, { name: refId, refId }))));
      } else {
        readAttach(file, (a) => setAtts((x) => x.concat(a)));
      }
    }
  }
  const footer = html`
    <label class="composer-icon tip" data-tip="Attach a file" style="margin-right:auto"><${Icon} name="paperclip" size=${18}/><input type="file" multiple style="display:none" onChange=${pick}/></label>
    <button class="btn" onClick=${() => submit(false)}>Add to Planned</button>
    <button class="btn primary" onClick=${() => submit(true)}><${Icon} name="play" size=${15}/> Start now</button>`;
  return html`<${Modal} title="New issue" onClose=${onClose} footer=${footer}>
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <${Select} value=${repo || ""} options=${repos.map((r) => ({ value: r, label: r.split("/").pop() }))} onChange=${setRepo}/>
      <${Select} value=${role} options=${agentOptions(data && data.agentDefs, data && data.workflows)} onChange=${setRole}/>
      ${modelOpts.length ? html`<${Select} value=${model} btnClass="iconbtn-sm" onChange=${setModel}
        options=${[{ value: "", label: "Default model", hint: defaultModelLabel(data), icon: "sparkles" }].concat(modelOpts.map((o) => ({ value: o.providerId + "/" + o.model, label: o.short, logo: o.provider })))}
        trigger=${(cur) => (cur && cur.logo)
          ? html`<span class="tip" data-tip=${cur.label} style="display:inline-flex"><${ProviderLogo} name=${cur.logo} size=${16}/></span>`
          : html`<span class="tip" data-tip=${"Default model · " + defaultModelLabel(data)} style="display:inline-flex"><${Icon} name="sparkles" size=${16}/></span>`}/>` : null}
    </div>
    <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="What should it do?" style="margin-bottom:10px"/>
    <div class="composer">
      ${atts.length ? html`<div class="composer-atts">${atts.map((a, idx) => html`<span class="att" key=${idx}>${a.img ? html`<img src=${a.d}/>` : html`<span><${Icon} name="paperclip" size=${12}/> ${a.name}</span>`}<button class="iconbtn" style="width:18px;height:18px;border:none" onClick=${() => setAtts((x) => x.filter((_, j) => j !== idx))}>×</button></span>`)}</div>` : null}
      <${MarkdownArea} value=${body} taRef=${taRef} placeholder="Details, context, acceptance criteria…  (Cmd+Enter starts, paste image to embed)" onInput=${(v) => setBody(v)} onPaste=${onPaste} onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(true); } }}/>
    </div>
  <//>`;
}
