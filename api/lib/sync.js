import { createHash } from 'node:crypto';
import { readState, writeState } from './state-store.js';

const kinds = ['workouts', 'routines', 'programs'];
const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
export const envelope = state => ({ state, meta: state._sync });

export function directReceipt(state, body, kind) {
  if (!state._sync.enabled) return null;
  if (!body.operationId) fail('SYNC_UPGRADE_REQUIRED', 'Actualiza la aplicación: se requiere operationId');
  const key = 'direct:' + kind + ':' + body.operationId;
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const receipt = state._sync.receipts[key];
  if (receipt) {
    if (receipt.digest !== digest) fail('OPERATION_REUSED', 'Operación reutilizada');
    return receipt.result;
  }
  if (state._sync.enabled && (!body.operationId || body.sync?.revision !== state._sync.revision || body.sync?.generation !== state._sync.generation)) fail('SYNC_CONFLICT', 'La programación cambió; conserva tu borrador');
  return null;
}
export function saveTrainer(uid, state, body, kind, result) {
  if (body.operationId) state._sync.receipts['direct:' + kind + ':' + body.operationId] = {
    digest: createHash('sha256').update(JSON.stringify(body)).digest('hex'), result: { ...result, sync: { revision: state._sync.revision + 1, generation: state._sync.generation } },
  };
  writeState(uid, state);
}

export const trainerReceipt = directReceipt;
export const saveDirect = saveTrainer;

// The entire read/check/apply/write is synchronous, with no yield to another request.
// This serializes per-user transactions in the existing single-process Node server.
export function openSync(uid) {
  const state = readState(uid) || {};
  if (!state._sync?.enabled) {
    writeState(uid, state);
    state._sync.enabled = true;
    writeState(uid, state);
  }
  return envelope(state);
}

export function mutate(uid, op) {
  const current = readState(uid) || {};
  if (!current._sync) openSync(uid);
  const state = readState(uid);
  const meta = state._sync;
  if (!op || typeof op.operationId !== 'string' || op.operationId.length < 8 || op.operationId.length > 128) fail('INVALID_OPERATION', 'operationId requerido', 400);
  const digest = createHash('sha256').update(JSON.stringify(op)).digest('hex');
  const receipt = Object.hasOwn(meta.receipts, op.operationId) ? meta.receipts[op.operationId] : null;
  // A response can be lost after commit. Check the receipt before stale preconditions.
  if (receipt) {
    if (receipt.digest !== digest) fail('OPERATION_REUSED', 'operationId reutilizado con otro contenido');
    return { ...envelope(state), acknowledged: op.operationId };
  }
  if (op.revision !== meta.revision || op.generation !== meta.generation) fail('SYNC_CONFLICT', 'Hay cambios nuevos en el servidor');
  let next;
  if (op.type === 'save' || op.type === 'reset' || op.type === 'replace') {
    if (!op.state || typeof op.state !== 'object' || Array.isArray(op.state)) fail('INVALID_OPERATION', 'Estado requerido', 400);
    next = structuredClone(op.state);
    delete next._sync;
    // Active has its own handoff/finish/clear protocol, never a generic snapshot authority.
    next.active = state.active || null;
    if (op.type === 'save') {
      next.routineVersions = state.routineVersions || {};
      next.programVersions = state.programVersions || {};
      for (const kind of kinds) {
        if (!Array.isArray(next[kind])) next[kind] = state[kind] || [];
        if (next[kind].some(x => meta.tombstones[kind].includes(x.id))) fail('ENTITY_DELETED', 'La entidad fue eliminada');
        const present = new Set(next[kind].map(x => x.id));
        const deleted = new Set(op.deletes?.[kind] || []);
        next[kind].push(...(state[kind] || []).filter(x => !present.has(x.id) && !deleted.has(x.id)));
      }
    }
  } else if (op.type === 'delete') {
    if (!kinds.includes(op.kind) || typeof op.id !== 'string') fail('INVALID_OPERATION', 'Entidad no válida', 400);
    next = structuredClone(state);
    next[op.kind] = (next[op.kind] || []).filter(x => x.id !== op.id);
  } else fail('INVALID_OPERATION', 'Operación no válida', 400);
  Object.defineProperty(next, '_sync', { value: structuredClone(meta), writable: true, configurable: true });
  next._sync.receipts = { ...meta.receipts, [op.operationId]: { digest, revision: meta.revision + 1 } };
  // writeState compares the old generation. Advance the generation in a separate option
  // passed through the metadata only after the CAS check in writeState.
  if (op.type === 'reset' || op.type === 'replace') next._sync.nextGeneration = meta.generation + 1;
  if (op.type === 'delete') next._sync.tombstones[op.kind] = [...new Set([...next._sync.tombstones[op.kind], op.id])];
  writeState(uid, next);
  return { ...envelope(next), acknowledged: op.operationId };
}
