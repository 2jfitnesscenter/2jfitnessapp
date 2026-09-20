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
import { supersetGroupInfo, supersetLabel, SUPERSET_PRINT_COLORS } from './superset-colors.js'

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
//
// V1.4 redesign: the old layout packed up to 3 days side by side on a landscape page — clean
// for a full 3/6-day week, but a 2-day routine left two-thirds of the sheet blank, and an
// odd day count (e.g. 4) stranded a nearly-empty page. This version stacks one day per
// full-width table on a portrait page instead (closer to a real paper log a trainer would
// hand out — see PLANTILLA 3 FUERZA, the reference this was built against, not copied
// pixel-for-pixel) and lets the browser's own print pagination decide how many days fit on
// each physical page — no fixed "days per page" to get wrong either way. The one thing this
// version doesn't do that the old one did: repeat the masthead on every page (there's no
// reliable, cross-browser way to inject running headers into a plain window.print() flow
// without a real pagination engine) — a printed packet from here is meant to be kept
// together, not to have every sheet independently self-identifying.

const esc = str => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// One exercise's scheme, e.g. "3 × 10", "3 × 0:45" or "2 × 20 min @ 8 km/h" — SERIES Y REP.
// Deliberately never appends a starting weight here (unlike the phone app's own exLine): this
// sheet exists specifically for writing the real, evolving weight by hand across SEMANA 1-4,
// so pre-printing one would just be a number the first week immediately writes over.
function scheme(e) {
  const sets = e.sets || 1
  const mode = modeOf(e)
  if (mode === 'cardio') {
    const body = `${e.min || 20} min @ ${fmtNum(e.speed || 8)} km/h`
    return sets > 1 ? `${sets} × ${body}` : body
  }
  return mode === 'time' ? `${sets} × ${fmtSec(e.sec || 45)}` : `${sets} × ${e.reps ?? 10}`
}

// The only routine-exercise field that amounts to a genuinely PLANNED RPE (progression.js's
// own pct1rm policy asks for a target RIR, not an RPE, but the two are the same scale 10
// points apart — see history.js's own feelFor, which reads RIR through its RPE equivalent the
// same way). Every other policy prescribes a weight/rep target, never an intensity target, so
// most rows print this column blank — same as the paper template's own RPE column, meant to
// be filled in by hand when nothing was actually planned.
const plannedRpe = e => (e.prog === 'pct1rm' && e.targetRIR != null ? Math.round((10 - e.targetRIR) * 2) / 2 : null)

