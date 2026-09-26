// Copyright (C) 2026 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { LegalSheet, SOURCE_URL, UPSTREAM_URL, LICENSE_URL } from './Legal.jsx'

/* Legal & credits: the original author's notice is kept, the fork is credited for its own work
 * only, the license and the source are one tap away, and the repo documents say the same. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const doc = f => readFileSync(join(root, f), 'utf8')

describe('Legal & credits', () => {
  const html = renderToStaticMarkup(<LegalSheet />)
  it('keeps openGym and its author, credits the fork, and links the license and the source', () => {
    expect(html).toContain('openGym — Copyright (C) 2026 Duarte Santos')
    expect(html).toContain('Copyright (C) 2026 2J Fitness Center')
    expect(html).toContain('Development and fork modifications: 2J Fitness Center')
    expect(html).toContain('Alex Costa')
    expect(html).toContain('GNU Affero General Public License v3.0 or later')
    for (const u of [SOURCE_URL, UPSTREAM_URL, LICENSE_URL]) expect(html).toContain(`href="${u}"`)
    expect(html).toContain('MuscleMap by Melih Colpan (MIT)')
    expect(html).toContain('hasaneyldrm/exercises-dataset')
  })
  it('the repository notices agree with the screen and the license stays AGPL', () => {
    expect(doc('LICENSE')).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/)
    expect(doc('NOTICE.md')).toContain('openGym** — Copyright (C) 2026 Duarte Santos')
    expect(doc('NOTICE.md')).toContain('Copyright (C) 2026 **2J Fitness Center**')
    expect(doc('AUTHORS.md')).toContain('Duarte Santos')
    expect(doc('THIRD_PARTY_NOTICES.md')).toContain('Copyright (c) 2026 Melih Colpan')
    expect(doc('TRADEMARKS.md')).toContain('does **not** restrict anything the AGPL allows')
    for (const p of ['frontend/package.json', 'api/package.json']) expect(JSON.parse(doc(p)).license).toBe('AGPL-3.0-or-later')
  })
})
