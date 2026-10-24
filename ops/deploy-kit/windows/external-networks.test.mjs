import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const templatePath = path.join(here, 'templates/release-runner.ps1.in')
const template = fs.readFileSync(templatePath, 'utf8').replace(/\r\n/g, '\n')
const compose = fs.readFileSync(path.join(root, 'docker-compose.prod.yml'), 'utf8').replace(/\r\n/g, '\n')
const bash = (() => {
  if (process.platform !== 'win32') return 'bash'
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/usr/bin/bash.exe'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || 'bash'
})()

function guardFunction() {
  const start = template.indexOf('assert_external_docker_networks() {')
  assert.notEqual(start, -1, 'remote runner must define the external-network guard')
  const end = template.indexOf('\n}', start)
  assert.notEqual(end, -1, 'external-network guard must have a closing brace')
  return template.slice(start, end + 2)
}

function runGuard(missing = '') {
  const source = `${guardFunction()}\nrequired_external_networks=(2j-home-staging-proxy 2j-pwa-demo-edge)\n` +
    'docker() { [[ "$1" == network && "$2" == inspect && "$3" != "${MISSING_EXTERNAL_NETWORK:-}" ]]; }\n' +
    'DEPLOY_STARTED=0\nif assert_external_docker_networks; then DEPLOY_STARTED=1; fi\nprintf "DEPLOY_STARTED=%s\\n" "$DEPLOY_STARTED"\n'
  return spawnSync(bash, ['-c', source], { encoding: 'utf8', env: { ...process.env, MISSING_EXTERNAL_NETWORK: missing } })
}

test('external network guard passes only when both Compose external networks exist', () => {
  const result = runGuard()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /EXTERNAL_DOCKER_NETWORKS=OK names=2j-home-staging-proxy 2j-pwa-demo-edge/)
  assert.match(compose, /name: 2j-home-staging-proxy/)
  assert.match(compose, /name: 2j-pwa-demo-edge/)
})

test('missing required external network fails clearly before deployment starts', () => {
  const result = runGuard('2j-pwa-demo-edge')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /EXTERNAL_DOCKER_NETWORK_MISSING name=2j-pwa-demo-edge/)
  assert.match(result.stderr, /create the required external network before deploying/)
  assert.match(result.stdout, /DEPLOY_STARTED=0/)
})

test('PrepareOnly preflight runs the guard before backup or any production mutation', () => {
  const verify = template.indexOf('STEP=verify-current-production')
  const backup = template.indexOf('STEP=backup-data', verify)
  const checked = template.indexOf('assert_external_docker_networks\n', backup)
  const backupWrite = template.indexOf('BACKUP=/root/backups/2jfitness-predeploy-', backup)
  const firstMutation = template.indexOf('DEPLOY_STARTED=1', verify)
  assert.ok(verify >= 0 && backup > verify && checked > backup)
  assert.ok(backupWrite > checked, 'network existence must be checked before creating the backup')
  assert.ok(firstMutation > checked, 'network existence must be checked before extraction/marker changes')
  assert.ok(template.includes("external-networks.test.mjs'"), 'PrepareOnly must execute these regressions')
  assert.match(template, /if assert_external_docker_networks; then\n\s+"\$\{COMPOSE\[@\]\}" up -d --build/)
  assert.match(template, /STEP=docker-build-up\nassert_external_docker_networks\n"\$\{COMPOSE\[@\]\}" up -d --build/)
})
