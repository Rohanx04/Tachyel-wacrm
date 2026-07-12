import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  decodeWebhookSecret,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from './webhook';

// Deterministic fixtures: sign the payload exactly the way Supabase
// (Standard Webhooks) does, then assert our verifier agrees.
const RAW_KEY = Buffer.from('super-secret-signing-key');
const SECRET = `v1,whsec_${RAW_KEY.toString('base64')}`;
const PAYLOAD = JSON.stringify({ user: { email: 'a@b.co' }, email_data: {} });
const ID = 'msg_2K6yZ';
const NOW_MS = 1_750_000_000_000;
const TIMESTAMP = String(Math.floor(NOW_MS / 1000));

function sign(
  payload: string,
  id: string = ID,
  timestamp: string = TIMESTAMP,
  key: Buffer = RAW_KEY
): string {
  const sig = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  return `v1,${sig}`;
}

describe('decodeWebhookSecret', () => {
  it('decodes the dashboard format v1,whsec_<b64>', () => {
    expect(decodeWebhookSecret(SECRET).equals(RAW_KEY)).toBe(true);
  });

  it('decodes whsec_<b64> and bare base64 too', () => {
    const b64 = RAW_KEY.toString('base64');
    expect(decodeWebhookSecret(`whsec_${b64}`).equals(RAW_KEY)).toBe(true);
    expect(decodeWebhookSecret(b64).equals(RAW_KEY)).toBe(true);
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', () => {
    const result = verifyWebhookSignature(
      PAYLOAD,
      { id: ID, timestamp: TIMESTAMP, signature: sign(PAYLOAD) },
      SECRET,
      NOW_MS
    );
    expect(result).toEqual({ valid: true });
  });

  it('accepts when a matching signature sits among rotated ones', () => {
    const other = sign(PAYLOAD, ID, TIMESTAMP, Buffer.from('old-key'));
    const result = verifyWebhookSignature(
      PAYLOAD,
      {
        id: ID,
        timestamp: TIMESTAMP,
        signature: `${other} ${sign(PAYLOAD)}`,
      },
      SECRET,
      NOW_MS
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const result = verifyWebhookSignature(
      PAYLOAD.replace('a@b.co', 'evil@x.co'),
      { id: ID, timestamp: TIMESTAMP, signature: sign(PAYLOAD) },
      SECRET,
      NOW_MS
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a signature made with the wrong key', () => {
    const result = verifyWebhookSignature(
      PAYLOAD,
      {
        id: ID,
        timestamp: TIMESTAMP,
        signature: sign(PAYLOAD, ID, TIMESTAMP, Buffer.from('wrong')),
      },
      SECRET,
      NOW_MS
    );
    expect(result.valid).toBe(false);
  });

  it('rejects missing headers', () => {
    for (const headers of [
      { id: null, timestamp: TIMESTAMP, signature: sign(PAYLOAD) },
      { id: ID, timestamp: null, signature: sign(PAYLOAD) },
      { id: ID, timestamp: TIMESTAMP, signature: null },
    ]) {
      expect(
        verifyWebhookSignature(PAYLOAD, headers, SECRET, NOW_MS).valid
      ).toBe(false);
    }
  });

  it('rejects timestamps outside the tolerance window (replay guard)', () => {
    const staleTs = String(
      Math.floor(NOW_MS / 1000) - WEBHOOK_TOLERANCE_SECONDS - 1
    );
    const result = verifyWebhookSignature(
      PAYLOAD,
      { id: ID, timestamp: staleTs, signature: sign(PAYLOAD, ID, staleTs) },
      SECRET,
      NOW_MS
    );
    expect(result.valid).toBe(false);
    // ...but a timestamp just inside the window passes.
    const freshTs = String(
      Math.floor(NOW_MS / 1000) - WEBHOOK_TOLERANCE_SECONDS + 5
    );
    expect(
      verifyWebhookSignature(
        PAYLOAD,
        { id: ID, timestamp: freshTs, signature: sign(PAYLOAD, ID, freshTs) },
        SECRET,
        NOW_MS
      ).valid
    ).toBe(true);
  });

  it('rejects non-v1 signature schemes', () => {
    const sig = sign(PAYLOAD).replace(/^v1,/, 'v2,');
    expect(
      verifyWebhookSignature(
        PAYLOAD,
        { id: ID, timestamp: TIMESTAMP, signature: sig },
        SECRET,
        NOW_MS
      ).valid
    ).toBe(false);
  });
});
