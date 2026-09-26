// V2 — the review layer on top of V1's import-csv.js. Nothing here replaces parseWorkoutCSV or
// mergeImport; this sits between them: it tries to upgrade whatever parseWorkoutCSV couldn't
// resolve on its own (parsed.customEx, one placeholder per distinct unrecognised name) to a real
// library exercise — first via a gym-wide alias a human already confirmed, then via the
// auxiliary-AI profile's exercise_import_matching capability (optional, Gemini) — before the
// user ever sees a confirm button. If nothing here resolves anything (offline, IA auxiliar
// desactivada, sin candidatos, lo que sea), the import behaves exactly like V1: every
// unrecognised name becomes a custom exercise, same as always. This file never itself writes to
// S — see sheets.jsx's ImportSummary/ImportMatchReview for where a user's choice is applied.
import { EXDB, EXIDX } from './exercises.js'
import { nameFor } from './i18n.js'
import { api } from './api.js'

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** The gym-wide alias table's key for one external exercise name — namespaced by source (a
 *  name can mean different things exported from different apps) same as machine-scan.js's own
 *  machineAliasKey, just with `source` folded in since here there IS one to fold in. */
export const importAliasKey = (source, name) => `${norm(source)}|${norm(name)}`

/* --------------------------------------------------------- local candidate generation ---- */
// Loose, non-authoritative overlap scoring — this is deliberately more permissive than
// import-csv.js's own matchExerciseCandidates() (which only auto-applies a tied handful of
// near-exact matches): this list only ever gets a candidate PUT IN FRONT OF A HUMAN, or sent to
// Gemini as the closed set it's allowed to choose from — it never assigns anything by itself.
// Scored against both the dataset's own English name and its Spanish translation (when one
// exists), so a Spanish CSV export has a real shot at a token match even though the underlying
// dataset is English-named.
const tokenize = s => norm(s).replace(/[()[\]]/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)

let NAME_INDEX = null
function nameIndex() {
  if (NAME_INDEX) return NAME_INDEX
  NAME_INDEX = EXDB.map(ex => ({ ex, en: tokenize(ex.n), es: tokenize(nameFor(ex)) }))
  return NAME_INDEX
}
function jaccard(aTokens, bSet) {
  if (!aTokens.length || !bSet.size) return 0
  let inter = 0
  for (const t of aTokens) if (bSet.has(t)) inter++
  const union = aTokens.length + bSet.size - inter
  return union ? inter / union : 0
}

/** Up to `limit` catalogue exercises whose name plausibly overlaps `name`, best first — never
 *  auto-applied, only ever offered (to a human, or as Gemini's closed candidate set). */
export function localCandidates(name, limit = 6) {
  const q = tokenize(name)
  if (!q.length) return []
  const scored = nameIndex().map(({ ex, en, es }) => ({
    ex, score: Math.max(jaccard(q, new Set(en)), jaccard(q, new Set(es))),
  })).filter(s => s.score >= 0.2)
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ ex }) => ({
    id: ex.id, name: nameFor(ex), equipment: ex.eq, muscles: [ex.tg, ...(ex.sm || [])].filter(Boolean),
  }))
}

