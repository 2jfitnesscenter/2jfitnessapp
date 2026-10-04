#!/usr/bin/env node
// Rollback helper for the encrypted chat store: converts data/chat.json back to the legacy plain-JSON format so an older release can read it.
//   DATA_DIR=./data node api/scripts/decrypt-chat.mjs           -> reports what it would do (no changes)
//   DATA_DIR=./data node api/scripts/decrypt-chat.mjs --write   -> writes the plain file atomically (keeps the encrypted one as chat.json.enc-bak)
// Needs the same instance secret (SECRET_FILE or data/secret). Run it BEFORE deploying the older release, with the API stopped.
import fs from 'node:fs';
import path from 'node:path';
import { decrypt } from '../lib/crypto.js';

const DATA = process.env.DATA_DIR || '/data';
const file = path.join(DATA, 'chat.json');
const text = fs.readFileSync(file, 'utf8').trim();
if (text.startsWith('{')) { console.log('chat.json is already plain JSON - nothing to do'); process.exit(0); }
const data = decrypt(text, 'chat-store');
if (!data) { console.error('cannot decrypt chat.json (wrong key or damaged file); nothing changed'); process.exit(2); }
console.log(`chat.json decrypts: ${data.threads?.length || 0} threads, ${data.messages?.length || 0} messages`);
if (process.argv.includes('--write')) {
  fs.copyFileSync(file, file + '.enc-bak');
  fs.writeFileSync(file + '.tmp', JSON.stringify({ threads: data.threads || [], messages: data.messages || [] }, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  console.log('written plain chat.json (encrypted copy kept as chat.json.enc-bak - delete it when rollback is no longer needed)');
}
