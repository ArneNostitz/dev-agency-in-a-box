/**
 * Detecting (and recovering from) Claude subscription usage-limit walls — all in plain code,
 * NO agent/AI calls, so it works even when there are zero tokens left.
 *
 * When a run fails because the 5-hour usage limit is hit, we park the issue as "rate-limited"
 * with a resume time (read from the error if present, else the next window reset), pause new
 * agent work until then, and a script-driven timer re-runs the parked work after the reset.
 */

/**
 * Does this error look like a genuine CLAUDE/Anthropic usage-or-rate limit (and when does it reset)?
 *
 * Strict on purpose: we only pause ALL agents for a real LLM usage limit. We must NOT trip on
 * GitHub's API rate limit, a generic "limit"/"quota"/"resets at" appearing in agent output or some
 * unrelated error, or a transient "overloaded" (529, retry soon — not a usage wall). Match only the
 * signatures Claude Code / the Anthropic API actually return for usage/rate limits.
 */
export function parseRateLimit(msg: string): { limited: boolean; resetAt?: number } {
  const text = msg || "";
  // GitHub's own rate limit (from the agent's `gh`/git calls) is NOT a Claude usage limit.
  if (/api rate limit exceeded|secondary rate limit|x-ratelimit|api\.github\.com/i.test(text)) return { limited: false };
  const limited =
    /(claude (ai |code )?usage limit|usage limit reached|reached your usage limit|session limit|rate_limit_error|hit your (usage|session|[\w ]*?) ?limit|\b429\b|too many requests)/i.test(
      text,
    );
  if (!limited) return { limited: false };

  let resetAt: number | undefined;
  // 10-digit unix epoch (seconds), e.g. a reset timestamp in the error body.
  const epoch = /\b(1[6-9]\d{8})\b/.exec(text);
  if (epoch) resetAt = Number(epoch[1]) * 1000;
  // ISO-ish datetime.
  if (!resetAt) {
    const iso = /(\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)/.exec(text);
    if (iso) {
      const t = Date.parse(iso[1]);
      if (Number.isFinite(t)) resetAt = t;
    }
  }
  // Wall-clock form Claude actually uses, e.g. "resets 12:40am (UTC)" / "resets at 3pm".
  if (!resetAt) resetAt = parseResetClock(text);
  return { limited: true, resetAt };
}

/** Parse "resets 12:40am (UTC)" / "resets at 3pm" -> next ms epoch of that wall-clock time. */
export function parseResetClock(text: string, now = Date.now()): number | undefined {
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(?\s*(utc|gmt|z)?/i.exec(text || "");
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  // Claude reports these in UTC; the container runs UTC too, so treat as UTC.
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, min, 0, 0);
  if (t <= now) t += 24 * 3600 * 1000; // already passed today -> next occurrence
  return t;
}

/** The next reset boundary from an anchored (or rolling) window — pure clock math. */
export function nextWindowReset(now: number, windowHours: number, anchorIso?: string | null): number {
  const winMs = Math.max(1, windowHours) * 3600_000;
  const anchor = Date.parse(anchorIso ?? "");
  if (Number.isFinite(anchor) && anchor <= now) {
    const start = anchor + Math.floor((now - anchor) / winMs) * winMs;
    return start + winMs;
  }
  return now + winMs;
}
