// Newest-first ordering for model ids — pure functions, no imports.
// There is no release date in the catalog, so recency is inferred from the id: the version tuple
// ("claude-opus-4-8" → [4,8], "gemini-2.5-pro" → [2,5]) plus an explicit date suffix (compact
// "…-20241022" or ISO "…-2024-08-06"). Version numbers are only comparable within one FAMILY
// (gemma-4 is not newer than gemini-3.5), so ids group by their first word, families sort
// alphabetically, and within a family the version wins first, the date breaks ties, and a
// "-latest" alias floats above its dated siblings. Tokens with letter suffixes ("26b", "5v",
// "4o") are parameter counts / variants, not versions, and are ignored.
// MIRROR: src/db/model-recency.ts — keep the two in sync.

const DATE_RE = /20\d{2}-?\d{2}-?\d{2}/g;

function recencyKey(id) {
  const s = String(id).toLowerCase();
  let date = 0;
  const m = s.match(/(20\d{2})-?(\d{2})-?(\d{2})/);
  if (m) date = Number(m[1] + m[2] + m[3]);
  if (/latest$/.test(s)) date = 99999999;
  const version = [];
  for (const w of s.replace(DATE_RE, " ").split(/[-_/ ]+/)) {
    if (/^\d+(\.\d+)*$/.test(w)) for (const part of w.split(".")) version.push(Number(part));
  }
  return { version, date };
}

// The family a model id belongs to — its first word ("claude", "gemini", "gemma", "glm").
function familyOf(id) {
  return String(id).toLowerCase().split(/[-_/ .:]/)[0];
}

// Compare two model ids: family A→Z, then NEWEST first within the family.
export function compareModelRecency(a, b) {
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

// A copy of `models` sorted family A→Z, newest first within each family.
export function sortModelsByRecency(models) {
  return (models || []).slice().sort(compareModelRecency);
}
