/**
 * Parser for pi's `--mode json --print` NDJSON stream (one JSON object per line).
 * Pure + unit-tested; the PiCliRunner threads stdin lines through it.
 *
 * pi emits: session / agent_start / turn_start / message_start|update|end / turn_end /
 * agent_end. Assistant messages carry `usage: {input, output, cacheRead, cacheWrite,
 * totalTokens, cost:{input,output,cacheRead,cacheWrite,total}}`. text_delta carries the
 * streaming assistant text. We accumulate the LAST usage seen on an assistant message_end
 * (pi reports running totals, so the final value is authoritative) plus per-turn deltas.
 */
export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal: number;
}
export const ZERO_USAGE: PiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0 };

export interface PiEvent {
  /** A text chunk to surface to the live activity feed. */
  textDelta?: string;
  /** A tool call started/finished (best-effort one-liner for the feed). */
  tool?: string;
  /** Updated cumulative usage (emit to update accounting). */
  usage?: PiUsage;
  /** A turn completed (count toward turns). */
  turnEnded?: boolean;
  /** The run finished. */
  done?: boolean;
  /** The final assistant text (from the last message). */
  finalText?: string;
}

function readUsage(obj: unknown): PiUsage | undefined {
  const u = (obj as { usage?: Record<string, unknown> }).usage;
  if (!u || typeof u !== "object") return undefined;
  const n = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
  const cost = u.cost as Record<string, unknown> | undefined;
  const c = (k: string): number => (cost && typeof cost[k] === "number" ? (cost[k] as number) : 0);
  return {
    input: n("input"),
    output: n("output"),
    cacheRead: n("cacheRead"),
    cacheWrite: n("cacheWrite"),
    totalTokens: n("totalTokens") || n("input") + n("output") + n("cacheRead") + n("cacheWrite"),
    costTotal: c("total"),
  };
}

/** Parse ONE NDJSON line into 0..n PiEvents. Malformed lines are ignored (best-effort). */
export function parsePiLine(line: string): PiEvent[] {
  const raw = line.trim();
  if (!raw) return [];
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return []; // pi occasionally prints non-JSON to stdout; ignore
  }
  const type = obj.type as string | undefined;
  const out: PiEvent[] = [];

  if (type === "message_update") {
    const ev = (obj as { assistantMessageEvent?: Record<string, unknown> }).assistantMessageEvent;
    if (ev) {
      const et = ev.type as string | undefined;
      if (et === "text_delta" && typeof ev.delta === "string") out.push({ textDelta: ev.delta });
      if (et === "tool_execution_start") {
        const name = (ev.toolName as string) || "tool";
        const desc = summarizeArgs(ev.args);
        out.push({ tool: `🔧 ${name}${desc ? `: ${desc}` : ""}` });
      }
    }
    const u = readUsage((ev as { partial?: unknown })?.partial ?? obj);
    if (u) out.push({ usage: u });
  } else if (type === "message_end" || type === "turn_end") {
    const msg = (obj as { message?: Record<string, unknown> }).message;
    const u = readUsage(msg);
    if (u) out.push({ usage: u });
    // Surface a per-turn error (e.g. "401 token expired") so the live feed shows WHY a run stalls
    // instead of just printing the heartbeat ("still working…") until it times out.
    const stopReason = (msg as { stopReason?: string })?.stopReason;
    const errMsg = (msg as { errorMessage?: string })?.errorMessage;
    if (stopReason === "error" && typeof errMsg === "string" && errMsg.trim()) {
      out.push({ textDelta: `❌ ${errMsg.trim().slice(0, 300)}` });
    }
    if (type === "turn_end") {
      out.push({ turnEnded: true });
      const text = assistantText(msg);
      if (text) out.push({ finalText: text });
    }
  } else if (type === "agent_end") {
    out.push({ done: true });
  }
  return out;
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const s = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (typeof a.command === "string") return `$ ${s(a.command)}`;
  if (typeof a.file_path === "string") return s(a.file_path);
  if (typeof a.pattern === "string") return s(a.pattern);
  return "";
}

function assistantText(msg: unknown): string {
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => (c as { type?: string }).type === "text")
    .map((c) => ((c as { text?: string }).text) || "")
    .join("");
}
