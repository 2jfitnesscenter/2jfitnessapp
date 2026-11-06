// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Fusionar con…": pick one exercise of your own library and the exercise to merge it into, then confirm.
// Redirection only (lib/exercise-merge.js): nothing stored is rewritten and the merge can be undone.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { nameFor } from '../lib/i18n.js'
import { allExercises } from '../lib/exercises.js'
import { searchExercises } from '../lib/library/index.js'
import { mergeExercise, mergeProblem, mergedAwayIds, MERGE_PROBLEM_TEXT } from '../lib/exercise-merge.js'
import { Button } from './ui.jsx'

const SHOWN = 30

export function ExerciseMergeSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [from, setFrom] = useState(null)
  const [to, setTo] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const hidden = new Set(mergedAwayIds(S))
  // The member's own library: their customs and the catalogue, minus exercises already merged away.
  const pool = allExercises(S).filter(e => !hidden.has(e.id) && (!from || e.id !== from.id))
  const list = (q.trim() ? searchExercises(pool, q) : pool).slice(0, SHOWN)

  const confirm = () => {
    const problem = mergeProblem(S, from.id, to.id)
    if (problem) { setErr(MERGE_PROBLEM_TEXT[problem]); return }
    update(s => { mergeExercise(s, from.id, to.id) })
    useUI.getState().toast('Ejercicios fusionados')
    close()
  }

  if (to) return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>¿Fusionar {nameFor(from)} con {nameFor(to)}?</h3>
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>
      Tus entrenos pasados se quedan como están, y puedes deshacer la fusión desde Biblioteca cuando quieras.
    </div>
    {err && <div className="small" style={{ color: 'var(--danger, #c00)', marginBottom: 10 }}>{err}</div>}
    <button className="btn primary" onClick={confirm}>Fusionar</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { setTo(null); setErr('') }}>Volver</Button>
  </div>

  const step = from ? 'Fusionar «' + nameFor(from) + '» con…' : '¿Qué ejercicio quieres fusionar?'
  return <>
    <h3 style={{ marginBottom: 6 }}>{step}</h3>
    <div className="small dim" style={{ marginBottom: 10 }}>Elige un ejercicio de tu biblioteca. El ejercicio fusionado desaparece de las listas, pero sus datos siguen contando para el ejercicio destino.</div>
    <div className="search v3-search" style={{ margin: '0 0 8px' }}>
      <input className="input" placeholder="Buscar ejercicio…" value={q} onChange={e => setQ(e.target.value)} />
    </div>
    <div className="list">
      {list.map(e => <button key={e.id} className="item" onClick={() => (from ? setTo(e) : setFrom(e))}>
        <div className="grow"><div className="tt capitalize">{nameFor(e)}</div></div>
      </button>)}
      {list.length === 0 && <div className="small dim">Ningún ejercicio coincide con la búsqueda.</div>}
    </div>
    {from && <><div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { setFrom(null); setQ('') }}>Cambiar ejercicio</Button></>}
  </>
}

export const exerciseMergeSheet = () => useUI.getState().openSheet(close => <ExerciseMergeSheet close={close} />)
