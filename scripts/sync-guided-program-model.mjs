// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The same pure program completion model serves phone and Bunker finish.
import { readFileSync, writeFileSync } from 'node:fs'
const source = new URL('../frontend/src/lib/guided-programs.js', import.meta.url)
const target = new URL('../api/lib/guided-program-model.js', import.meta.url)
const expected = readFileSync(source, 'utf8').replaceAll('\r\n', '\n')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== expected) throw new Error('Guided program model out of sync')
  console.log('GUIDED_PROGRAM_MODEL=OK')
} else writeFileSync(target, expected)
