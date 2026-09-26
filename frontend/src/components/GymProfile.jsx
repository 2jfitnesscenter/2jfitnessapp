// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { EQUIPMENT } from '../lib/protocol/movements.js'
import { activeGymProfile, gymProfilesOf, selectGymProfile, saveGymProfile, compatibleWithGym } from '../lib/gym-profiles.js'

export function GymCompatibility({ ex, context }) {
  const S = useStore(s => s.S)
  return <span className="small dim">{compatibleWithGym(context || S, ex) ? t('Compatible with this place') : t('Equipment not confirmed here')}</span>
}
export default function GymProfile({ editable = false }) {
  const selectorId = useId()
  const S = useStore(s => s.S), update = useStore(s => s.update)
  const active = activeGymProfile(S)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('other')
  const change = id => update(s => selectGymProfile(s, id))
  const toggle = id => update(s => saveGymProfile(s, { ...active, availableEquipment: active.availableEquipment.includes(id) ? active.availableEquipment.filter(x => x !== id) : [...active.availableEquipment, id] }))
  return <div className="card" style={{ padding: 12, marginBottom: 12 }}>
    <label className="small dim" htmlFor={selectorId}>{t('Training place')}</label>
    <select className="input" id={selectorId} value={active.id} onChange={e => change(e.target.value)}>
      {gymProfilesOf(S).map(p => <option key={p.id} value={p.id}>{p.type === 'other' || p.type === 'custom' ? p.name : t(p.name)}</option>)}
    </select>
    {editable && <>
      <button className="chip" onClick={() => setOpen(!open)}>{t('Configure training places')}</button>
      {open && <>
        <p className="small dim">{t('Equipment categories only; check the actual machine before training.')}</p>
        {active.id === '2j' ? <p className="small">{t('Confirmed 2J categories')}: {active.availableEquipment.map(id => t(EQUIPMENT.find(e => e.id === id)?.label || id)).join(' · ')}</p> : <>
          <div className="chips">{EQUIPMENT.map(e => <button key={e.id} className={'chip' + (active.availableEquipment.includes(e.id) ? ' on' : '')} aria-pressed={active.availableEquipment.includes(e.id)} onClick={() => toggle(e.id)}>{t(e.label)}</button>)}</div>
          {(active.type === 'other' || active.type === 'custom') && <button className="chip" onClick={() => update(s => { s.gymProfiles = { ...s.gymProfiles, activeId: '2j', custom: (s.gymProfiles?.custom || []).filter(p => p.id !== active.id) } })}>{t('Delete place')}</button>}
        </>}
        <input className="input" aria-label={t('Place name')} placeholder={t('Place name')} maxLength={60} value={name} onChange={e => setName(e.target.value)} />
        <select className="input" aria-label={t('Place type')} value={type} onChange={e => setType(e.target.value)}><option value="other">{t('Other gym')}</option><option value="custom">{t('Custom gym')}</option></select>
        <button className="btn" disabled={!name.trim() || gymProfilesOf(S).length >= 15} onClick={() => {
          const id = 'gym-' + crypto.randomUUID()
          update(s => { saveGymProfile(s, { id, name, type, availableEquipment: ['bodyweight'] }); selectGymProfile(s, id) }); setName('')
        }}>{t('Add place')}</button>
      </>}
    </>}
  </div>
}
