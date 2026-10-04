#!/usr/bin/env node
// Verifies a built Android APK against what the server trusts, without ever touching a keystore or a password:
//   node scripts/android-release-verify.mjs frontend/android/app/build/outputs/apk/release/app-release.apk
// Checks: (1) apksigner says the signature is valid, (2) the signing certificate SHA-256 is NOT the debug one, (3) it is listed in
// /.well-known/assetlinks.json, (4) its base64url hash is in api/lib/webauthn-origins.js, (5) the APK is zip-aligned.
// Needs the Android SDK build-tools (ANDROID_HOME / ANDROID_SDK_ROOT, or the default Windows location).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DEBUG_FINGERPRINT = '0C:BB:BF:6F:26:C1:0C:83:23:54:2C:93:AE:B3:E6:19:44:D2:92:46:56:0A:F8:9D:A6:85:36:0F:7A:83:5E:AC'

/** Pulls the signer certificate SHA-256 out of `apksigner verify --print-certs`, as colon-separated upper-case hex. */
export function parseCertDigest(output) {
  const m = /Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/.exec(output || '')
  return m ? m[1].toUpperCase().match(/../g).join(':') : null
}
export const originHash = colon => Buffer.from(colon.replace(/:/g, ''), 'hex').toString('base64url')

function tool(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'AppData/Local/Android/Sdk')
  const dir = path.join(sdk, 'build-tools')
  const versions = fs.existsSync(dir) ? fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse() : []
  for (const v of versions) for (const ext of ['', '.bat', '.exe']) { const f = path.join(dir, v, name + ext); if (fs.existsSync(f)) return f }
  throw new Error(`${name} not found under ${dir} (set ANDROID_HOME)`)
}

// apksigner is a .bat on Windows; run its jar directly so paths with spaces are not re-split by a shell.
function runApksigner(args) {
  const exe = tool('apksigner')
  if (!exe.endsWith('.bat')) return spawnSync(exe, args, { encoding: 'utf8' })
  const jar = path.join(path.dirname(exe), 'lib', 'apksigner.jar')
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java'
  return spawnSync(java, ['-jar', jar, ...args], { encoding: 'utf8' })
}

export function verifyApk(apk) {
  const results = []
  const ok = (name, pass, detail = '') => results.push({ name, pass, detail })
  if (!fs.existsSync(apk)) throw new Error('APK not found: ' + apk)
  const signer = runApksigner(['verify', '--verbose', '--print-certs', apk])
  const out = (signer.stdout || '') + (signer.stderr || '')
  ok('apksigner: signature valid', signer.status === 0 && /Verifies/.test(out), signer.status === 0 ? '' : out.split('\n')[0])
  const digest = parseCertDigest(out)
  ok('certificate present', !!digest, digest || 'no signer certificate (unsigned APK?)')
  if (digest) {
    ok('not the debug certificate', digest !== DEBUG_FINGERPRINT)
    const links = JSON.parse(fs.readFileSync(path.join(root, 'frontend/public/.well-known/assetlinks.json'), 'utf8'))
    ok('listed in assetlinks.json', links.some(x => x.target?.sha256_cert_fingerprints?.includes(digest)))
    ok('hash allowed for WebAuthn origins', fs.readFileSync(path.join(root, 'api/lib/webauthn-origins.js'), 'utf8').includes(`'${originHash(digest)}'`), 'android:apk-key-hash:' + originHash(digest))
  }
  const align = spawnSync(tool('zipalign'), ['-c', '-P', '16', '4', apk], { encoding: 'utf8' })
  ok('zip-aligned', align.status === 0, align.status === 0 ? '' : (align.stdout || align.stderr || '').split('\n')[0])
  const sha = crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex')
  return { results, digest, apkSha256: sha, bytes: fs.statSync(apk).size, pass: results.every(r => r.pass) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const apk = path.resolve(process.argv[2] || path.join(root, 'frontend/android/app/build/outputs/apk/release/app-release.apk'))
    const r = verifyApk(apk)
    console.log('APK: ' + apk + ` (${r.bytes} bytes)\nAPK SHA-256: ${r.apkSha256}\nSigner certificate SHA-256: ${r.digest || '-'}`)
    for (const c of r.results) console.log((c.pass ? 'PASS  ' : 'FAIL  ') + c.name + (c.detail ? '  — ' + c.detail : ''))
    console.log(r.pass ? 'RESULT: PASS' : 'RESULT: FAIL')
    process.exit(r.pass ? 0 : 1)
  } catch (e) { console.error('error: ' + e.message); process.exit(2) }
}