/* ------------------------------------------------------------------ the review plan ---- */
// One entry per parsed.customEx placeholder (never per raw unmatchedNames string — see this
// module's own note: two differently-cased/spaced raw names can normalise to the very same
// customEx, and the placeholder id is what workout entries actually reference).
//
//   status: 'alias'      — a human already confirmed this exact (source, name) before; applied
//                           automatically, never re-asked (section 8's "no volver a preguntar").
//   status: 'suggested'  — Gemini proposed exactly one candidate; shown pre-selected in the
//                           review screen but NEVER auto-applied without an explicit confirm —
//                           see finalizeImportPlan()'s own comment for why.
//   status: 'pending'    — nothing resolved it (no alias, Gemini off/failed/AMBIGUOUS/NO_MATCH,
//                           or no candidates existed to begin with) — local candidates (if any)
//                           are still offered for a manual pick; untouched, it stays a custom
//                           exercise exactly as V1 already does.
export async function buildImportPlan(parsed, { useGemini = true } = {}) {
  const resolutions = new Map()   // placeholder id -> { name, status, exerciseId, candidates, key, confidence?, reason? }
  if (!parsed.customEx?.length) return resolutions

  let aliasByKey = new Map()
  try {
    const { aliases } = await api('/api/exercises/import-aliases')
    aliasByKey = new Map((aliases || []).map(a => [a.key, a.exerciseId]));
  } catch { /* signed out, offline, or the endpoint failed — proceed with no aliases at all */ }

  const forGemini = []
  parsed.customEx.forEach(c => {
    const name = c.n
    const key = importAliasKey(parsed.source, name)
    const aliasId = aliasByKey.get(key)
    if (aliasId && EXIDX[aliasId]) {
      resolutions.set(c.id, { name, key, status: 'alias', exerciseId: aliasId, candidates: [] });
      return
    }
    const candidates = localCandidates(name)
    resolutions.set(c.id, { name, key, status: 'pending', exerciseId: null, candidates });
    if (candidates.length) forGemini.push({ placeholderId: c.id, name, candidates })
  })

  if (useGemini && forGemini.length) {
    try {
      const { results } = await api('/api/exercises/import-match', {
        method: 'POST',
        body: JSON.stringify({
          items: forGemini.map(it => ({ name: it.name, source: parsed.source, candidates: it.candidates })),
        }),
      })
      const byName = new Map((results || []).map(r => [r.externalName, r]))
      forGemini.forEach(it => {
        const r = byName.get(it.name)
        const res = resolutions.get(it.placeholderId)
        if (!r || !res) return
        if (r.status === 'MATCH' && r.exerciseId && EXIDX[r.exerciseId]) {
          res.status = 'suggested'; res.exerciseId = r.exerciseId
          res.confidence = r.confidence; res.reason = r.reason
        }
        // AMBIGUOUS / NO_MATCH / anything else: stays 'pending', candidates already attached.
      })
    } catch { /* IA auxiliar desactivada, sin credencial, caída, timeout, JSON inválido... — la
                 importación sigue por el camino manual, nunca se bloquea por esto (sección 16). */ }
  }

  return resolutions
}

/**
 * Applies only what the user actually confirmed (alias hits are pre-confirmed by definition —
 * see buildImportPlan's own status doc) to `parsed`, WITHOUT mutating it — returns a fresh
 * plan for mergeImport(), plus the list of newly-confirmed aliases to persist once the import
 * itself actually goes through (never before — section 5's "nada se escribe antes de
 * confirmar", section 8's "identidad del alias contempla el origen").
 *
 * `confirmed` is a Map of placeholder id -> exerciseId for anything a human explicitly chose in
 * the review screen (a Gemini 'suggested' item the user tapped "Confirmar" on, a candidate they
 * picked for a 'pending' item, or a manual library search result) — 'alias' resolutions apply
 * on their own and need no entry here; anything with neither an alias nor an explicit human
 * confirmation is left exactly as parseWorkoutCSV produced it (a custom exercise), same as V1.
 */
export function applyImportResolutions(parsed, resolutions, confirmed) {
  const idMap = new Map()
  const aliasesToSave = []
  resolutions.forEach((res, placeholderId) => {
    if (res.status === 'alias') { idMap.set(placeholderId, res.exerciseId); return }
    const chosen = confirmed?.get(placeholderId)
    if (chosen && EXIDX[chosen]) {
      idMap.set(placeholderId, chosen)
      aliasesToSave.push({ key: res.key, exerciseId: chosen, source: parsed.source || '', externalName: res.name })
    }
  })
  if (!idMap.size) return { ...parsed, aliasesToSave }
  const workouts = parsed.workouts.map(w => ({
    ...w,
    entries: w.entries.map(e => (idMap.has(e.id) ? { ...e, id: idMap.get(e.id) } : e)),
  }))
  const customEx = parsed.customEx.filter(c => !idMap.has(c.id))
  return { ...parsed, workouts, customEx, aliasesToSave }
}
