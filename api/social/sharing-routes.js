import * as store from './sharing-store.js';
import * as chat from '../chat/store.js';
import * as friends from '../friends/store.js';
import * as notifications from '../notifications/store.js';
import { cleanSnapshot, snapshotCard } from '../lib/share-snapshot.js';
import { LIMITS } from '../lib/social-limits.js';

const KINDS = new Set(['workout', 'record', 'achievement', 'streak', 'routine', 'program', 'challenge']);
const REASONS = new Set(['spam', 'inappropriate', 'privacy', 'other']);
export function sharingRoutes({ json, readBody, readSession, users, isAdmin, resolveTarget, canShareWith = () => false, featureOn = () => true, postSnapshot = () => null, moderated = () => {}, limit = () => ({ ok: true }), resolveReported, removeReported, notify = () => {}, sendPush = () => {} }) {
  const throttle = (res, user, [bucket, max, windowMs]) => {
    const r = limit(user.id, bucket, max, windowMs);
    if (r.ok) return false;
    json(res, 429, { error: 'vas demasiado rápido; espera un momento', code: 'rate_limited' }, { 'Retry-After': String(r.retryAfter) });
    return true;
  };
  const guard = (req, res) => { const u = readSession(req); if (!u) { json(res, 401, { error: 'no has iniciado sesión' }); return null; } return u; };
  const directAllowed = (a, b) => a !== b && friends.friendIdsOf(a).includes(b) && friends.friendIdsOf(b).includes(a) && !friends.isBlocked(a, b) && !friends.isBlocked(b, a);
  const visible = (share, viewer) => {
    if (!share || share.authorId === viewer.id) return !!share;
    // A private snapshot is the sender's explicit act towards one friend; the profile/category toggles govern what is visible WITHOUT such an act.
    if (share.audience === 'direct') return share.recipientId === viewer.id && directAllowed(share.authorId, viewer.id) && (!!share.snapshot || canShareWith(share.authorId, viewer.id, share.kind));
    if (share.audience !== 'community') return false;
    const p = notifications.privacyFor(share.authorId);
    const pref = share.kind === 'record' ? p.prs : ['workout'].includes(share.kind) ? p.workouts : ['achievement', 'streak'].includes(share.kind) ? p.achievements : ['routine', 'program'].includes(share.kind) ? p.routines : p.challenges;
    if (pref !== true || p.activity === 'nobody' || p.profile === 'private') return false;
    const friend = directAllowed(share.authorId, viewer.id);
    return friend || (p.profile === 'community' && p.activity === 'community');
  };
  const snapshot = (share, viewer) => {
    if (!visible(share, viewer)) return null;
    const current = share.snapshot ? snapshotCard(share) : resolveTarget(share.authorId, share.kind, share.targetId);
    if (!current) return null;
    return { id: share.id, kind: share.kind, authorId: share.authorId, authorName: share.authorName, targetId: share.targetId, audience: share.audience, createdAt: share.createdAt, card: current,
      ...(share.snapshot ? { private: true, discarded: share.recipientId === viewer.id && !!share.discardedAt } : {}) };
  };
  // A routine or program sent privately to ONE friend: a cleaned snapshot of the plan content, stored with the share. It does not depend on the sender's
  // routine afterwards (delete it, rename it: the receiver keeps what was sent) and nothing is published to the community.
  const sendSnapshot = (user, b, res) => {
    const kind = String(b.kind || '');
    if (b.audience !== 'chat') return json(res, 400, { error: 'un envío privado va a un amigo' });
    if (!featureOn('chat') || !featureOn('friends')) return json(res, 403, { error: 'esta función está desactivada por el gimnasio', code: 'feature_off' });
    const clean = cleanSnapshot(kind, b.snapshot, b.meta && typeof b.meta === 'object' ? b.meta : {});
    if (clean.error) return json(res, 400, { error: clean.error });
    const idempotencyKey = /^[A-Za-z0-9_-]{12,80}$/.test(String(b.idempotencyKey || '')) ? String(b.idempotencyKey) : null;
    const recipientId = String(b.recipientId || ''), threadId = String(b.threadId || '');
    const thread = chat.findThread(threadId);
    if (!directAllowed(user.id, recipientId) || !thread || thread.kind !== 'direct' || !((thread.memberId === user.id && thread.recipientId === recipientId) || (thread.memberId === recipientId && thread.recipientId === user.id))) return json(res, 403, { error: 'conversación no disponible' });
    const previous = idempotencyKey ? store.listShares().find(x => x.authorId === user.id && x.idempotencyKey === idempotencyKey && !x.deletedAt) : null;
    if (previous && (previous.recipientId !== recipientId || previous.kind !== kind || previous.targetId !== clean.targetId)) return json(res, 409, { error: 'idempotency key already used' });
    const share = previous || store.createShare({ authorId: user.id, authorName: user.name, kind, targetId: clean.targetId, audience: 'direct', recipientId, idempotencyKey, snapshot: clean.snapshot, meta: { ...clean.meta, senderLabel: user.name } });
    const message = previous ? chat.findShareMessage(share.id) : chat.addShareMessage(threadId, user.id, 'member', share.id);
    if (!message) return json(res, 409, { error: 'share state incomplete' });
    if (!previous) {
      const n = notify(recipientId, { type: 'share', actor: { id: user.id, name: user.name }, target: { kind: 'share', id: share.id }, deepLink: '/chat/' + threadId, dedupeKey: 'share-message:' + message.id });
      if (n) sendPush(recipientId, { title: 'Contenido compartido', body: `${user.name} te ha enviado ${kind === 'program' ? 'un programa' : 'una rutina'}`, tag: 'share-' + message.id, url: '#/chat/' + threadId }, 'share');
    }
    json(res, 200, { ok: true, message: { ...message, share: snapshot(share, user) }, recipient: users().find(x => x.id === recipientId)?.name || null });
  };
  return {
    'POST /api/social/shares': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const b = await readBody(req);
      if (throttle(res, user, LIMITS.share)) return;
      if (b.snapshot !== undefined) return sendSnapshot(user, b, res);
      // A routine or program the sender already published goes to a friend the same way: as a snapshot of that post, so the receiver can open and save it.
      if (b.audience === 'chat' && ['routine', 'program'].includes(b.kind)) {
        const post = postSnapshot(user.id, b.kind, String(b.targetId || ''));
        if (!post) return json(res, 404, { error: 'ese contenido ya no está disponible' });
        return sendSnapshot(user, { ...b, snapshot: post.snapshot, meta: { ...post.meta, ...(b.meta || {}) } }, res);
      }
      const kind = String(b.kind || ''), targetId = String(b.targetId || '');
      if (!KINDS.has(kind) || !targetId || targetId.length > 100) return json(res, 400, { error: 'contenido no válido' });
      const card = resolveTarget(user.id, kind, targetId);
      if (!card) return json(res, 404, { error: 'ese contenido ya no está disponible' });
      const idempotencyKey = /^[A-Za-z0-9_-]{12,80}$/.test(String(b.idempotencyKey || '')) ? String(b.idempotencyKey) : null;
      if (b.audience === 'chat') {
        if (!featureOn('chat') || !featureOn('friends')) return json(res, 403, { error: 'esta función está desactivada por el gimnasio', code: 'feature_off' });
        const recipientId = String(b.recipientId || ''), threadId = String(b.threadId || '');
        const thread = chat.findThread(threadId);
        if (!directAllowed(user.id, recipientId) || !canShareWith(user.id, recipientId, kind) || !thread || thread.kind !== 'direct' || !((thread.memberId === user.id && thread.recipientId === recipientId) || (thread.memberId === recipientId && thread.recipientId === user.id))) return json(res, 403, { error: 'conversación no disponible' });
        const recipient = users().find(x => x.id === recipientId);
        const previous = idempotencyKey ? store.listShares().find(x => x.authorId === user.id && x.idempotencyKey === idempotencyKey && !x.deletedAt) : null;
        if (previous && (previous.recipientId !== recipientId || previous.kind !== kind || previous.targetId !== targetId)) return json(res, 409, { error: 'idempotency key already used' });
        const share = previous || store.createShare({ authorId: user.id, authorName: user.name, kind, targetId, audience: 'direct', recipientId, idempotencyKey });
        const message = previous ? chat.findShareMessage(share.id) : chat.addShareMessage(threadId, user.id, 'member', share.id);
        if (!message) return json(res, 409, { error: 'share state incomplete' });
        if (previous) return json(res, 200, { ok: true, message: { ...message, share: snapshot(share, user) }, recipient: users().find(x => x.id === recipientId)?.name || null });
        const notificationType = kind === 'challenge' ? 'challenge' : ['achievement', 'streak'].includes(kind) ? 'achievement' : 'share';
        const n = notify(recipientId, { type: notificationType, actor: { id: user.id, name: user.name }, target: { kind: 'share', id: share.id }, deepLink: '/chat/' + threadId, dedupeKey: 'share-message:' + message.id });
        if (n) sendPush(recipientId, { title: kind === 'challenge' ? 'Desafío compartido' : 'Contenido compartido', body: `${user.name} te ha enviado algo`, tag: 'share-' + message.id, url: '#/chat/' + threadId }, notificationType);
        return json(res, 200, { ok: true, message: { ...message, share: snapshot(share, user) }, recipient: recipient?.name || null });
      }
      if (b.audience !== 'community') return json(res, 400, { error: 'destino no válido' });
      const privacy = notifications.privacyFor(user.id);
      const category = kind === 'record' ? 'prs' : kind === 'workout' ? 'workouts' : ['achievement', 'streak'].includes(kind) ? 'achievements' : ['routine', 'program'].includes(kind) ? 'routines' : 'challenges';
      if (privacy[category] !== true || privacy.activity === 'nobody' || privacy.profile === 'private') return json(res, 403, { error: 'revisa tus preferencias de privacidad antes de compartir' });
      const previous = idempotencyKey ? store.listShares().find(x => x.authorId === user.id && x.idempotencyKey === idempotencyKey && !x.deletedAt) : null;
      if (previous && (previous.audience !== 'community' || previous.kind !== kind || previous.targetId !== targetId)) return json(res, 409, { error: 'idempotency key already used' });
      const share = previous || store.createShare({ authorId: user.id, authorName: user.name, kind, targetId, audience: 'community', idempotencyKey });
      json(res, 200, { ok: true, share: snapshot(share, user) });
    },
    'GET /api/social/shares': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const shares = store.listShares().filter(x => x.audience === 'community').map(x => snapshot(x, user)).filter(Boolean);
      json(res, 200, { shares });
    },
    'GET /api/social/shares/item': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      const share = store.findShare(id);
      const item = snapshot(share, user);
      if (!item) return json(res, 404, { error: 'contenido retirado o privado' });
      if (share.snapshot) item.content = { snapshot: share.snapshot, meta: share.meta };
      json(res, 200, { share: item });
    },
    // The receiver sets a private share aside. The conversation keeps its message and the sender is not told.
    'POST /api/social/shares/discard': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const b = await readBody(req);
      const share = store.findShare(String(b.id || ''));
      if (!share || !visible(share, user) || !store.markDiscarded(share.id, user.id)) return json(res, 404, { error: 'contenido no disponible' });
      json(res, 200, { ok: true });
    },
    'POST /api/social/shares/delete': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const b = await readBody(req);
      const before = store.findShare(String(b.id || ''));
      if (!store.deleteShare(String(b.id || ''), user.id, isAdmin(user))) return json(res, 404, { error: 'publicación no disponible' });
      if (before && before.authorId !== user.id) moderated(user, before.authorId, 'share', before.id);
      json(res, 200, { ok: true });
    },
    'POST /api/social/reports': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      if (throttle(res, user, LIMITS.report)) return;
      const b = await readBody(req), targetType = String(b.targetType || ''), targetId = String(b.targetId || ''), reason = String(b.reason || '');
      if (!['share', 'wall', 'routine', 'program', 'challenge', 'topic', 'message', 'comment'].includes(targetType) || !targetId || !REASONS.has(reason)) return json(res, 400, { error: 'informe no válido' });
      const target = resolveReported(user, targetType, targetId);
      if (!target || target.authorId === user.id) return json(res, 404, { error: 'contenido no disponible' });
      const report = store.report({ reporterId: user.id, targetType, targetId, reason });
      if (!report) return json(res, 409, { error: 'ya has enviado un informe pendiente sobre esto' });
      json(res, 200, { ok: true, id: report.id });
    },
    'GET /api/admin/social-reports': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      if (!isAdmin(user)) return json(res, 403, { error: 'prohibido' });
      const reports = store.pendingReports().map(r => ({ ...r, content: resolveReported(user, r.targetType, r.targetId) || null }));
      json(res, 200, { reports });
    },
    'POST /api/admin/social-reports/resolve': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      if (!isAdmin(user)) return json(res, 403, { error: 'prohibido' });
      const b = await readBody(req), status = b.action === 'remove' ? 'removed' : b.action === 'dismiss' ? 'dismissed' : null;
      if (!status) return json(res, 400, { error: 'acción no válida' });
      const report = store.pendingReports().find(x => x.id === b.id);
      if (!report) return json(res, 404, { error: 'informe no disponible' });
      if (status === 'removed' && !removeReported(report.targetType, report.targetId, user, report.reason)) return json(res, 409, { error: 'no se pudo retirar el contenido' });
      store.resolveReport(report.id, user.id, status);
      json(res, 200, { ok: true, status });
    }
  };
}
