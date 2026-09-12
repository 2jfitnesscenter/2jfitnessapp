/* HTTP surface for Chat con entrenadores — factory taking server.js's own helpers, same
 * reasoning as api/coach/routes.js and api/friends/routes.js.
 */
import * as store from './store.js';

const MAX_TEXT = 2000;

export function chatRoutes({ json, readBody, readSession, sendPush, isTrainer, users }) {
  const guard = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'no has iniciado sesión' }); return null; }
    return user;
  };
  const memberName = id => (users().find(u => u.id === id) || {}).name || null;
  const preview = thread => {
    const last = store.lastMessageOf(thread.id);
    return {
      id: thread.id, memberId: thread.memberId, status: thread.status,
      createdAt: thread.createdAt, updatedAt: thread.updatedAt,
      lastMessage: last ? { text: last.text, authorRole: last.authorRole, createdAt: last.createdAt } : null
    };
  };
  const notifyTrainers = (fromName, text, threadId) => {
    users().filter(u => isTrainer(u)).forEach(t => sendPush(t.id, {
      title: 'Nuevo mensaje', body: `${fromName}: ${text.slice(0, 80)}`, tag: 'chat-' + threadId, url: '#/chat/' + threadId
    }));
  };

  return {
    'GET /api/chat/threads': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      if (isTrainer(user)) return json(res, 200, { threads: store.allThreads().map(t => ({ ...preview(t), memberName: memberName(t.memberId) })) });
      json(res, 200, { threads: store.threadsOf(user.id).map(preview) });
    },

    'POST /api/chat/threads': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      const text = String(body.text || '').trim().slice(0, MAX_TEXT);
      if (!text) return json(res, 400, { error: 'escribe un mensaje' });
      const { thread } = store.createThread(user.id, text);
      notifyTrainers(user.name, text, thread.id);
      json(res, 200, { ok: true, thread: preview(thread) });
    },

    'GET /api/chat/messages': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const threadId = new URL(req.url, 'http://x').searchParams.get('threadId') || '';
      const thread = store.findThread(threadId);
      if (!thread) return json(res, 404, { error: 'esa conversación no existe' });
      if (thread.memberId !== user.id && !isTrainer(user)) return json(res, 403, { error: 'prohibido' });
      json(res, 200, { thread: { ...preview(thread), memberName: memberName(thread.memberId) }, messages: store.messagesOf(thread.id) });
    },

    'POST /api/chat/messages': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      const body = await readBody(req);
      const thread = store.findThread(body.threadId);
      if (!thread) return json(res, 404, { error: 'esa conversación no existe' });
      if (thread.memberId !== user.id && !isTrainer(user)) return json(res, 403, { error: 'prohibido' });
      if (thread.status === 'closed') return json(res, 400, { error: 'esta conversación está cerrada' });
      const text = String(body.text || '').trim().slice(0, MAX_TEXT);
      if (!text) return json(res, 400, { error: 'escribe un mensaje' });
      const role = thread.memberId === user.id ? 'member' : 'trainer';
      const message = store.addMessage(thread.id, user.id, role, text);
      if (role === 'member') notifyTrainers(user.name, text, thread.id);
      else sendPush(thread.memberId, { title: 'Tu entrenador ha respondido', body: text.slice(0, 80), tag: 'chat-' + thread.id, url: '#/chat/' + thread.id });
      json(res, 200, { ok: true, message });
    },

    'POST /api/chat/threads/status': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      if (!isTrainer(user)) return json(res, 403, { error: 'prohibido' });
      const body = await readBody(req);
      const status = body.status === 'closed' ? 'closed' : 'open';
      const thread = store.setStatus(body.threadId, status);
      if (!thread) return json(res, 404, { error: 'esa conversación no existe' });
      json(res, 200, { ok: true, thread: preview(thread) });
    }
  };
}
