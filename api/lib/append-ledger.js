// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Append-only ledger for the actions that must never be rewritten (H13 assisted link issuance).
 *
 *   - One JSON line per event in a file opened only for appending (mode 600). This module offers NO function to edit, truncate or delete.
 *   - Every line carries `prev` (the MAC of the line before it) and its own `mac` = HMAC-SHA256(key, line without mac): editing, removing or
 *     re-ordering any line breaks the chain, and without the key a forged line cannot be produced.
 *   - The chain head (seq + mac) is also handed back to the caller to keep elsewhere (db.json); a truncated tail then no longer matches the head.
 *   - Fields are an allow-list of scalars: never a note, token, IP, user-agent or health data.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const FIELDS = ['type', 'actorId', 'personId', 'trainingUserId', 'receiptId', 'requestId', 'reviewId', 'reasonCode', 'result', 'role'];
const GENESIS = '0'.repeat(64);

const mac = (key, record) => crypto.createHmac('sha256', key).update(JSON.stringify(record)).digest('hex');
const clean = value => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : undefined);

export function validLedgerKey(value) {
  return typeof value === 'string' && /^[0-9a-f]{64,}$/i.test(value);
}

/** @param {{file: string, key: string, now?: () => number}} options */
export function createLedger({ file, key, now = Date.now }) {
  if (!validLedgerKey(key)) throw new Error('ledger key must be at least 32 bytes of hex');
  const secret = Buffer.from(key, 'hex');

  function readAll() {
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, 'utf8');
    if (text && !text.endsWith('\n')) throw Object.assign(new Error('ledger ends with a partial line'), { code: 'LEDGER_CORRUPT' });
    return text.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { throw Object.assign(new Error('ledger line is not JSON'), { code: 'LEDGER_CORRUPT' }); } });
  }

  /** Checks the whole chain. `head` (optional) is the {seq, mac} the caller remembered: a shorter or different tail fails. */
  function verify(head = null) {
    let entries;
    try { entries = readAll(); } catch { return { ok: false, reason: 'unreadable' }; }
    let prev = GENESIS;
    for (let i = 0; i < entries.length; i++) {
      const { mac: stored, ...record } = entries[i];
      if (record.seq !== i + 1 || record.prev !== prev) return { ok: false, reason: 'chain_broken', at: i + 1 };
      const expected = mac(secret, record);
      if (typeof stored !== 'string' || stored.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(expected))) return { ok: false, reason: 'bad_mac', at: i + 1 };
      prev = stored;
    }
    const last = { seq: entries.length, mac: prev };
    if (head && (head.seq !== last.seq || head.mac !== last.mac)) {
      // A head that is AHEAD of the file means lines were cut off; a head that is behind means the caller crashed between append and remembering.
      if (!(head.seq === last.seq - 1)) return { ok: false, reason: 'head_mismatch' };
    }
    return { ok: true, count: entries.length, head: last };
  }

  /** Appends one event and returns the new head. Throws if the existing chain is not intact. */
  function append(event, expectedHead = null) {
    const state = verify(expectedHead);
    if (!state.ok) throw Object.assign(new Error(`ledger not intact: ${state.reason}`), { code: 'LEDGER_CORRUPT' });
    const record = { seq: state.head.seq + 1, at: new Date(now()).toISOString(), prev: state.head.mac };
    for (const field of FIELDS) { const value = clean(event[field]); if (value !== undefined) record[field] = value; }
    if (!record.type) throw new Error('ledger event needs a type');
    const line = JSON.stringify({ ...record, mac: mac(secret, record) }) + '\n';
    const fd = fs.openSync(file, 'a', 0o600);          // 'a' = every write goes to the end of the file
    try { fs.writeSync(fd, line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { seq: record.seq, mac: JSON.parse(line).mac };
  }

  /** How many events of this type this actor produced since `sinceMs` (for the daily limit). */
  function countSince(type, actorId, sinceMs) {
    return readAll().filter(entry => entry.type === type && entry.actorId === actorId && Date.parse(entry.at) >= sinceMs).length;
  }

  return Object.freeze({ append, verify, countSince });
}
