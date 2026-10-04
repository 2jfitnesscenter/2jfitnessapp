// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Chat con entrenadores — member-started support-style threads, in their own data/chat.json.
   No per-member/per-trainer assignment exists anywhere in this app (trainer status is global —
   see server.js's isTrainer), so a thread is between one member and "the trainers" collectively:
   any trainer can see and reply to any thread, mirroring the existing assign-routine/assign-
   program endpoints' global trainer access. Same module-level-cache + atomicWrite shape as
   api/friends/store.js and server.js's own social.json. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encrypt, decrypt } from '../lib/crypto.js';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'chat.json');

/* chat.json is encrypted at rest (AES-256-GCM, lib/crypto.js, domain 'chat-store'). Compatibility rules:
   - READ is dual: a file that starts with '{' is the legacy plain JSON, anything else is the encrypted base64 blob.
   - A legacy file is converted once at boot, atomically (temp file -> verified by decrypting it -> rename), so there is never a moment
     with a half-written chat. Nothing is deleted; a failed conversion leaves the plain file exactly as it was.
   - If the file exists but cannot be read (wrong/missing key, corruption) the store stays EMPTY AND READ-ONLY: it never overwrites the
     file with an empty chat, so fixing the key restores everything.
   - Rollback to a release that only reads plain JSON: scripts/decrypt-chat.mjs (or the pre-deploy backup). */
const INFO = 'chat-store';
const store = { threads: [], messages: [] };
let locked = false;
export const isLocked = () => locked;

const serialize = () => encrypt({ threads: store.threads, messages: store.messages }, INFO);
/* Replaces `file` atomically WITHOUT changing who owns it or who can read it.
   - File already exists: the temp file gets exactly its mode, uid and gid BEFORE the rename, and is re-read to prove it. If any of that
     cannot be done (e.g. chown not permitted), nothing is renamed, the temp file is removed and the error propagates: the original
     chat.json stays byte-for-byte as it was. There is no silent fallback.
   - New file: mode 0600, owner/group of the process.
   `io` is the fs module; tests pass a wrapper to force failures. */
export function atomicWrite(file, content, io = fs) {
  const tmp = file + '.tmp';
  let original = null;
  try { original = io.statSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try {
    if (original) {
      const mode = original.mode & 0o7777;
      io.writeFileSync(tmp, content, { mode });
      io.chmodSync(tmp, mode);                         // writeFileSync's mode is masked by umask and ignored on an existing temp file
      io.chownSync(tmp, original.uid, original.gid);   // no catch: failing to preserve ownership aborts the replacement
      const check = io.statSync(tmp);
      if ((check.mode & 0o7777) !== mode || check.uid !== original.uid || check.gid !== original.gid) throw new Error('chat.json metadata could not be preserved');
    } else {
      io.writeFileSync(tmp, content, { mode: 0o600 });
    }
    io.renameSync(tmp, file);
  } catch (e) {
    try { io.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}
function loadFromDisk() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch { return; }   // first boot — no file yet
  const text = raw.trim();
  if (!text) return;
  const legacy = text.startsWith('{');
  let parsed = null;
  try { parsed = legacy ? JSON.parse(text) : decrypt(text, INFO); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') { locked = true; console.error('chat: chat.json cannot be read (key or file problem); chat is read-only until fixed'); return; }
  store.threads = Array.isArray(parsed.threads) ? parsed.threads : [];
  store.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  if (legacy) {
    try {
      const blob = serialize();
      const check = decrypt(blob, INFO);
      if (!check || check.messages.length !== store.messages.length || check.threads.length !== store.threads.length) throw new Error('verification failed');
      atomicWrite(FILE, blob);
    } catch (e) { console.error('chat: encryption of chat.json postponed:', e.message); }
  }
}
loadFromDisk();
function save() {
  if (locked) { console.error('chat: write skipped, chat.json is locked (unreadable)'); return; }
  atomicWrite(FILE, serialize());
}

export function threadsOf(memberId) {
  return store.threads.filter(t => t.memberId === memberId || (t.kind === 'direct' && t.recipientId === memberId)).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function allThreads() {
  return [...store.threads].sort((a, b) => b.updatedAt - a.updatedAt);
}
export function findThread(id) {
  return store.threads.find(t => t.id === id) || null;
}
export function createThread(memberId, text) {
  const now = Date.now();
  const thread = { id: crypto.randomBytes(9).toString('base64url'), memberId, status: 'open', createdAt: now, updatedAt: now, readBy: {} };
  store.threads.push(thread);
  const message = { id: crypto.randomBytes(9).toString('base64url'), threadId: thread.id, authorId: memberId, authorRole: 'member', text, createdAt: now };
  store.messages.push(message);
  save();
  return { thread, message };
}
export function findDirect(a, b) {
  return store.threads.find(t => t.kind === 'direct' && ((t.memberId === a && t.recipientId === b) || (t.memberId === b && t.recipientId === a))) || null;
}
export function createDirect(a, b) {
  const now = Date.now();
  const thread = { id: crypto.randomBytes(9).toString('base64url'), kind: 'direct', memberId: a, recipientId: b, status: 'open', createdAt: now, updatedAt: now, readBy: {} };
  store.threads.push(thread); save(); return thread;
}
export function messagesOf(threadId) {
  return store.messages.filter(m => m.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt);
}
export function findShareMessage(shareId) { return store.messages.find(m => m.type === 'share' && m.shareId === shareId) || null; }
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
export function addShareMessage(threadId, authorId, authorRole, shareId) {
  const now = Date.now();
  const message = { id: crypto.randomBytes(9).toString('base64url'), threadId, authorId, authorRole, type: 'share', shareId: String(shareId).slice(0, 100), createdAt: now };
  store.messages.push(message);
  const thread = store.threads.find(t => t.id === threadId);
  if (thread) thread.updatedAt = now;
  save(); return message;
}
export function markRead(threadId, userId) {
  const thread = store.threads.find(t => t.id === threadId);
  if (!thread) return;
  if (!thread.readBy) thread.readBy = {};
  thread.readBy[userId] = Date.now();
  save();
}
export function setStatus(threadId, status) {
  const thread = store.threads.find(t => t.id === threadId);
  if (!thread) return null;
  thread.status = status;
  thread.updatedAt = Date.now();
  save();
  return thread;
}

/* Account erasure: removes every thread the person is part of (support threads they started, direct threads with them) with all its
   messages, plus any message they wrote elsewhere. Returns what was removed. A locked (unreadable) store is never touched. */
export function removeUser(uid) {
  if (locked) return { threads: 0, messages: 0, skipped: true };
  const gone = new Set(store.threads.filter(t => t.memberId === uid || t.recipientId === uid).map(t => t.id));
  const before = { threads: store.threads.length, messages: store.messages.length };
  store.threads = store.threads.filter(t => !gone.has(t.id));
  store.messages = store.messages.filter(m => !gone.has(m.threadId) && m.authorId !== uid);
  store.threads.forEach(t => { if (t.readBy) delete t.readBy[uid]; });
  if (before.threads !== store.threads.length || before.messages !== store.messages.length) save();
  return { threads: before.threads - store.threads.length, messages: before.messages - store.messages.length };
}
/** Data-portability: the person's own messages (their words), with the thread each belongs to. Nobody else's text is included. */
export function exportUser(uid) {
  const mine = store.threads.filter(t => t.memberId === uid || t.recipientId === uid);
  const ids = new Set(mine.map(t => t.id));
  return {
    threads: mine.map(t => ({ id: t.id, kind: t.kind || 'support', createdAt: t.createdAt, withUserId: t.kind === 'direct' ? (t.memberId === uid ? t.recipientId : t.memberId) : null })),
    messages: store.messages.filter(m => ids.has(m.threadId) && m.authorId === uid).map(m => ({ id: m.id, threadId: m.threadId, type: m.type || 'text', text: m.text ?? null, createdAt: m.createdAt })),
  };
}
