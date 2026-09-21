/* The single place state-<uid>.json (a member's full workout history, body-weight log, and
   measurements — the app's actual health data) is read from and written to disk, encrypted at
   rest with the shared AES-256-GCM helper (./crypto.js) under its own domain (`user-state`), so
   a copy of this file alone is unreadable without ./data/secret too — see SECURITY.md's "Health
   data is encrypted at rest" section for exactly what that does and doesn't protect against.

   server.js and coach/jobs.js both used to read this file directly with their own
   fs.readFileSync — two independent copies of the same eleven characters ('state-' + uid +
   '.json') were an easy way for one of them to silently start parsing ciphertext as JSON the
   day encryption landed. Centralizing here means there is exactly one reader and one writer to
   keep in sync with the on-disk format, now and for whatever comes after AES-GCM. */
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from './crypto.js';

const DATA = process.env.DATA_DIR || '/data';
const INFO = 'user-state';
const safe = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
const defaultSync = () => ({
  schemaVersion: 2, revision: 0, generation: 0,
  tombstones: { workouts: [], routines: [], programs: [] },
  receipts: {}, enabled: false, activeRevision: 0,
});
const normalizeSync = value => ({
  ...defaultSync(), ...(value || {}),
  tombstones: { ...defaultSync().tombstones, ...(value?.tombstones || {}) },
  receipts: value?.receipts || {},
  activeRevision: Number.isSafeInteger(value?.activeRevision) && value.activeRevision >= 0 ? value.activeRevision : 0,
});

export const stateFile = uid => path.join(DATA, 'state-' + safe(uid) + '.json');

// A file written before this feature existed is plain JSON, always starting with '{'; an
// encrypted one is a single base64 blob, which the base64 alphabet ([A-Za-z0-9+/=]) can never
// start with '{' either way — no version byte needed to tell them apart. This also means a
// profile nobody has written to since the upgrade stays readable exactly as before, and quietly
// converts to encrypted the next time anything saves it (PUT /api/data, an admin measurement
// entry, a trainer-assigned routine, ...).
export function readState(uid) {
  let raw;
  try { raw = fs.readFileSync(stateFile(uid), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const trimmed = raw.trim();
  let state;
  try { state = trimmed.startsWith('{') ? JSON.parse(trimmed) : decrypt(trimmed, INFO); } catch { /* corrupt */ }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw Object.assign(new Error('Estado ilegible; se requiere recuperación, no se sobrescribirá.'), { status: 503, code: 'STATE_CORRUPT' });
  }
  // Non-enumerable in domain objects: backups/legacy clients cannot import server metadata.
  const meta = normalizeSync(state._sync);
  delete state._sync;
  Object.defineProperty(state, '_sync', { value: meta, writable: true, configurable: true });
  return state;
}

export function writeState(uid, state) {
  const current = readState(uid);
  const previous = current?._sync;
  if (state._sync && previous && (state._sync.revision !== previous.revision || state._sync.generation !== previous.generation)) {
    throw Object.assign(new Error('El estado cambió'), { status: 409, code: 'SYNC_CONFLICT' });
  }
  const meta = structuredClone(normalizeSync(state._sync || previous));
  const replacing = meta.nextGeneration !== undefined;
  if (replacing) { meta.generation = meta.nextGeneration; delete meta.nextGeneration; meta.tombstones = { workouts: [], routines: [], programs: [] }; }
  for (const kind of ['workouts', 'routines', 'programs']) {
    const ids = new Set((state[kind] || []).map(x => x.id));
    if (!replacing && previous?.enabled && previous.tombstones[kind].some(id => ids.has(id))) {
      throw Object.assign(new Error('La entidad fue eliminada'), { status: 409, code: 'ENTITY_DELETED' });
    }
    meta.tombstones[kind] = [...new Set([...meta.tombstones[kind], ...(current?.[kind] || []).filter(x => !ids.has(x.id)).map(x => x.id)])];
  }
  meta.revision = (previous?.revision || 0) + 1;
  const file = stateFile(uid), tmp = file + '.tmp';
  fs.writeFileSync(tmp, encrypt({ ...state, _sync: meta }, INFO), { mode: 0o600 });
  fs.renameSync(tmp, file);
  delete state._sync;
  Object.defineProperty(state, '_sync', { value: meta, writable: true, configurable: true });
}
