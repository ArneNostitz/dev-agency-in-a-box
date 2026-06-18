// Dev Agency dashboard — detail module (split from app.js; Preact + htm, no build step).
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Avatar, Icon, Sheet, Spinner, ago, api, fmtTok, getJSON, ghUrl, isDone, md, MarkdownArea, readAttach, roleFromComment, shortModel, toast, usageTitle } from "./core.js";


// ---------- Detail ----------
export function Detail({ issue, activity, act, isDesktop, startError, onClose, onOpenIssue, data, isOnline = true, onQueueComment }) {
  const [tab, setTab] = useState("chat"); // mobile sub-tab: chat | stream
  const [thread, setThread] = useState(null);
  const [pr, setPr] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [reply, setReply] = useState("");
  const [atts, setAtts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(""); // two-tap confirm: which destructive action is armed
  const [moreOpen, setMoreOpen] = useState(false); // toolbar "More" overflow menu
  const [modelOverride, setModelOverride] = useState(
    issue.modelOverride ? issue.modelOverride.providerId + "/" + issue.modelOverride.model : ""
  );
  const providers = data?.providers || [];
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ value: p.id + "/" + m, label: p.name + " / " + m })));
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

  const stream = activity.filter((a) => a.repo === repo && a.number === number).slice(-60);
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
    const textToSend = reply;
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
    Promise.all(atts.map((a) =>
      api("/upload-file", { repo, number, dataUrl: a.d, name: a.name })
        .then((j) => ({ md: j && j.md, refId: a.refId }))
        .catch(() => null)
    ))
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
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== "file") continue;
      const file = items[i].getAsFile();
      if (!file) continue;
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
  const lbl = (t) => isDesktop ? html`<span class="tlabel">${t}</span>` : null;
  const au = issue.auto || {};
  // Obvious ON/OFF toggle switch. Reflects the effective state; clicking flips it (explicit on/off).
  const autoToggle = (kind) => {
    const on = kind === "resume" ? au.resume : au.merge;
    const busy = act.isBusy("auto-" + kind, repo, number);
    return html`<button class=${"autotog" + (on ? " on" : "") + (busy ? " busy" : "")} disabled=${busy} data-tip=${"Auto-" + kind + " is " + (on ? "ON" : "OFF") + " — click to turn " + (on ? "off" : "on")} onClick=${() => act.setAuto(kind, on ? "off" : "on", repo, number)}>
      <span class="autotog-l"><${Icon} name=${kind === "resume" ? "refresh" : "merge"} size=${13}/> auto-${kind}</span>
      <span class="autotog-sw"><span class="autotog-knob"></span></span>
    </button>`;
  };
  const tb = [];
  // A toolbar icon that swaps to a spinner + disables while its action is in flight.
  const bz = (a) => act.isBusy(a, repo, number);
  const tico = (a, name) => bz(a) ? html`<${Spinner} size=${18}/>` : html`<${Icon} name=${name}/>`;
  // Compact icon-only links (tooltips carry the meaning) so the toolbar stays uncluttered.
  tb.push(html`<a class="tbtn" data-tip="Open on GitHub" href=${ghUrl(repo, number)} target="_blank" rel="noopener"><${Icon} name="link"/></a>`);
  if (issue.pr_url) tb.push(html`<a class="tbtn" data-tip="Open PR" href=${issue.pr_url} target="_blank" rel="noopener"><${Icon} name="pr"/></a>`);
  if (issue.previewUrl) tb.push(html`<a class="tbtn primary" data-tip="Open preview" href=${issue.previewUrl} target="_blank" rel="noopener"><${Icon} name="globe"/></a>`);
  // Re-pull this single issue (title + whole conversation) from GitHub.
  tb.push(html`<button class=${"tbtn" + (bz("update") ? " busy" : "")} disabled=${bz("update")} data-tip="Update this issue from GitHub" onClick=${() => act.updateIssue(repo, number).then(loadThread)}>${tico("update", "refresh")}${lbl(bz("update") ? "Updating…" : "Update")}</button>`);
  if (!done) {
    // Decide actions from FACTS, not the (possibly stale) state label:
    //  • running  — something is actually executing right now (live registry), so the only
    //               meaningful action is Stop. A restart can leave the label "in-progress" while
    //               nothing runs — that must NOT show Stop.
    //  • hasPr    — a PR exists → the goal is Merge (or Fix/Resolve if blocked). Never Create PR/Close.
    //  • approved — reviewer approved but no PR yet → Create PR (token-free).
    const hasPr = !!issue.pr_number;
    const parked = !st || st === "planned" || st === "agency:planned";
    const awaiting = st === "agency:awaiting-approval";
    const approved = review === "approved";

    const parts = modelOverride ? modelOverride.split("/") : [];
    const mo = parts.length >= 2 ? { providerId: parts[0], model: parts.slice(1).join("/") } : null;

    const bStop = () => html`<button class=${"tbtn warn" + (bz("stop") ? " busy" : "")} disabled=${bz("stop")} data-tip="Stop the running agent & move to Planned" onClick=${() => act.stop(repo, number)}>${tico("stop", "stop")}${lbl(bz("stop") ? "Stopping…" : "Stop")}</button>`;
    const bToPlanned = () => html`<button class=${"tbtn" + (bz("stop") ? " busy" : "")} disabled=${bz("stop")} data-tip="Move to Planned (park it — no AI until you start it)" onClick=${() => act.stop(repo, number).then(onClose)}>${tico("stop", "planned")}${lbl(bz("stop") ? "Moving…" : "To Planned")}</button>`;
    const bStart = () => html`<button class=${"tbtn green" + (bz("start") ? " busy" : "")} disabled=${bz("start")} data-tip="Start building this" onClick=${() => act.start(repo, number, mo).then(onClose)}>${tico("start", "play")}${lbl("Start")}</button>`;
    const bApprove = () => html`<button class=${"tbtn primary" + (bz("approve") ? " busy" : "")} disabled=${bz("approve")} data-tip="Approve the plan & build" onClick=${() => act.approve(repo, number, mo).then(onClose)}>${tico("approve", "check")}${lbl("Approve")}</button>`;
    const bResume = () => html`<button class=${"tbtn" + (bz("resume") ? " busy" : "")} disabled=${bz("resume")} data-tip="Re-run the agent on this issue" onClick=${() => act.resume(repo, number, mo)}>${tico("resume", "refresh")}${lbl(bz("resume") ? "Resuming…" : "Resume")}</button>`;
    const bFix = () => html`<button class=${"tbtn primary" + (bz("fix") ? " busy" : "")} disabled=${bz("fix")} data-tip=${conflict ? "Resolve merge conflicts" : "Address the review's requested changes"} onClick=${() => act.fix(repo, number, mo).then(onClose)}>${tico("fix", "wrench")}${lbl(conflict ? "Resolve" : "Fix")}</button>`;
    const bCreatePr = () => html`<button class=${"tbtn green" + (bz("createPr") ? " busy" : "")} disabled=${bz("createPr")} data-tip="Open a PR from the approved branch (no AI / no tokens)" onClick=${() => act.createPr(repo, number)}>${tico("createPr", "pr")}${lbl(bz("createPr") ? "Opening PR…" : "Create PR")}</button>`;
    const bMerge = (anyway) => { const ma = armed === "merge", mb = bz("merge"); return html`<button class=${"tbtn green" + (ma ? " armed" : "") + (mb ? " busy" : "")} disabled=${mb} data-tip=${ma ? "Tap again to merge" : anyway ? "Merge despite requested changes" : "Merge the PR & close the issue"} onClick=${() => confirmAct("merge", () => act.merge(repo, number).then(onClose))}>${mb ? html`<${Spinner} size=${18}/>` : html`<${Icon} name="merge"/>`}${(isDesktop || ma) ? html`<span class="tlabel">${mb ? "Merging…" : ma ? "Confirm merge" : anyway ? "Merge anyway" : "Merge"}</span>` : null}</button>`; };
    const bClose = (epic) => { const ca = armed === "close", cb = bz("close"); const epicAllDone = issue.epic && issue.epic.done >= issue.epic.total; const clabel = ca ? "Confirm" : cb ? "Closing…" : epic ? (epicAllDone ? "Complete" : "Close epic") : "Close"; return html`<button class=${"tbtn" + (epic ? " green" : "") + (ca ? " armed" : "") + (cb ? " busy" : "")} disabled=${cb} data-tip=${ca ? "Tap again to close" : epic ? "Merge any remaining sub-PRs & close this epic" : "Close this issue (mark it done, no PR)"} onClick=${() => confirmAct("close", () => act.close(repo, number).then(onClose))}>${cb ? html`<${Spinner} size=${18}/>` : html`<${Icon} name="check"/>`}${(isDesktop || ca) ? html`<span class="tlabel">${clabel}</span>` : null}</button>`; };

    // Cancel → reset to Planned even when there's a PR / work in flight (the branch/PR stays on GitHub).
    const bCancel = () => html`<button class=${"tbtn warn" + (bz("cancel") ? " busy" : "")} disabled=${bz("cancel")} data-tip="Reset to Planned — discards the agency state but keeps the branch/PR on GitHub" onClick=${() => act.cancel(repo, number).then(onClose)}>${tico("cancel", "planned")}${lbl(bz("cancel") ? "Cancelling…" : "Cancel")}</button>`;

    if (running) {
      tb.push(bStop()); // the only meaningful action while it's executing
    } else if (hasPr) {
      // A PR exists → merge it (or unblock it). Never Create PR / Close here.
      if (conflict) tb.push(bFix());
      else if (needsFix) { tb.push(bFix()); tb.push(bMerge(true)); }
      else tb.push(bMerge(false));
      tb.push(bResume());
      tb.push(bCancel());
    } else if (parked) {
      tb.push(bStart());
    } else if (awaiting) {
      tb.push(bApprove());
      tb.push(bToPlanned());
    } else if (issue.epic) {
      tb.push(bClose(true)); // master issue → complete/close (merges remaining sub-PRs)
      tb.push(bResume());
      tb.push(bCancel());
    } else if (approved) {
      tb.push(bCreatePr());
      tb.push(bResume());
      tb.push(bCancel());
    } else {
      // ready / needs-attention / answered, no PR → re-engage, or close, or park
      tb.push(bResume());
      tb.push(bClose(false));
      tb.push(bCancel());
    }
  }
  // Less-frequent controls live behind a "More" menu so the bar stays tidy.
  const da = armed === "del", db = bz("del");
  const moreItems = [];
  if (!done) { moreItems.push(autoToggle("resume")); moreItems.push(autoToggle("merge")); }
  moreItems.push(html`<button class=${"tbtn danger wide" + (da ? " armed" : "") + (db ? " busy" : "")} disabled=${db} onClick=${() => confirmAct("del", () => act.del(repo, number))}>${db ? html`<${Spinner} size=${18}/>` : html`<${Icon} name="trash"/>`}<span class="tlabel">${db ? "Deleting…" : da ? "Confirm delete" : "Delete"}</span></button>`);

  const streamPane = html`<div class="dpane side">
    <div class="sec">Live stream</div>
    ${startError ? html`<div class="secbanner">⚠ ${startError}</div>` : null}
    <div class="dstream" ref=${streamRef} onScroll=${(e) => { const el = e.target; const atB = el.scrollHeight - el.scrollTop - el.clientHeight < 50; stickRef.current = atB; setStreamAtBottom(atB); }}>
      ${stream.length ? stream.map((a, idx) => html`<div key=${idx} class=${"l " + (a.kind === "tool" ? "tool" : a.kind === "start" || a.kind === "done" ? "muted" : "")}>${a.text}</div>`) : html`<div class="l muted">${startError ? "Failed to start." : "No live activity yet."}</div>`}
      ${!streamAtBottom ? html`<div class="scroll-fab-wrap"><button class="iconbtn scroll-fab" title="Scroll to bottom" onClick=${() => { const el = streamRef.current; if (el) el.scrollTop = el.scrollHeight; }}><${Icon} name="chevdown" size=${14}/></button></div>` : null}
    </div>
    ${issue.usage && issue.usage.tokens ? html`<div class="dusage" title=${usageTitle(issue.usage)}>
      <span><${Icon} name="chart" size=${13}/> ${fmtTok(issue.usage.tokens)} tokens</span>
      <span>$${Number(issue.usage.costUsd || 0).toFixed(2)}</span>
      ${issue.usage.model ? html`<span>${shortModel(issue.usage.model)}</span>` : null}
      <span class="muted">${issue.usage.runs || 0} runs</span>
    </div>` : null}
    <${RunApp} repo=${repo} number=${number} appInfo=${appInfo} issue=${issue} done=${done}/>
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
    <div class="sec">Conversation</div>
    ${thread === null ? html`<div class="muted">Loading…</div>`
      : thread._err ? html`<div class="muted" style="color:var(--red);display:flex;align-items:center;gap:8px">${thread._err} <button class="btn" onClick=${loadThread}>Retry</button></div>`
      : html`<div>
        ${thread.body ? html`<${Comment} author=${thread.author} createdAt=${thread.createdAt} body=${thread.body} isAgency=${false}/>` : null}
        ${(thread.comments || []).map((c) => html`<${Comment} key=${c.localId || c.id || c.createdAt} id=${c.id} author=${c.author} createdAt=${c.createdAt} body=${c.body} isAgency=${c.isAgency} incoming=${c.incoming} avatars=${(data && data.config && data.config.avatars) !== "off"} onEdit=${editComment}/>`)}
        ${pendingComments.map((p) => html`<${Comment} key=${"skel-" + p.id} author=${p.author} createdAt=${p.createdAt} body=${p.body} isAgency=${false} isSkel=${true}/>`)}
      </div>`}
    ${!chatAtBottom ? html`<div class="scroll-fab-wrap"><button class="iconbtn scroll-fab" title="Scroll to bottom" onClick=${() => { chatRef.current.scrollTop = chatRef.current.scrollHeight; }}><${Icon} name="chevdown" size=${16}/></button></div>` : null}
    ${prBar}
  </div>`;

  return html`<div class="detail on">
    <div class="dhead">
      <button class="iconbtn" aria-label="Close" onClick=${onClose}><${Icon} name="arrowleft"/></button>
      <div class="tt">${issue.title || "#" + number} <span class="dmeta">· ${repo.split("/").pop()} #${number}${st ? " · " + st.replace("agency:", "") : ""}</span></div>
    </div>
    <div class="dtoolbar">
      ${tb}
      <span style="flex:1"></span>
      ${modelOpts.length ? html`
        <select title="Override model for next run" class="modelsel" value=${modelOverride} onChange=${(e) => updateModelOverride(e.target.value)}>
          <option value="">Default model</option>
          ${modelOpts.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
        </select>
      ` : null}
      ${moreItems.length ? html`<span class="dropwrap">
        <button class="tbtn" data-tip="More" onClick=${() => setMoreOpen((o) => !o)}><${Icon} name="dots"/></button>
        ${moreOpen ? html`<div class="dropscrim" onClick=${() => setMoreOpen(false)}></div><div class="dropmenu toolmore">${moreItems.map((it, i) => html`<div key=${i} class="toolmore-row">${it}</div>`)}</div>` : null}
      </span>` : null}
    </div>
    ${!isDesktop ? html`<div class="dtoolbar" style="justify-content:center">
      <button class=${"btn ghost " + (tab === "chat" ? "primary" : "")} onClick=${() => setTab("chat")}>Chat</button>
      <button class=${"btn ghost " + (tab === "stream" ? "primary" : "")} onClick=${() => setTab("stream")}>Stream</button>
    </div>` : null}
    <div class="dpanes">
      ${isDesktop ? html`${chatPane}${streamPane}` : tab === "chat" ? chatPane : streamPane}
    </div>
    <div class="dcompose">
      <div class="composer">
        ${atts.length ? html`<div class="composer-atts">${atts.map((a, idx) => html`<span class="att" key=${idx}>${a.img ? html`<img src=${a.d}/>` : html`<span><${Icon} name="paperclip" size=${12}/> ${a.name}</span>`}<button class="iconbtn" style="width:18px;height:18px;border:none" onClick=${() => setAtts((x) => x.filter((_, j) => j !== idx))}>×</button></span>`)}</div>` : null}
        <${MarkdownArea} value=${reply} taRef=${taRef} placeholder=${running ? "Message the agent…  (queued until the run finishes)" : "Reply…  (Cmd+Enter sends, paste image to embed)"} onInput=${(v) => setReply(v)} onPaste=${onPaste} onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}/>
        <div class="composer-row">
          <label class="composer-icon" title="Attach a file"><${Icon} name="paperclip" size=${18}/><input type="file" multiple style="display:none" onChange=${pickFiles}/></label>
          ${modelOpts && modelOpts.length ? html`<select title="Override model for this run" class="modelsel" value=${modelOverride} onChange=${(e) => updateModelOverride(e.target.value)}>
            <option value="">Default model</option>
            ${modelOpts.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
          </select>` : null}
          <span class="spacer"></span>
          ${running ? html`<button class=${"btn warn" + (bz("stop") ? " busy" : "")} title="Stop the running agent" disabled=${bz("stop")} onClick=${() => act.stop(repo, number)}>${bz("stop") ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="stop" size=${15}/>`} Stop</button>` : null}
          <button class=${"btn primary" + (busy ? " busy" : "")} disabled=${busy} onClick=${send}>${busy ? html`<${Spinner} size=${15}/>` : running ? html`<${Icon} name="clock" size=${15}/>` : html`<${Icon} name="send" size=${15}/>`} ${running ? "Queue" : "Send"}</button>
        </div>
      </div>
    </div>
  </div>`;
}
function Comment({ id, author, createdAt, body, isAgency, isSkel, incoming, avatars = true, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(body || "");
  const [saving, setSaving] = useState(false);
  function startEdit() { setEditVal(body || ""); setEditing(true); }
  function cancelEdit() { setEditing(false); }
  function save() {
    if (!onEdit || !editVal.trim() || saving) return;
    setSaving(true);
    onEdit(id, editVal.trim()).then(() => { setEditing(false); setSaving(false); }).catch(() => setSaving(false));
  }
  return html`<div class=${"cmt " + (isAgency ? "ag" : "") + (isSkel ? " skel" : "") + (incoming ? " incoming" : "")}>
    <div class="h">
      ${isAgency && avatars ? html`<${Avatar} role=${roleFromComment(body)} size=${44} crop="full"/>` : null}
      <span>${incoming ? html`<span class="cmt-in" title="Incoming — posted on GitHub"><${Icon} name="incoming" size=${12}/></span> ` : ""}${author || ""} · ${isSkel ? "just now" : ago(createdAt)}</span>
      ${id && onEdit && !isSkel ? html`<button class="iconbtn cmt-edit-btn" title="Edit comment" onClick=${startEdit}><${Icon} name="edit" size=${13}/></button>` : null}
    </div>
    ${editing ? html`
      <textarea class="cmt-edit-ta" value=${editVal} onInput=${(e) => setEditVal(e.target.value)}></textarea>
      <div class="cmt-edit-row">
        <button class="btn" onClick=${cancelEdit}>Cancel</button>
        <button class="btn primary" disabled=${saving} onClick=${save}>${saving ? html`<${Spinner} size=${13}/>` : "Save"}</button>
      </div>
    ` : html`<div class="b" dangerouslySetInnerHTML=${{ __html: md(body) }}></div>`}
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
  return html`<div class="sec">Run the app</div><div class="autorow">
    ${kind === "tauri" ? html`<button class="btn" onClick=${copyRun}><${Icon} name="laptop" size=${15}/> Run on my Mac</button>` : null}
    ${app && app.status === "running" ? html`<a class="btn primary" href=${app.url} target="_blank" rel="noopener"><${Icon} name="monitor" size=${15}/> Open app</a><button class="btn" onClick=${() => api("/app-stop", { repo, number }).then(() => toast("Stopped"))}><${Icon} name="stop" size=${15}/></button>`
      : app && (app.status === "installing" || app.status === "starting") ? html`<span class="muted">⏳ ${app.status}…</span>`
      : kind === "web" ? html`<button class="btn" onClick=${() => api("/app-run", { repo, number }).then((r) => toast(r && r.error ? r.error : "Starting preview…")).catch(() => toast("Couldn’t start", "error"))}><${Icon} name="play" size=${15}/> Run preview</button>` : null}
  </div>`;
}

// ---------- Composer ----------
export function Composer({ repos, repo, setRepo, onClose, onCreate, data }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [role, setRole] = useState("@dev");
  const [atts, setAtts] = useState([]);
  const providers = data?.providers || [];
  const modelOpts = providers.flatMap((p) => (p.models || []).map((m) => ({ providerId: p.id, model: m, label: p.name + " / " + m })));
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
    onCreate(repo, role, title.trim(), body.trim(), start, atts.map((a) => ({ dataUrl: a.d, name: a.name })), modelOverride);
  }
  function pick(e) { const fs = e.target.files || []; for (let i = 0; i < fs.length; i++) readAttach(fs[i], (a) => setAtts((x) => x.concat(a))); e.target.value = ""; }
  function onPaste(e) {
    const items = (e.clipboardData || {}).items || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== "file") continue;
      const file = items[i].getAsFile();
      if (!file) continue;
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
  return html`<${Sheet} title="New issue" onClose=${onClose}>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <select style="flex:1.5;width:auto" value=${repo || ""} onChange=${(e) => setRepo(e.target.value)}>${repos.map((r) => html`<option key=${r} value=${r}>${r.split("/").pop()}</option>`)}</select>
      <select style="flex:1;width:auto" value=${role} onChange=${(e) => setRole(e.target.value)}>
        <option value="@dev">@dev</option>
        <option value="@plan">@plan</option>
        <option value="@arch">@arch</option>
        <option value="@review">@review</option>
        <option value="@test">@test</option>
      </select>
      ${modelOpts.length ? html`<select style="flex:1.5;width:auto" value=${model} onChange=${(e) => setModel(e.target.value)}>
        <option value="">Default model</option>
        ${modelOpts.map((o) => html`<option key=${o.providerId + "/" + o.model} value=${o.providerId + "/" + o.model}>${o.label}</option>`)}
      </select>` : null}
    </div>
    <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="What should it do?" style="margin-bottom:10px"/>
    <div class="composer">
      ${atts.length ? html`<div class="composer-atts">${atts.map((a, idx) => html`<span class="att" key=${idx}>${a.img ? html`<img src=${a.d}/>` : html`<span><${Icon} name="paperclip" size=${12}/> ${a.name}</span>`}<button class="iconbtn" style="width:18px;height:18px;border:none" onClick=${() => setAtts((x) => x.filter((_, j) => j !== idx))}>×</button></span>`)}</div>` : null}
      <${MarkdownArea} value=${body} taRef=${taRef} placeholder="Details, context, acceptance criteria…  (Cmd+Enter starts, paste image to embed)" onInput=${(v) => setBody(v)} onPaste=${onPaste} onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(true); } }}/>
      <div class="composer-row">
        <label class="composer-icon" title="Attach a file"><${Icon} name="paperclip" size=${18}/><input type="file" multiple style="display:none" onChange=${pick}/></label>
        <span class="spacer"></span>
        <button class="btn ghost" onClick=${() => submit(false)}>Add to Planned</button>
        <button class="btn primary" onClick=${() => submit(true)}><${Icon} name="play" size=${15}/> Start now</button>
      </div>
    </div>
  <//>`;
}
