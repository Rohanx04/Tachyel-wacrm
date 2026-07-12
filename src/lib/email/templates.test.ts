import { describe, expect, it } from 'vitest';

import { buildAuthEmail, buildInviteEmail, escapeHtml } from './templates';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<img src="x" onerror='a'> & more`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;a&#39;&gt; &amp; more'
    );
  });
});

describe('buildAuthEmail', () => {
  const url = 'https://proj.supabase.co/auth/v1/verify?token=abc&type=signup';

  it('renders a signup confirmation with link and OTP fallback', () => {
    const { subject, html, text } = buildAuthEmail({
      actionType: 'signup',
      to: 'new@user.co',
      confirmationUrl: url,
      otp: '123456',
    });
    expect(subject).toContain('Confirm');
    expect(html).toContain(escapeHtml(url));
    expect(html).toContain('123456');
    expect(text).toContain(url);
    expect(text).toContain('123456');
  });

  it('renders recovery / magiclink / email_change with distinct subjects', () => {
    const subjects = (['recovery', 'magiclink', 'email_change'] as const).map(
      (actionType) =>
        buildAuthEmail({ actionType, to: 'u@x.co', confirmationUrl: url })
          .subject
    );
    expect(new Set(subjects).size).toBe(3);
  });

  it('renders reauthentication as OTP-only', () => {
    const { html, text } = buildAuthEmail({
      actionType: 'reauthentication',
      to: 'u@x.co',
      otp: '654321',
    });
    expect(html).toContain('654321');
    expect(text).toContain('654321');
    expect(html).not.toContain('href');
  });

  it('falls back to a generic rendering for unknown action types', () => {
    const { subject, html } = buildAuthEmail({
      actionType: 'some_future_type',
      to: 'u@x.co',
      confirmationUrl: url,
      otp: '111222',
    });
    expect(subject.length).toBeGreaterThan(0);
    expect(html).toContain(escapeHtml(url));
  });

  it('escapes attacker-controlled interpolations', () => {
    const { html } = buildAuthEmail({
      actionType: 'email_change',
      to: 'u@x.co',
      confirmationUrl: url,
      newEmail: `<script>alert(1)</script>@x.co`,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildInviteEmail', () => {
  it('includes account name, role, url and expiry in both variants', () => {
    const { subject, html, text } = buildInviteEmail({
      accountName: 'Acme Support',
      role: 'agent',
      url: 'https://crm.example.com/join/tok123',
      expiresInDays: 7,
    });
    expect(subject).toContain('Acme Support');
    expect(html).toContain('Acme Support');
    expect(html).toContain('agent');
    expect(html).toContain('https://crm.example.com/join/tok123');
    expect(html).toContain('7 days');
    expect(text).toContain('https://crm.example.com/join/tok123');
  });

  it('uses singular wording for a 1-day expiry and escapes the account name', () => {
    const { html } = buildInviteEmail({
      accountName: `<b>Evil & Co</b>`,
      role: 'viewer',
      url: 'https://crm.example.com/join/t',
      expiresInDays: 1,
    });
    expect(html).toContain('1 day');
    expect(html).not.toContain('<b>Evil');
    expect(html).toContain('&lt;b&gt;Evil &amp; Co&lt;/b&gt;');
  });
});
