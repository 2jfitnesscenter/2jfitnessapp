// Share a weekly plan.
//
// Two jobs:
//  1. A small, self-contained file a friend can import into THEIR openGym — just the
//     routines + the week schedule + the custom exercises those routines use. It never
//     carries workouts, weigh-ins or settings, and importing MERGES (adds routines with
//     fresh ids) so nothing the friend already has is touched.
//  2. A clean, printable page (Save as PDF) where a single exercise never splits across
//     a page break — each exercise, and each routine that fits, stays in one place.

import { EXIDX } from './exercises.js'
import { modeOf, fmtSec } from './history.js'
import { uid, todayISO, DAYN, fmtNum } from './format.js'
import { t, nameFor } from './i18n.js'

const PLAN_FMT = 1
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]   // Mon-first, matching the Plan screen

// Keep only the meaningful config fields, so the file stays small and readable.
function cleanEx(e) {
  const o = { id: e.id, sets: e.sets }
  const mode = modeOf(e)
  if (mode === 'cardio') {
    if (e.min != null) o.min = e.min
    if (e.speed != null) o.speed = e.speed
  } else if (mode === 'time') {
    // Written out even though 'reps' is the fallback for a non-cardio id: a plan file that
    // dropped the mode would turn a 45-second plank into a 45-rep one at the other end.
    o.mode = 'time'
    if (e.sec != null) o.sec = e.sec
    if (e.weight) o.weight = e.weight
  } else {
    if (e.reps != null) o.reps = e.reps
    if (e.weight) o.weight = e.weight
  }
  // Progression settings travel with the plan — a shared Greyskull routine that arrives
  // without its rule is just a list of weights.
  if (e.prog) o.prog = e.prog
  if (e.inc > 0) o.inc = e.inc
  if (e.repsMin != null) o.repsMin = e.repsMin
  if (e.sg) o.sg = e.sg
  return o
}

/** Build the shareable bundle: every routine, the week schedule, referenced customs. */
export function buildPlanBundle(S, name) {
  const routines = (S.routines || []).map(r => ({
    id: r.id, name: r.name, emoji: r.emoji, ...(r.prog ? { prog: r.prog } : {}), ex: (r.ex || []).map(cleanEx)
  }))
  const usedIds = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const customEx = (S.customEx || [])
    .filter(c => usedIds.has(c.id))
    .map(c => ({ id: c.id, n: c.n, bp: c.bp, ...(c.desc ? { desc: c.desc } : {}) }))
  const week = {}
  WEEK_ORDER.forEach(d => { if (S.week?.[d]) week[d] = S.week[d] })
  return { opengym_plan: PLAN_FMT, exported: todayISO(), name: name || '', week, routines, customEx }
}

/**
 * Validate + normalise an imported file. Throws with a friendly message if it isn't one.
 *
 * Every exercise id has to resolve — either to the built-in library or to a custom
 * exercise carried in the same file. An id that resolves to neither (a hand-edited file,
 * an export from a build with a different exercise dataset) is dropped here: kept, it
 * would sit invisibly in the routine and only surface as a blank screen when the routine
 * is trained.
 */
export function parsePlan(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!data || !data.opengym_plan || !Array.isArray(data.routines)) {
    throw new Error(t('this isn’t a 2J Fitness Center plan file'))
  }
  const customEx = (Array.isArray(data.customEx) ? data.customEx : []).filter(c => c && c.id)
  const known = new Set(customEx.map(c => c.id))
  let dropped = 0
  const routines = data.routines.filter(r => r && Array.isArray(r.ex)).map(r => ({
    ...r,
    ex: r.ex.filter(e => {
      const ok = !!e && (known.has(e.id) || !!EXIDX[e.id])
      if (!ok) dropped++
      return ok
    })
  }))
  return {
    name: (data.name || '').trim(),
    routines,
    week: data.week || {},
    customEx,
    dropped,
    routineCount: routines.length,
    exerciseCount: routines.reduce((n, r) => n + r.ex.length, 0),
    scheduledDays: WEEK_ORDER.filter(d => data.week?.[d]).length
  }
}

/**
 * Merge a parsed bundle into a draft state `s` (call inside store.update).
 *  - customs: reuse one you already have with the same name + body part, else add it fresh
 *  - routines: always added as NEW routines (fresh ids) — never overwrites yours
 *  - schedule: optional; when on, the shared week REPLACES yours (days the shared plan
 *    leaves empty become rest days — a half-overwritten week would silently mix two plans)
 */
