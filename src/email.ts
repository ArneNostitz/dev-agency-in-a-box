/**
 * Transactional email via SMTP (nodemailer), configured from env so you can paste the same SMTP
 * credentials you gave Coolify's transactional email into this app:
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE (true for 465).
 * Email is OPTIONAL — when SMTP isn't configured, email-based password reset is simply unavailable
 * (the MASTER_KEY recovery method still works).
 */
import nodemailer, { type Transporter } from "nodemailer";

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT?.trim() || "587");
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || user || "";
  // Implicit TLS on 465; STARTTLS on 587/25. Override with SMTP_SECURE=true|false.
  const secureEnv = process.env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureEnv ? secureEnv === "true" || secureEnv === "1" : port === 465;
  return { host, port, user, pass, from, secure };
}

/** True when SMTP is configured well enough to send (host + a from address). */
export function emailEnabled(): boolean {
  const c = smtpConfig();
  return Boolean(c.host && c.from);
}

let cached: Transporter | null = null;
function transport(): Transporter | null {
  const c = smtpConfig();
  if (!c.host) return null;
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    ...(c.user ? { auth: { user: c.user, pass: c.pass } } : {}),
  });
  return cached;
}

export async function sendMail(to: string, subject: string, html: string, text?: string): Promise<void> {
  const t = transport();
  const c = smtpConfig();
  if (!t || !c.from) throw new Error("SMTP is not configured (set SMTP_HOST + SMTP_FROM).");
  await t.sendMail({ from: c.from, to, subject, html, text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
}

/** Send the one-time password-reset link. */
export async function sendPasswordReset(to: string, link: string): Promise<void> {
  const html = `
    <div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1c20">
      <p>We received a request to reset your <strong>Dev Agency</strong> password.</p>
      <p><a href="${link}" style="display:inline-block;background:#2f6df6;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Set a new password</a></p>
      <p style="color:#6b727c;font-size:13px">This link expires in 1 hour and can be used once. If you didn't request it, you can ignore this email.</p>
      <p style="color:#9aa1ab;font-size:12px">${link}</p>
    </div>`;
  await sendMail(to, "Reset your Dev Agency password", html);
}
