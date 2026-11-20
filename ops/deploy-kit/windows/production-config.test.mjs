import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')

test('root and mounted Caddyfiles preserve the verified production routing', () => {
  const rootCaddy = read('Caddyfile').trimEnd()
  const mountedCaddy = read('caddy-config/Caddyfile').trimEnd()
  assert.equal(rootCaddy, mountedCaddy, 'the fallback root config must not diverge from the mounted production config')
  for (const host of ['app.2jfitnesscenter.com', 'home.2jfitnesscenter.com', 'staging-home.2jfitnesscenter.com']) {
    assert.ok(mountedCaddy.includes(`${host} {`), `missing Caddy site ${host}`)
  }
  assert.match(mountedCaddy, /reverse_proxy web:80/)
  assert.match(mountedCaddy, /reverse_proxy 2j-home-visual:8080/)
  assert.match(mountedCaddy, /reverse_proxy 2j-home-demo:8080/)
  for (const denied of ['/api', '/auth', '/login', '/register', '/bookings', '/payments', '/admin', '/staff', '/training', '/bunker']) {
    assert.ok(mountedCaddy.includes(denied), `missing operational path deny ${denied}`)
  }
})

test('production Compose mounts the Caddy config directory and declares existing external upstream networks', () => {
  const compose = read('docker-compose.prod.yml')
  assert.match(compose, /- \.\/caddy-config:\/etc\/caddy:ro/)
  assert.match(compose, /networks:\s*\n\s*- default\s*\n\s*- home-staging-proxy\s*\n\s*- demo-edge/)
  assert.match(compose, /home-staging-proxy:\s*\n\s*external: true\s*\n\s*name: 2j-home-staging-proxy/)
  assert.match(compose, /demo-edge:\s*\n\s*external: true\s*\n\s*name: 2j-pwa-demo-edge/)
})

test('PrepareOnly runs the production configuration regression test', () => {
  const template = read('ops/deploy-kit/windows/templates/release-runner.ps1.in')
  assert.match(template, /node --test[^\r\n]*ops\/deploy-kit\/windows\/production-config\.test\.mjs/)
})

test('checked-in production proxy configuration contains no populated credential assignments', () => {
  for (const file of ['Caddyfile', 'caddy-config/Caddyfile', 'docker-compose.prod.yml']) {
    const content = read(file)
    assert.doesNotMatch(content, /(?:API_KEY|SECRET|PASSWORD|TOKEN)\s*[:=]\s*[^\s"']+/i, `${file} must not contain a credential value`)
  }
})
