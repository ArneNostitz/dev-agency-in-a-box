/** Minimal server-rendered auth pages (setup + login + invite + reset). Token-light, no client JS. */
const BRAND = `<div class="brand"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.3L21.18 5.5a.5.5 0 0 1 .8.52l-2.83 10.25a1 1 0 0 1-.96.73H5.81a1 1 0 0 1-.95-.73L2.02 6.02a.5.5 0 0 1 .8-.52l4.27 3.66a1 1 0 0 0 1.52-.29z"/></svg> Dev Agency in a Box</div>`;

/** Wrap inner HTML in the page chrome. `inner` supplies its own <form> element(s). */
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
button.ghost{background:transparent;border:1px solid #272c34;color:#cfd3da}
.err{margin-top:14px;color:#f1746a;font-size:13.5px}
.ok{margin-top:14px;color:#3ddc97;font-size:13.5px}
.muted{color:#6b727c;font-size:12.5px;margin-top:14px;text-align:center}
.or{display:flex;align-items:center;gap:10px;color:#4b515b;font-size:12px;margin:22px 0 4px}
.or::before,.or::after{content:"";flex:1;height:1px;background:#272c34}
form{margin:0}
</style></head><body>
<div class="card">${BRAND}${inner}</div>
</body></html>`;
}

export function renderLogin(error?: string, notice?: string): string {
  return page(
    "Sign in · Dev Agency in a Box",
    `<form method="post" action="/login">
       <label>Username</label><input name="username" autocomplete="username" autofocus required>
       <label>Password</label><input name="password" type="password" autocomplete="current-password" required>
       <button type="submit">Sign in</button>
     </form>
     ${notice ? `<div class="ok" style="text-align:center">${notice}</div>` : ""}
     ${error ? `<div class="err">${error}</div>` : ""}
     <div class="muted" style="margin-top:16px"><a href="/forgot" style="color:#9aa1ab">Forgot password?</a></div>`,
  );
}

/**
 * Forgot-password page. When SMTP is configured it offers an emailed reset link (primary); the
 * MASTER_KEY recovery method is always available below as a fallback.
 */
export function renderForgot(opts: { error?: string; notice?: string; emailOn?: boolean } = {}): string {
  const { error, notice, emailOn } = opts;
  const emailForm = emailOn
    ? `<form method="post" action="/forgot-link">
         <div class="muted" style="text-align:left;margin:0 2px 2px">Enter your username or email and we'll send a reset link.</div>
         <label>Username or email</label><input name="identifier" autocomplete="username" autofocus required>
         <button type="submit">Email me a reset link</button>
       </form>
       <div class="or">or use your recovery key</div>`
    : "";
  return page(
    "Reset password · Dev Agency in a Box",
    `${emailForm}
     <form method="post" action="/forgot">
       <div class="muted" style="text-align:left;margin:0 2px 2px">Reset using your server's recovery key.</div>
       <label>Username</label><input name="username" autocomplete="username" ${emailOn ? "" : "autofocus"} required>
       <label>Recovery key</label><input name="key" type="password" required placeholder="your server's MASTER_KEY">
       <label>New password</label><input name="password" type="password" autocomplete="new-password" minlength="8" required>
       <button type="submit" class="ghost">Reset with recovery key</button>
     </form>
     ${notice ? `<div class="ok" style="text-align:center">${notice}</div>` : ""}
     ${error ? `<div class="err">${error}</div>` : ""}
     <div class="muted" style="margin-top:14px;font-size:12px">The recovery key is the <code>MASTER_KEY</code> on the server (or the auto-generated one at <code>/app/data/.masterkey</code>). Only the operator has it.</div>
     <div class="muted" style="margin-top:12px"><a href="/login" style="color:#9aa1ab">Back to sign in</a></div>`,
  );
}

/** Set a new password from a one-time email link (?token=…). */
export function renderReset(token: string, error?: string): string {
  return page(
    "Set a new password · Dev Agency in a Box",
    `<form method="post" action="/reset">
       <input type="hidden" name="token" value="${token.replace(/"/g, "&quot;")}">
       <div class="muted" style="text-align:left;margin:0 2px 2px">Choose a new password for your account.</div>
       <label>New password</label><input name="password" type="password" autocomplete="new-password" minlength="8" autofocus required>
       <button type="submit">Set password &amp; sign in</button>
     </form>
     ${error ? `<div class="err">${error}</div>` : ""}
     <div class="muted" style="margin-top:12px"><a href="/login" style="color:#9aa1ab">Back to sign in</a></div>`,
  );
}

/** First-run: no users exist yet → create the admin account in-browser (no env password needed). */
export function renderSetup(error?: string): string {
  return page(
    "Set up · Dev Agency in a Box",
    `<form method="post" action="/setup">
       <div class="muted" style="text-align:left;margin:0 2px 2px">Welcome. Create the admin account for this Dev Agency in a Box.</div>
       <label>Username</label><input name="username" autocomplete="username" autofocus required>
       <label>Email (optional)</label><input name="email" type="email" autocomplete="email">
       <label>Password</label><input name="password" type="password" autocomplete="new-password" minlength="8" required>
       <button type="submit">Create admin &amp; sign in</button>
     </form>
     ${error ? `<div class="err">${error}</div>` : ""}`,
  );
}

export function renderInvite(token: string, email: string | null, error?: string): string {
  return page(
    "Accept invite · Dev Agency in a Box",
    `<form method="post" action="/invite">
       <input type="hidden" name="_form" value="invite">
       <input type="hidden" name="token" value="${token}">
       <div class="muted" style="text-align:left;margin:0 2px">You've been invited to Dev Agency in a Box. Pick a username and password.</div>
       <label>Username</label><input name="username" autocomplete="username" autofocus required>
       <label>Email</label><input name="email" type="email" autocomplete="email" value="${email ? email.replace(/"/g, "&quot;") : ""}">
       <label>Password</label><input name="password" type="password" autocomplete="new-password" minlength="8" required>
       <button type="submit">Create account</button>
     </form>
     ${error ? `<div class="err">${error}</div>` : ""}`,
  );
}
