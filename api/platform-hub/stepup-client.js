import { z } from 'zod';
import { HUB_PATHS, HUB_STEPUP } from './config.js';
import { CORRELATION } from './redeem-client.js';
import { signHubRequest } from './service-auth.js';

// F9d-2 · Server-to-server redemption of a Platform step-up code (2JHub contract §9). Same transport rules as the SSO redemption (F9b):
// signed 2J-SERVICE-AUTH-V1, 5 s timeout, no redirects, strict schema; anything outside the contract is refused.

const CODE = z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/);
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const stepupRequestSchema = z.object({
  v: z.literal(1), code: CODE, audience: z.literal(HUB_STEPUP.audience), destination: z.literal(HUB_STEPUP.destination), correlationId: CORRELATION,
}).strict();
export const stepupResponseSchema = z.object({
  v: z.literal(1), issuer: z.literal(HUB_STEPUP.issuer), audience: z.literal(HUB_STEPUP.audience), personId: UUID,
  trainingUserId: z.string().min(1).max(200), purpose: z.enum(HUB_STEPUP.purposes), assurance: z.literal(HUB_STEPUP.assurance),
  verifiedAt: z.string().datetime(), correlationId: CORRELATION,
}).strict();

const MAX_BYTES = 16 * 1024;

/** @returns { status: 'ok', data } | { status: 'rejected' } | { status: 'unavailable' } | { status: 'invalid' } (like the SSO client) */
export function createStepupRedeemClient({ client, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000 }) {
  return async function redeemStepup({ code, correlationId }) {
    if (!client) return { status: 'unavailable' };
    const payload = stepupRequestSchema.safeParse({ v: 1, code, audience: HUB_STEPUP.audience, destination: HUB_STEPUP.destination, correlationId });
    if (!payload.success) return { status: 'rejected' };
    const body = Buffer.from(JSON.stringify(payload.data), 'utf8');
    const timestamp = new Date(now()).toISOString(), requestId = globalThis.crypto.randomUUID();
    const { signature } = signHubRequest({ keyId: client.keyId, secret: client.secret, timestamp, requestId, method: 'POST', target: HUB_PATHS.stepupRedeem, body });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(HUB_PATHS.stepupRedeem, client.baseUrl), {
        method: 'POST', redirect: 'error', signal: controller.signal, body,
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-2j-key-id': client.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature },
      });
      if (response.status >= 500 || response.status === 408 || response.status === 429) return { status: 'unavailable' };
      if (response.status !== 200) return { status: 'rejected', httpStatus: response.status };
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { status: 'invalid' };
      let json;
      try { json = JSON.parse(text); } catch { return { status: 'invalid' }; }
      const parsed = stepupResponseSchema.safeParse(json);
      return parsed.success ? { status: 'ok', data: parsed.data } : { status: 'invalid' };
    } catch { return { status: 'unavailable' }; }
    finally { clearTimeout(timer); }
  };
}
