import { z } from 'zod';
import { HUB_PATHS, HUB_SSO } from './config.js';
import { signHubRequest } from './service-auth.js';

// F9b · Server-to-server redemption of a Home SSO code with Platform (2JHub contract §2.2).
// The answer carries identity only (no capabilities): those are asked separately through GET …/training-capabilities.

const CODE = z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const CORRELATION = z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/);
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const redeemRequestSchema = z.object({
  v: z.literal(1), code: CODE, audience: z.literal(HUB_SSO.audience), destination: z.literal(HUB_SSO.destination), correlationId: CORRELATION,
}).strict();
/** `ssoCodeRedemptionResponse` as F9a extended it (`displayName`, `assurance`). Anything else is refused. */
export const redeemResponseSchema = z.object({
  v: z.literal(1), issuer: z.literal(HUB_SSO.issuer), audience: z.literal(HUB_SSO.audience), personId: UUID,
  trainingUserId: z.string().min(1).max(200), linkStatus: z.literal('active'), displayName: z.string().min(1).max(200),
  assurance: z.literal(HUB_SSO.assurance), correlationId: CORRELATION,
}).strict();

const MAX_BYTES = 16 * 1024;

/**
 * @returns { status: 'ok', data } | { status: 'rejected' } (Platform said no: code unknown/used/expired, no link, suspended…)
 *          | { status: 'unavailable' } (network, timeout, 5xx, not configured) | { status: 'invalid' } (an answer outside the contract)
 */
export function createRedeemClient({ client, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000 }) {
  return async function redeem({ code, correlationId }) {
    if (!client) return { status: 'unavailable' };
    const payload = redeemRequestSchema.safeParse({ v: 1, code, audience: HUB_SSO.audience, destination: HUB_SSO.destination, correlationId });
    if (!payload.success) return { status: 'rejected' };
    const body = Buffer.from(JSON.stringify(payload.data), 'utf8');
    const timestamp = new Date(now()).toISOString(), requestId = globalThis.crypto.randomUUID();
    const { signature } = signHubRequest({ keyId: client.keyId, secret: client.secret, timestamp, requestId, method: 'POST', target: HUB_PATHS.redeem, body });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(HUB_PATHS.redeem, client.baseUrl), {
        method: 'POST', redirect: 'error', signal: controller.signal, body,
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-2j-key-id': client.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature },
      });
      if (response.status >= 500 || response.status === 408 || response.status === 429) return { status: 'unavailable' };
      if (response.status !== 200) return { status: 'rejected', httpStatus: response.status };
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { status: 'invalid' };
      let json;
      try { json = JSON.parse(text); } catch { return { status: 'invalid' }; }
      const parsed = redeemResponseSchema.safeParse(json);
      return parsed.success ? { status: 'ok', data: parsed.data } : { status: 'invalid' };
    } catch { return { status: 'unavailable' }; }
    finally { clearTimeout(timer); }
  };
}
