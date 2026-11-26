import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { RecoveryLinkError, recoveryLinkErrorText } from './recovery-link-error.jsx'

/* F9r (M-7): «Generate link» refused (session from 2J Hub → the server asks for the Búnker passkey) must be said INSIDE the sheet, with what to
 * do; before, only a toast hidden behind the sheet got it and the button looked broken. */
describe('recovery link sheet: a refused link is explained in the sheet', () => {
  const passkey = /confirm with your Búnker passkey|confirmar con tu passkey de Búnker/

  it('passkey required (403) or the passkey prompt cancelled → says to use the Búnker passkey', () => {
    const refused = Object.assign(new Error('confirma con tu passkey para continuar'), { status: 403, data: { code: 'passkey_required' } })
    expect(recoveryLinkErrorText(refused)).toMatch(passkey)
    expect(recoveryLinkErrorText(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' }))).toMatch(passkey)
  })

  it('any other failure keeps the server reason, and an empty one still reads as a sentence', () => {
    expect(recoveryLinkErrorText(new Error('usuario no encontrado'))).toMatch(/usuario no encontrado/)
    expect(recoveryLinkErrorText({})).toMatch(/Could not create the link\. Try again\.|No se pudo generar el enlace\. Vuelve a intentarlo\./)
  })

  it('renders as an alert, and nothing when there is no error', () => {
    expect(renderToStaticMarkup(<RecoveryLinkError error="x" />)).toContain('role="alert"')
    expect(renderToStaticMarkup(<RecoveryLinkError error={null} />)).toBe('')
  })

  it('the sheet shows it above the button instead of a toast, and the texts are in Spanish', () => {
    const admin = readFileSync(new URL('./Admin.jsx', import.meta.url), 'utf8')
    const sheet = admin.slice(admin.indexOf('function RecoveryLinkSheet'), admin.indexOf('function BioimpedanceSheet'))
    expect(sheet).toContain('.catch(e => setError(recoveryLinkErrorText(e)))')
    expect(sheet).not.toContain('.catch(e => toast(e.message))')
    expect(sheet.indexOf('<RecoveryLinkError error={error} />')).toBeLessThan(sheet.indexOf("'Generate link'"))
    const es = readFileSync(new URL('../locales/es.js', import.meta.url), 'utf8')
    for (const k of ['To create the link, confirm with your Búnker passkey. If you came in from 2J Hub, sign in to Búnker with your passkey and try again.', 'Could not create the link: {0}', 'Could not create the link. Try again.']) expect(es).toContain(`'${k}':`)
  })
})
