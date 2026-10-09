// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* HTTP surface for Chat con entrenadores — factory taking server.js's own helpers, same
 * reasoning as api/coach/routes.js and api/friends/routes.js.
 */
import * as store from './store.js';
import { LIMITS } from '../lib/social-limits.js';

const MAX_TEXT = 2000;

/** The one rule for who may read a thread: a direct chat needs both people and a live, unblocked friendship; support is the member, an admin or the assigned trainer. */
export const makeCanRead = ({ isTrainer, canReachMember, isFriend }) => (thread, user) => thread.kind === 'direct'
  ? ((thread.memberId === user.id || thread.recipientId === user.id) && isFriend(thread.memberId, thread.recipientId))
  : (thread.memberId === user.id || (isTrainer(user) && canReachMember(user, thread.memberId)));

export function chatRoutes({ json, readBody, readSession, sendPush, isTrainer, canReachMember = () => false, limit = () => ({ ok: true }), users, isFriend = () => false, notify = () => {}, markThreadNotificationsRead = () => {}, resolveShare = () => null }) {
  const guard = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'no has iniciado sesión' }); return null; }
    return user;
  };
  const throttle = (res, user, [bucket, max, windowMs]) => {
    const r = limit(user.id, bucket, max, windowMs);
    if (r.ok) return false;
    json(res, 429, { error: 'vas demasiado rápido; espera un momento', code: 'rate_limited' }, { 'Retry-After': String(r.retryAfter) });
    return true;
  };
  const memberName = id => (users().find(u => u.id === id) || {}).name || null;
  const canRead = makeCanRead({ isTrainer, canReachMember, isFriend });
  // `unread` is per-viewer: a thread is unread for you when the last message wasn't written
  // by you and arrived after the last time you (specifically) opened it — tracked per user id
  // in thread.readBy so every trainer has their own read state on a thread they all share.
  const preview = (thread, viewerId) => {
    const last = store.lastMessageOf(thread.id);
    const readAt = (thread.readBy || {})[viewerId] || 0;
    return {
      id: thread.id, memberId: thread.memberId, status: thread.status,
      createdAt: thread.createdAt, updatedAt: thread.updatedAt,
      lastMessage: last ? { type: last.type || 'text', text: last.type === 'share' ? 'Shared content' : last.type === 'removed' ? '' : last.text, authorRole: last.authorRole, createdAt: last.createdAt } : null,
      unread: !!last && last.authorId !== viewerId && last.createdAt > readAt
    };
  };
  const memberIdOf = threadId => store.findThread(threadId)?.memberId;
  const notifyTrainers = (fromId, fromName, text, threadId) => {
    users().filter(u => isTrainer(u) && u.id !== fromId && canReachMember(u, memberIdOf(threadId))).forEach(t => {
      notify(t.id, { type: 'message', actor: { id: fromId, name: fromName }, target: { kind: 'chat', id: threadId }, deepLink: '/chat/' + threadId });
      sendPush(t.id, {
      title: 'Nuevo mensaje', body: `${fromName}: ${text.slice(0, 80)}`, tag: 'chat-' + threadId, url: '#/chat/' + threadId
      });
    });
  };

  return {
    'GET /api/chat/threads': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      if (isTrainer(user)) return json(res, 200, { threads: store.allThreads().filter(t => canRead(t, user)).map(t => ({ ...preview(t, user.id), kind: t.kind || 'trainer', memberName: memberName(t.kind === 'direct' && t.memberId === user.id ? t.recipientId : t.memberId) })) });
      json(res, 200, { threads: store.threadsOf(user.id).filter(t => canRead(t, user)).map(t => ({ ...preview(t, user.id), kind: t.kind || 'trainer', memberName: t.kind === 'direct' ? memberName(t.memberId === user.id ? t.recipientId : t.memberId) : undefined })) });
    },

    'POST /api/chat/direct': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req); const peerId = String(body.userId || '');
      if (!peerId || peerId === user.id || !isFriend(user.id, peerId)) return json(res, 403, { error: 'solo puedes iniciar un chat con una amistad aceptada' });
      const peer = users().find(u => u.id === peerId);
      if (!peer) return json(res, 404, { error: 'esa persona ya no está disponible' });
      const thread = store.findDirect(user.id, peerId) || store.createDirect(user.id, peerId);
      json(res, 200, { ok: true, thread: { ...preview(thread, user.id), kind: 'direct', memberName: peer.name } });
    },

    'POST /api/chat/threads': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      const text = String(body.text || '').trim().slice(0, MAX_TEXT);
      if (!text) return json(res, 400, { error: 'escribe un mensaje' });
      if (throttle(res, user, LIMITS.supportThread)) return;
      const { thread } = store.createThread(user.id, text);
      notifyTrainers(user.id, user.name, text, thread.id);
      json(res, 200, { ok: true, thread: preview(thread, user.id) });
    },

    'GET /api/chat/messages': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const params = new URL(req.url, 'http://x').searchParams;
      const threadId = params.get('threadId') || '';
      const thread = store.findThread(threadId);
      if (!thread) return json(res, 404, { error: 'esa conversación no existe' });
      if (!canRead(thread, user)) return json(res, 403, { error: 'prohibido' });
      store.markRead(thread.id, user.id);
      markThreadNotificationsRead(user.id, thread.id);
      // Polling asks only for what is new: `after` is the last message the client holds. A moderation removal moves the thread revision and the
      // client gets the whole thread once; an unknown cursor does the same. Without `after` the answer is the whole thread, as before.
      const all = store.messagesOf(thread.id);
      const rev = store.revOf(thread.id);
      const after = params.get('after') || '';
      const at = after && String(rev) === (params.get('rev') ?? String(rev)) ? all.findIndex(m => m.id === after) : -1;
      const fresh = at >= 0 ? all.slice(at + 1) : all;
      const messages = fresh.map(m => m.type === 'share'
        ? { ...m, share: resolveShare(m.shareId, user) }
        : m);
      json(res, 200, { full: at < 0, rev, thread: { ...preview(thread, user.id), kind: thread.kind || 'trainer', memberName: memberName(thread.kind === 'direct' && thread.memberId === user.id ? thread.recipientId : thread.memberId) }, messages });
    },

    'POST /api/chat/messages': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      const thread = store.findThread(body.threadId);
      if (!thread) return json(res, 404, { error: 'esa conversación no existe' });
      if (!canRead(thread, user)) return json(res, 403, { error: 'prohibido' });
      if (thread.status === 'closed') return json(res, 400, { error: 'esta conversación está cerrada' });
      const text = String(body.text || '').trim().slice(0, MAX_TEXT);
      if (!text) return json(res, 400, { error: 'escribe un mensaje' });
      if (throttle(res, user, LIMITS.messageBurst) || throttle(res, user, LIMITS.messageHour)) return;
      const role = thread.kind === 'direct' ? 'member' : (thread.memberId === user.id ? 'member' : 'trainer');
      const message = store.addMessage(thread.id, user.id, role, text);
      if (thread.kind === 'direct') {
        const recipientId = thread.memberId === user.id ? thread.recipientId : thread.memberId;
        notify(recipientId, { type: 'message', actor: { id: user.id, name: user.name }, target: { kind: 'chat', id: thread.id }, deepLink: '/chat/' + thread.id });
        sendPush(recipientId, { title: 'Nuevo mensaje', body: text.slice(0, 80), tag: 'chat-' + thread.id, url: '#/chat/' + thread.id });
      } else if (role === 'member') notifyTrainers(user.id, user.name, text, thread.id);
      else {
        notify(thread.memberId, { type: 'message', actor: { id: user.id, name: user.name }, target: { kind: 'chat', id: thread.id }, deepLink: '/chat/' + thread.id });
        sendPush(thread.memberId, { title: 'Tu entrenador ha respondido', body: text.slice(0, 80), tag: 'chat-' + thread.id, url: '#/chat/' + thread.id });
      }
      json(res, 200, { ok: true, message });
    },

    'POST /api/chat/threads/status': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      if (!isTrainer(user)) return json(res, 403, { error: 'prohibido' });
      const body = await readBody(req);
      const existing = store.findThread(body.threadId);
      if (existing?.kind === 'direct' || (existing && !canRead(existing, user))) return json(res, 404, { error: 'esa conversación no existe' });
      const status = body.status === 'closed' ? 'closed' : 'open';
      const thread = store.setStatus(body.threadId, status);
      if (!thread) return json(res, 404, { error: 'esa conversación no existe' });
      json(res, 200, { ok: true, thread: preview(thread, user.id) });
    }
  };
}
