// ============================================================
// /api/auth/send-email — Supabase Auth "Send Email" hook.
//
// Point Supabase at this endpoint (Dashboard → Authentication →
// Hooks → Send Email → HTTPS) and EVERY auth email — signup
// confirmation, password recovery, magic link, email change,
// reauthentication OTP — is delivered through the SMTP server
// configured in this app's env instead of Supabase's built-in
// (heavily rate-limited) mailer. Setup guide: docs/email.md.
//
// Request authenticity: Supabase signs each call per the Standard
// Webhooks spec with the secret it generated when the hook was
// created. We verify that signature against SEND_EMAIL_HOOK_SECRET
// before sending anything — otherwise anyone who found this URL
// could use our relay as an open spam cannon.
//
// Failure semantics: a non-2xx response makes the triggering auth
// operation fail (the user sees "error sending email" instead of a
// silent black hole), which is exactly what we want when the relay
// is down or misconfigured.
// ============================================================

import { NextResponse } from 'next/server';

import { isSmtpConfigured, sendEmail } from '@/lib/email/mailer';
import { buildAuthEmail } from '@/lib/email/templates';
import { verifyWebhookSignature } from '@/lib/email/webhook';

interface SendEmailHookPayload {
  user?: {
    email?: string;
    // Present during secure email change; the hook fires once per
    // recipient and `email` already holds the right destination,
    // but we surface new_email in the copy.
    new_email?: string;
  };
  email_data?: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

// Build the verification link the email's button points at. Same
// URL shape Supabase's own templates use:
//   {SUPABASE_URL}/auth/v1/verify?token={token_hash}&type={type}&redirect_to={redirect_to}
function buildConfirmationUrl(
  emailData: NonNullable<SendEmailHookPayload['email_data']>
): string | undefined {
  const tokenHash = emailData.token_hash?.trim();
  const actionType = emailData.email_action_type?.trim();
  if (!tokenHash || !actionType) return undefined;
  // Reauthentication is OTP-only — there is no link to click.
  if (actionType === 'reauthentication') return undefined;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  if (!supabaseUrl) return undefined;

  const url = new URL(`${supabaseUrl}/auth/v1/verify`);
  url.searchParams.set('token', tokenHash);
  url.searchParams.set('type', actionType);
  const redirectTo =
    emailData.redirect_to?.trim() || emailData.site_url?.trim();
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET?.trim();
  if (!secret) {
    console.error(
      '[POST /api/auth/send-email] SEND_EMAIL_HOOK_SECRET is not set; rejecting hook call'
    );
    return NextResponse.json(
      { error: 'Send Email hook secret is not configured on the server' },
      { status: 500 }
    );
  }
  if (!isSmtpConfigured()) {
    console.error(
      '[POST /api/auth/send-email] SMTP is not configured; rejecting hook call'
    );
    return NextResponse.json(
      { error: 'SMTP is not configured on the server' },
      { status: 500 }
    );
  }

  // Signature is computed over the RAW body — read it as text first
  // and only JSON.parse after verification succeeds.
  const rawBody = await request.text();
  const verdict = verifyWebhookSignature(
    rawBody,
    {
      id: request.headers.get('webhook-id'),
      timestamp: request.headers.get('webhook-timestamp'),
      signature: request.headers.get('webhook-signature'),
    },
    secret
  );
  if (!verdict.valid) {
    console.warn(
      '[POST /api/auth/send-email] rejected unsigned/invalid hook call:',
      verdict.reason
    );
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: SendEmailHookPayload;
  try {
    payload = JSON.parse(rawBody) as SendEmailHookPayload;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  const to = payload.user?.email?.trim();
  const emailData = payload.email_data;
  if (!to || !emailData?.email_action_type) {
    return NextResponse.json(
      {
        error: 'Payload is missing user.email or email_data.email_action_type',
      },
      { status: 400 }
    );
  }

  const rendered = buildAuthEmail({
    actionType: emailData.email_action_type,
    to,
    confirmationUrl: buildConfirmationUrl(emailData),
    otp: emailData.token?.trim() || undefined,
    newEmail: payload.user?.new_email?.trim() || undefined,
  });

  try {
    await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (err) {
    // Log the class of failure but never the recipient-linked token
    // material that lives in the payload.
    console.error('[POST /api/auth/send-email] SMTP send failed:', err);
    return NextResponse.json(
      { error: 'Failed to send email via SMTP' },
      { status: 500 }
    );
  }

  return NextResponse.json({});
}
