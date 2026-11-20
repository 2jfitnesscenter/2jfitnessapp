import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import GuidedProgramPhoto from '../components/GuidedProgramPhoto.jsx'
import programs from '../../../api/lib/guided-programs-official.json' with { type: 'json' }
import { GUIDED_PROGRAM_PHOTO_IDS, photoForGuidedProgram } from './guided-program-photo.js'

describe('real photos for Entrena con 2J guided programs', () => {
  it('assigns a relevant local photo and attribution to every official program', () => {
    expect(GUIDED_PROGRAM_PHOTO_IDS).toHaveLength(programs.programs.length)
    for (const program of programs.programs) {
      const photo = photoForGuidedProgram(program)
      expect(photo.src).toMatch(/^\/images\/guided-programs\/.+\.jpg$/)
      expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', photo.src.slice(1)))).toBe(true)
      expect(photo.author).toBeTruthy()
      expect(photo.source).toContain('commons.wikimedia.org/wiki/File:')
      expect(photo.license).toBe('https://creativecommons.org/licenses/by/2.0/')
    }
  })

  it('matches program themes to the corresponding photo category', () => {
    const byId = Object.fromEntries(programs.programs.map(program => [program.id, program]))
    expect(photoForGuidedProgram(byId['g2j-mobility-21d']).src).toContain('mobility-stretch')
    expect(photoForGuidedProgram(byId['g2j-cardio-base-6w']).src).toContain('cardio-treadmill')
    expect(photoForGuidedProgram(byId['g2j-home-3w']).src).toContain('home-dumbbell')
    expect(photoForGuidedProgram(byId['g2j-core-3w']).src).toContain('core-leg-raise')
    expect(photoForGuidedProgram(byId['g2j-hotel-3w']).src).toContain('bodyweight-row')
    expect(photoForGuidedProgram(byId['g2j-fullbody-hypertrophy-4w']).src).toContain('strength-woman')
  })

  it('uses a relevant fallback for newly added programs', () => {
    expect(photoForGuidedProgram({ id: 'future', cover: 'mobility' }).src).toContain('mobility-stretch')
    expect(photoForGuidedProgram({ id: 'future', cover: 'strength' }).src).toContain('strength-woman')
  })

  it('renders a local photograph and linked source/license credits on the detail cover', () => {
    const program = programs.programs.find(item => item.id === 'g2j-mobility-21d')
    const html = renderToStaticMarkup(createElement(GuidedProgramPhoto, { program, linkedCredit: true }))
    expect(html).toContain('src="/images/guided-programs/mobility-stretch.jpg"')
    expect(html).toContain('Foto: Nenad Stojković')
    expect(html).toContain('href="https://commons.wikimedia.org/wiki/File:Fit_woman_stretching_her_leg_in_gym.jpg"')
    expect(html).toContain('href="https://creativecommons.org/licenses/by/2.0/"')
  })
})
