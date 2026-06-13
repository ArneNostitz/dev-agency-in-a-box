/** Pure helper (no side effects) for extracting the Auditor agent's JSON proposals. Kept separate
 * from runner.ts so it's unit-testable without importing the whole runtime. */

export interface AuditProposal {
  title: string;
  body: string;
}

/** Extract the auditor's JSON proposal array from its result text (fenced block or bare array). */
export function parseAuditProposals(text: string): AuditProposal[] {
  if (!text) return [];
  const tryParse = (s: string): AuditProposal[] | null => {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.filter((x) => x && typeof x.title === "string" && typeof x.body === "string");
    } catch {
      /* ignore */
    }
    return null;
  };
  // Prefer a fenced ```json ... ``` block.
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    const r = tryParse(m[1].trim());
    if (r) return r;
  }
  // Else the largest bare [ ... ] that parses.
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first >= 0 && last > first) {
    const r = tryParse(text.slice(first, last + 1));
    if (r) return r;
  }
  return [];
}
