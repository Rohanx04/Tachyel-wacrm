// ============================================================
// Standard Webhooks signature verification — pure, no I/O.
//
// Supabase Auth signs "Send Email" hook requests per the Standard
// Webhooks spec (https://www.standardwebhooks.com/):
//
//   headers:
//     webhook-id:        unique message id
//     webhook-timestamp: unix seconds
//     webhook-signature: space-separated list of "v1,<base64 sig>"
//
//   signed content:  "<id>.<timestamp>.<raw body>"
//   algorithm:       HMAC-SHA256 keyed with the base64-DECODED
//                    secret (dashboard shows it as "v1,whsec_<b64>")
//
// We implement the ~20 lines ourselves instead of pulling in the
// `standardwebhooks` package: the verification is small, stable,
// and a hand-rolled version keeps the auth-critical path free of
// an extra supply-chain dependency.
//
// Security notes
// --------------
// * Comparison uses `timingSafeEqual` so signature checking can't
//   be turned into a byte-at-a-time oracle.
// * The timestamp is bounded (±5 min) to blunt replay of captured
//   requests.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Max clock skew / replay window, in seconds (spec recommends 5 min). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type WebhookVerifyResult =
  { valid: true } | { valid: false; reason: string };

/**
 * Decode the shared secret as shown in the Supabase dashboard.
 * Accepts `v1,whsec_<b64>`, `whsec_<b64>`, or the bare base64.
 */
export function decodeWebhookSecret(secret: string): Buffer {
  let s = secret.trim();
  if (s.startsWith('v1,')) s = s.slice(3);
  if (s.startsWith('whsec_')) s = s.slice(6);
  return Buffer.from(s, 'base64');
}

/**
 * Verify a Standard Webhooks signature.
 *
 * @param payload  Raw request body EXACTLY as received (no re-serialize).
 * @param headers  The three webhook-* headers.
 * @param secret   Shared secret from the Supabase hook config.
 * @param nowMs    Injectable clock for tests.
 */
export function verifyWebhookSignature(
  payload: string,
  headers: WebhookHeaders,
  secret: string,
  nowMs: number = Date.now()
): WebhookVerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { valid: false, reason: 'missing webhook-* headers' };
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: 'malformed webhook-timestamp' };
  }
  const skew = Math.abs(nowMs / 1000 - ts);
  if (skew > WEBHOOK_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'webhook-timestamp outside tolerance' };
  }

  const key = decodeWebhookSecret(secret);
  if (key.length === 0) {
    return { valid: false, reason: 'webhook secret decodes to empty key' };
  }

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest();

  // The header may carry several space-separated signatures (key
  // rotation). Accept if ANY v1 entry matches.
  for (const part of signature.split(' ')) {
    const [version, sig] = part.split(',', 2);
    if (version !== 'v1' || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    ) {
      return { valid: true };
    }
  }
  return { valid: false, reason: 'no matching v1 signature' };
}
