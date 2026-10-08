// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Coach & Seguimiento PRO V3 (staff) — the client side of api/lib/coach-followup.js: thin API wrappers and the words. Everything the sheet shows is computed on the
// server from the member's own data; this file only translates codes into sentences. Nothing here scores, judges or diagnoses.
import { api } from './api.js'
import { t } from './i18n.js'
import { PAIN_ZONE } from './checkin.js'

const post = (path, body) => api('/api/trainer/followup/' + path, { method: 'POST', body: JSON.stringify(body) })
export const fetchBoard = () => api('/api/trainer/followup/overview')
export const fetchMember = id => api('/api/trainer/followup/member?id=' + encodeURIComponent(id))
export const fetchAnalysis = id => api('/api/trainer/followup/analysis?id=' + encodeURIComponent(id))
export const startFollowUp = id => post('start', { id })
export const saveGoal = (id, goal) => post('goal', { id, ...goal })
export const saveNote = (id, text, ref) => post('note', { id, text, ...(ref ? { ref } : {}) })
export const removeNote = (id, noteId) => post('note/delete', { id, noteId })
export const logDecision = (id, kind, text, ref) => post('decision', { id, kind, ...(text ? { text } : {}), ...(ref ? { ref } : {}) })
export const setFlag = (id, on) => post('flag', { id, on })
export const analyze = (id, structure, lang) => post('analyze', { id, structure, lang })
export const assignTrainers = (id, trainerIds) => api('/api/admin/user/trainers', { method: 'POST', body: JSON.stringify({ id, trainerIds }) })

// The goals the product already has (CoachIntake / follow-up digest). A staff reading may also carry a free label.
export const GOALS = [['hypertrophy', 'Build muscle'], ['toning', 'Tone up'], ['fatloss', 'Lose fat'], ['power', 'Power'], ['plyometrics', 'Plyometrics'],
  ['longevity', 'Health & longevity'], ['padel', 'Padel performance'], ['basketball', 'Basketball performance'], ['examfitness', 'Physical exam prep']]
const GOAL_NAME = Object.fromEntries(GOALS)
/** The goal as a short name: the staff's own label first, then the product goal; null when there is none. */
export const goalName = g => (g?.label ? g.label : g?.key && GOAL_NAME[g.key] ? t(GOAL_NAME[g.key]) : null)

export const LEVEL = { priority: { word: 'Priority', tone: 'orange' }, review: { word: 'To review', tone: 'blue' }, normal: { word: 'Normal', tone: 'acc' } }

/** "today" · "yesterday" · "6 days ago" for a number of days (null → ''). */
export const agoText = days => (days == null ? '' : days <= 0 ? t('Today') : days === 1 ? t('Yesterday') : t('{0} days ago', days))
/** "in 3 days" / "today" / "2 days ago" for a review date offset. */
export const inText = days => (days == null ? '' : days === 0 ? t('Today') : days > 0 ? (days === 1 ? t('Tomorrow') : t('In {0} days', days)) : (days === -1 ? t('Yesterday') : t('{0} days ago', -days)))

/** One sentence per signal, from the registered English template and the numbers behind it. A discomfort zone is turned into its label. */
export function signalText(s) {
  const args = s.id === 'checkin_discomfort' ? [t(PAIN_ZONE[s.args?.[0]]?.label || s.args?.[0] || '').toLowerCase(), s.args?.[1]] : s.args || []
  return t(s.explanation, ...args)
}
export const actionText = s => t(s.suggestedAction)

// Certainty tags: never mix the three in one sentence.
export const TAG = { fact: 'Fact', inference: 'Inference', suggestion: 'Suggestion' }

export const EVENT_TEXT = {
  review_done: 'Review completed', measurement_review: 'Measurement review', plan_changed: 'Plan changed', goal_changed: 'Goal updated',
  review_rescheduled: 'Review date moved', recommendation_accepted: 'Recommendation accepted', recommendation_rejected: 'Recommendation dismissed',
  program_changed: 'Program changed', rescheduled: 'Sessions rescheduled', flag_set: 'Marked for follow-up', flag_cleared: 'Follow-up mark cleared', note_added: 'Note added',
}
export const eventLabel = k => t(EVENT_TEXT[k] || k)

export const TREND_TEXT = { up: 'Adherence is rising', down: 'Adherence is falling', flat: 'Adherence is steady' }
export const PROGRESSION_TEXT = { improving: 'Progression trend improving', stable: 'Progression trend stable', insufficient: 'Not enough data yet' }
