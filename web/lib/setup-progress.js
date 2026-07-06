// Workspace setup progress — pure function, no dependencies.
//
// Derive a real clone/setup percentage from the live activity stream. The backend streams
// `📥 cloning <repo>… NN%` (real git progress) and `🧭 …` indexing lines. We walk the stream from
// the end, treating the latest setup-phase line as current. Once a non-setup agent event appears
// (a tool use, a text/model output, or a "started (…)" run start), setup is finished → null.
export function getSetupProgress(stream) {
  if (!stream || !stream.length) return null;
  for (let i = stream.length - 1; i >= 0; i--) {
    const ev = stream[i];
    const text = ev.text || "";
    // A real agent run has started (role start event) or produced model/tool output → setup done.
    if (ev.kind === "start") return null;
    if (ev.kind === "text") return null;
    if (ev.kind === "tool" && !/^📥/.test(text) && !/^🧭/.test(text)) return null;
    // Structured progress event (SSE, replaces the old %-in-text lines): pct rides on the event.
    if (ev.kind === "progress") {
      const phase = text.replace(/^📥\s*/, "").trim();
      return { percent: ev.pct == null ? null : Math.min(100, ev.pct), phase: phase || "preparing" };
    }
    // Setup line: parse a real `%` if present, else a phase label without a number.
    if (/^📥/.test(text)) {
      const m = text.match(/(\d+)%/);
      const phase = text.replace(/^📥\s*/, "").replace(/\s*\d+%/, "").replace(/\s*done$/, "").trim();
      if (m) return { percent: Math.min(100, parseInt(m[1], 10)), phase };
      if (/done$/.test(text) || /^📥 (cloned|workdir refreshed)/.test(text)) return { percent: 100, phase };
      return { percent: null, phase: phase || "preparing" };
    }
    if (/^🧭/.test(text)) {
      return { percent: null, phase: text.replace(/^🧭\s*/, "").trim() || "indexing" };
    }
  }
  return null;
}
