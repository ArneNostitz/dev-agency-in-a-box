/** Minimal server-rendered auth pages (login + invite acceptance). Token-light, no client JS. */
function page(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0e1014"><title>${title}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#0e1014;color:#e7e9ed;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
.card{width:min(380px,92vw);background:#171a1f;border:1px solid #272c34;border-radius:16px;padding:26px 22px}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:18px;margin-bottom:18px}
.brand svg{color:#5b8cff}
label{display:block;font-size:13px;color:#9aa1ab;margin:14px 2px 6px}
input{width:100%;font-size:16px;border:1px solid #272c34;background:#0e1014;color:#e7e9ed;border-radius:10px;padding:11px 12px;outline:none}
input:focus{border-color:#5b8cff}
button{width:100%;margin-top:18px;font-size:15px;font-weight:560;border:none;background:#2f6df6;color:#fff;border-radius:10px;padding:12px;cursor:pointer}
.err{margin-top:14px;color:#f1746a;font-size:13.5px}
.muted{color:#6b727c;font-size:12.5px;margin-top:14px;text-align:center}
</style></head><body>
<form class="card" method="post">
  <div class="brand"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.3L21.18 5.5a.5.5 0 0 1 .8.52l-2.83 10.25a1 1 0 0 1-.96.73H5.81a1 1 0 0 1-.95-.73L2.02 6.02a.5.5 0 0 1 .8-.52l4.27 3.66a1 1 0 0 0 1.52-.29z"/></svg> Dev Agency</div>
  ${inner}
</form></body></html>`;
}

export function renderLogin(error?: string): string {
  return page(
    "Sign in · Dev Agency",
    `<input type="hidden" name="_form" value="login">
     <label>Username</label><input name="username" autocomplete="username" autofocus required>
     <label>Password</label><input name="password" type="password" autocomplete="current-password" required>
     <button type="submit">Sign in</button>
     ${error ? `<div class="err">${error}</div>` : ""}`,
  );
}

export function renderInvite(token: string, email: string | null, error?: string): string {
  return page(
    "Accept invite · Dev Agency",
    `<input type="hidden" name="_form" value="invite">
     <input type="hidden" name="token" value="${token}">
     <div class="muted" style="text-align:left;margin:0 2px">You've been invited to Dev Agency. Pick a username and password.</div>
     <label>Username</label><input name="username" autocomplete="username" autofocus required>
     <label>Email</label><input name="email" type="email" autocomplete="email" value="${email ? email.replace(/"/g, "&quot;") : ""}">
     <label>Password</label><input name="password" type="password" autocomplete="new-password" minlength="8" required>
     <button type="submit">Create account</button>
     ${error ? `<div class="err">${error}</div>` : ""}`,
  );
}
