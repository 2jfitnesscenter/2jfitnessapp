// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* A member's right to take their data with them (export) and to have it removed (erasure).
   Everything is injected (the server owns `db` and `social`; the stores own their files) so the logic is testable and has ONE list of
   places where a person's data lives. Adding a new per-person store means adding it here — the erasure test fails if a seeded
   identifier survives anywhere on disk.

   RETENTION: nothing about a deleted member is kept. The only residue is anonymous and by design: gym-wide machine/import aliases (they hold
   no person), and an invite code stays single-use (`usedBy` becomes "deleted-account", so a code cannot be redeemed twice).
   Staff accounts (admin/trainer) cannot be erased this way: their content (library, programs, news, guided routines) belongs to the gym,
   so an admin must first remove the role. Provider tokens (WHOOP/Strava) are deleted with the record; revoking the app on the provider's
   side is the member's own step (they are told so). */
import fs from 'node:fs';
import path from 'node:path';

const own = (list, uid) => (list || []).filter(x => x.authorId === uid);
const imagesOf = items => items.map(x => x.image).filter(Boolean);

export class ErasureError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }

export function exportMember(d, uid) {
  const user = d.db.users.find(u => u.id === uid);
  if (!user) throw new ErasureError('no_user', 'cuenta no encontrada', 404);
  const state = d.readState(uid);
  if (state) { state._sync = undefined; }
  const s = d.social;
  const commentsMine = (kind, list) => (list || []).flatMap(p => (p.comments || []).filter(c => c.authorId === uid).map(c => ({ in: kind, postId: p.id, ...c })));
  return {
    format: '2j-account-export', version: 1, exportedAt: new Date().toISOString(),
    account: {
      id: user.id, name: user.name, username: user.username || null, created: user.created || null, hasAvatar: !!user.avatar,
      invitedBy: user.invitedBy || null, integrations: { strava: !!user.stravaAuth, whoop: !!user.whoopAuth },
      passkeys: d.db.creds.filter(c => c.userId === uid).map(c => ({ id: c.id, name: c.name || null, created: c.createdAt || c.created || null, lastUsed: c.lastUsedAt || null, transports: c.transports || null })),
      pushSubscriptions: d.db.subs.filter(x => x.userId === uid).length,
    },
    state: state || null,
    chat: d.chat.exportUser(uid),
    friends: d.friends.exportUser(uid),
    notifications: d.notifications.exportUser(uid),
    sharing: d.sharing.exportUser(uid),
    bunker: d.bunker.exportUser(uid),
    social: {
      routines: own(s.routines, uid), programs: own(s.programs, uid), wall: own(s.wall, uid), topics: own(s.topics, uid), board: own(s.board, uid),
      challengesAuthored: own(s.challenges, uid), challengesJoined: (s.challenges || []).filter(c => c.authorId !== uid && (c.participants || []).includes(uid)).map(c => ({ id: c.id, name: c.name })),
      goals: (s.goals || []).filter(g => g.userId === uid),
      comments: [...commentsMine('wall', s.wall), ...commentsMine('topics', s.topics), ...commentsMine('board', s.board)],
    },
  };
}

export function eraseMember(d, uid) {
  const user = d.db.users.find(u => u.id === uid);
  if (!user) throw new ErasureError('no_user', 'cuenta no encontrada', 404);
  if (d.isStaff(user)) throw new ErasureError('staff', 'las cuentas de administración o entrenador no se pueden borrar desde aquí: un administrador debe quitar antes el rol', 403);
  const report = {};
  const s = d.social;

  // 1. everything on disk that will lose its owner's reference: collect the uploaded images before the references disappear
  const uploads = new Set();
  if (user.avatar) uploads.add(user.avatar);
  let stateText = '';
  try { stateText = JSON.stringify(d.readState(uid) || {}); } catch { /* unreadable state: nothing to scan */ }
  try { for (const f of fs.readdirSync(d.uploadsDir)) if (stateText.includes(f)) uploads.add(f); } catch { /* no uploads folder */ }

  // 2. stores that own a file each
  report.chat = d.chat.removeUser(uid);
  report.friends = d.friends.removeUser(uid);
  report.notifications = d.notifications.removeUser(uid);
  report.sharing = d.sharing.removeUser(uid);
  report.bunker = d.bunker.removeUser(uid);
  d.clearCoach?.(uid);

  // 3. the community file
  const gone = { routines: own(s.routines, uid), programs: own(s.programs, uid), wall: own(s.wall, uid), topics: own(s.topics, uid), board: own(s.board, uid), challenges: own(s.challenges, uid) };
  imagesOf([...gone.routines, ...gone.programs, ...gone.wall, ...gone.topics, ...gone.board]).forEach(i => uploads.add(i));
  for (const k of ['routines', 'programs', 'wall', 'topics', 'board', 'challenges']) s[k] = (s[k] || []).filter(x => x.authorId !== uid);
  for (const k of ['wall', 'topics', 'board']) (s[k] || []).forEach(p => { if (p.comments) p.comments = p.comments.filter(c => c.authorId !== uid); });
  (s.challenges || []).forEach(c => { if (c.participants) c.participants = c.participants.filter(p => p !== uid); });
  const goalsBefore = (s.goals || []).length; s.goals = (s.goals || []).filter(g => g.userId !== uid);
  report.social = { posts: Object.values(gone).reduce((n, l) => n + l.length, 0), goals: goalsBefore - s.goals.length };
  d.saveSocial();

  // 4. the member's state (workouts, body, Health aggregates, notes …) and the files it referenced
  try { fs.unlinkSync(d.stateFile(uid)); report.state = true; } catch { report.state = false; }
  let removedUploads = 0;
  for (const f of uploads) { try { d.deleteUploadedImage(f); removedUploads++; } catch { /* already gone */ } }
  report.uploads = removedUploads;

  // 5. accounts file last: if anything above failed halfway the account still exists and the operation can simply be repeated
  const before = { creds: d.db.creds.length, subs: d.db.subs.length, restAlerts: (d.db.restAlerts || []).length, rec: d.db.recoveries.length, req: (d.db.recoveryRequests || []).length };
  d.db.creds = d.db.creds.filter(c => c.userId !== uid);
  d.db.subs = d.db.subs.filter(x => x.userId !== uid);
  d.db.restAlerts = (d.db.restAlerts || []).filter(x => x.userId !== uid);
  d.db.recoveries = d.db.recoveries.filter(r => r.userId !== uid);
  d.db.recoveryRequests = (d.db.recoveryRequests || []).filter(r => r.matchedUserId !== uid);
  d.db.invites.forEach(i => { if (i.usedBy === uid) i.usedBy = 'deleted-account'; });
  d.db.users = d.db.users.filter(u => u.id !== uid);
  report.account = { passkeys: before.creds - d.db.creds.length, pushSubscriptions: before.subs - d.db.subs.length, restAlerts: before.restAlerts - d.db.restAlerts.length, recoveryLinks: before.rec - d.db.recoveries.length };
  d.saveDb();
  d.forgetRuntime?.(uid);
  return report;
}
