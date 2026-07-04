// Organism — Detail. Extracted from web/detail.js; logic unchanged.
// The issue detail pane: conversation thread, live activity stream, toolbar actions, per-step
// model pickers on the timeline, and the new-issue composer.
//
// Imports atoms + molecules + lib from their new (split) locations. The Comment renderer is now the
// shared molecule ../molecules/Comment.js; timelineModel comes from the molecule Timeline. ghUrl and
// the badge helpers haven't been extracted to lib yet — ghUrl is temporarily pulled from core.js
// (the badge helpers live inside the Comment molecule, so they're not needed here).
import { html, useState, useEffect, useRef } from "/web/vendor/standalone.mjs";
import { Icon } from "../atoms/Icon.js";
import { Avatar } from "../atoms/Avatar.js";
import { Spinner } from "../atoms/Spinner.js";
import { ProviderLogo } from "../atoms/ProviderLogo.js";
import { Select } from "../atoms/Select.js";
import { Modal } from "../atoms/Modal.js";
import { Breadcrumb } from "../atoms/Breadcrumb.js";
import { MarkdownArea } from "../atoms/MarkdownArea.js";
import { ModelSelect } from "../molecules/ModelSelect.js";
import { Comment } from "../molecules/Comment.js";
import { timelineModel } from "../molecules/Timeline.js";
import { api, getJSON } from "../../lib/api.js";
import { ago, cap, fmtTok, tokHeat, usageTitle, shortModel } from "../../lib/format.js";
import { toast, readAttach } from "../../lib/toast.js";
import { isDone, statusChip } from "../../lib/issue-logic.js";
import { defaultModelLabel, parseModelRef, providerModelOptions, resolveAgentModel } from "../../lib/model-logic.js";
import { getSetupProgress } from "../../lib/setup-progress.js";
import { agentOptions, agentOnlyOptions, workflowOptions } from "../../lib/agent-options.js";
// ghUrl hasn't been extracted to lib yet — temporarily pulled from the old core.js.
import { ghUrl } from "../../core.js";


