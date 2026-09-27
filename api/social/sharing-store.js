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