// One full-width table per day: Nº · Ejercicio · RPE · Series y Rep · Semana 1-4, each week
// column holding one blank writable box per set — the actual "print + write results by hand
// for a few weeks" sheet the brief asks for. `num`/`weekday` are optional — a standalone
// routine (no day of its own) omits both and prints just the table. Column widths are computed
// here (not left to table-layout:auto) for the same reason the old per-page version did: a
// narrow fixed-layout table needs the exercise name to win most of the space, and how much
// that setup needs shifts with how many sets a given day's biggest exercise actually has.
function dayTableHTML(num, weekday, r, ssInfo) {
  const maxSets = Math.max(1, ...r.ex.map(e => e.sets || 1))
  // %, of the 4 SEMANA columns combined — narrower boxes the more sets there are, same
  // "adapts, never grows unreadable" spirit as the density tiers below.
  const weekW = Math.min(15, Math.max(9, 52 / maxSets))
  const rows = r.ex.map((e, i) => {
    const info = ssInfo[i]
    const ex = EXIDX[e.id]
    const name = ex ? nameFor(ex) : t('Unknown exercise')
    const part = ex && ex.bp && ex.bp !== 'cardio' ? `<span class="ex-part">${esc(t(ex.bp))}</span>` : ''
    const badge = info
      ? `<span class="ss-badge" style="background:${SUPERSET_PRINT_COLORS[info.token]}">${esc(supersetLabel(info))}</span>` : ''
    const rpe = plannedRpe(e)
    const boxes = Array.from({ length: e.sets || 1 }, () => '<span class="box"></span>').join('')
    const weekCell = `<td class="week"><div class="boxes">${boxes}</div></td>`
    return `<tr${info ? ` class="ss-row" style="--ss-color:${SUPERSET_PRINT_COLORS[info.token]}"` : ''}>
      <td class="num">${i + 1}</td>
      <td><div class="ex-name">${badge}${esc(name)}${part}</div></td>
      <td class="rpe">${rpe != null ? fmtNum(rpe) : ''}</td>
      <td class="target">${esc(scheme(e))}</td>
      ${weekCell}${weekCell}${weekCell}${weekCell}
    </tr>`
  }).join('')
  const head = num != null
    ? `<span class="dnum">${esc(String(num).padStart(2, '0'))}</span><h2>${esc(r.name)}</h2><span class="wd">${esc(weekday)}</span>`
    : `<h2>${esc(r.name)}</h2>`
  const weekHeads = [1, 2, 3, 4].map(n => `<th class="week" style="width:${weekW}%">${esc(t('Week {0}', n))}</th>`).join('')
  return `<section class="day">
    <div class="day-head">${head}</div>
    <table class="log">
      <colgroup><col style="width:5%"><col style="width:${Math.max(20, 100 - 5 - 7 - 12 - weekW * 4)}%"><col style="width:7%"><col style="width:12%">${(`<col style="width:${weekW}%">`).repeat(4)}</colgroup>
      <thead><tr><th>${esc(t('No.'))}</th><th>${esc(t('Exercise'))}</th><th>${esc(t('RPE'))}</th><th>${esc(t('Sets & reps'))}</th>${weekHeads}</tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="empty">${esc(t('No exercises yet.'))}</td></tr>`}</tbody>
    </table>
  </section>`
}

// How much room a routine's own content needs decides font size, row height and padding — the
// "adaptive print engine" the brief asks for, without a bespoke box-packing algorithm: three
// fixed, deterministic presets (never a computed continuous value, which would make one
// printout's 8.4px unreproducible on the next) selected by the ACTUAL exercise-row count and
// day count about to be printed, then plain CSS + the browser's own print pagination do the
// rest — a day never splits (`.day{break-inside:avoid}`), so the choice here is only ever "how
// much can honestly fit," never "force it to fit anyway."
function densityTier(dayCount, totalRows) {
  if (dayCount >= 5 || totalRows > 26) return 'tight'
  if (dayCount >= 4 || totalRows > 16) return 'compact'
  return 'normal'
}

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

// "Rutina Juanjo Perez (20-09-2026)" — set as the document <title>, which is what Chrome/
// Firefox/Safari all suggest as the filename in their own "Save as PDF" dialog, exactly the
// mechanism the old version already relied on (its title was just the plain heading before).
// Never the visible on-page heading (that stays whatever routine/program name is real, in
// whatever alphabet it's in) — only the save-file name needs the fixed DD-MM-AAAA shape and
// the handful of characters a filesystem can't take.
const ddmmyyyy = iso => { const [y, m, d] = String(iso || '').split('-'); return `${d}-${m}-${y}` }
const sanitizeFilename = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
const fileTitleOf = (kind, owner) => sanitizeFilename(`${kind}${owner ? ' ' + owner : ''} (${ddmmyyyy(todayISO())})`)

// The one static bit of explanation carried over from the paper template — a fixed 0-10 scale,
// true regardless of which routine or how many days this is, so it prints once at the very end
// rather than once per day (see this section's own header comment on why nothing here repeats
// per physical page). Skipped for an empty printout — no scale is worth explaining nothing.
const RPE_LEGEND = [[4, 'Comfortable to finish'], [6, 'A bit harder, but you finish clean'], [8, 'Hard — costs real effort to finish'], [10, 'Maximum — no rep left, needs real recovery']]
const rpeLegendHTML = () => `<div class="legend">
  <div class="legend-title">${esc(t('RPE (Rate of Perceived Exertion)'))}</div>
  <div class="legend-row">${RPE_LEGEND.map(([n, d]) => `<div><b>${n}</b> ${esc(t(d))}</div>`).join('')}</div>
