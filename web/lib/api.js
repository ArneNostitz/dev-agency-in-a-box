// Networking helpers — pure functions, no dependencies.

export function api(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  }).then(async (r) => {
    if (!r.ok) {
      let msg = "http " + r.status;
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    return r.json().catch(() => ({}));
  });
}

export function getJSON(u) { return fetch(u).then((r) => r.json()); }
