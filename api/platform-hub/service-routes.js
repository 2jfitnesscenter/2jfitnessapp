import crypto from 'node:crypto';
import { z } from 'zod';
import { HUB_PATHS } from './config.js';
import { verifyHubRequest } from './service-auth.js';
import { PROVISIONED_PLACEHOLDER_NAME } from './receiver.js';

// F9b · Platform -> Training service routes of the 2JHub contract (§3): minimal-profile provisioning and the user directory for Admin linking.
// Signed with 2J-SERVICE-AUTH-V1 (Platform's outbound key, our PLATFORM_HUB_INBOUND_KEYS), exact allowlist, single-use request ids in the
// persisted store, strict bodies, generic errors. OFF → the same 404 as a route that does not exist.

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const provisionSchema = z.object({
  v: z.literal(1), personId: UUID, idempotencyKey: z.string().min(16).max(128).regex(/^[\x21-\x7e]+$/), correlationId: z.string().min(1).max(100),
}).strict();
const DIRECTORY_ITEM = /^\/api\/internal\/platform\/v1\/training-users\/([^/]{1,200})$/;
export const HUB_SERVICE_ALLOWLIST = Object.freeze([
  { method: 'POST', path: HUB_PATHS.provision },
  { method: 'GET', path: HUB_PATHS.directory },
  { method: 'GET', path: DIRECTORY_ITEM },
]);
const occupies = link => Boolean(link) && ['pending', 'active'].includes(link.state);
const fold = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function readRaw(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, tooLarge = false;
    req.on('data', chunk => { if (tooLarge) return; size += chunk.length; if (size > max) { tooLarge = true; chunks.length = 0; return; } chunks.push(chunk); });
    req.on('end', () => (tooLarge ? reject(new Error('too_large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export function createHubServiceRoutes({ hub, db, saveDb, secEvent, json, store, generateUsername, isEnvAdmin, legacyProvision, newUserId = () => crypto.randomBytes(12).toString('base64url'), now = Date.now }) {
  db.platformHubProvisioning = db.platformHubProvisioning && typeof db.platformHubProvisioning === 'object' && !Array.isArray(db.platformHubProvisioning) ? db.platformHubProvisioning : {};
  const notFound = res => json(res, 404, { error: 'no encontrado' });
  const audit = (kind, reason, keyId) => { secEvent('platform_hub_service_refused', { meta: { kind, reason, keyId: keyId || null } }); saveDb(); };

  /** Signature, allowlist, freshness, single use. Returns the raw body or null (already answered). */
  async function authenticated(req, res, kind) {
    res.setHeader?.('Cache-Control', 'no-store');
    let raw;
    try { raw = await readRaw(req); } catch { json(res, 413, { error: 'invalid_request' }); return null; }
    const verdict = verifyHubRequest({ method: req.method, requestTarget: req.url, headers: req.headers, body: raw, keys: hub.inboundKeys, allow: HUB_SERVICE_ALLOWLIST, now: now() });
    if (!verdict.ok) { audit(kind, verdict.reason, req.headers['x-2j-key-id']); json(res, 401, { error: 'SERVICE_AUTH_INVALID' }); return null; }
    try {
      if (store.acceptServiceRequest(verdict.requestId, 'platform_hub').status !== 'accepted') { audit(kind, 'replay', verdict.keyId); json(res, 401, { error: 'SERVICE_AUTH_INVALID' }); return null; }
    } catch { json(res, 503, { error: 'unavailable' }); return null; }
    return raw;
  }

  const visible = user => !user.disabled && !isEnvAdmin(user.id);
  const item = user => ({ trainingUserId: user.id, displayName: String(user.name || user.username || user.id).slice(0, 200), ...(user.username ? { username: String(user.username).slice(0, 200) } : {}) });

  async function provision(req, res) {
    const raw = await authenticated(req, res, 'provision'); if (!raw) return;
    if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json(res, 400, { error: 'invalid_request' });
    let body;
    try { body = provisionSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))); } catch { return json(res, 400, { error: 'invalid_request' }); }
    const answer = (status, user) => json(res, status === 'created' ? 201 : 200, { v: 1, status, personId: body.personId, trainingUserId: user.id, linkStatus: 'active', correlationId: body.correlationId });
    const conflict = reason => { secEvent('platform_hub_provision_conflict', { meta: { reason } }); saveDb(); return json(res, 409, { error: 'conflict' }); };
    const hash = crypto.createHash('sha256').update(JSON.stringify({ personId: body.personId, correlationId: body.correlationId })).digest('hex');
    const records = db.platformHubProvisioning;
    const sameKey = records[body.idempotencyKey];
    const userOf = record => db.users.find(candidate => candidate.id === record?.trainingUserId);
    const live = user => user && !user.disabled && user.personId === (user.platformLink?.personId) && user.platformLink?.state === 'active';
    if (sameKey) {
      if (sameKey.requestHash !== hash) return conflict('idempotency_body_mismatch');
      const user = userOf(sameKey);
      return live(user) && user.personId === body.personId ? answer('already_provisioned', user) : conflict('provisioned_user_gone');
    }
    // The same person never gets a second profile, whatever the key (a lost answer retried with a new key still finds the first one).
    const earlier = Object.values(records).find(record => record.personId === body.personId);
    if (earlier) {
      const user = userOf(earlier);
      if (!live(user) || user.personId !== body.personId) return conflict('provisioned_user_gone');
      records[body.idempotencyKey] = { requestHash: hash, personId: body.personId, trainingUserId: user.id, at: new Date(now()).toISOString() };
      saveDb();
      return answer('already_provisioned', user);
    }
    // A person already linked to an existing Training account is never given a new one (and never linked by e-mail or name).
    if (db.users.some(candidate => candidate.personId === body.personId || (occupies(candidate.platformLink) && candidate.platformLink.personId === body.personId))) return conflict('person_already_linked');
    let id = newUserId();
    while (db.users.some(candidate => candidate.id === id)) id = newUserId();
    const created = new Date(now()).toISOString();
    const user = {
      id, name: PROVISIONED_PLACEHOLDER_NAME, created, username: generateUsername(PROVISIONED_PLACEHOLDER_NAME), personId: body.personId,
      // Born through Platform: enforced from the start, never the open legacy behaviour.
      platformEnforcement: 'enforced',
      platformLink: { personId: body.personId, state: 'active', origin: 'hub_provisioned', provisioningKey: body.idempotencyKey, correlationId: body.correlationId, createdAt: created },
    };
    db.users.push(user);
    records[body.idempotencyKey] = { requestHash: hash, personId: body.personId, trainingUserId: id, at: created };
    secEvent('platform_provisioned', { userId: id, meta: { via: 'hub' } });
    saveDb();
    return answer('created', user);
  }

  async function directory(req, res) {
    if (!hub.directoryEnabled) return notFound(res);
    if (!(await authenticated(req, res, 'directory'))) return;
    const url = new URL(req.url, 'http://x');
    const names = [...url.searchParams.keys()];
    const query = url.searchParams.get('query');
    if (names.length !== 1 || names[0] !== 'query' || typeof query !== 'string' || query.trim().length < 2 || query.length > 100) return json(res, 400, { error: 'invalid_request' });
    const needle = fold(query.trim());
    const items = db.users.filter(visible).filter(user => fold(user.name).includes(needle) || fold(user.username).includes(needle))
      .sort((a, b) => fold(a.name).localeCompare(fold(b.name))).slice(0, 50).map(item);
    return json(res, 200, { v: 1, items });
  }

  async function directoryItem(req, res, trainingUserId) {
    if (!hub.directoryEnabled) return notFound(res);
    if (!(await authenticated(req, res, 'directory'))) return;
    const user = db.users.find(candidate => candidate.id === trainingUserId);
    if (!user || !visible(user)) return json(res, 404, { error: 'no encontrado' });
    return json(res, 200, { v: 1, user: item(user) });
  }

  return {
    routes: {
      [`POST ${HUB_PATHS.provision}`]: async (req, res) => (hub.provisioningEnabled ? provision(req, res) : legacyProvision(req, res)),
      // Not even registered while the directory is off: the router answers its usual 404.
      ...(hub.directoryEnabled ? { [`GET ${HUB_PATHS.directory}`]: directory } : {}),
    },
    /** Parametrised route the exact-key router cannot hold. `null` keeps today's 404. */
    resolve(method, pathname) {
      if (!hub.directoryEnabled || method !== 'GET') return null;
      const match = DIRECTORY_ITEM.exec(pathname);
      if (!match) return null;
      let id;
      try { id = decodeURIComponent(match[1]); } catch { return null; }
      return (req, res) => directoryItem(req, res, id);
    },
  };
}
