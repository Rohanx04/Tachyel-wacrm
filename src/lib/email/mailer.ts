// ============================================================
// SMTP mailer — the single place the app hands mail to a wire.
//
// Configuration is entirely env-driven (see .env.local.example):
//
//   SMTP_HOST      required — hostname of your SMTP relay
//   SMTP_PORT      optional — defaults to 587 (STARTTLS submission)
//   SMTP_SECURE    optional — "true" for implicit TLS (port 465)
//   SMTP_USER      optional — auth username (omit for open relays)
//   SMTP_PASS      optional — auth password
//   SMTP_FROM      required — the From header, e.g.
//                  "Tachyel CRM <no-reply@example.com>"
//
// SMTP is intentionally OPTIONAL: the app must keep working with
// share-link invites and Supabase's built-in email when no relay
// is configured. Callers therefore check `isSmtpConfigured()` (or
// tolerate `sendEmail` throwing `SmtpNotConfiguredError`) instead
// of assuming mail can always be sent.
//
// The transport is created lazily and cached per process so we
// reuse the connection pool across requests instead of paying a
// TCP+TLS handshake per email.
// ============================================================

import nodemailer, { type Transporter } from 'nodemailer';

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super(
      'SMTP is not configured. Set SMTP_HOST and SMTP_FROM (and usually SMTP_USER/SMTP_PASS) to enable outbound email.'
    );
    this.name = 'SmtpNotConfiguredError';
  }
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Plaintext alternative. Always provide one — spam filters punish
   *  HTML-only mail and some clients render only text/plain. */
  text: string;
  /** Optional Reply-To, e.g. the inviting admin's address. */
  replyTo?: string;
}

/** True when the minimum viable SMTP config is present. */
export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim()
  );
}

// Cache keyed by the config values so a hot-reload (dev) or an env
// change between serverless invocations doesn't serve a transport
// built from stale settings.
let cached: { key: string; transporter: Transporter } | null = null;

function getTransporter(): Transporter {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !from) throw new SmtpNotConfiguredError();

  const port = Number.parseInt(process.env.SMTP_PORT ?? '', 10) || 587;
  const secure = process.env.SMTP_SECURE?.trim().toLowerCase() === 'true';
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;

  const key = [host, port, secure, user ?? ''].join('|');
  if (cached?.key === key) return cached.transporter;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure, // false → STARTTLS is still attempted when the server offers it
    ...(user ? { auth: { user, pass: pass ?? '' } } : {}),
  });
  cached = { key, transporter };
  return transporter;
}

/**
 * Send one email through the configured SMTP relay.
 *
 * Throws `SmtpNotConfiguredError` when SMTP env vars are missing and
 * whatever nodemailer throws on delivery failure — callers decide
 * whether that's fatal (auth hook: yes) or degradable (invite email:
 * fall back to the share link).
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
}