</div>`

// Shared document chrome behind all four print views below — the styles are the expensive
// part to keep in sync, so there is exactly one copy of them. `dayBlocks` are already-rendered
// dayTableHTML() strings, one full-width <section class="day"> each; `weekStripHtml`, when
// given, appears once, right under the masthead. Everything flows as ONE continuous document —
// no manual "N days per page" — `.day{break-inside:avoid}` keeps a single day whole, and the
// browser's own print pagination decides how many whole days fit on each physical page.
function printShell(heading, fileTitle, meta, logoImg, dayBlocks, weekStripHtml, density) {
  const body = dayBlocks.length
    ? `${weekStripHtml || ''}<div class="days">${dayBlocks.join('')}</div>${rpeLegendHTML()}`
    : `<p class="none">${esc(t('No routines yet.'))}</p>`
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(fileTitle)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 11mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: #1c1d17; background: #f6f4ec;
    font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  /* 186mm = A4 portrait (210mm) minus the @page's own 11mm side margins — sizing this in mm (a
     real physical unit, not just a print-time one) means the layout previews at its true
     printed proportions in an ordinary browser tab too, not only inside the print dialog. */
  .sheet { width: 186mm; margin: 0 auto; }

  .masthead { display: flex; align-items: center; gap: 6mm; border-bottom: 1.5px solid #1c1d17; padding-bottom: 3mm; margin-bottom: 5mm; }
  .masthead .logo { height: 11mm; width: auto; flex: none; display: block; }
  .masthead .titles { min-width: 0; }
  .masthead .brand { font-size: 9px; letter-spacing: .13em; text-transform: uppercase; color: #3e6626; font-weight: 700; }
  .masthead h1 { font-size: 19px; letter-spacing: -.01em; margin: 2px 0 0; }
  .masthead .meta { margin-left: auto; text-align: right; font-size: 10px; color: #5e6263; line-height: 1.6; white-space: nowrap; flex: none; }
  .masthead .meta b { color: #1c1d17; font-weight: 600; }

  .week-strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; background: #c7c0a9; border: 1px solid #c7c0a9; margin: 0 0 6mm; break-inside: avoid; page-break-inside: avoid; }
  .week-strip .d { background: #efebdf; padding: 5px 4px 6px; text-align: center; }
  .week-strip .d.on { background: #e4efdb; }
  .week-strip .dn { font-size: 8px; letter-spacing: .08em; text-transform: uppercase; color: #5e6263; font-weight: 600; }
  .week-strip .d.on .dn { color: #3e6626; }
  .week-strip .dr { font-size: 8.5px; margin-top: 3px; color: #1c1d17; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .week-strip .dr .off { color: #a79f89; text-transform: none; }

  .days { display: flex; flex-direction: column; gap: 7mm; }
  .day { break-inside: avoid; page-break-inside: avoid; }
  .day-head { display: flex; align-items: baseline; gap: 6px; border-bottom: 1.5px solid #1c1d17; padding-bottom: 3px; margin-bottom: 4px; break-after: avoid; page-break-after: avoid; }
  .day-head .dnum { font-size: 15px; font-weight: 700; color: #5a9438; flex: none; }
  .day-head h2 { font-size: 13px; letter-spacing: -.005em; margin: 0; flex: 1; min-width: 0; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .day-head .wd { font-size: 8px; letter-spacing: .09em; text-transform: uppercase; color: #5e6263; font-weight: 600; white-space: nowrap; }

  table.log { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.log th { text-align: left; font-size: 7px; letter-spacing: .03em; text-transform: uppercase; color: #5e6263; font-weight: 600; padding: 0 3px 3px; border-bottom: 1px solid #c7c0a9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  table.log th.week { text-align: center; }
  table.log td { padding: 3px; border-bottom: 1px solid #dbd5c3; vertical-align: top; break-inside: avoid; page-break-inside: avoid; }
  table.log tbody tr:last-child td { border-bottom: 1.5px solid #1c1d17; }
  table.log td.num { color: #a79f89; font-weight: 600; }
  table.log td.rpe { color: #1c1d17; text-align: center; }
  .ex-name { font-weight: 500; text-transform: capitalize; line-height: 1.25; overflow-wrap: break-word; }
  .ex-part { display: block; font-size: .82em; letter-spacing: .02em; text-transform: uppercase; color: #5e6263; margin-top: 1px; }
  .target { color: #5e6263; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  td.week .boxes { display: flex; gap: 2px; }
  .box { flex: 1; min-width: 0; display: block; height: 10px; border-bottom: 1px solid #c7c0a9; }
  /* Superset rows: a colored left rail plus the A1/A2 badge carries the grouping — never color
     alone, so a black-and-white print still reads the pairing correctly (see this file's own
     lib/superset-colors.js for why the color itself is picked deterministically, not by hand). */
  .ss-row td:first-child { position: relative; padding-left: 8px; }
  .ss-row td:first-child::before { content: ''; position: absolute; left: 0; top: 3px; bottom: 3px; width: 2px; background: var(--ss-color, #5a9438); border-radius: 1px; }
  .ss-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 4px; font-size: .82em; font-weight: 700; color: #fff; margin-right: 4px; }
  .empty { color: #a79f89; }

  .legend { margin-top: 7mm; padding-top: 3mm; border-top: 1px solid #dbd5c3; break-inside: avoid; page-break-inside: avoid; }
  .legend-title { font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: #5e6263; font-weight: 700; margin-bottom: 3mm; }
  .legend-row { display: flex; flex-wrap: wrap; gap: 3mm 8mm; font-size: 9px; color: #5e6263; }
  .legend-row b { color: #3e6626; font-weight: 700; margin-right: 3px; }

  .none { color: #a79f89; }
  footer { margin-top: 6mm; padding-top: 2mm; border-top: 1px solid #dbd5c3; color: #a79f89; font-size: 8px; text-align: center; }

  /* --- density tiers: the only thing that changes between a 2-day and a 5-day printout ---- */
  body.density-normal table.log th, body.density-normal .target, body.density-normal td.rpe { font-size: 8.5px }
  body.density-normal .ex-name { font-size: 9.5px }
  body.density-normal table.log td { padding-block: 3.5px }
  body.density-normal .box { height: 11px }

  body.density-compact table.log th, body.density-compact .target, body.density-compact td.rpe { font-size: 7.5px }
  body.density-compact .ex-name { font-size: 8.5px }
  body.density-compact table.log td { padding-block: 2.5px }
  body.density-compact .box { height: 9px }
  body.density-compact .days { gap: 5mm }

  body.density-tight table.log th, body.density-tight .target, body.density-tight td.rpe { font-size: 6.5px }
  body.density-tight .ex-name { font-size: 7.5px }
  body.density-tight table.log td { padding-block: 2px }
  body.density-tight .box { height: 7px }
  body.density-tight .days { gap: 4mm }
  body.density-tight .day-head { margin-bottom: 3px }
</style></head>
<body class="density-${density}"><div class="sheet">
  <div class="masthead">
    ${logoImg ? `<img class="logo" src="${logoImg}" alt="" />` : ''}
    <div class="titles"><div class="brand">2J Fitness Center</div><h1>${esc(heading)}</h1></div>
    <div class="meta">${meta}</div>
  </div>
  ${body}
  <footer>${esc(t('Made with 2J Fitness Center'))} · 2jfitnesscenter.com</footer>
</div></body></html>`
}

