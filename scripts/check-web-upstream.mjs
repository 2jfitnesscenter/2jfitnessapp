// Checks web/nginx.conf as an nginx-image template (no docker needed).
// Emulates the official nginx entrypoint (20-envsubst-on-templates.sh): only ${NAME} for DEFINED env vars is substituted.
// Run: node scripts/check-web-upstream.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { execSync as sh } from 'node:child_process'

const tpl = readFileSync(new URL('../web/nginx.conf', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const dockerfile = readFileSync(new URL('../web/Dockerfile', import.meta.url), 'utf8')
const envDefault = dockerfile.match(/^ENV BUNKER_API_UPSTREAM=(\S+)$/m)?.[1]
assert.equal(envDefault, 'api:3000', 'Dockerfile must default BUNKER_API_UPSTREAM to api:3000')
assert.match(dockerfile, /COPY web\/nginx\.conf \/etc\/nginx\/templates\/default\.conf\.template/)

const render = env => tpl.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, n) => (n in env ? env[n] : m))
const upstream = out => out.match(/proxy_pass (http:\/\/[^;]+);/)[1]

// Container env when the variable is not provided: the image ENV default applies.
const unset = render({ BUNKER_API_UPSTREAM: envDefault })
const hub = render({ BUNKER_API_UPSTREAM: 'bunker-api:3000' })
console.log('unset ->', upstream(unset))
console.log('set   ->', upstream(hub))
assert.equal(upstream(unset), 'http://api:3000')
assert.equal(upstream(hub), 'http://bunker-api:3000')
assert.ok(!/\$\{/.test(unset) && !/\$\{/.test(hub), 'no unrendered ${...} left')

// With the variable unset the rendered file must equal the previous hardcoded config, apart from the added comment.
const original = sh('git show 4730afa:web/nginx.conf', { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).replace(/\r\n/g, '\n')
const strip = s => s.split('\n').filter(l => !/API → backend container/.test(l) && !/^\s*# \(default api:3000/.test(l)).join('\n')
assert.equal(strip(unset), strip(original), 'rendered default config differs from the original')
// Only the one upstream line differs between default and hub.
const diff = unset.split('\n').filter((l, i) => l !== hub.split('\n')[i])
assert.equal(diff.length, 1)
console.log('OK: default render equals original config; hub differs only in the /api/ upstream')