export function mergePlan(s, bundle, { schedule } = {}) {
  s.customEx = s.customEx || []
  const exIdMap = {}
  bundle.customEx.forEach(c => {
    const same = s.customEx.find(x => (x.n || '').toLowerCase() === (c.n || '').toLowerCase() && x.bp === c.bp)
    if (same) { exIdMap[c.id] = same.id; return }
    const nid = uid()
    exIdMap[c.id] = nid
    s.customEx.push({ id: nid, n: c.n, bp: c.bp, ...(c.desc ? { desc: c.desc } : {}) })
  })
  const ridMap = {}
  bundle.routines.forEach(r => {
    const nid = uid()
    ridMap[r.id] = nid
    s.routines.push({
      id: nid,
      name: r.name || t('Shared routine'),
      emoji: r.emoji,
      ...(r.prog ? { prog: r.prog } : {}),
      ex: (r.ex || []).map(e => ({ ...e, id: exIdMap[e.id] || e.id }))
    })
  })
  if (schedule) {
    WEEK_ORDER.forEach(d => { delete s.week[d] })
    Object.entries(bundle.week || {}).forEach(([d, oldId]) => {
      if (ridMap[oldId]) s.week[d] = ridMap[oldId]
    })
  }
  return { routines: bundle.routines.length }
}

/* ------------------------------- printable PDF ------------------------------- */

const esc = str => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// One exercise's scheme, e.g. "3 × 10 · 60 kg", "3 × 0:45" or "2 × 20 min @ 8 km/h".
function scheme(e, unit) {
  const sets = e.sets || 1
  const mode = modeOf(e)
  if (mode === 'cardio') {
    const body = `${e.min || 20} min @ ${fmtNum(e.speed || 8)} km/h`
    return sets > 1 ? `${sets} × ${body}` : body
  }
  let s = mode === 'time' ? `${sets} × ${fmtSec(e.sec || 45)}` : `${sets} × ${e.reps ?? 10}`
  if (e.weight) s += ` · ${fmtNum(e.weight)} ${unit}`
  return s
}

// Group consecutive exercises sharing a superset id into rendered units.
function units(ex) {
  const out = []
  ex.forEach((e, i) => {
    const prev = ex[i - 1]
    if (i > 0 && e.sg && prev?.sg === e.sg) out[out.length - 1].push(e)
    else out.push([e])
  })
  return out
}

