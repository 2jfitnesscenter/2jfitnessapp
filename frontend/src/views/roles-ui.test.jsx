import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/* Role selector (Admin → user) and the trainer's routine-cycle editor: wiring only; the server rules are covered by api/test/roles.test.js and routine-review.test.js. */
const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')

describe('role management UI', () => {
  const admin = read('./Admin.jsx')
  it('the admin user sheet has a Member / Trainer / Admin selector that always asks before applying', () => {
    expect(admin).toContain("['member', 'trainer', 'admin']")
    expect(admin).toContain("t('Change role?')")
    expect(admin).toContain("'/api/admin/user/role'")
    expect(admin).toMatch(/confirmSheet\(\{\s*title: t\('Change role\?'\)/)
    expect(admin).toContain("t('Role changed to {0}'")
    expect(admin).toContain('u.adminByConfig')
    expect(admin).not.toContain('setTrainer')                    // the old on/off button is replaced, not duplicated
  })
  it('a change only fires when the role really differs, and the admin changing themself reloads their own session', () => {
    expect(admin).toContain('if (role === currentRole) return')
    expect(admin).toContain('me?.id === u.id')
  })
})

describe('trainer panel: routine-review cycle', () => {
  it('the trainer panel member page shows the cycle editor fed by the trainer endpoint, not the admin follow-up', () => {
    const plan = read('./trainer/TrainerClientPlan.jsx')
    expect(plan).toContain('RoutineCycles'); expect(plan).toContain('fetchRoutineCycles')
    expect(read('../lib/trainer-api.js')).toContain("/api/trainer/routine-cycles?id=")
    expect(plan).not.toContain('/api/admin/user/followup')
  })
  it('the shared editor writes through the staff endpoints and reloads through whoever hosts it', () => {
    const fu = read('./AdminFollowUp.jsx')
    expect(fu).toContain('export function RoutineCycles')
    expect(fu).toContain('reload={load}')
    expect(fu).toContain("'routine-cycle'"); expect(fu).toContain("'routine-reviewed'")
  })
})