const metaOf = (owner, extra) => [owner ? `<div><b>${esc(owner)}</b></div>` : '', `<div>${esc([extra, todayISO()].filter(Boolean).join(' · '))}</div>`].join('')
const totalExRows = days => days.reduce((n, x) => n + (x.r?.ex?.length || 0), 0)

/** Full self-contained HTML for the print/PDF view — a gym-floor sheet, one full-width table
 *  per scheduled day, stacked and auto-paginated (see this section's own header comment).
 *  Whichever schedule is actually driving Home right now — an active program's own week if one
 *  is active, the flat week otherwise (same activeWeek() Home itself reads) — not always the
 *  flat S.week, or this prints "no routines" for someone whose whole plan lives inside an
 *  active program. */
export async function planPrintHTML(S, owner) {
  const routines = S.routines || []
  const week = activeWeek(S)
  const days = WEEK_ORDER.map(d => ({ d, r: routines.find(x => x.id === week?.[d]) })).filter(x => x.r && x.r.ex && x.r.ex.length)
  const dayBlocks = days.map((x, i) => dayTableHTML(i + 1, t(DAYN[x.d]), x.r, supersetGroupInfo(x.r.ex)))
  const meta = metaOf(owner, days.length ? t('{0} days a week', days.length) : '')
  const density = densityTier(days.length, totalExRows(days))
  return printShell(t('Weekly Training Plan'), fileTitleOf(t('Routine'), owner), meta, await logoDataUri(), dayBlocks, days.length ? weekStripHTML(routines, week) : '', density)
}