// Gym-floor sheet: one log table per scheduled day (not per routine — a routine repeated on
// two days gets a table each, matching a physical sheet used on that specific day), with a
// blank box per set so it can be printed and filled in by hand on the gym floor.
function dayLogHTML(num, weekday, r, unit) {
  const maxSets = Math.max(1, ...r.ex.map(e => e.sets || 1))
  const setHeads = Array.from({ length: maxSets }, (_, i) => `<th class="set">${esc(t('Set {0}', i + 1))}</th>`).join('')
  const rows = units(r.ex).flatMap(u => u.map(e => {
    const ex = EXIDX[e.id]
    const name = ex ? nameFor(ex) : t('Unknown exercise')
    const part = ex && ex.bp && ex.bp !== 'cardio' ? `<span class="ex-part">${esc(t(ex.bp))}</span>` : ''
    const ssTag = u.length > 1 ? `<span class="ss-tag">${esc(t('Superset'))}</span>` : ''
    const boxes = Array.from({ length: maxSets }, (_, i) => `<td>${i < (e.sets || 1) ? '<span class="box"></span>' : ''}</td>`).join('')
    return `<tr${u.length > 1 ? ' class="ss-row"' : ''}>
      <td><div class="ex-name">${ssTag}${esc(name)}${part}</div></td>
      <td class="target">${esc(scheme(e, unit))}</td>
      ${boxes}
    </tr>`
  })).join('')
  return `<section class="day">
    <div class="day-head"><span class="num">${esc(String(num).padStart(2, '0'))}</span><h2>${esc(r.name)}</h2><span class="wd">${esc(weekday)}</span></div>
    <table class="log">
      <thead><tr><th>${esc(t('Exercise'))}</th><th>${esc(t('Target'))}</th>${setHeads}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${maxSets + 2}" class="empty">${esc(t('No exercises yet.'))}</td></tr>`}</tbody>
    </table>
  </section>`
}

function weekStripHTML(S) {
  const cells = WEEK_ORDER.map(d => {
    const r = S.routines.find(x => x.id === S.week?.[d])
    const short = t(DAYN[d]).slice(0, 3).toUpperCase()
    const label = r ? esc(r.name) : `<span class="off">${esc(t('Rest'))}</span>`
    return `<div class="d${r ? ' on' : ''}"><div class="dn">${esc(short)}</div><div class="dr">${label}</div></div>`
  }).join('')
  return `<div class="week-strip">${cells}</div>`
}

/** Full self-contained HTML for the print/PDF view — a gym-floor sheet, one table per
 *  scheduled day, with blank boxes to log each set by hand. */
export function planPrintHTML(S, owner) {
  const unit = S.unit || 'kg'
  const days = WEEK_ORDER
    .map(d => ({ d, r: S.routines?.find(x => x.id === S.week?.[d]) }))
    .filter(x => x.r && x.r.ex && x.r.ex.length)
  const body = days.length
    ? days.map((x, i) => dayLogHTML(i + 1, t(DAYN[x.d]), x.r, unit)).join('')
    : `<p class="none">${esc(t('No routines yet.'))}</p>`
  const dayCount = days.length ? t('{0} days a week', days.length) : ''
  const metaLines = [owner ? `<div><b>${esc(owner)}</b></div>` : '', `<div>${esc([dayCount, todayISO()].filter(Boolean).join(' · '))}</div>`].join('')
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(t('Weekly Training Plan'))}</title>
<style>
  @page { margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: #1c1d17; background: #f6f4ec;
    font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .doc { max-width: 760px; margin: 0 auto; }

  .masthead { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; border-bottom: 3px solid #1c1d17; padding-bottom: 14px; margin-bottom: 6px; }
  .masthead .brand { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #3e6626; font-weight: 700; }
  .masthead h1 { font-size: 30px; letter-spacing: -.01em; margin: 5px 0 0; }
  .masthead .meta { text-align: right; font-size: 12px; color: #5e6263; line-height: 1.6; white-space: nowrap; }
  .masthead .meta b { color: #1c1d17; font-weight: 600; }

  .week-strip { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; background: #c7c0a9; border: 1px solid #c7c0a9; margin: 18px 0 30px; break-inside: avoid; page-break-inside: avoid; }
  .week-strip .d { background: #efebdf; padding: 8px 5px 10px; text-align: center; }
  .week-strip .d.on { background: #e4efdb; }
  .week-strip .dn { font-size: 10px; letter-spacing: .09em; text-transform: uppercase; color: #5e6263; font-weight: 600; }
  .week-strip .d.on .dn { color: #3e6626; }
  .week-strip .dr { font-size: 10.5px; margin-top: 6px; color: #1c1d17; text-transform: capitalize; }
  .week-strip .dr .off { color: #a79f89; text-transform: none; }

  .day { break-inside: avoid; page-break-inside: avoid; margin-bottom: 26px; }
  .day-head { display: flex; align-items: baseline; gap: 12px; border-bottom: 2px solid #1c1d17; padding-bottom: 6px; margin-bottom: 10px; break-after: avoid; page-break-after: avoid; }
  .day-head .num { font-size: 22px; font-weight: 700; color: #5a9438; flex: none; }
  .day-head h2 { font-size: 18px; letter-spacing: -.005em; margin: 0; flex: 1; text-transform: capitalize; }
  .day-head .wd { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: #5e6263; font-weight: 600; white-space: nowrap; }

  table.log { width: 100%; border-collapse: collapse; }
  table.log th { text-align: left; font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; color: #5e6263; font-weight: 600; padding: 0 7px 6px; border-bottom: 1px solid #c7c0a9; }
  table.log th.set { text-align: center; width: 58px; }
  table.log td { padding: 7px 7px; border-bottom: 1px solid #dbd5c3; vertical-align: top; break-inside: avoid; page-break-inside: avoid; }
  table.log tbody tr:last-child td { border-bottom: 2px solid #1c1d17; }
  .ex-name { font-weight: 500; text-transform: capitalize; }
  .ex-part { display: block; font-size: 10px; letter-spacing: .03em; text-transform: uppercase; color: #5e6263; margin-top: 2px; }
  .target { color: #5e6263; white-space: nowrap; }
  .box { display: inline-block; width: 40px; height: 17px; border-bottom: 1.5px solid #c7c0a9; }
  .ss-row td:first-child { position: relative; padding-left: 15px; }
  .ss-row td:first-child::before { content: ''; position: absolute; left: 0; top: 5px; bottom: 5px; width: 3px; background: #5a9438; border-radius: 2px; }
  .ss-tag { display: block; font-size: 8.5px; letter-spacing: .07em; text-transform: uppercase; color: #3e6626; font-weight: 700; margin-bottom: 3px; }
  .empty { color: #a79f89; }

  .none { color: #a79f89; }
  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #dbd5c3; color: #a79f89; font-size: 11px; text-align: center; }
</style></head>
<body><div class="doc">
  <div class="masthead">
    <div>
      <div class="brand">2J Fitness Center</div>
      <h1>${esc(t('Weekly Training Plan'))}</h1>
    </div>
    <div class="meta">${metaLines}</div>
  </div>
  ${weekStripHTML(S)}
  ${body}
  <footer>${esc(t('Made with 2J Fitness Center'))} · 2jfitnesscenter.com</footer>
</div></body></html>`
}

/**
 * Render the plan and open the browser's print dialog (→ Save as PDF).
 * Uses a hidden iframe so we never navigate away or trip a popup blocker.
 */
export function printPlan(S, owner) {
  const ifr = document.createElement('iframe')
  ifr.setAttribute('aria-hidden', 'true')
  ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'
  document.body.appendChild(ifr)
  const cleanup = () => { try { ifr.remove() } catch (e) { /* */ } }
  const run = () => {
    const w = ifr.contentWindow
    if (!w) { cleanup(); return }
    w.onafterprint = cleanup
    setTimeout(cleanup, 60000)   // safety net if afterprint never fires
    w.focus()
    try { w.print() } catch (e) { cleanup() }
  }
  const doc = ifr.contentWindow.document
  doc.open(); doc.write(planPrintHTML(S, owner)); doc.close()
  // Give the iframe a tick to lay out before printing.
  if (doc.readyState === 'complete') setTimeout(run, 120)
  else ifr.onload = () => setTimeout(run, 120)
}
