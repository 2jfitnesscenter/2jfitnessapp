/* Instance-level Strava app credentials — one Client ID/Secret Juanjo (the operator) registers
   once on Strava's own developer portal (https://www.strava.com/settings/api), pasted in via the
   admin dashboard. Every member who connects authorizes that same app to their own individual
   Strava account (see ./oauth.js). Same encrypted-at-rest shape as api/coach/config.js, in its
   own data/strava.json rather than db.json since this is instance config, not a user record. */
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from '../lib/crypto.js';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'strava.json');
const CRYPTO_INFO = 'opengym-strava-v1';

function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

let cache = null;
export function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { cache = { clientId: null, secretBlob: null }; }
  return cache;
}
export function save({ clientId, clientSecret }) {
  const next = {
    clientId: String(clientId || '').trim() || null,
    secretBlob: clientSecret ? encrypt({ clientSecret: String(clientSecret).trim() }, CRYPTO_INFO) : load().secretBlob
  };
  cache = next;
  atomicWrite(FILE, JSON.stringify(next, null, 2));
  return next;
}
export function clear() {
  cache = { clientId: null, secretBlob: null };
  atomicWrite(FILE, JSON.stringify(cache, null, 2));
}
export const clientId = () => load().clientId;
export function clientSecret() {
  const blob = load().secretBlob;
  if (!blob) return null;
  const d = decrypt(blob, CRYPTO_INFO);
  return d ? d.clientSecret : null;
}
export const isConfigured = () => !!(clientId() && load().secretBlob);
export function reset() { cache = null; }