/** Print view for a single standalone routine — just its own exercise table, no week strip
 *  (a lone routine isn't necessarily assigned to any day). */
export async function routinePrintHTML(routine, owner) {
  const dayBlocks = routine.ex?.length ? [dayTableHTML(null, '', routine, supersetGroupInfo(routine.ex))] : []
  const density = densityTier(1, routine.ex?.length || 0)
  return printShell(routine.name || t('Routine'), fileTitleOf(t('Routine'), owner), metaOf(owner, exCount(routine.ex?.length || 0)), await logoDataUri(), dayBlocks, '', density)
}

// A plain sequence of routine tables, one per routine in the order given, no week/day framing
// — for anything that isn't tied to a schedule: a hand-picked selection, or a program with
// routines but no days assigned to them yet.
const routineBlocks = routines => routines.filter(r => r.ex?.length).map((r, i) => dayTableHTML(i + 1, '', r, supersetGroupInfo(r.ex)))

/** Print view for a hand-picked set of routines — e.g. from the multi-select in the Routines
 *  tab, printing 2 of a dozen instead of the whole list. Order follows the given array. */
export async function routinesPrintHTML(routines, owner) {
  const real = routines.filter(r => r.ex?.length)
  const density = densityTier(real.length, real.reduce((n, r) => n + r.ex.length, 0))
  return printShell(t('Routines'), fileTitleOf(t('Routine'), owner), metaOf(owner, routineCount(routines.length)), await logoDataUri(), routineBlocks(routines), '', density)
}

/** Print view for one program — its own routines + its own weekday schedule, same gym-floor
 *  layout as the whole-plan view but scoped to just this program instead of the flat S.week. */
export async function programPrintHTML(program, routines, owner) {
  const days = WEEK_ORDER.map(d => ({ d, r: routines.find(x => x.id === program.week?.[d]) })).filter(x => x.r && x.r.ex && x.r.ex.length)
  const dayBlocks = days.length
    ? days.map((x, i) => dayTableHTML(i + 1, t(DAYN[x.d]), x.r, supersetGroupInfo(x.r.ex)))
    : routineBlocks(routines)
  const meta = metaOf(owner, days.length ? t('{0} days a week', days.length) : routineCount(routines.length))
  const density = days.length ? densityTier(days.length, totalExRows(days)) : densityTier(routines.length, routines.reduce((n, r) => n + (r.ex?.length || 0), 0))
  return printShell(program.name || t('Program'), fileTitleOf(t('Routine'), owner), meta, await logoDataUri(), dayBlocks, days.length ? weekStripHTML(routines, program.week) : '', density)
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
// `unit` is still accepted here (existing call sites pass S.unit) even though the print sheet
// itself no longer prints a starting weight — see scheme()'s own comment on why — so nothing
// upstream needs to change just because this file stopped needing it.
export const printPlan = async (S, owner) => openPrintWindow(await planPrintHTML(S, owner))
export const printRoutine = async (routine, owner, unit) => openPrintWindow(await routinePrintHTML(routine, owner))
export const printRoutines = async (routines, owner, unit) => openPrintWindow(await routinesPrintHTML(routines, owner))
export const printProgram = async (program, routines, owner, unit) => openPrintWindow(await programPrintHTML(program, routines, owner))
