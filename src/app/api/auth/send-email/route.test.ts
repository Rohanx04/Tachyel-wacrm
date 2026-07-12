import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for the Supabase Auth "Send Email" hook endpoint. The mailer is
// mocked (no real SMTP socket); the signature path is exercised for real —
// requests are signed exactly the way Supabase does per Standard Webhooks.
// ---------------------------------------------------------------------------

const sendEmailMock = vi.fn<(input: unknown) => Promise<void>>();
let smtpConfigured = true;

vi.mock('@/lib/email/mailer', () => ({
  isSmtpConfigured: () => smtpConfigured,
  sendEmail: (input: unknown) => sendEmailMock(input),
}));

import { POST } from './route';

const RAW_KEY = Buffer.from('hook-test-key');
const SECRET = `v1,whsec_${RAW_KEY.toString('base64')}`;
const SUPABASE_URL = 'https://proj.supabase.co';

function hookRequest(
  body: unknown,
  opts: { secretKey?: Buffer; timestamp?: number } = {}
): Request {
  const payload = JSON.stringify(body);
  const id = 'msg_test_1';
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', opts.secretKey ?? RAW_KEY)
    .update(`${id}.${ts}.${payload}`)
    .digest('base64');
  return new Request('http://localhost/api/auth/send-email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': ts,
      'webhook-signature': `v1,${sig}`,
    },
    body: payload,
  });
}

const SIGNUP_PAYLOAD = {
  user: { email: 'new@user.co' },
  email_data: {
    token: '123456',
    token_hash: 'pkce_hash_abc',
    redirect_to: 'https://crm.example.com/dashboard',
    email_action_type: 'signup',
    site_url: 'https://crm.example.com',
  },
};

beforeEach(() => {
  smtpConfigured = true;
  sendEmailMock.mockResolvedValue(undefined);
  vi.stubEnv('SEND_EMAIL_HOOK_SECRET', SECRET);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/auth/send-email', () => {
  it('sends a signup confirmation for a correctly signed request', async () => {
    const res = await POST(hookRequest(SIGNUP_PAYLOAD));
    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const sent = sendEmailMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(sent.to).toBe('new@user.co');
    expect(sent.subject).toContain('Confirm');
    // Verify link points at Supabase's verify endpoint with our params.
    expect(sent.html).toContain(
      `${SUPABASE_URL}/auth/v1/verify?token=pkce_hash_abc&amp;type=signup`
    );
    expect(sent.text).toContain('123456');
  });

  it('rejects a request signed with the wrong secret (401, nothing sent)', async () => {
    const res = await POST(
      hookRequest(SIGNUP_PAYLOAD, { secretKey: Buffer.from('wrong-key') })
    );
    expect(res.status).toBe(401);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('rejects a stale (replayed) request', async () => {
    const res = await POST(
      hookRequest(SIGNUP_PAYLOAD, {
        timestamp: Math.floor(Date.now() / 1000) - 3600,
      })
    );
    expect(res.status).toBe(401);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('fails loudly when the hook secret is not configured', async () => {
    vi.stubEnv('SEND_EMAIL_HOOK_SECRET', '');
    const res = await POST(hookRequest(SIGNUP_PAYLOAD));
    expect(res.status).toBe(500);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('fails loudly when SMTP is not configured', async () => {
    smtpConfigured = false;
    const res = await POST(hookRequest(SIGNUP_PAYLOAD));
    expect(res.status).toBe(500);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the SMTP send throws, so the auth action fails visibly', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('relay down'));
    const res = await POST(hookRequest(SIGNUP_PAYLOAD));
    expect(res.status).toBe(500);
  });

  it('renders reauthentication as OTP-only (no verify link)', async () => {
    const res = await POST(
      hookRequest({
        user: { email: 'u@x.co' },
        email_data: {
          token: '654321',
          token_hash: 'hash',
          email_action_type: 'reauthentication',
        },
      })
    );
    expect(res.status).toBe(200);
    const sent = sendEmailMock.mock.calls[0][0] as { html: string };
    expect(sent.html).toContain('654321');
    expect(sent.html).not.toContain('/auth/v1/verify');
  });

  it('400s on a signed but malformed payload', async () => {
    const res = await POST(hookRequest({ email_data: {} }));
    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
