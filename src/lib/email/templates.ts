// ============================================================
// Email templates — pure functions, no I/O, fully unit-testable.
//
// Two families:
//
//   1. Auth emails (buildAuthEmail) — rendered by the Supabase
//      "Send Email" hook endpoint (/api/auth/send-email) for
//      signup confirmation, password recovery, magic links,
//      email-change confirmation, and reauthentication OTPs.
//
//   2. Team invites (buildInviteEmail) — sent by
//      POST /api/account/invitations when the admin supplies an
//      email address for the new teammate.
//
// Everything user-controlled is HTML-escaped before interpolation;
// URLs additionally go through the href attribute escaped, and the
// plaintext variant carries the raw URL so copy/paste works.
// ============================================================

/** The action types Supabase's Send Email hook can ask us to render.
 *  (See https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) */
export type AuthEmailActionType =
  | 'signup'
  | 'invite'
  | 'magiclink'
  | 'recovery'
  | 'email_change'
  | 'email'
  | 'reauthentication';

export interface AuthEmailInput {
  actionType: AuthEmailActionType | string;
  /** Recipient address (used in copy, not for routing). */
  to: string;
  /** Fully-built Supabase verify URL. Absent for reauthentication,
   *  which is OTP-only. */
  confirmationUrl?: string;
  /** 6-digit OTP. Present on every hook call; shown as a fallback
   *  for link-based actions and as the primary content for
   *  reauthentication. */
  otp?: string;
  /** For email_change: the address the account is changing to. */
  newEmail?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const APP_NAME = 'Tachyel CRM';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// One shared shell so every email the app sends looks the same.
// Inline styles only — email clients strip <style> blocks — and a
// single-column 480px table-free layout that survives Outlook.
function renderLayout(heading: string, bodyHtml: string): string {
  return `<div style="margin:0;padding:32px 16px;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:32px;">
    <p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#18181b;">${escapeHtml(APP_NAME)}</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#18181b;">${escapeHtml(heading)}</h1>
    ${bodyHtml}
    <hr style="margin:32px 0 16px;border:none;border-top:1px solid #e4e4e7;" />
    <p style="margin:0;font-size:12px;color:#71717a;">If you didn't expect this email, you can safely ignore it.</p>
  </div>
</div>`;
}

function renderButton(url: string, label: string): string {
  return `<p style="margin:0 0 24px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;background-color:#18181b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">${escapeHtml(label)}</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#71717a;">Or copy and paste this link into your browser:</p>
    <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(url)}" style="color:#2563eb;">${escapeHtml(url)}</a></p>`;
}

function renderOtp(otp: string): string {
  return `<p style="margin:0 0 8px;font-size:13px;color:#71717a;">Or enter this one-time code:</p>
    <p style="margin:0 0 24px;font-size:24px;font-weight:700;letter-spacing:4px;color:#18181b;">${escapeHtml(otp)}</p>`;
}

interface AuthCopy {
  subject: string;
  heading: string;
  intro: string;
  cta: string;
}

function authCopy(input: AuthEmailInput): AuthCopy {
  switch (input.actionType) {
    case 'signup':
      return {
        subject: `Confirm your ${APP_NAME} account`,
        heading: 'Confirm your email',
        intro: `Thanks for signing up for ${APP_NAME}. Click the button below to verify your email address and activate your account.`,
        cta: 'Confirm email',
      };
    case 'invite':
      return {
        subject: `You've been invited to ${APP_NAME}`,
        heading: 'Accept your invitation',
        intro: `You've been invited to join ${APP_NAME}. Click the button below to accept the invitation and set up your account.`,
        cta: 'Accept invitation',
      };
    case 'magiclink':
      return {
        subject: `Your ${APP_NAME} sign-in link`,
        heading: 'Sign in to your account',
        intro: `Click the button below to sign in to ${APP_NAME}. This link can only be used once.`,
        cta: 'Sign in',
      };
    case 'recovery':
      return {
        subject: `Reset your ${APP_NAME} password`,
        heading: 'Reset your password',
        intro: `We received a request to reset the password for your ${APP_NAME} account. Click the button below to choose a new password.`,
        cta: 'Reset password',
      };
    case 'email_change':
      return {
        subject: `Confirm your new email for ${APP_NAME}`,
        heading: 'Confirm your new email address',
        intro: input.newEmail
          ? `You asked to change your ${APP_NAME} email to ${input.newEmail}. Click the button below to confirm the change.`
          : `You asked to change the email address on your ${APP_NAME} account. Click the button below to confirm the change.`,
        cta: 'Confirm email change',
      };
    case 'reauthentication':
      return {
        subject: `Your ${APP_NAME} verification code`,
        heading: "Verify it's you",
        intro: `Enter the code below to confirm this action on your ${APP_NAME} account.`,
        cta: '',
      };
    // "email" (generic OTP) and anything Supabase adds later fall
    // through to a safe generic rendering rather than a 500.
    default:
      return {
        subject: `Verify your ${APP_NAME} email`,
        heading: 'Verify your email',
        intro: `Use the button or code below to continue with ${APP_NAME}.`,
        cta: 'Continue',
      };
  }
}

/** Render a Supabase auth email (hook endpoint calls this). */
export function buildAuthEmail(input: AuthEmailInput): RenderedEmail {
  const copy = authCopy(input);

  let bodyHtml = `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(copy.intro)}</p>`;
  const textLines: string[] = [copy.heading, '', copy.intro, ''];

  if (input.confirmationUrl && copy.cta) {
    bodyHtml += renderButton(input.confirmationUrl, copy.cta);
    textLines.push(`${copy.cta}: ${input.confirmationUrl}`, '');
  }
  if (input.otp) {
    bodyHtml += renderOtp(input.otp);
    textLines.push(`One-time code: ${input.otp}`, '');
  }
  textLines.push("If you didn't expect this email, you can safely ignore it.");

  return {
    subject: copy.subject,
    html: renderLayout(copy.heading, bodyHtml),
    text: textLines.join('\n'),
  };
}

export interface InviteEmailInput {
  /** Team/account display name, e.g. "Acme Support". */
  accountName: string;
  /** Role the invitee will receive. */
  role: string;
  /** The one-time invite URL (/join/<token>). */
  url: string;
  /** Link lifetime, already clamped by the API route. */
  expiresInDays: number;
}

/** Render the team-invitation email sent from the Members tab. */
export function buildInviteEmail(input: InviteEmailInput): RenderedEmail {
  const days = `${input.expiresInDays} ${input.expiresInDays === 1 ? 'day' : 'days'}`;
  const intro = `You've been invited to join ${input.accountName} on ${APP_NAME} as ${input.role}. Click the button below to accept — the link is valid for ${days} and can be used once.`;
  const heading = `Join ${input.accountName}`;

  const bodyHtml =
    `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(intro)}</p>` +
    renderButton(input.url, 'Accept invitation');

  return {
    subject: `You've been invited to join ${input.accountName} on ${APP_NAME}`,
    html: renderLayout(heading, bodyHtml),
    text: [
      heading,
      '',
      intro,
      '',
      `Accept invitation: ${input.url}`,
      '',
      "If you didn't expect this email, you can safely ignore it.",
    ].join('\n'),
  };
}
