/* Chat con entrenadores — member-started support-style threads, in their own data/chat.json.
   No per-member/per-trainer assignment exists anywhere in this app (trainer status is global —
   see server.js's isTrainer), so a thread is between one member and "the trainers" collectively:
   any trainer can see and reply to any thread, mirroring the existing assign-routine/assign-
   program endpoints' global trainer access. Same module-level-cache + atomicWrite shape as
   api/friends/store.js and server.js's own social.json. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'chat.json');

const store = { threads: [], messages: [] };
try {
  const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  store.threads = Array.isArray(parsed.threads) ? parsed.threads : [];
  store.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
} catch { /* first boot — no file yet */ }

function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
function save() { atomicWrite(FILE, JSON.stringify(store, null, 2)); }

export function threadsOf(memberId) {
  return store.threads.filter(t => t.memberId === memberId).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function allThreads() {
  return [...store.threads].sort((a, b) => b.updatedAt - a.updatedAt);
}
export function findThread(id) {
  return store.threads.find(t => t.id === id) || null;
}
export function createThread(memberId, text) {
  const now = Date.now();
  const thread = { id: crypto.randomBytes(9).toString('base64url'), memberId, status: 'open', createdAt: now, updatedAt: now };
  store.threads.push(thread);
  const message = { id: crypto.randomBytes(9).toString('base64url'), threadId: thread.id, authorId: memberId, authorRole: 'member', text, createdAt: now };
  store.messages.push(message);
  save();
  return { thread, message };
}
export function messagesOf(threadId) {
  return store.messages.filter(m => m.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt);
}
export function lastMessageOf(threadId) {
  const msgs = messagesOf(threadId);
  return msgs.length ? msgs[msgs.length - 1] : null;
}
export function addMessage(threadId, authorId, authorRole, text) {
  const now = Date.now();
  const message = { id: crypto.randomBytes(9).toString('base64url'), threadId, authorId, authorRole, text, createdAt: now };
  store.messages.push(message);
  const thread = store.threads.find(t => t.id === threadId);
  if (thread) thread.updatedAt = now;
  save();
  return message;
}
export function setStatus(threadId, status) {
  const thread = store.threads.find(t => t.id === threadId);
  if (!thread) return null;
  thread.status = status;
  thread.updatedAt = Date.now();
  save();
  return thread;
}
