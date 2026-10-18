// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PrivacySheet, TOPICS } from './Privacy.jsx'
import { CONTROLLER, VERIFY, pendingItems, hasPendingLegalItems } from '../lib/legal-controller.js'

/* The privacy policy tells people what the code really does. These tests keep the three places that
 * say it — the in-app policy, docs/PRIVACY_POLICY.md and the code — from drifting apart, and make
 * sure nothing about the controller is ever invented. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const doc = f => readFileSync(join(root, f), 'utf8')
const page = topic => renderToStaticMarkup(<PrivacySheet topic={topic} />)
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('what the policy must cover', () => {
  const all = text(page('policy'))
  it('names the controller with the owner’s real details; only unverified facts stay as placeholders', () => {
    for (const v of Object.values(CONTROLLER)) { expect(v).not.toMatch(/LEGAL_TBD_/); expect(all).toContain(v) }
    expect(all).toContain('JUAN JOSE PEREZ SANCHEZ'); expect(all).toContain('54088887V'); expect(all).toContain('SIREINSA'); expect(all).toContain('2JFITNESSCENTER@GMAIL.COM')
    expect(pendingItems().sort()).toEqual(['LEGAL_TBD_AI_PROVIDER_TERMS', 'LEGAL_TBD_BACKUP_FREQUENCY', 'LEGAL_TBD_BACKUP_RETENTION', 'LEGAL_TBD_DPO_CONTACT', 'LEGAL_TBD_SERVER_LOCATION', 'LEGAL_TBD_TRANSFER_SAFEGUARDS'])
    expect(hasPendingLegalItems()).toBe(true)
    expect(all).toContain('are still being verified')          // the notice shows only while something relevant is pending
    expect(all).not.toContain('pending confirmation by the controller')
  })
  it('covers every point: data, purposes, legal basis, health, AI, providers, transfers, retention, rights, contact', () => {
    for (const s of ['Who is responsible', 'Data we process', 'Who can see your data', 'Why we use it', 'Legal basis', 'Health-related data', 'Artificial intelligence',
      'External providers', 'International transfers', 'How long we keep it', 'Your rights', 'Contact']) expect(all).toContain(s)
    for (const s of ['Art. 6(1)(b)', 'Art. 6(1)(f)', 'Art. 9(2)(a)', 'AEPD', 'within one month', 'not legal advice']) expect(all).toContain(s)
  })
  it('does not claim compliance, server locations, safeguards or provider terms nobody verified', () => {
    for (const v of Object.values(VERIFY)) expect(all).toContain(v)
    expect(all).not.toMatch(/fully compliant|GDPR[- ]compliant|certified|data processing agreement|DPA in place|servers? (are|is) located in/i)
  })
  it('lists every disclosed data category of the app', () => {
    for (const s of ['passkeys', 'birth date', 'body composition', 'follow-up questionnaires and progress photos', 'direct messages', 'private professional notes', 'push-notification subscriptions', 'local copy', 'no advertising and no third-party analytics']) expect(all).toContain(s)
  })
})

describe('AI disclosure', () => {
  const ai = text(page('ai'))
  it('says when AI acts, that it only proposes, and that it is not medical advice', () => {
    for (const s of ['only when you or a member of staff ask for it', 'the screen tells you when AI is involved', 'nothing is applied without you or the professional reviewing it', 'not medical advice']) expect(ai).toContain(s)
  })
  it('covers each AI function with what it receives, and what is never sent', () => {
    for (const s of ['Coach (plan, review and explanations)', 'Routine drafts by staff', 'Follow-up analysis by staff', 'Scans:', 'Import matching', 'Never sent to AI', 'progress photos', 'WHOOP and Strava data']) expect(ai).toContain(s)
  })
  it('staff AI needs the member’s separate consent and says so', () => {
    for (const s of ['separate consent to Staff AI tools', 'which is not the Coach consent', 'without it nothing is sent', 'with the same Staff AI tools consent']) expect(ai).toContain(s)
    expect(ai).not.toContain('This does not use your Coach consent')
  })
  it('keeps the per-file scan consent and the "nothing is kept" statement', () => {
    expect(ai).toContain('only after you confirm a notice for that file')
    expect(ai).toContain('the server refuses the scan without it')
    expect(ai).toContain('the scan does not keep the file or the result')
    expect(ai).toContain('If you cancel, nothing is read or sent')
  })
})

describe('third parties match the code', () => {
  const providers = text(page('providers'))
  it('names exactly the providers the app talks to, with purpose, data, optionality and transfer', () => {
    for (const s of ['Google (Gemini API)', 'Anthropic (Claude)', 'OpenAI', 'WHOOP', 'Strava', 'Push services', 'Google Fonts', 'jsDelivr', 'Hosting and infrastructure']) expect(providers).toContain(s)
    expect(providers).toContain('provided by Contabo')
    expect(providers).toContain('no independent external backup provider is used')
    expect(providers).toContain('Optional')
    expect(providers).toContain('outside the EEA')
  })
  // Any new outside host in the source must be added to the policy first (and to this list).
  const ALLOWED = new Map([
    ['generativelanguage.googleapis.com', 'Google (Gemini API)'], ['api.openai.com', 'OpenAI'], ['api.prod.whoop.com', 'WHOOP'], ['www.strava.com', 'Strava'],
    ['fonts.googleapis.com', 'Google Fonts'], ['fonts.gstatic.com', 'Google Fonts'], ['cdn.jsdelivr.net', 'jsDelivr'],
    // links and citations only: nothing is sent to these hosts at runtime
    ['developer.whoop.com', null], ['developers.strava.com', null], ['commons.wikimedia.org', null], ['upload.wikimedia.org', null],
    ['github.com', null], ['www.gnu.org', null], ['play.google.com', null], ['app.2jfitnesscenter.com', null], ['2jfitnesscenter.com', null],
    ['localhost', null], ['127.0.0.1', null], ['www.w3.org', null], ['link', null], ['enlace', null], ['api', null], ['x', null], ['example.com', null]
  ])
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir)) {
      if (['node_modules', 'test', 'dist', 'locales'].includes(e)) continue
      const p = join(dir, e), st = statSync(p)
      if (st.isDirectory()) walk(p, out)
      else if (/\.(js|jsx|mjs)$/.test(e) && !/\.test\./.test(e)) out.push(p)
    }
    return out
  }
  it('every outside host in the application source is disclosed or is only a link', () => {
    const seen = new Set()
    for (const f of [...walk(join(root, 'api')), ...walk(join(root, 'frontend', 'src'))]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) seen.add(m[1])
    }
    for (const host of seen) expect(ALLOWED.has(host), `undisclosed host ${host}: add it to the privacy policy`).toBe(true)
    for (const [host, name] of ALLOWED) if (name && seen.has(host)) expect(providers).toContain(name)
  })
})

describe('entry points in Settings', () => {
  const settings = doc('frontend/src/views/Settings.jsx')
  it('Settings shows the policy, data, AI and providers entries, plus export and delete', () => {
    for (const topic of Object.keys(TOPICS)) expect(settings).toContain(`<PrivacySheet topic="${topic}" />`)
    expect(settings).toContain('<StaffAiConsentSheet close={close} />')
    expect(settings).toContain("t('Export my data')")
    expect(settings).toContain("t('Delete my account')")
  })
  it('the delete sheet says what stays in backups and with connected apps', () => {
    expect(doc('frontend/src/components/DeleteAccountSheet.jsx')).toContain('Copies inside security backups disappear when those backups expire')
  })
})

describe('docs agree with the screen and the code', () => {
  const policy = doc('docs/PRIVACY_POLICY.md')
  it('the repository policy carries every placeholder and the same key statements', () => {
    for (const v of pendingItems()) expect(policy, v).toContain(v)
    for (const s of ['Art. 6(1)(b)', 'Art. 9(2)(a)', 'external-ai-scan-v1', 'AEPD', 'Google Fonts', 'jsDelivr', 'Never sent to AI', 'LEGAL_TBD_']) expect(policy).toContain(s)
  })
  it('trainer AI is gated by the member’s separate Staff AI consent in the code, the map and the policy', () => {
    expect(doc('docs/DATA_MAP.md')).not.toContain('ALSO requires the member')
    expect(doc('docs/DATA_MAP.md')).toContain('Staff AI tools')
    const jobs = doc('api/coach/trainer-jobs.js')
    expect(jobs).toContain('hasStaffAiConsent(S)')
    expect(jobs).not.toMatch(/coach\.consent/)                       // it is not the Coach consent
    expect(doc('api/lib/coach-followup-routes.js')).toContain('hasStaffAiConsent(S)')
    expect(policy).toContain('Staff AI tools')
    expect(policy).not.toContain('LEGAL_TBD_TRAINER_AI_BASIS')
  })
  it('the repo policy carries the owner’s controller data', () => {
    for (const v of Object.values(CONTROLLER)) if (v !== CONTROLLER.hosting) expect(policy).toContain(v)
    expect(policy).toContain('Contabo')
  })
  it('the erasure notes describe follow-up data, staff accounts, connected apps and backups', () => {
    const erasure = doc('docs/ACCOUNT_ERASURE.md')
    for (const s of ['follow-up', 'progress photos', 'Trainer and admin accounts', 'WHOOP', 'backups']) expect(erasure).toContain(s)
  })
  it('the export code leaves out exactly what the policy says it leaves out', () => {
    const code = doc('api/lib/account-erasure.js')
    expect(code).toContain('progressPhotos')                                 // descriptors only…
    expect(code).not.toMatch(/privateNotes/)                                 // …and no private staff notes
    expect(code).not.toMatch(/stravaAuth\.(access|refresh)|whoopAuth\.(access|refresh)/)   // no provider tokens
  })
})
