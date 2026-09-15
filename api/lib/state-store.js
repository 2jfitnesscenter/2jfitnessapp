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

export const stateFile = uid => path.join(DATA, 'state-' + safe(uid) + '.json');

// A file written before this feature existed is plain JSON, always starting with '{'; an
// encrypted one is a single base64 blob, which the base64 alphabet ([A-Za-z0-9+/=]) can never
// start with '{' either way — no version byte needed to tell them apart. This also means a
// profile nobody has written to since the upgrade stays readable exactly as before, and quietly
// converts to encrypted the next time anything saves it (PUT /api/data, an admin measurement
// entry, a trainer-assigned routine, ...).
export function readState(uid) {
  let raw;
  try { raw = fs.readFileSync(stateFile(uid), 'utf8'); } catch { return null; }
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) { try { return JSON.parse(trimmed); } catch { return null; } }
  return decrypt(trimmed, INFO);
}

export function writeState(uid, state) {
  const file = stateFile(uid), tmp = file + '.tmp';
  fs.writeFileSync(tmp, encrypt(state, INFO), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
