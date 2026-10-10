// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Gestión del centro V1 — the read side of the console (Hoy · Miembros · Entrenadores). It composes what already exists and owns no data:
 *  - who is who, who is assigned to whom: db.users (`assignedTrainers`, the one rule `canAccessMember`);
 *  - training activity: the derived summary (lib/user-summary.js) — `lastWorkoutAt`, never `lastSync`, is "trained";
 *  - who needs attention and which reviews are near: the Coach follow-up engine itself (overviewRow / bucketRows), not a second set of rules;
 *  - who is training right now: the in-memory presence.
 * Admin sees everybody. A trainer reads the full row of the members assigned to them; with scope=all the rest of the roster appears as a minimal row
 * (name, avatar, who looks after them) with nothing about their training, and no way in.
 */
import { overviewRow, unreadableRow, bucketRows } from './coach-followup.js';
import { canAccessMember } from './coach-followup-routes.js';
import * as userSummaries from './user-summary.js';

const DAY = 86400000;
const NEW_DAYS = 14;
const LIST = 8;
const todayISO = () => new Date().toISOString().slice(0, 10);
const dayOf = iso => Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z');
export const daysBetween = (fromIso, toIso) => Math.round((dayOf(toIso) - dayOf(fromIso)) / DAY);
const clampDays = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(90, Math.max(3, n)) : 7; };

