import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'social-sharing.json');
const state = { shares: [], reports: [] };
try {
  const disk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  state.shares = Array.isArray(disk.shares) ? disk.shares : [];
  state.reports = Array.isArray(disk.reports) ? disk.reports : [];
} catch { /* first boot */ }
function save() {
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}
const id = () => crypto.randomBytes(9).toString('base64url');
export function createShare(value) {
  if (value.idempotencyKey) {
    const existing = state.shares.find(x => x.authorId === value.authorId && x.idempotencyKey === value.idempotencyKey && !x.deletedAt);
    if (existing) return existing;
  }
  const share = { id: id(), ...value, createdAt: Date.now(), deletedAt: null };
  state.shares.push(share); state.shares = state.shares.slice(-5000); save(); return share;
}
export const findShare = shareId => state.shares.find(x => x.id === shareId && !x.deletedAt) || null;
export const listShares = () => state.shares.filter(x => !x.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
export function deleteShare(shareId, actorId, admin = false) {
  const s = findShare(shareId);
  if (!s || (s.authorId !== actorId && !admin)) return false;
  s.deletedAt = Date.now(); save(); return true;
}
export function report(value) {
  const duplicate = state.reports.find(r => r.reporterId === value.reporterId && r.targetType === value.targetType && r.targetId === value.targetId && r.status === 'pending');
  if (duplicate) return null;
  const row = { id: id(), ...value, status: 'pending', createdAt: Date.now(), resolvedAt: null, resolvedBy: null };
  state.reports.push(row); state.reports = state.reports.slice(-5000); save(); return row;
}
export const pendingReports = () => state.reports.filter(x => x.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
export function resolveReport(reportId, adminId, status) {
  const row = state.reports.find(x => x.id === reportId && x.status === 'pending');
  if (!row) return null;
  row.status = status; row.resolvedAt = Date.now(); row.resolvedBy = adminId; save(); return row;
}

/** Account erasure: shares the person authored (hard delete, not the soft `deletedAt` flag), their reports, and reports about those shares. */
export function removeUser(uid) {
  const mine = new Set(state.shares.filter(x => x.authorId === uid).map(x => x.id));
  const n = state.shares.length + state.reports.length;
  state.shares = state.shares.filter(x => x.authorId !== uid);
  state.reports = state.reports.filter(r => r.reporterId !== uid && !(r.targetType === 'share' && mine.has(r.targetId)));
  const left = state.shares.length + state.reports.length;
  if (left !== n) save();
  return { removed: n - left, shareIds: [...mine] };
}
export function exportUser(uid) {
  return { shares: state.shares.filter(x => x.authorId === uid && !x.deletedAt), reports: state.reports.filter(r => r.reporterId === uid) };
}
