// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* A software authenticator for the API tests: a real ES256 key pair that produces genuine WebAuthn registration ("none" attestation)
 * and assertion responses, so the server's own verification runs unmodified. Also a tiny harness that boots server.js against a temp
 * data directory and signs session cookies the way the server does. */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const b64u = b => Buffer.from(b).toString('base64url')

const cborBytes = bytes => {
  if (bytes.length < 24) return Buffer.concat([Buffer.from([0x40 + bytes.length]), bytes])
  if (bytes.length < 256) return Buffer.concat([Buffer.from([0x58, bytes.length]), bytes])
  return Buffer.concat([Buffer.from([0x59, bytes.length >> 8, bytes.length & 255]), bytes])
}
const cborText = s => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([0x60 + b.length]), b]) }
export const cosePublicKey = jwk => Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(jwk.x, 'base64url'), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y, 'base64url')])

export class Authenticator {
  constructor({ id = crypto.randomBytes(16).toString('base64url'), userVerified = true } = {}) {
    this.keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    this.id = id
    this.counter = 0
    this.userVerified = userVerified
  }
  /** What a db.json credential record for this authenticator looks like. */
  record(userId, extra = {}) {
    return { id: this.id, userId, publicKey: cosePublicKey(this.keys.publicKey.export({ format: 'jwk' })).toString('base64url'), counter: 0, transports: ['internal'], ...extra }
  }
  assertion(challenge, { origin, rpId = 'localhost' }) {
    this.counter++
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }))
    const flags = this.userVerified ? 0x05 : 0x01
    const authData = Buffer.concat([crypto.createHash('sha256').update(rpId).digest(), Buffer.from([flags]), Buffer.from([0, 0, 0, this.counter])])
    const signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), this.keys.privateKey)
    return { id: this.id, rawId: this.id, type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null }, clientExtensionResults: {} }
  }
  registration(challenge, { origin, rpId = 'localhost' }) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }))
    const credId = Buffer.from(this.id, 'base64url')
    const authData = Buffer.concat([
      crypto.createHash('sha256').update(rpId).digest(), Buffer.from([this.userVerified ? 0x45 : 0x41]), Buffer.from([0, 0, 0, 0]), Buffer.alloc(16),
      Buffer.from([credId.length >> 8, credId.length & 255]), credId, cosePublicKey(this.keys.publicKey.export({ format: 'jwk' })),
    ])
    const attestationObject = Buffer.concat([Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'), Buffer.from([0xa0]), cborText('authData'), cborBytes(authData)])
    return { id: this.id, rawId: this.id, type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] }, clientExtensionResults: {} }
  }
}

/** Boots server.js on `port` over a fresh data directory seeded with `db`. */
export async function bootServer({ port, db, secret = 'f'.repeat(64), env = {} }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi2j-'))
  fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 })
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ subs: [], invites: [], recoveries: [], ...db }))
  const base = `http://localhost:${port}`
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, RP_ID: 'localhost', ORIGIN: base, ...env }, stdio: ['ignore', 'ignore', 'ignore'] })
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)) }
  const readDb = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'))
  const req = (method, route, body, cookie = '', headers = {}) => fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) })
  const post = (route, body, cookie, headers) => req('POST', route, body, cookie, headers)
  const get = (route, cookie, headers) => req('GET', route, undefined, cookie, headers)
  /** A session cookie signed like the server's. `version` must match the user's session version; `extra` appends claim fields (passkey sessions). */
  const cookieFor = (uid, { version = 0, extra = [] } = {}) => {
    const p = [uid, Date.now() + 86_400_000, version, ...extra].join(':')
    return 'gymsid=' + p + '.' + crypto.createHmac('sha256', secret).update(p).digest('base64url')
  }
  const stop = () => { child.kill() }
  return { base, dataDir, readDb, post, get, cookieFor, stop, origin: base, dbFile: path.join(dataDir, 'db.json') }
}