export function centerRoutes({ db, json, requireTrainer, isAdmin, isTrainer, readState, stateFingerprint, livePresence }) {
  const isMember = u => !u.disabled && !isTrainer(u);
  const summaryOf = u => userSummaries.summaryFor(u.id, { fingerprint: () => stateFingerprint(u.id), read: () => readState(u.id) });
  const nameOf = id => db.users.find(x => x.id === id)?.name || null;
  const trainersOf = u => (Array.isArray(u.assignedTrainers) ? u.assignedTrainers : []).map(id => ({ id, name: nameOf(id) })).filter(t => t.name);
  const roleOf = u => (isAdmin(u) ? 'admin' : isTrainer(u) ? 'trainer' : 'member');
  const minimal = u => ({ id: u.id, name: u.name, avatar: u.avatar || null, assigned: false, assignedTrainers: trainersOf(u) });

  // The members a staff member may read in depth, as Coach rows (one decrypt each, once per request).
  const coachRows = (staff, today) => {
    const rows = [];
    for (const u of db.users) {
      if (!isMember(u) || !canAccessMember(staff, u, isAdmin)) continue;
      try { rows.push({ u, row: overviewRow({ S: readState(u.id) || {}, u, today }) }); } catch { rows.push({ u, row: unreadableRow(u) }); }
    }
    return rows;
  };

  return {
    /* ------------------------------ Miembros ------------------------------ */
    'GET /api/center/members': async (req, res) => {
      const staff = requireTrainer(req, res); if (!staff) return;
      const admin = isAdmin(staff);
      const asked = new URL(req.url, 'http://x').searchParams.get('scope');
      const scope = admin ? 'all' : asked === 'all' ? 'all' : 'assigned';
      userSummaries.prune(db.users.map(u => u.id));
      const users = [];
      for (const u of db.users) {
        if (!admin && isTrainer(u)) continue;                                  // a trainer's roster is members only
        const mine = canAccessMember(staff, u, isAdmin);
        if (!mine) { if (scope === 'all' && !u.disabled) users.push(minimal(u)); continue; }
        const sum = summaryOf(u), live = livePresence(u.id);
        users.push({
          id: u.id, name: u.name, avatar: u.avatar || null, assigned: true, role: roleOf(u), disabled: !!u.disabled, created: u.created || null,
          assignedTrainers: trainersOf(u), workoutCount: sum.workoutCount, lastWorkoutAt: sum.lastWorkoutAt,
          activeNow: !!live, live: live ? { name: live.name || null } : null,
          ...(sum.unreadable ? { stateUnreadable: true } : {}),
          ...(admin ? { lastSync: sum.lastSync } : {}),
        });
      }
      const trainers = admin ? db.users.filter(u => !u.disabled && isTrainer(u) && u.trainer === true).map(u => ({ id: u.id, name: u.name })) : [];
      json(res, 200, { scope, admin, today: todayISO(), users, trainers });
    },

    /* ------------------------------ Hoy ------------------------------ */
    'GET /api/center/today': async (req, res) => {
      const staff = requireTrainer(req, res); if (!staff) return;
      const q = new URL(req.url, 'http://x').searchParams;
      const days = clampDays(q.get('days'));
      const today = todayISO();
      const scoped = coachRows(staff, today);
      const sums = scoped.map(({ u, row }) => ({ u, row, sum: summaryOf(u) }));
      const buckets = bucketRows(scoped.map(x => x.row));
      const ago = s => (s.lastWorkoutAt ? daysBetween(s.lastWorkoutAt, today) : null);
      const created = u => (u.created ? String(u.created).slice(0, 10) : null);
      const live = sums.filter(x => livePresence(x.u.id)).map(x => ({ id: x.u.id, name: x.u.name, avatar: x.u.avatar || null, workout: livePresence(x.u.id).name || null }));
      const fresh = sums.filter(x => created(x.u) && daysBetween(created(x.u), today) < NEW_DAYS && daysBetween(created(x.u), today) >= 0)
        .sort((a, b) => created(b.u).localeCompare(created(a.u)));
      // "Not training": a plain list by the number of days the viewer chose. A member younger than that has not had the time yet; one who never trained is listed once old enough.
      const idle = sums.map(x => ({ ...x, since: ago(x.sum) }))
        .filter(x => (x.since === null ? created(x.u) && daysBetween(created(x.u), today) >= days : x.since >= days))
        .sort((a, b) => (b.since ?? 1e9) - (a.since ?? 1e9) || String(a.u.name).localeCompare(String(b.u.name)));
      const within = n => sums.filter(x => { const d = ago(x.sum); return d !== null && d >= 0 && d < n; }).length;
      json(res, 200, {
        today, days, scope: isAdmin(staff) ? 'all' : 'assigned', members: sums.length,
        activity: { activeNow: live.length, trainedToday: sums.filter(x => ago(x.sum) === 0).length, trained7d: within(7), trained30d: within(30), newMembers: fresh.length, neverTrained: sums.filter(x => x.sum.workoutCount === 0).length },
        activeNow: live.slice(0, LIST),
        attention: { count: buckets.counts.attention, list: buckets.attention.slice(0, LIST).map(brief) },
        upcoming: { count: buckets.counts.upcoming, list: buckets.upcoming.slice(0, LIST).map(brief) },
        newMembers: { count: fresh.length, list: fresh.slice(0, LIST).map(x => ({ id: x.u.id, name: x.u.name, avatar: x.u.avatar || null, created: created(x.u), workoutCount: x.sum.workoutCount })) },
        idle: { count: idle.length, list: idle.slice(0, LIST).map(x => ({ id: x.u.id, name: x.u.name, avatar: x.u.avatar || null, daysSince: x.since, lastWorkoutAt: x.sum.lastWorkoutAt })) },
      });
    },

    /* ------------------------------ Entrenadores ------------------------------ */
    'GET /api/center/trainers': async (req, res) => {
      const staff = requireTrainer(req, res); if (!staff) return;
      const admin = isAdmin(staff);
      const today = todayISO();
      const scoped = coachRows(staff, today).map(x => ({ ...x, sum: summaryOf(x.u) }));
      const stats = list => {
        const rows = list.map(x => x.row);
        const b = bucketRows(rows);
        const last = list.reduce((m, x) => (x.sum.lastWorkoutAt && x.sum.lastWorkoutAt > m ? x.sum.lastWorkoutAt : m), '');
        return { members: list.length, attention: b.counts.attention, upcoming: b.counts.upcoming, trainedLast7d: list.filter(x => x.sum.lastWorkoutAt && daysBetween(x.sum.lastWorkoutAt, today) < 7).length,
          activeNow: list.filter(x => livePresence(x.u.id)).length, lastWorkoutAt: last || null };
      };
      const assignedTo = id => scoped.filter(x => (x.u.assignedTrainers || []).includes(id));
      const people = admin ? db.users.filter(u => !u.disabled && isTrainer(u) && (u.trainer === true || assignedTo(u.id).length)) : [staff];
      const trainers = people.map(u => ({ id: u.id, name: u.name, avatar: u.avatar || null, role: roleOf(u), ...stats(assignedTo(u.id)) }))
        .sort((a, b) => b.attention - a.attention || b.members - a.members || String(a.name).localeCompare(String(b.name)));
      json(res, 200, { today, admin, trainers, unassigned: admin ? stats(scoped.filter(x => !(x.u.assignedTrainers || []).length)) : null });
    },
  };
}

// What the dashboard shows of a Coach row: who, why (the engine's own explained signals) and when. Nothing more.
const brief = r => ({ id: r.id, name: r.name, avatar: r.avatar, level: r.level, signals: r.signals, daysSince: r.daysSince, reviewIn: r.reviewIn, nextReview: r.nextReview, unreadable: !!r.unreadable });
