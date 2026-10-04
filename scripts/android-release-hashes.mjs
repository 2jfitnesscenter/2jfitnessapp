#!/usr/bin/env node
// Turns the SHA-256 certificate fingerprint of the Android RELEASE keystore (public information) into the two values the
// server needs so passkeys keep working in the signed app:
//   1. the fingerprint line for /.well-known/assetlinks.json (Digital Asset Links)
//   2. the base64url "android:apk-key-hash:" value for api/lib/webauthn-origins.js (or ANDROID_APK_KEY_HASHES)
// Usage:
//   node scripts/android-release-hashes.mjs 0C:BB:...:AC            # print both, change nothing
//   node scripts/android-release-hashes.mjs 0C:BB:...:AC --apply    # also add them to the two repo files (idempotent)
// Get the fingerprint WITHOUT exposing the key: keytool -list -v -keystore <release.jks> -alias <alias>  (copy the SHA256 line).
// This script never reads a keystore or a password.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const parseFingerprint = input => {
  const hex = String(input || '').trim().replace(/^SHA-?256:?\s*/i, '').replace(/[:\s]/g, '').toUpperCase()
  if (!/^[0-9A-F]{64}$/.test(hex)) throw new Error('expected a SHA-256 fingerprint: 32 bytes as hex, e.g. 0C:BB:BF:...')
  return { colon: hex.match(/../g).join(':'), hash: Buffer.from(hex, 'hex').toString('base64url') }
}

export function applyTo(root, { colon, hash }) {
  const links = path.join(root, 'frontend/public/.well-known/assetlinks.json')
  const doc = JSON.parse(fs.readFileSync(links, 'utf8'))
  const target = doc.find(x => x.target?.namespace === 'android_app')
  if (!target) throw new Error('assetlinks.json has no android_app target')
  const known = target.target.sha256_cert_fingerprints
  let changed = false
  if (!known.includes(colon)) { known.push(colon); changed = true; fs.writeFileSync(links, JSON.stringify(doc, null, 2) + '\n') }
  const origins = path.join(root, 'api/lib/webauthn-origins.js')
  let src = fs.readFileSync(origins, 'utf8')
  if (!src.includes(`'${hash}'`)) {
    src = src.replace(/(export const ANDROID_APK_KEY_HASHES = \[\r?\n)/, `$1  '${hash}',   // release keystore, com.twojfitnesscenter.app\n`)
    fs.writeFileSync(origins, src); changed = true
  }
  return changed
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2)
    const fp = parseFingerprint(args.find(a => !a.startsWith('--')))
    console.log('assetlinks sha256_cert_fingerprints entry:\n  ' + fp.colon)
    console.log('webauthn origin (ANDROID_APK_KEY_HASHES):\n  ' + fp.hash + '\n  → android:apk-key-hash:' + fp.hash)
    if (args.includes('--apply')) console.log(applyTo(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), fp) ? 'applied to assetlinks.json and webauthn-origins.js' : 'already present, nothing changed')
  } catch (e) { console.error('error: ' + e.message); process.exit(1) }
}
