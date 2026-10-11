// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The same pure Oposiciones model serves the phone (plan, control tests) and the API (profile validation, Coach summary).
import { readFileSync, writeFileSync } from 'node:fs'
const source = new URL('../frontend/src/lib/opposition-model.js', import.meta.url)
const target = new URL('../api/lib/opposition-model.js', import.meta.url)
const expected = readFileSync(source, 'utf8').replaceAll('\r\n', '\n')
if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(target, 'utf8').replaceAll('\r\n', '\n') } catch { /* missing */ }
  if (current !== expected) throw new Error('Opposition model out of sync')
  console.log('OPPOSITION_MODEL=OK')
} else writeFileSync(target, expected)
