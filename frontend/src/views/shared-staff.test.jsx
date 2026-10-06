import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const login = source('./Login.jsx')
const guard = source('../components/SharedStaffSessionGuard.jsx')
const settings = source('./SharedStaffSettings.jsx')
const server = source('../../../api/lib/shared-staff.js')
const app = source('../App.jsx')

describe('shared trainer access surfaces', () => {
  it('shows the discreet entry only for an authorized device and lists only server-eligible staff', () => {
    expect(login).toContain('sharedDevice?.authorized &&')
    expect(login).toContain('sharedDevice.staff.map(person =>')
    expect(server).toContain('.filter(user => allowed.has(user.id) && !user.disabled && isTrainer(user))')
    expect(server).toContain("({ id: user.id, name: String(user.name || '').slice(0, 60), role: isAdmin(user) ? 'admin' : 'trainer' })")
    expect(login).toContain('Back to passkey sign-in')
  })

  it('sends PIN only through the shared-device endpoint and uses one generic failure message', () => {
    expect(login).toContain('sharedStaffLogin(sharedUser, sharedPin)')
    expect(login).toContain('The profile or PIN is not correct.')
    expect(login).not.toContain('email')
  })

  it('auto-locks after 15 minutes, rechecks on visibility and clears transient UI on lock', () => {
    expect(guard).toContain('const IDLE_MS = 15 * 60_000')
    expect(guard).toContain("document.addEventListener('visibilitychange', checkElapsed)")
    expect(guard).toContain("window.addEventListener('2j:shared-session-invalid', lockNow)")
    expect(guard).toContain('ui.closeAll(); ui.stopRest(); ui.stopWork()')
    expect(guard).toContain('await lockSharedSession()')
  })

  it('does not render cached PIN identity or run active-workout startup tasks before server validation', () => {
    expect(app).toContain("if (!ready && user?.authLevel === 'pin') return (")
    expect(app).toContain("if (!state.ready && state.user?.authLevel === 'pin') return")
    expect(app).toContain('if (!ready || !user?.id) return')
  })

  it('requires passkey ceremonies for PIN changes, device authorization/revocation and admin resets', () => {
    expect(settings).toContain('setOwnStaffPin(pin)')
    expect(settings).toContain('authorizeSharedDevice(label)')
    expect(settings).toContain('revokeSharedDevice(device.id)')
    expect(settings).toContain('resetStaffPin(targetId, pin)')
    expect(settings).toContain('Confirm with your passkey')
  })
})
