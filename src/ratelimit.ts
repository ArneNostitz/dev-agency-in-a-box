/**
 * Detecting (and recovering from) Claude subscription usage-limit walls — all in plain code,
 * NO agent/AI calls, so it works even when there are zero tokens left.
 *
 * When a run fails because the 5-hour usage limit is hit, we park the issue as "rate-limited"
 * with a resume time (read from the error if present, else the next window reset), pause new
 * agent work until then, and a script-driven timer re-runs the parked work after the reset.
 */

/** Does this error message look like a usage/rate limit, and when does it reset (ms epoch)? */
export function parseRateLimit(msg: string): { limited: boolean; resetAt?: number } {
  const text = msg || "";
  const limited =
    /(usage limit|rate[ _-]?limit|rate_limit_error|\b429\b|too many requests|quota|overloaded_error|limit reached|limit will reset|resets? at)/i.test(
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
  return { limited: true, resetAt };
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
