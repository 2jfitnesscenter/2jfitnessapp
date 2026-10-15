import { describe, expect, it, vi } from 'vitest'
import { EXTERNAL_AI_SCAN_CONSENT, scanAfterExplicitConsent } from './scan-consent.js'

describe('explicit consent for external AI scans', () => {
  it('does not read or send a selected file when the user cancels', async () => {
    const readFile = vi.fn()
    const scan = vi.fn()
    await expect(scanAfterExplicitConsent({ file: new File(['private'], 'report.pdf'), accepted: false, readFile, scan })).resolves.toBeNull()
    expect(readFile).not.toHaveBeenCalled()
    expect(scan).not.toHaveBeenCalled()
  })

  it('reads and sends the file once only after explicit confirmation', async () => {
    const file = new File(['synthetic'], 'scan.pdf', { type: 'application/pdf' })
    const readFile = vi.fn().mockResolvedValue('data:application/pdf;base64,c3ludGhldGlj')
    const scan = vi.fn().mockResolvedValue({ ok: true })
    await expect(scanAfterExplicitConsent({ file, accepted: true, readFile, scan })).resolves.toEqual({ ok: true })
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(readFile).toHaveBeenCalledWith(file)
    expect(scan).toHaveBeenCalledTimes(1)
    expect(scan).toHaveBeenCalledWith('data:application/pdf;base64,c3ludGhldGlj', { externalAiConsent: EXTERNAL_AI_SCAN_CONSENT })
  })
})
