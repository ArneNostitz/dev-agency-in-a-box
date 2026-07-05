/**
 * Newest-first ordering for discovered model ids (issue: settings model list).
 *
 * There is no release date in pi's registry, so recency is inferred from the id itself:
 *  - the version tuple ("claude-opus-4-8" → [4,8], "gemini-2.5-pro" → [2,5], "glm-5.1" → [5,1])
 *  - an explicit date suffix, compact or ISO ("…-20241022", "…-2024-08-06")
 * Version numbers are only comparable within one FAMILY (gemma-4 is not newer than gemini-3.5),
 * so ids group by their first word, families sort alphabetically, and within a family the version
 * wins first (opus-4-8 beats a dated 3-5 model), the date breaks ties, and a "-latest" alias
 * floats above its dated siblings. Tokens with letter suffixes ("26b", "5v", "4o") are parameter
 * counts / variants, not versions, and are ignored.
 *
 * MIRROR: web/lib/model-recency.js — keep the two in sync.
 */

interface RecencyKey { version: number[]; date: number; }

const DATE_RE = /20\d{2}-?\d{2}-?\d{2}/g;

function recencyKey(id: string): RecencyKey {
  const s = String(id).toLowerCase();
  let date = 0;
  const m = s.match(/(20\d{2})-?(\d{2})-?(\d{2})/);
  if (m) date = Number(m[1] + m[2] + m[3]);
  if (/latest$/.test(s)) date = 99999999;
  const version: number[] = [];
  for (const w of s.replace(DATE_RE, " ").split(/[-_/ ]+/)) {
    if (/^\d+(\.\d+)*$/.test(w)) for (const part of w.split(".")) version.push(Number(part));
  }
  return { version, date };
}

/** The family a model id belongs to — its first word ("claude", "gemini", "gemma", "glm"). */
function familyOf(id: string): string {
  return String(id).toLowerCase().split(/[-_/ .:]/)[0];
}

/** Compare two model ids: family A→Z, then NEWEST first within the family. */
export function compareModelRecency(a: string, b: string): number {
  const fa = familyOf(a);
  const fb = familyOf(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  const ka = recencyKey(a);
  const kb = recencyKey(b);
  const n = Math.max(ka.version.length, kb.version.length);
  for (let i = 0; i < n; i++) {
    const va = i < ka.version.length ? ka.version[i] : -1;
    const vb = i < kb.version.length ? kb.version[i] : -1;
    if (va !== vb) return vb - va;
  }
  if (ka.date !== kb.date) return kb.date - ka.date;
  return a.localeCompare(b);
}

/** A copy of `models` sorted family A→Z, newest first within each family. */
export function sortModelsByRecency(models: string[]): string[] {
  return (models || []).slice().sort(compareModelRecency);
}

/**
 * The `n` most recent model ids. Taken from the DOMINANT family (the one with the most entries —
 * a provider's main line, e.g. gemini over gemma) so the default selection isn't hijacked by a
 * side family that happens to sort first; falls back to the sorted list when families are tiny.
 */
export function newestModels(models: string[], n: number): string[] {
  const sorted = sortModelsByRecency(models);
  const counts = new Map<string, number>();
  for (const m of sorted) counts.set(familyOf(m), (counts.get(familyOf(m)) || 0) + 1);
  let main = "";
  for (const [f, c] of counts) if (!main || c > (counts.get(main) || 0)) main = f;
  const dominant = sorted.filter((m) => familyOf(m) === main);
  return (dominant.length >= n ? dominant : sorted).slice(0, n);
}
