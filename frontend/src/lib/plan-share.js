// Share a weekly plan.
//
// Two jobs:
//  1. A small, self-contained file a friend can import into THEIR 2J Fitness Center — just the
//     routines + the week schedule + the custom exercises those routines use. It never
//     carries workouts, weigh-ins or settings, and importing MERGES (adds routines with
//     fresh ids) so nothing the friend already has is touched.
//  2. A clean, printable page (Save as PDF) where a single exercise never splits across
//     a page break — each exercise, and each routine that fits, stays in one place.

import { EXIDX } from './exercises.js'
import { modeOf, fmtSec, activeWeek } from './history.js'
import { uid, todayISO, DAYN, fmtNum, exCount, routineCount } from './format.js'
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

/**
 * Build the shareable bundle. By default: every routine + the flat weekly schedule.
 * `routineIds` scopes it down to just those routines (in that order) — used to export a
 * single routine, or one program's routines — and also restricts which days end up in the
 * exported week. `week` overrides which schedule is read: pass a program's own `p.week`
 * when exporting a program, since that's a separate mapping from the flat `S.week`.
 */
export function buildPlanBundle(S, name, { routineIds, week: weekSource } = {}) {
  const source = routineIds
    ? routineIds.map(id => (S.routines || []).find(r => r.id === id)).filter(Boolean)
    : (S.routines || [])
  const routines = source.map(r => ({
    id: r.id, name: r.name, emoji: r.emoji, ...(r.prog ? { prog: r.prog } : {}), ex: (r.ex || []).map(cleanEx)
  }))
  const usedIds = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const customEx = (S.customEx || [])
    .filter(c => usedIds.has(c.id))
    .map(c => ({ id: c.id, n: c.n, bp: c.bp, ...(c.mgKey ? { mgKey: c.mgKey } : {}), ...(c.desc ? { desc: c.desc } : {}) }))
  const srcWeek = weekSource !== undefined ? weekSource : S.week
  const week = {}
  WEEK_ORDER.forEach(d => { if (srcWeek?.[d] && (!routineIds || routineIds.includes(srcWeek[d]))) week[d] = srcWeek[d] })
  return { '2jfitness_plan': PLAN_FMT, exported: todayISO(), name: name || '', week, routines, customEx }
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
  // Accepts both the old and new format-marker key so plan files already exported (or created
  // by an older Coach bundle) keep importing correctly.
  if (!data || (!data.opengym_plan && !data['2jfitness_plan']) || !Array.isArray(data.routines)) {
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
 *  - schedule: optional; when on, the shared week REPLACES the flat one (days the shared plan
 *    leaves empty become rest days — a half-overwritten week would silently mix two plans)
 *  - asProgram: optional, and takes over from `schedule` entirely when set — instead of writing
 *    the flat week, bundles the merged routines + their remapped week into a new Program and
 *    makes it the active one (see lib/history.js's activeWeek). Used by the AI Coach's
 *    create-a-plan flow, not by importing a plan file from a friend — the two never both need it.
 */
export function mergePlan(s, bundle, { schedule, asProgram, programName, programEmoji } = {}) {
  s.customEx = s.customEx || []
  const exIdMap = {}
  bundle.customEx.forEach(c => {
    const same = s.customEx.find(x => (x.n || '').toLowerCase() === (c.n || '').toLowerCase() && x.bp === c.bp)
    if (same) { exIdMap[c.id] = same.id; return }
    const nid = uid()
    exIdMap[c.id] = nid
    s.customEx.push({ id: nid, n: c.n, bp: c.bp, ...(c.mgKey ? { mgKey: c.mgKey } : {}), ...(c.desc ? { desc: c.desc } : {}) })
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
  let programId
  if (asProgram) {
    const week = {}
    Object.entries(bundle.week || {}).forEach(([d, oldId]) => { if (ridMap[oldId]) week[d] = ridMap[oldId] })
    const program = {
      id: uid(), name: programName || bundle.name || t('New program'), emoji: programEmoji || 'sparkles',
      routineIds: bundle.routines.map(r => ridMap[r.id]).filter(Boolean), week
    }
    s.programs = s.programs || []
    s.programs.push(program)
    s.activeProgramId = program.id
    programId = program.id
  } else if (schedule) {
    WEEK_ORDER.forEach(d => { delete s.week[d] })
    Object.entries(bundle.week || {}).forEach(([d, oldId]) => {
      if (ridMap[oldId]) s.week[d] = ridMap[oldId]
    })
  }
  return { routines: bundle.routines.length, programId }
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
// blank box per set so it can be printed and filled in by hand on the gym floor. `num`/`weekday`
// are optional — a standalone routine (no day of its own) omits both and prints just the table.
//
// Sized for a third of a landscape page (see DAYS_PER_PAGE below) — column widths are computed
// here rather than left to the browser's own table layout, since a fixed-layout table this
// narrow needs the exercise name column to win most of the space or it wraps into unreadable
// slivers, and that balance shifts with how many set columns a given day actually needs.
function dayLogHTML(num, weekday, r, unit) {
  const maxSets = Math.max(1, ...r.ex.map(e => e.sets || 1))
  const setW = Math.min(14, Math.max(7, 40 / maxSets))       // %, narrower per column the more sets there are
  const nameW = Math.max(30, 96 - 18 - setW * maxSets)        // % — whatever the set columns don't use, minus target's fixed 18%
  const setHeads = Array.from({ length: maxSets }, (_, i) => `<th class="set" style="width:${setW}%">${esc(t('Set {0}', i + 1))}</th>`).join('')
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
  const head = num
    ? `<span class="num">${esc(String(num).padStart(2, '0'))}</span><h2>${esc(r.name)}</h2><span class="wd">${esc(weekday)}</span>`
    : `<h2>${esc(r.name)}</h2>`
  return `<section class="day">
    <div class="day-head">${head}</div>
    <table class="log">
      <colgroup><col style="width:${nameW}%"><col style="width:18%">${Array.from({ length: maxSets }, () => `<col style="width:${setW}%">`).join('')}</colgroup>
      <thead><tr><th>${esc(t('Exercise'))}</th><th>${esc(t('Target'))}</th>${setHeads}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${maxSets + 2}" class="empty">${esc(t('No exercises yet.'))}</td></tr>`}</tbody>
    </table>
  </section>`
}

// 3 columns fit comfortably on a landscape page without the exercise table shrinking past
// legibility — a 4th made the name column too narrow to hold most exercise names on one line.
// A 5-day week is exactly two sheets this way (3 + 2), printed both sides of one page.
const DAYS_PER_PAGE = 3
const paginate = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

function weekStripHTML(routines, week) {
  const cells = WEEK_ORDER.map(d => {
    const r = routines.find(x => x.id === week?.[d])
    const short = t(DAYN[d]).slice(0, 3).toUpperCase()
    const label = r ? esc(r.name) : `<span class="off">${esc(t('Rest'))}</span>`
    return `<div class="d${r ? ' on' : ''}"><div class="dn">${esc(short)}</div><div class="dr">${label}</div></div>`
  }).join('')
  return `<div class="week-strip">${cells}</div>`
}

// The gym's own logo (frontend/public/brand/logo-full.png), inlined as a data: URI so it
// renders regardless of how the print document ends up hosted — a same-origin hidden iframe
// (openPrintWindow's default path) can load a plain /brand/... URL fine, but the blob: URL
// standalone-iOS falls back to (see openInNewTab below) gets its own opaque origin, where a
// relative path to the real app server isn't guaranteed to resolve. Fetched once and cached
// module-wide; every print/export call after the first pays nothing for it.
let LOGO_CACHE = null
async function logoDataUri() {
  if (LOGO_CACHE) return LOGO_CACHE
  try {
    const res = await fetch('/brand/logo-full.png')
    const blob = await res.blob()
    LOGO_CACHE = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch { /* offline, or the asset moved — the masthead just runs without it */ }
  return LOGO_CACHE
}

// Shared document chrome (styles + one .page per DAYS_PER_PAGE-sized group of day tables,
// each with its own masthead so a page found on its own is still identifiable) behind all four
// print views below — the styles are the expensive part to keep in sync, so there is exactly
// one copy of them. `dayBlocks` are already-rendered dayLogHTML() strings; `weekStripHtml`,
// when given, appears once, under the first page's masthead only.
function printShell(title, meta, logoImg, dayBlocks, weekStripHtml) {
  const groups = paginate(dayBlocks.length ? dayBlocks : ['<p class="none">' + esc(t('No routines yet.')) + '</p>'], DAYS_PER_PAGE)
  const pages = groups.map((group, gi) => `
    <div class="page">
      <div class="masthead">
        ${logoImg ? `<img class="logo" src="${logoImg}" alt="" />` : ''}
        <div class="titles"><div class="brand">2J Fitness Center</div><h1>${esc(title)}</h1></div>
        <div class="meta">${meta}</div>
      </div>
      ${gi === 0 && weekStripHtml ? weekStripHtml : ''}
      <div class="days-grid">${group.join('')}</div>
      <footer>${esc(t('Made with 2J Fitness Center'))} · 2jfitnesscenter.com${groups.length > 1 ? ` · ${gi + 1}/${groups.length}` : ''}</footer>
    </div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: #1c1d17; background: #f6f4ec;
    font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }

  /* 277mm = A4 landscape (297mm) minus the @page's own 10mm margins either side — sizing this
     in mm (a real physical unit, not just a print-time one) means the layout previews at its
     true printed proportions in an ordinary browser tab too, not only inside the print dialog. */
  .page { width: 277mm; margin: 0 auto 10mm; }
  .page:not(:last-child) { break-after: page; page-break-after: always; }

  .masthead { display: flex; align-items: center; gap: 8mm; border-bottom: 1.5px solid #1c1d17; padding-bottom: 3mm; margin-bottom: 5mm; }
  .masthead .logo { height: 11mm; width: auto; flex: none; display: block; }
  .masthead .titles { min-width: 0; }
  .masthead .brand { font-size: 8px; letter-spacing: .13em; text-transform: uppercase; color: #3e6626; font-weight: 700; }
  .masthead h1 { font-size: 17px; letter-spacing: -.01em; margin: 2px 0 0; }
  .masthead .meta { margin-left: auto; text-align: right; font-size: 9px; color: #5e6263; line-height: 1.6; white-space: nowrap; flex: none; }
  .masthead .meta b { color: #1c1d17; font-weight: 600; }

  .week-strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; background: #c7c0a9; border: 1px solid #c7c0a9; margin: 0 0 6mm; break-inside: avoid; page-break-inside: avoid; }
  .week-strip .d { background: #efebdf; padding: 5px 4px 6px; text-align: center; }
  .week-strip .d.on { background: #e4efdb; }
  .week-strip .dn { font-size: 7.5px; letter-spacing: .08em; text-transform: uppercase; color: #5e6263; font-weight: 600; }
  .week-strip .d.on .dn { color: #3e6626; }
  .week-strip .dr { font-size: 8px; margin-top: 3px; color: #1c1d17; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .week-strip .dr .off { color: #a79f89; text-transform: none; }

  .days-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7mm; align-items: start; }
  .day { break-inside: avoid; page-break-inside: avoid; min-width: 0; }
  .day-head { display: flex; align-items: baseline; gap: 5px; border-bottom: 1.5px solid #1c1d17; padding-bottom: 3px; margin-bottom: 5px; break-after: avoid; page-break-after: avoid; }
  .day-head .num { font-size: 13px; font-weight: 700; color: #5a9438; flex: none; }
  .day-head h2 { font-size: 10.5px; letter-spacing: -.005em; margin: 0; flex: 1; min-width: 0; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .day-head .wd { font-size: 6.5px; letter-spacing: .09em; text-transform: uppercase; color: #5e6263; font-weight: 600; white-space: nowrap; }

  table.log { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.log th { text-align: left; font-size: 5.5px; letter-spacing: .04em; text-transform: uppercase; color: #5e6263; font-weight: 600; padding: 0 2px 3px; border-bottom: 1px solid #c7c0a9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  table.log th.set { text-align: center; }
  table.log td { padding: 3px 2px; border-bottom: 1px solid #dbd5c3; vertical-align: top; break-inside: avoid; page-break-inside: avoid; }
  table.log tbody tr:last-child td { border-bottom: 1.5px solid #1c1d17; }
  .ex-name { font-size: 7.5px; font-weight: 500; text-transform: capitalize; line-height: 1.25; overflow-wrap: break-word; }
  .ex-part { display: block; font-size: 5.5px; letter-spacing: .02em; text-transform: uppercase; color: #5e6263; margin-top: 1px; }
  .target { color: #5e6263; font-size: 6.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .box { display: block; width: 100%; height: 8px; border-bottom: 1px solid #c7c0a9; }
  .ss-row td:first-child { position: relative; padding-left: 7px; }
  .ss-row td:first-child::before { content: ''; position: absolute; left: 0; top: 3px; bottom: 3px; width: 2px; background: #5a9438; border-radius: 1px; }
  .ss-tag { display: block; font-size: 5px; letter-spacing: .05em; text-transform: uppercase; color: #3e6626; font-weight: 700; margin-bottom: 2px; }
  .empty { color: #a79f89; font-size: 8px; }

  .none { color: #a79f89; }
  footer { margin-top: 6mm; padding-top: 2mm; border-top: 1px solid #dbd5c3; color: #a79f89; font-size: 8px; text-align: center; }
</style></head>
<body>${pages}</body></html>`
}

const metaOf = (owner, extra) => [owner ? `<div><b>${esc(owner)}</b></div>` : '', `<div>${esc([extra, todayISO()].filter(Boolean).join(' · '))}</div>`].join('')

/** Full self-contained HTML for the print/PDF view — a gym-floor sheet, one table per
 *  scheduled day, 3 to a landscape page, with blank boxes to log each set by hand. Whichever
 *  schedule is actually driving Home right now — an active program's own week if one is
 *  active, the flat week otherwise (same activeWeek() Home itself reads) — not always the flat
 *  S.week, or this prints "no routines" for someone whose whole plan lives inside an active
 *  program. */
export async function planPrintHTML(S, owner) {
  const unit = S.unit || 'kg'
  const routines = S.routines || []
  const week = activeWeek(S)
  const days = WEEK_ORDER.map(d => ({ d, r: routines.find(x => x.id === week?.[d]) })).filter(x => x.r && x.r.ex && x.r.ex.length)
  const dayBlocks = days.map((x, i) => dayLogHTML(i + 1, t(DAYN[x.d]), x.r, unit))
  const meta = metaOf(owner, days.length ? t('{0} days a week', days.length) : '')
  return printShell(t('Weekly Training Plan'), meta, await logoDataUri(), dayBlocks, days.length ? weekStripHTML(routines, week) : '')
}

/** Print view for a single standalone routine — just its own exercise table, no week strip
 *  (a lone routine isn't necessarily assigned to any day). */
export async function routinePrintHTML(routine, owner, unit) {
  const dayBlocks = routine.ex?.length ? [dayLogHTML(null, '', routine, unit)] : []
  return printShell(routine.name || t('Routine'), metaOf(owner, exCount(routine.ex?.length || 0)), await logoDataUri(), dayBlocks)
}

// A plain sequence of routine tables, one per routine in the order given, no week/day framing
// — for anything that isn't tied to a schedule: a hand-picked selection, or a program with
// routines but no days assigned to them yet.
const routineBlocks = (routines, unit) => routines.filter(r => r.ex?.length).map((r, i) => dayLogHTML(i + 1, '', r, unit))

/** Print view for a hand-picked set of routines — e.g. from the multi-select in the Routines
 *  tab, printing 2 of a dozen instead of the whole list. Order follows the given array. */
export async function routinesPrintHTML(routines, owner, unit) {
  return printShell(t('Routines'), metaOf(owner, routineCount(routines.length)), await logoDataUri(), routineBlocks(routines, unit))
}

/** Print view for one program — its own routines + its own weekday schedule, same gym-floor
 *  layout as the whole-plan view but scoped to just this program instead of the flat S.week. */
export async function programPrintHTML(program, routines, owner, unit) {
  const days = WEEK_ORDER.map(d => ({ d, r: routines.find(x => x.id === program.week?.[d]) })).filter(x => x.r && x.r.ex && x.r.ex.length)
  const dayBlocks = days.length ? days.map((x, i) => dayLogHTML(i + 1, t(DAYN[x.d]), x.r, unit)) : routineBlocks(routines, unit)
  const meta = metaOf(owner, days.length ? t('{0} days a week', days.length) : routineCount(routines.length))
  return printShell(program.name || t('Program'), meta, await logoDataUri(), dayBlocks, days.length ? weekStripHTML(routines, program.week) : '')
}

// Standalone-mode iOS (added to the home screen) largely doesn't support window.print() from
// inside the app itself — WebKit has nowhere to host the print sheet without Safari's own
// chrome. A blob: URL opened as a real new tab escapes into Safari, where printing (via the
// share sheet's own Print / "Save as PDF") works exactly as it does in any other Safari tab.
// Everywhere else (desktop, Android, iOS Safari proper) the hidden-iframe + print() path below
// already works well and keeps the print CSS's page-break handling, so it stays the default.
const isStandaloneIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  (window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches)

function openInNewTab(html) {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  // Never got a handle back (a popup blocker, most likely) — nothing left to clean up toward,
  // and revoking now would pull the page out from under a tab that did open.
  if (!win) return
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/**
 * Render the given print HTML and open the browser's print dialog (→ Save as PDF). Uses a
 * hidden iframe so we never navigate away or trip a popup blocker — except in standalone iOS,
 * where a real new tab is the only thing that actually lets printing happen (see above).
 */
function openPrintWindow(html) {
  if (isStandaloneIOS()) { openInNewTab(html); return }
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
  doc.open(); doc.write(html); doc.close()
  // Give the iframe a tick to lay out before printing.
  if (doc.readyState === 'complete') setTimeout(run, 120)
  else ifr.onload = () => setTimeout(run, 120)
}

// The *PrintHTML builders are async now (they await the logo once) — callers already fire
// these off from a plain onClick with nothing to await afterwards, so wrapping each in an
// async arrow is the whole change; nothing downstream needed to start awaiting anything.
export const printPlan = async (S, owner) => openPrintWindow(await planPrintHTML(S, owner))
export const printRoutine = async (routine, owner, unit) => openPrintWindow(await routinePrintHTML(routine, owner, unit))
export const printRoutines = async (routines, owner, unit) => openPrintWindow(await routinesPrintHTML(routines, owner, unit))
export const printProgram = async (program, routines, owner, unit) => openPrintWindow(await programPrintHTML(program, routines, owner, unit))
