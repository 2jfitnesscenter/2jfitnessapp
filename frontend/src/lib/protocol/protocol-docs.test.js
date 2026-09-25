import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { RULES, EVIDENCE, MESSAGES, MESSAGE_RULE, RULE_BY_ID, PROTOCOL_VERSION } from './rules.js'

// The protocol exists three times — prose, bibliography, code. This keeps them from drifting:
// every id the code runs on must be written down, and every evidence id a rule cites must exist.
const docs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs')
const protocolMd = readFileSync(join(docs, 'TRAINING_PROTOCOL_2J.md'), 'utf8')
const evidenceMd = readFileSync(join(docs, 'EVIDENCE.md'), 'utf8')

it('every rule id is in the protocol document, every evidence id in the evidence register', () => {
  for (const r of RULES) expect(protocolMd, r.id).toContain(r.id)
  for (const e of EVIDENCE) expect(evidenceMd, e.id).toContain(`## ${e.id}`)
  expect(protocolMd).toContain(`v${PROTOCOL_VERSION}`)
})
it('rules only cite evidence that exists, messages only rules that exist', () => {
  const ids = new Set(EVIDENCE.map(e => e.id))
  for (const r of RULES) for (const e of r.evidence) expect(ids.has(e), `${r.id} → ${e}`).toBe(true)
  for (const [code, rule] of Object.entries(MESSAGE_RULE)) {
    expect(MESSAGES[code], code).toBeTruthy()
    expect(RULE_BY_ID[rule], rule).toBeTruthy()
  }
})
it('evidence and heuristics are labelled, never mixed up', () => {
  for (const r of RULES) expect(['evidence', 'heuristic']).toContain(r.kind)
  // A rule labelled evidence must cite something.
  for (const r of RULES.filter(x => x.kind === 'evidence')) expect(r.evidence.length, r.id).toBeGreaterThan(0)
})
