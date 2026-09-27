// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// One gym-wide admin-owned equipment list; deliberately outside per-member Sync V2 state.
import fs from 'node:fs'
import path from 'node:path'
import { cleanEquipment, DEFAULT_2J_EQUIPMENT } from './gym-profiles.js'

const file = () => path.join(process.env.DATA_DIR || '/data', 'gym-profile.json')

export function load() {
  try {
    const value = JSON.parse(fs.readFileSync(file(), 'utf8'))
    if (value?.v === 1 && Array.isArray(value.availableEquipment)) return cleanEquipment(value.availableEquipment)
  } catch { /* a missing/invalid file uses the bundled compatible default */ }
  return [...DEFAULT_2J_EQUIPMENT]
}

export function save(availableEquipment) {
  const target = file(), tmp = target + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, availableEquipment }))
  fs.renameSync(tmp, target)
}
