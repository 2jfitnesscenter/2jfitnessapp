/* One-time migration: force every state-<uid>.json still sitting as plain JSON to be rewritten
 * through writeState (encrypted). Not required for correctness — readState already falls back to
 * plain JSON, and any file gets upgraded the next time its owner's data is saved — but an
 * inactive profile could otherwise stay in plain text indefinitely. Safe to run more than once:
 * an already-encrypted file is a no-op (skipped, not re-read as JSON).
 *
 * Usage (inside the api container, so DATA_DIR/data/secret match the real deployment):
 *   docker compose exec api node scripts/encrypt-existing-state.mjs
 *
 * Back up ./data before running this on a production instance, the same as before any change
 * that rewrites every user's file.
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.DATA_DIR || '/data';

const files = fs.readdirSync(DATA).filter(f => /^state-.+\.json$/.test(f));
if (!files.length) {
  console.log('No state-*.json files found in', DATA);
  process.exit(0);
}

const { readState, writeState } = await import('../lib/state-store.js');

let converted = 0, alreadyDone = 0, failed = 0;
for (const f of files) {
  const uid = f.slice('state-'.length, -'.json'.length);
  const raw = fs.readFileSync(path.join(DATA, f), 'utf8').trim();
  if (!raw.startsWith('{')) { alreadyDone++; continue; }   // already encrypted
  const S = readState(uid);
  if (S === null) { console.error(`✗ ${f}: could not be read, left untouched`); failed++; continue; }
  writeState(uid, S);
  converted++;
  console.log(`✓ ${f} encrypted`);
}

console.log(`\n${converted} file(s) encrypted, ${alreadyDone} already were, ${failed} failed.`);
if (failed) process.exit(1);
