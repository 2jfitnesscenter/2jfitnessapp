// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* The one place the instance secret is located and read (it signs session cookies and, through HKDF in crypto.js, derives the
   at-rest encryption keys). By default it is ./data/secret, as it has always been. Setting SECRET_FILE (e.g. /secrets/secret on
   a separate mount) moves it OUT of the data folder, so backups of ./data no longer carry the key to their own ciphertext.
   Existing installs are never broken: if SECRET_FILE points to a file that does not exist yet and the legacy ./data/secret does,
   the legacy value is COPIED (never moved or deleted) so the same key keeps decrypting the same files. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = () => process.env.DATA_DIR || '/data';
export const legacySecretPath = () => path.join(dataDir(), 'secret');
export const secretPath = () => process.env.SECRET_FILE || legacySecretPath();
export const secretIsSeparated = () => path.resolve(secretPath()) !== path.resolve(legacySecretPath());

function writeSecretFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch { /* host refuses chmod */ }
  fs.writeFileSync(file, value, { mode: 0o600 });
}

/** Reads the secret, copying it over from the legacy location the first time SECRET_FILE is configured. Throws if there is none. */
export function readSecret() {
  const file = secretPath();
  if (!fs.existsSync(file) && secretIsSeparated() && fs.existsSync(legacySecretPath())) {
    writeSecretFile(file, fs.readFileSync(legacySecretPath(), 'utf8').trim());
  }
  return fs.readFileSync(file, 'utf8').trim();
}

/** Boot-time: make sure a secret exists (migrating or generating). Returns the secret. */
export function ensureSecret() {
  const file = secretPath();
  if (!fs.existsSync(file) && !(secretIsSeparated() && fs.existsSync(legacySecretPath()))) {
    writeSecretFile(file, crypto.randomBytes(32).toString('hex'));
  }
  return readSecret();
}
