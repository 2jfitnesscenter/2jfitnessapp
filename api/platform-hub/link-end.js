import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { signHubRequest } from './service-auth.js';

// F9c · When a linked member ERASES their Training account (the existing erasure, unchanged), Training tells Platform so it revokes the link
// (reason `deleted_in_training`) and the next "Abrir Búnker" creates a NEW empty profile. Signed 2J-SERVICE-AUTH-V1 with Training's key to
// Platform (the same one used to redeem codes). The erasure NEVER waits for, depends on or is undone by this notice: it is queued in a small
// persistent outbox (own file) and delivered in the background with backoff, idempotent by `eventId`.
//
// Retention: while queued, an entry holds the Platform person id and the erased Training id (Platform needs both to find the link). It is
// removed on delivery, on a final refusal, or after MAX_AGE (then dropped and audited anonymously). Documented in docs/ACCOUNT_ERASURE.md.

export const LINK_ENDED_PATH = '/api/internal/platform/v2/training-links/ended';
const MAX_AGE_MS = 30 * 24 * 3600_000;
const BASE_DELAY_MS = 30_000, MAX_DELAY_MS = 6 * 3600_000;
const answerSchema = z.object({ v: z.literal(1), eventId: z.string(), status: z.enum(['revoked', 'already_ended']) }).strict();

export function createLinkEndNotifier({ client, dataDir, secEvent, saveDb, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000, setTimer = setTimeout }) {
  const file = path.join(dataDir, 'platform-hub-outbox.json');
  let items = [];
  try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(raw?.items)) items = raw.items; } catch { /* none yet */ }
  let timer = null, running = null;

  const persist = () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ items }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  const audit = (event, reason) => { try { secEvent(event, { meta: { reason } }); saveDb(); } catch { /* never fails a delivery */ } };

  async function deliver(item) {
    if (!client) return 'retry';
    const body = Buffer.from(JSON.stringify({ v: 1, eventId: item.eventId, personId: item.personId, trainingUserId: item.trainingUserId, reason: 'deleted_in_training', endedAt: item.endedAt, correlationId: item.correlationId }), 'utf8');
    const timestamp = new Date(now()).toISOString(), requestId = globalThis.crypto.randomUUID();
    const { signature } = signHubRequest({ keyId: client.keyId, secret: client.secret, timestamp, requestId, method: 'POST', target: LINK_ENDED_PATH, body });
    const controller = new AbortController(), t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(LINK_ENDED_PATH, client.baseUrl), {
        method: 'POST', redirect: 'error', signal: controller.signal, body,
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-2j-key-id': client.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature },
      });
      if (response.status === 200) {
        let json = null;
        try { json = JSON.parse(await response.text()); } catch { /* checked below */ }
        return answerSchema.safeParse(json).success && json.eventId === item.eventId ? 'done' : 'retry';
      }
      // 400/409: Platform will never accept this notice (no such link, bad body): final. 401/404/429/5xx: key or switch not ready yet → retry.
      return response.status === 400 || response.status === 409 ? 'refused' : 'retry';
    } catch { return 'retry'; }
    finally { clearTimeout(t); }
  }

  function schedule() {
    if (timer || !items.length) return;
    const next = Math.min(...items.map(item => item.nextAt));
    timer = setTimer(() => { timer = null; void run(); }, Math.max(0, next - now()));
    timer?.unref?.();
  }

  async function run() {
    if (running) return running;
    running = (async () => {
      for (const item of [...items]) {
        if (item.nextAt > now()) continue;
        const outcome = await deliver(item);
        if (outcome === 'done' || outcome === 'refused' || now() - Date.parse(item.createdAt) > MAX_AGE_MS) {
          items = items.filter(other => other.eventId !== item.eventId);
          audit(outcome === 'done' ? 'platform_hub_link_end_sent' : 'platform_hub_link_end_dropped', outcome === 'done' ? 'delivered' : outcome === 'refused' ? 'refused' : 'expired');
        } else {
          item.attempts += 1;
          item.nextAt = now() + Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(item.attempts - 1, 16));
        }
        persist();
      }
    })().finally(() => { running = null; schedule(); });
    return running;
  }

  if (items.length) schedule();

  return {
    /** Queue the notice (persisted first) and try right away in the background. Never throws to the caller. */
    enqueue({ personId, trainingUserId }) {
      try {
        const at = new Date(now()).toISOString();
        items.push({ eventId: globalThis.crypto.randomUUID(), personId, trainingUserId, correlationId: `erasure-${globalThis.crypto.randomUUID()}`, endedAt: at, createdAt: at, attempts: 0, nextAt: now() });
        persist();
        void run();
        return true;
      } catch { return false; }
    },
    pending: () => items.map(item => ({ ...item })),
    run,
  };
}