// ---------- Detail ----------
export function Detail({ issue, activity, act, isDesktop, startError, onClose, onOpenIssue, data, isOnline = true, onQueueComment, docked = false, onOpenModels }) {
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
  const updateModelOverride = (mo) => {
    setModelOverride(mo ? mo.providerId + "/" + mo.model : "");
    issue.modelOverride = mo || null;
    api("/model-override", { repo, number, model: mo || null }).catch((err) => {
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
  // Full reset — wipe ALL progress (activity, plan, session, overrides) back to initial state.
  if (!done) moreItems.push(html`<button class=${"menu-item" + (bz("reset") ? " busy" : "")} disabled=${bz("reset")} onClick=${() => { if (!window.confirm("Wipe ALL progress for this issue (activity, plan, session, model overrides)? The branch/PR stays on GitHub.")) return; act.resetIssue(repo, number).then(onClose); }}>${bz("reset") ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="refresh" size=${15}/>`}<span class="mi-label">${bz("reset") ? "Resetting…" : "Full reset"}</span></button>`);
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
    <${DetailTimeline} issue=${issue} data=${data} onOpenModels=${onOpenModels}/>
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
      ${html`<${ModelSelect} providers=${providers} data=${data} value=${modelOverride} emit="object" onChange=${updateModelOverride} includeDefault=${true} defaultLabel="Default model" defaultHint=${defModelLabel} onSetUp=${onOpenModels} menuAlign="right" btnClass="iconbtn" trigger=${modelTrigger}/>`}
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
          ${html`<${ModelSelect} providers=${providers} data=${data} value=${modelOverride} emit="object" onChange=${updateModelOverride} includeDefault=${true} defaultLabel="Default model" defaultHint=${defModelLabel} onSetUp=${onOpenModels} btnClass="iconbtn" trigger=${modelTrigger}/>`}
          <span class="spacer"></span>
          ${running ? html`<button class=${"btn tip" + (bz("hold") ? " busy" : "")} data-tip="Interrupt & steer — pauses the workflow at the next safe break and folds your message into the next step" disabled=${bz("hold")} onClick=${() => { const t = reply.trim(); act.hold(repo, number, t); if (t) setReply(""); }}>${bz("hold") ? html`<${Spinner} size=${15}/>` : html`<${Icon} name="stop" size=${15}/>`} Interrupt</button>` : null}
          <button class=${"btn primary" + (busy ? " busy" : "")} disabled=${busy} title=${running ? "Send a nudge to the running agent (no interruption)" : "Send"} onClick=${send}>${busy ? html`<${Spinner} size=${15}/>` : running ? html`<${Icon} name="messages" size=${15}/>` : html`<${Icon} name="send" size=${15}/>`} ${running ? "Nudge" : "Send"}</button>
        </div>
      </div>
    </div>
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

// Map a workflow's steps to per-step model targets — the storage KEY each step routes by must match
// the server's resolveAssignment (built-in handle → role name; custom agent → handle without @), all
// lowercased. Deduped so a role used in two steps shows one picker (the store is per-agent, not per-step).
const STEP_ROLE_KEY = { "@dev": "developer", "@plan": "planner", "@arch": "architect", "@review": "reviewer", "@test": "tester", "@split": "decomposer" };
export function stepModelTargets(wf, agentDefs, data) {
  const defs = agentDefs || [];
  const rm = (data && data.roleModels) || {};
  const seen = new Set(); const out = [];
  for (const s of (wf && wf.steps || [])) {
    const handle = (s.agent || "").toLowerCase();
    if (!handle) continue;
    const builtin = STEP_ROLE_KEY[handle];
    // The editable agentDef driving this step: match by handle, else (for a built-in handle) by the
    // role NAME — so @test finds the "tester" agent and uses ITS configured model, not the app default.
    const def = defs.find((d) => (d.handle || ("@" + d.name)).toLowerCase() === handle || d.name.toLowerCase() === handle.replace(/^@/, ""))
      || (builtin ? defs.find((d) => d.name.toLowerCase() === builtin) : null);
    // Storage key the server resolves by (built-in role name, or a custom agent's handle w/o @).
    const key = (builtin || (def ? (def.handle || ("@" + def.name)).replace(/^@/, "") : handle.replace(/^@/, ""))).toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    const name = def ? def.name : (builtin || handle.replace(/^@/, ""));
    // The model this step resolves to absent a per-issue override — step.model → agent's model →
    // per-role model (Settings → Models) → global. Tier words resolve to concrete models for display.
    const roleM = rm[key] && rm[key].model ? { ref: rm[key].providerId + "/" + rm[key].model, short: shortModel(rm[key].model), provider: ((data.providers || []).find((p) => p.id === rm[key].providerId) || {}).name } : null;
    // The effective raw model source (step override → agent definition → role), to detect a bare tier
    // word so the default label reads "default: Medium" rather than the resolved model name.
    const rawModel = (s.model && String(s.model).trim()) || (def && def.model && String(def.model).trim()) || (rm[key] && rm[key].model ? rm[key].providerId + "/" + rm[key].model : "");
    const tierHit = rawModel && ["high", "medium", "low"].indexOf(String(rawModel).toLowerCase()) >= 0 ? String(rawModel).toLowerCase() : "";
    const m = resolveAgentModel(s.model, data) || resolveAgentModel(def && def.model, data) || roleM || null;
    // Default label: "default: <Tier|modelName>" — a tier pick shows the tier word, else the model name.
    const dfltLabel = tierHit ? "default: " + cap(tierHit) : (m ? "default: " + m.short : "");
    out.push({ key, label: cap(name), dfltRef: m ? m.ref : "", dflt: dfltLabel, dfltShort: m ? m.short : "", dfltProvider: m ? m.provider : "" });
  }
  return out;
}

// ---------- Detail timeline (top of detail page) ----------
// Renders the workflow steps as a .flow (same classes as table.js WorkflowTimeline). For a WORKFLOW
// issue, each step's avatar is a model-picker Select: the same model dropdown used everywhere else,
// but positioned on the step's avatar instead of an icon button. Clicking it writes a per-agent model
// override for THIS issue (/issue-agent-model, keyed by the step's role — priority 1 in the server's
// resolveAssignment, so it reliably takes effect). Non-workflow / not-started → falls back to the
// plain WorkflowTimeline (or nothing), so nothing changes for issues without steps.
export function DetailTimeline({ issue, data, onOpenModels }) {
  const m = timelineModel(issue);
  if (m.epic || !m.started) return null; // epic bar or nothing-yet → no interactive timeline
  // Only a real workflow has steps whose agent we can target. Solo-role / generic issues render the
  // shared (non-interactive) timeline — there's only one agent, the whole-issue picker already covers it.
  const wf = (data && data.workflows || []).find((w) => w.id === issue.workflowId);
  if (!wf || !m.workflow) {
    return html`<${PlainTimeline} i=${issue}/>`;
  }
  const targets = stepModelTargets(wf, data && data.agentDefs, data);
  // Build {key → step} so a per-agent picker attaches to the matching step (deduped like targets).
  const agentModels = issue.agentModels || {};
  const providers = (data && data.providers) || [];
  const modelOpts = providerModelOptions(providers, { short: true });
  const live = !!(issue.active || issue.running);
  // Pair each timeline step with its model target (by role key), preserving timeline order/state.
  return html`<div class="dtl-flow">
    ${m.steps.map((s, idx) => {
      const done = s.st === "done";
      const current = idx === m.current && !done;
      const blocked = s.st === "attention";
      const cls = done ? "done" : current ? (blocked ? "blocked" : "current") : blocked ? "blocked" : "pending";
      // Match the timeline step to its model target by ROLE KEY (both sides are the lowercased role
      // name) — more robust than matching display labels, which can differ (ws.name vs agentDef name).
      const roleKey = String(s.role || s.k || "").toLowerCase();
      const target = targets.find((t) => t.key === roleKey) || targets.find((t) => (t.label || "").toLowerCase() === roleKey);
      // The live per-issue override for this step's agent (if any), else its resolved default.
      const curRef = target ? (agentModels[target.key] || target.dfltRef) : "";
      const curOpt = curRef ? modelOpts.find((o) => o.value === curRef) : null;
      const curLabel = curOpt ? curOpt.label : (target && target.dflt ? target.dflt : "");
      const curLogo = curOpt ? curOpt.logo : (target && target.dfltProvider) || "";
      const tip = (cap(s.role || s.k)) + (curLabel ? " · " + curLabel : "") + " — click to change model";
      return html`
        ${idx ? html`<span class=${"flow__line" + (idx <= m.current ? " on" : "")}></span>` : null}
        <span class=${"flow__step " + cls}>
          ${target
            ? html`<span class="tip" data-tip=${tip}><${ModelSelect}
                providers=${providers}
                data=${data}
                value=${curRef}
                includeDefault=${true}
                defaultLabel="Default"
                defaultHint=${target && target.dflt ? target.dflt : "default"}
                onSetUp=${onOpenModels}
                btnClass="flow__pick"
                menuAlign=${idx >= m.steps.length - 2 ? "right" : "left"}
                trigger=${() => html`<span class=${"flow__dot flow__dot--face" + (current && live ? " pulse" : "")}><span class="flow__face"><${Avatar} role=${s.role || s.k} size=${26} crop="head"/></span></span>`}
                onChange=${(v) => setStepModel(issue, target.key, v)}
              /></span>`
            : html`<span class=${"flow__dot" + (current && live ? " pulse" : "") + (s.role ? " flow__dot--face" : "")}>${done ? html`<${Icon} name="check" size=${10}/>` : s.role ? html`<span class="flow__face"><${Avatar} role=${s.role} size=${26} crop="head"/></span>` : null}</span>`}
          <span class="flow__lbl">${(current && live) ? html`<${Icon} name=${(statusChip(issue) || {}).icon || "circle"} size=${11} cls="flow__act"/> ` : null}${s.label}</span>
        </span>`;
    })}
  </div>`;
}

// Write a per-step model override for this issue (live, via /issue-agent-model). Updates the local
// issue object optimistically so the timeline reflects it immediately.
export function setStepModel(issue, key, value) {
  if (!issue.agentModels) issue.agentModels = {};
  if (value) issue.agentModels[key] = value; else delete issue.agentModels[key];
  api("/issue-agent-model", { repo: issue.repo, number: issue.number, agent: key, model: value || "" })
    .catch((err) => toast("Couldn't set step model: " + ((err && err.message) || ""), "error"));
}

// Non-interactive timeline for solo-role / generic issues (one agent — whole-issue picker covers it).
// Mirrors table.js WorkflowTimeline markup without re-importing it (keeps detail.js self-contained).
export function PlainTimeline({ i }) {
  const m = timelineModel(i);
  if (m.epic || !m.started) return null;
  const live = !!(i.active || i.running);
  return html`<div class="dtl-flow">
    ${m.steps.map((s, idx) => {
      const done = s.st === "done";
      const current = idx === m.current && !done;
      const blocked = s.st === "attention";
      const cls = done ? "done" : current ? (blocked ? "blocked" : "current") : blocked ? "blocked" : "pending";
      const face = current ? i.role : (s.role || null);
      return html`
        ${idx ? html`<span class=${"flow__line" + (idx <= m.current ? " on" : "")}></span>` : null}
        <span class=${"flow__step " + cls}>
          <span class=${"flow__dot" + (current && live ? " pulse" : "") + (face ? " flow__dot--face" : "")}>${done && !face ? html`<${Icon} name="check" size=${10}/>` : face ? html`<span class="flow__face"><${Avatar} role=${face} size=${26} crop="head"/></span>` : null}</span>
          <span class="flow__lbl">${(current && live) ? html`<${Icon} name=${(statusChip(i) || {}).icon || "circle"} size=${11} cls="flow__act"/> ` : null}${s.label}</span>
        </span>`;
    })}
  </div>`;
}

// ---------- Composer ----------
export function Composer({ repos, repo, setRepo, onClose, onCreate, data, onOpenModels }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const ndraftKey = "draft:newissue:" + (repo || "_");
  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(ndraftKey) || "{}"); if (d.title) setTitle(d.title); if (d.body) setBody(d.body); } catch (e) {} }, [ndraftKey]);
  useEffect(() => { try { if (title || body) localStorage.setItem(ndraftKey, JSON.stringify({ title, body })); else localStorage.removeItem(ndraftKey); } catch (e) {} }, [title, body, ndraftKey]);
  const [role, setRole] = useState((data && data.config && data.config.newIssueDefault) || "@dev");
  const [atts, setAtts] = useState([]);
  const providers = data?.providers || [];
  const anyModels = providers.some((p) => (p.models || []).length);
  // Issue model: "" = default (resolves per agent's own setting), "@individual" = per-agent pickers,
  // else a concrete providerId/model that overrides the WHOLE issue. Default is "" so the picker reads
  // "Default" (not a pinned provider) — each step then uses its own configured model.
  const [model, setModel] = useState("");
  // Per-step model overrides when a WORKFLOW is selected — keyed by the step's resolution key
  // (built-in role name, or a custom agent's handle without @), matching resolveAssignment on the server.
  const selWf = (role || "").startsWith("@") ? (data && data.workflows || []).find((w) => w.trigger === role) : null;
  const wfSteps = selWf ? stepModelTargets(selWf, data && data.agentDefs, data) : [];
  const individual = model === "@individual";
  const [stepModels, setStepModels] = useState({});
  const taRef = useRef(null);
  function submit(start) {
    if (!repo || !title.trim()) { toast("Repo + title needed"); return; }
    // A concrete whole-issue model wins; "Default"/"Individual" leave it unset (per-agent settings apply).
    let modelOverride = null;
    if (model && !individual) {
      const [providerId, mName] = model.split("/");
      modelOverride = { providerId, model: mName };
    }
    // Per-agent picks only when "Individual" is chosen; collect for THIS workflow's steps (dedup by key).
    const agentModels = {};
    if (individual) for (const s of wfSteps) { const v = stepModels[s.key]; if (v) agentModels[s.key] = v; }
    onCreate(repo, role, title.trim(), body.trim(), start, atts.map((a) => ({ dataUrl: a.d, name: a.name, refId: a.refId })), modelOverride, Object.keys(agentModels).length ? agentModels : null);
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
      ${html`<${ModelSelect} providers=${providers} data=${data} value=${model} btnClass="iconbtn-sm" onChange=${setModel} onSetUp=${onOpenModels}
        includeDefault=${true} defaultLabel="Default model"
        extraOptions=${selWf ? [{ value: "@individual", label: "Individual per agent", hint: "set each step", icon: "users" }] : []}
        trigger=${(cur) => (cur && cur.logo)
          ? html`<span class="tip" data-tip=${cur.label} style="display:inline-flex"><${ProviderLogo} name=${cur.logo} size=${16}/></span>`
          : (cur && cur.icon === "users")
          ? html`<span class="tip" data-tip="Individual model per agent" style="display:inline-flex"><${Icon} name="users" size=${16}/></span>`
          : html`<span class="tip" data-tip=${"Default model · " + defaultModelLabel(data)} style="display:inline-flex"><${Icon} name="sparkles" size=${16}/></span>`}/>`}
    </div>
    ${individual && wfSteps.length && anyModels ? html`<div class="setgrp" style="margin-bottom:10px">
      <div class="muted" style="font-size:12px;margin-bottom:10px">Model per step — the dot opens the picker; blank keeps each agent’s configured model.</div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:flex-start">
      ${wfSteps.map((s) => {
        const curVal = stepModels[s.key] || "";
        const curRef = curVal ? parseModelRef(curVal) : null;
        const curProvider = curRef ? (providers.find((p) => p.id === curRef.providerId) || {}).name : "";
        // Override picked → show that; else the agent's own configured model; else true default.
        const effProvider = curProvider || s.dfltProvider;
        const effShort = curRef ? curRef.model : (s.dfltShort || "Default");
        return html`<div key=${s.key} style="display:flex;flex-direction:column;align-items:center;gap:4px;width:88px;text-align:center">
          <${ModelSelect} providers=${providers} data=${data} value=${curVal} menuAlign="left" btnClass="iconbtn-sm" onSetUp=${onOpenModels}
            includeDefault=${true} defaultLabel=${s.dflt || "Default"} defaultHint=${s.dfltProvider || defaultModelLabel(data)}
            onChange=${(v) => setStepModels((m) => Object.assign({}, m, { [s.key]: v }))}
            trigger=${() => effProvider
              ? html`<span class="tip" data-tip=${effShort} style="display:inline-flex"><${ProviderLogo} name=${effProvider} size=${16}/></span>`
              : html`<span class="tip" data-tip=${s.dflt || ("Default · " + defaultModelLabel(data))} style="display:inline-flex"><${Icon} name="sparkles" size=${16}/></span>`}/>
          <span style="font-size:12px;font-weight:600;line-height:1.2">${s.label}</span>
          <span style="font-size:11px;color:var(--ink-3);line-height:1.2;word-break:break-word">${effShort}</span>
        </div>`;
      })}
      </div>
    </div>` : null}
    <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="What should it do?" style="margin-bottom:10px"/>
    <div class="composer">
      ${atts.length ? html`<div class="composer-atts">${atts.map((a, idx) => html`<span class="att" key=${idx}>${a.img ? html`<img src=${a.d}/>` : html`<span><${Icon} name="paperclip" size=${12}/> ${a.name}</span>`}<button class="iconbtn" style="width:18px;height:18px;border:none" onClick=${() => setAtts((x) => x.filter((_, j) => j !== idx))}>×</button></span>`)}</div>` : null}
      <${MarkdownArea} value=${body} taRef=${taRef} placeholder="Details, context, acceptance criteria…  (Cmd+Enter starts, paste image to embed)" onInput=${(v) => setBody(v)} onPaste=${onPaste} onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(true); } }}/>
    </div>
  <//>`;
}
