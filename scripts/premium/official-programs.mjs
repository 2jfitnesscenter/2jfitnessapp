// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* The official Premium catalogue, as DATA. scripts/build-premium-programs.mjs turns this into api/lib/premium-official.json (the versioned seed the
 * API reads from the release on every boot; nothing is generated at runtime).
 *
 * Editorial rules for this file:
 *  - Third-party methods are described by their publicly documented PRINCIPLES in our own words, with attribution. No book text, no paid template,
 *    no long proprietary table is reproduced. Where a method's name may carry trademark/licence weight the program says `legal.status: 'review'`:
 *    the owner decides before promoting it; the description stays neutral ("inspired by", never "official").
 *  - `sourceType`: 'established' (a popular, widely documented method) · 'principles' (built on training principles) · 'own' (a 2J design).
 *  - Nothing here claims one program is better than another: `evidenceSummary` says what is known and what is not.
 *  - English is the source language; `locales.es` carries the Spanish editorial text.
 */
import { readFileSync } from 'node:fs'

const SEEDED = '2026-10-11T00:00:00.000Z'
const ID = {
  squat: '0043', front: '0042', bench: '0025', incline: '0047', dbBench: '0289', deadlift: '0032', rdl: '0085', press: '1456', row: '0027', pendlay: '3017',
  cableRow: '0861', dbRow: '0327', pullup: '0652', chinup: '1326', pulldown: '0198', lunge: '0336', split: '2368', legPress: '0739', legCurl: '0586',
  legExt: '0585', calf: '0605', lateral: '0334', rearDelt: '0203', curl: '0031', hammer: '0313', pushdown: '0201', skull: '0060', dip: '0251', thrust: '0058',
  legRaise: '0472', crunch: '0274', run: '0684', skierg: '2142', burpee: '1160', farmers: '2133', pushup: '0662', fly: '0227', dbFly: '0308', shrug: '0095',
  goodMorning: '0044', backExt: '0489', dbPress: '0426', goblet: '1760',
}
export const EXERCISE_IDS = Object.values(ID)

const LIFTS4 = [
  { key: 'squat', exercise: ID.squat, group: 'lower' }, { key: 'bench', exercise: ID.bench, group: 'upper' },
  { key: 'deadlift', exercise: ID.deadlift, group: 'lower' }, { key: 'press', exercise: ID.press, group: 'upper' },
]
const INC_STD = { upper: { kg: 2.5, lb: 5 }, lower: { kg: 5, lb: 10 } }
const TM_RULE = (increments = INC_STD) => ({ cycleEnd: { kind: 'tm-increment', increments } })

const main = (lift, sets, extra = {}) => ({ role: 'main', lift, sets, ...extra })
const supp = (lift, sets, extra = {}) => ({ role: 'supplemental', lift, sets, ...extra })
const acc = (exercise, sets, repsMin, repsMax, extra = {}) => ({ role: 'accessory', exercise, scheme: { sets, repsMin, repsMax, prog: 'double' }, ...extra })
const heavy = (exercise, sets, reps, extra = {}) => ({ role: 'main', exercise, scheme: { sets, reps, prog: 'linear' }, ...extra })
const cond = (exercise, min, extra = {}) => ({ role: 'conditioning', exercise, conditioning: { min, ...(extra.speed ? { speed: extra.speed } : {}) }, ...(extra.note ? { note: extra.note } : {}) })
const S = (pct, reps, o = {}) => ({ pct, reps, ...o })
const day = (key, title, blocks) => ({ key, title, blocks })
const weeksOf = (n, build) => Array.from({ length: n }, (_, i) => build(i))

/* ---------------------------------------------------------------------------------------------------------------- 5/3/1 */
const W531 = [
  { label: 'Week 1 · 5s', phase: 'Week 1 · 5s', sets: [S(0.65, 5), S(0.75, 5), S(0.85, 5, { amrap: true })] },
  { label: 'Week 2 · 3s', phase: 'Week 2 · 3s', sets: [S(0.70, 3), S(0.80, 3), S(0.90, 3, { amrap: true })] },
  { label: 'Week 3 · 5/3/1', phase: 'Week 3 · 5/3/1', sets: [S(0.75, 5), S(0.85, 3), S(0.95, 1, { amrap: true })] },
  { label: 'Week 4 · Deload', phase: 'Week 4 · Deload', sets: [S(0.40, 5), S(0.50, 5), S(0.60, 5)] },
]
const sessions531 = [
  ['press', 'Press day', [acc(ID.dip, 3, 8, 15), acc(ID.chinup, 3, 5, 10), acc(ID.lateral, 3, 10, 15)]],
  ['deadlift', 'Deadlift day', [acc(ID.legRaise, 3, 8, 15), acc(ID.cableRow, 3, 8, 12), acc(ID.backExt, 3, 10, 15)]],
  ['bench', 'Bench day', [acc(ID.dbBench, 3, 8, 12), acc(ID.row, 3, 8, 12), acc(ID.pushdown, 3, 10, 15)]],
  ['squat', 'Squat day', [acc(ID.split, 3, 8, 12), acc(ID.legCurl, 3, 10, 15), acc(ID.crunch, 3, 10, 20)]],
]
const p531 = {
  id: 'premium-531', slug: '531', name: '5/3/1',
  shortDescription: 'Four days a week, one main lift each, loads set from a Training Max over a four-week wave.',
  longDescription: 'Each cycle lasts four weeks. Every main lift (squat, bench press, deadlift, press) is trained once a week with three work sets whose weight is a percentage of your Training Max; the last set each week is taken to as many good reps as possible (marked +). The fourth week is a lighter deload. After a full cycle 2J proposes a small Training Max increase for you to confirm. Accessory work fills the rest of each session.',
  goalTags: ['strength', 'strength-muscle'], level: 'intermediate', daysPerWeek: 4, durationDescription: '4-week cycles, repeated',
  methodType: 'percentage-wave', sourceType: 'established', author: { name: 'Jim Wendler', work: '5/3/1' },
  evidenceSummary: 'A widely used method built on sub-maximal, percentage-based work, planned deloads and slow progression. There is no head-to-head evidence that it beats other well-designed strength programs; its building blocks are consistent with general strength-training principles.',
  equipmentRequirements: ['barbell', 'rack', 'bench', 'pull-up bar'], progressionModel: 'training-max-cycle',
  legal: { status: 'review', note: 'Name and percentages of a commercial method. Description is original; keep the attribution and confirm licence/trademark before keeping the name.' },
  featured: true, badge: 'featured',
  copy: {
    howItWorks: ['Pick a Training Max for each lift (about 90 % of what you could lift for the target reps).', 'Each week has its own percentages; the last set is an AMRAP (as many good reps as possible).', 'Week 4 is a deload. At the end of the cycle you confirm the new Training Max.'],
    forWhom: ['You already know the basic barbell lifts.', 'You like a clear plan and slow, steady progress.', 'You can train four days a week with a barbell and rack.'],
    notIdealIf: ['You are brand new to lifting and still learning technique.', 'You cannot access a barbell, rack and bench.', 'You only want to train two or three days a week.'],
    tracking: ['Your cycle, week and next session.', 'The AMRAP result of every main lift.', 'Training Max changes — always confirmed by you.'],
  },
  definition: { schema: 1, cycleWeeks: 4, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE(),
    weeks: W531.map(w => ({ label: w.label, phase: w.phase, sessions: sessions531.map(([key, title, accs]) => day(key, title, [main(key, w.sets, { rest: 180 }), ...accs])) })) },
  es: {
    shortDescription: 'Cuatro días por semana, un levantamiento principal cada día, con cargas calculadas sobre un Training Max en una onda de cuatro semanas.',
    longDescription: 'Cada ciclo dura cuatro semanas. Cada levantamiento principal (sentadilla, press banca, peso muerto y press militar) se entrena una vez por semana con tres series de trabajo cuyo peso es un porcentaje de tu Training Max; la última serie de cada semana se lleva a tantas repeticiones buenas como puedas (marcada con +). La cuarta semana es una descarga más ligera. Al terminar el ciclo, 2J te propone una pequeña subida del Training Max para que la confirmes. El trabajo accesorio completa cada sesión.',
    durationDescription: 'Ciclos de 4 semanas, repetidos',
    evidenceSummary: 'Método muy usado, basado en trabajo submáximo con porcentajes, descargas planificadas y progresión lenta. No hay evidencia comparativa directa de que supere a otros programas de fuerza bien diseñados; sus componentes son coherentes con los principios generales del entrenamiento de fuerza.',
    howItWorks: ['Eliges un Training Max para cada levantamiento (alrededor del 90 % de lo que podrías levantar para las repeticiones objetivo).', 'Cada semana tiene sus propios porcentajes; la última serie es AMRAP (tantas repeticiones buenas como puedas).', 'La semana 4 es una descarga. Al final del ciclo confirmas el nuevo Training Max.'],
    forWhom: ['Ya conoces los levantamientos básicos con barra.', 'Te gusta un plan claro y un progreso lento y constante.', 'Puedes entrenar cuatro días por semana con barra y rack.'],
    notIdealIf: ['Eres nuevo en el entrenamiento y aún aprendes la técnica.', 'No tienes acceso a barra, rack y banco.', 'Solo quieres entrenar dos o tres días por semana.'],
    tracking: ['Tu ciclo, semana y próxima sesión.', 'El resultado AMRAP de cada levantamiento principal.', 'Los cambios de Training Max, siempre confirmados por ti.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- Texas Method */
const ptexas = {
  id: 'premium-texas-method', slug: 'texas-method', name: 'Texas Method',
  shortDescription: 'Three days a week: a volume day, a light recovery day and an intensity day where you try to beat last week.',
  longDescription: 'The week has a rhythm. Monday is the volume day (five sets of five at about 90 % of your current five-rep load). Wednesday is a short, light recovery day. Friday is the intensity day: one set of five at a slightly higher weight than last week. Loads rise a little every week, and after four weeks 2J proposes an update of your five-rep loads for you to confirm.',
  goalTags: ['strength'], level: 'intermediate', daysPerWeek: 3, durationDescription: '4-week blocks, repeated',
  methodType: 'weekly-load', sourceType: 'established', author: { name: 'Popularised by Mark Rippetoe and Glenn Pendlay', work: 'Practical Programming for Strength Training' },
  evidenceSummary: 'A popular intermediate weekly-load structure (volume, recovery, intensity). It is described in strength-coaching literature; no controlled comparison of the program as such exists. Weekly progression only works while you can keep recovering between hard sessions.',
  equipmentRequirements: ['barbell', 'rack', 'bench'], progressionModel: 'weekly-linear',
  legal: { status: 'review', note: 'Named after a popular method. Description is original; confirm attribution and naming before promoting it.' },
  featured: false, badge: null,
  copy: {
    howItWorks: ['Volume day: 5×5 at about 90 % of your five-rep load.', 'Recovery day: a light, short session to practise without fatigue.', 'Intensity day: one set of five trying a small step up. Loads rise a little every week.'],
    forWhom: ['You have outgrown adding weight every session.', 'You recover well and sleep enough.', 'You like testing yourself once a week.'],
    notIdealIf: ['You are a beginner who can still add weight each session.', 'Your sleep or recovery is poor.', 'You are returning from an injury.'],
    tracking: ['The load you reached on each intensity day.', 'Whether the week was completed.', 'The proposed update of your five-rep loads at the end of the block.'],
  },
  definition: { schema: 1, cycleWeeks: 4, referenceLabel: 'Five-rep load', lifts: [LIFTS4[0], LIFTS4[1], LIFTS4[2]], progression: TM_RULE({ upper: { kg: 2.5, lb: 5 }, lower: { kg: 5, lb: 10 } }),
    weeks: weeksOf(4, k => {
      const t = k / 4
      return {
        label: `Week ${k + 1}`, phase: `Week ${k + 1}`,
        sessions: [
          day('volume', 'Volume day', [main('squat', Array.from({ length: 5 }, () => S(0.9, 5)), { steps: t, rest: 180 }), main('bench', Array.from({ length: 5 }, () => S(0.9, 5)), { steps: t, rest: 150 }), acc(ID.chinup, 3, 5, 10)]),
          day('recovery', 'Recovery day', [main('squat', [S(0.72, 5), S(0.72, 5)], { steps: t, rest: 120 }), supp('bench', [S(0.8, 5), S(0.8, 5), S(0.8, 5)], { steps: t, rest: 120 }), acc(ID.backExt, 3, 8, 12)]),
          day('intensity', 'Intensity day', [main('squat', [S(1, 5, { amrap: false })], { steps: t + 0.25, rest: 240 }), main('bench', [S(1, 5)], { steps: t + 0.25, rest: 240 }), main('deadlift', [S(1, 5)], { steps: t + 0.25, rest: 240 })]),
        ],
      }
    }) },
  es: {
    shortDescription: 'Tres días por semana: un día de volumen, un día ligero de recuperación y un día de intensidad en el que intentas superar la semana anterior.',
    longDescription: 'La semana tiene su ritmo. El lunes es el día de volumen (cinco series de cinco a cerca del 90 % de tu carga actual para cinco repeticiones). El miércoles es una sesión corta y ligera de recuperación. El viernes es el día de intensidad: una serie de cinco con un peso algo mayor que la semana anterior. Las cargas suben un poco cada semana y, tras cuatro semanas, 2J te propone actualizar tus cargas de cinco repeticiones para que lo confirmes.',
    durationDescription: 'Bloques de 4 semanas, repetidos',
    evidenceSummary: 'Estructura semanal popular para nivel intermedio (volumen, recuperación, intensidad), descrita en la literatura de entrenamiento de fuerza; no existe una comparación controlada del programa como tal. La progresión semanal solo funciona mientras puedas recuperarte entre sesiones duras.',
    howItWorks: ['Día de volumen: 5×5 a cerca del 90 % de tu carga de cinco repeticiones.', 'Día de recuperación: una sesión ligera y corta para practicar sin fatiga.', 'Día de intensidad: una serie de cinco intentando un pequeño paso adelante. Las cargas suben un poco cada semana.'],
    forWhom: ['Ya no puedes añadir peso en cada sesión.', 'Te recuperas bien y duermes lo suficiente.', 'Te gusta ponerte a prueba una vez por semana.'],
    notIdealIf: ['Eres principiante y todavía puedes añadir peso en cada sesión.', 'Tu sueño o tu recuperación son malos.', 'Vuelves de una lesión.'],
    tracking: ['La carga que alcanzaste en cada día de intensidad.', 'Si la semana se completó.', 'La actualización propuesta de tus cargas de cinco repeticiones al final del bloque.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- Juggernaut-style waves */
const WAVES = [
  { reps: 10, name: '10s', accum: 0.60, inten: 0.67, real: 0.725 },
  { reps: 8, name: '8s', accum: 0.65, inten: 0.72, real: 0.775 },
  { reps: 5, name: '5s', accum: 0.70, inten: 0.77, real: 0.825 },
  { reps: 3, name: '3s', accum: 0.75, inten: 0.825, real: 0.90 },
]
const waveWeeks = []
for (const w of WAVES) {
  waveWeeks.push({ phase: `${w.name} · Accumulation`, kind: 'accum', w })
  waveWeeks.push({ phase: `${w.name} · Intensification`, kind: 'inten', w })
  waveWeeks.push({ phase: `${w.name} · Realization`, kind: 'real', w })
  waveWeeks.push({ phase: `${w.name} · Deload`, kind: 'deload', w })
}
const waveSets = ({ kind, w }) => kind === 'accum' ? Array.from({ length: 5 }, () => S(w.accum, w.reps))
  : kind === 'inten' ? Array.from({ length: 4 }, () => S(w.inten, w.reps))
    : kind === 'real' ? [S(w.accum, w.reps), S(w.inten, w.reps), S(w.real, w.reps, { amrap: true })]
      : [S(0.5, w.reps), S(0.55, w.reps), S(0.6, w.reps)]
const accJug = {
  squat: [acc(ID.lunge, 3, 8, 12), acc(ID.legCurl, 3, 10, 15)], bench: [acc(ID.dbPress, 3, 8, 12), acc(ID.pushdown, 3, 10, 15)],
  deadlift: [acc(ID.row, 3, 8, 12), acc(ID.legRaise, 3, 10, 15)], press: [acc(ID.pulldown, 3, 8, 12), acc(ID.lateral, 3, 12, 15)],
}
const pjug = {
  id: 'premium-juggernaut-method', slug: 'juggernaut-method', name: 'Juggernaut Method',
  shortDescription: 'Sixteen weeks in four waves (10s, 8s, 5s, 3s): build volume, raise intensity, test, then deload.',
  longDescription: 'The program is a long block of four waves. Each wave works in a different rep range (10, 8, 5 and 3) and moves through four weeks: accumulation (more sets, lighter weight), intensification (heavier), realization (a final set to as many reps as possible) and a deload. Weights are percentages of your Training Max. This version follows the publicly described wave idea with 2J’s own percentages — it does not reproduce any book table. At the end of the sixteen weeks 2J proposes a Training Max update for you to confirm.',
  goalTags: ['strength', 'strength-muscle'], level: 'advanced', daysPerWeek: 4, durationDescription: '16 weeks (four waves)',
  methodType: 'percentage-wave', sourceType: 'principles', author: { name: 'Wave idea described by Chad Wesley Smith', work: 'The Juggernaut Method' },
  evidenceSummary: 'Wave-style periodization (volume first, intensity later, planned deloads) is a common approach in strength sport; there is no direct evidence for this specific arrangement. The percentages used here are 2J’s own, not the book’s.',
  equipmentRequirements: ['barbell', 'rack', 'bench'], progressionModel: 'training-max-cycle',
  legal: { status: 'review', note: 'Name belongs to a commercial method. This program uses its public wave idea with original percentages; confirm licence/trademark or rename before promoting it.' },
  featured: false, badge: null,
  copy: {
    howItWorks: ['Four waves of four weeks: 10s, 8s, 5s and 3s.', 'Inside a wave: accumulation, intensification, realization (last set AMRAP), deload.', 'Everything is a percentage of your Training Max; you confirm changes at the end.'],
    forWhom: ['You have trained the big lifts for a while.', 'You can commit to a long, structured block.', 'You are comfortable with heavy sets taken close to your limit.'],
    notIdealIf: ['You are new to lifting.', 'You need a shorter program.', 'You cannot train four days a week.'],
    tracking: ['Wave and phase, week and next session.', 'Every AMRAP result.', 'Training Max updates — always confirmed by you.'],
  },
  definition: { schema: 1, cycleWeeks: 16, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE({ upper: { kg: 5, lb: 10 }, lower: { kg: 10, lb: 20 } }),
    weeks: waveWeeks.map(ww => ({ label: ww.phase, phase: ww.phase, sessions: ['squat', 'bench', 'deadlift', 'press'].map(l => day(l, `${l[0].toUpperCase()}${l.slice(1)} day`, [main(l, waveSets(ww), { rest: 150 }), ...accJug[l]])) })) },
  es: {
    shortDescription: 'Dieciséis semanas en cuatro ondas (10s, 8s, 5s y 3s): construir volumen, subir intensidad, probar y descargar.',
    longDescription: 'El programa es un bloque largo de cuatro ondas. Cada onda trabaja un rango de repeticiones distinto (10, 8, 5 y 3) y pasa por cuatro semanas: acumulación (más series, menos peso), intensificación (más pesado), realización (una serie final a tantas repeticiones como puedas) y descarga. Los pesos son porcentajes de tu Training Max. Esta versión sigue la idea de ondas descrita públicamente con porcentajes propios de 2J: no reproduce ninguna tabla de un libro. Al final de las dieciséis semanas, 2J te propone actualizar el Training Max para que lo confirmes.',
    durationDescription: '16 semanas (cuatro ondas)',
    evidenceSummary: 'La periodización en ondas (primero volumen, luego intensidad, descargas planificadas) es un enfoque habitual en deportes de fuerza; no hay evidencia directa de esta disposición concreta. Los porcentajes usados aquí son propios de 2J, no los del libro.',
    howItWorks: ['Cuatro ondas de cuatro semanas: 10s, 8s, 5s y 3s.', 'Dentro de cada onda: acumulación, intensificación, realización (última serie AMRAP) y descarga.', 'Todo es un porcentaje de tu Training Max; confirmas los cambios al final.'],
    forWhom: ['Llevas tiempo entrenando los levantamientos básicos.', 'Puedes comprometerte con un bloque largo y estructurado.', 'Te sientes cómodo con series pesadas cerca de tu límite.'],
    notIdealIf: ['Eres nuevo en el entrenamiento con pesas.', 'Necesitas un programa más corto.', 'No puedes entrenar cuatro días por semana.'],
    tracking: ['Onda y fase, semana y próxima sesión.', 'Cada resultado AMRAP.', 'Las actualizaciones de Training Max, siempre confirmadas por ti.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- GZCL-style tiers */
const gzDay = (k, t1, t2, t3) => day(k, ...[t1[0], [heavy(t1[1], 5, 3, { rest: 180, note: 'T1: heavy compound' }), { role: 'supplemental', exercise: t2, scheme: { sets: 3, reps: 10, prog: 'linear' }, rest: 120, note: 'T2: moderate volume' }, { role: 'accessory', exercise: t3, scheme: { sets: 3, repsMin: 12, repsMax: 18, prog: 'double' }, note: 'T3: high-rep accessory' }]])
const pgzcl = {
  id: 'premium-gzcl', slug: 'gzcl', name: 'GZCL',
  shortDescription: 'Tiers of work: a heavy main lift (T1), a moderate-volume lift (T2) and high-rep accessories (T3) in every session.',
  longDescription: 'Each session is built from three tiers. T1 is a heavy compound lift in low reps, T2 is a related lift in moderate reps and more sets, and T3 is a high-rep accessory. Loads progress session to session with the app’s own progression: when you hit every rep the weight goes up. This is the tier idea in a simple, four-day form — not a copy of any published template.',
  goalTags: ['strength', 'strength-muscle', 'hypertrophy'], level: 'intermediate', daysPerWeek: 4, durationDescription: '4-week blocks, repeated',
  methodType: 'tiered', sourceType: 'principles', author: { name: 'Tier concept described by Cody LeFever', work: 'GZCL method' },
  evidenceSummary: 'Tiered training (heavy, moderate and light volume in the same session) is a practical way to mix strength and size work. The method as such has not been tested head-to-head; the progression here is the app’s ordinary linear/double progression.',
  equipmentRequirements: ['barbell', 'rack', 'bench', 'cable machine'], progressionModel: 'tiered',
  legal: { status: 'review', note: 'Method name and tier terminology. Description and layout are original; confirm attribution/naming before promoting it.' },
  featured: false, badge: null,
  copy: {
    howItWorks: ['Every session has three tiers: heavy (T1), moderate (T2), high-rep (T3).', 'Loads follow the app’s progression: hit every rep and the weight goes up.', 'The four days rotate which lift is heavy.'],
    forWhom: ['You want strength and size without a complex percentage table.', 'You like variety inside a stable structure.', 'You can train four days a week.'],
    notIdealIf: ['You prefer fixed percentage cycles.', 'You are totally new to the main lifts.', 'You cannot access a barbell and a cable machine.'],
    tracking: ['Your block, week and next session.', 'Whether each tier hit its reps.', 'Load progress per lift.'],
  },
  definition: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
    gzDay(0, ['Day 1 · Squat', ID.squat], ID.dbBench, ID.pulldown), gzDay(1, ['Day 2 · Press', ID.press], ID.deadlift, ID.dbRow),
    gzDay(2, ['Day 3 · Bench', ID.bench], ID.front, ID.pulldown), gzDay(3, ['Day 4 · Deadlift', ID.deadlift], ID.dbPress, ID.dbRow)].map((s, i) => ({ ...s, key: `day-${i + 1}` })) })) },
  es: {
    shortDescription: 'Niveles de trabajo: un levantamiento principal pesado (T1), uno de volumen moderado (T2) y accesorios de muchas repeticiones (T3) en cada sesión.',
    longDescription: 'Cada sesión se construye con tres niveles. T1 es un compuesto pesado a pocas repeticiones, T2 es un levantamiento relacionado a repeticiones moderadas y más series, y T3 es un accesorio de muchas repeticiones. Las cargas progresan de sesión a sesión con la progresión propia de la app: si completas todas las repeticiones, el peso sube. Es la idea de niveles en una forma sencilla de cuatro días, no una copia de ninguna plantilla publicada.',
    durationDescription: 'Bloques de 4 semanas, repetidos',
    evidenceSummary: 'Entrenar por niveles (pesado, moderado y ligero en la misma sesión) es una forma práctica de mezclar trabajo de fuerza y de tamaño. El método como tal no se ha comparado directamente con otros; la progresión aquí es la progresión lineal/doble habitual de la app.',
    howItWorks: ['Cada sesión tiene tres niveles: pesado (T1), moderado (T2) y de muchas repeticiones (T3).', 'Las cargas siguen la progresión de la app: completa todas las repeticiones y el peso sube.', 'Los cuatro días rotan qué levantamiento es el pesado.'],
    forWhom: ['Quieres fuerza y tamaño sin una tabla compleja de porcentajes.', 'Te gusta la variedad dentro de una estructura estable.', 'Puedes entrenar cuatro días por semana.'],
    notIdealIf: ['Prefieres ciclos de porcentajes fijos.', 'Eres totalmente nuevo en los levantamientos principales.', 'No tienes barra ni polea.'],
    tracking: ['Tu bloque, semana y próxima sesión.', 'Si cada nivel cumplió sus repeticiones.', 'El progreso de carga por levantamiento.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- PHUL / PHAT (power + hypertrophy splits) */
const power = (ex, sets = 3) => ({ role: 'main', exercise: ex, scheme: { sets, repsMin: 3, repsMax: 5, prog: 'double' }, rest: 180 })
const hyp = (ex, sets = 3, lo = 8, hi = 12) => acc(ex, sets, lo, hi, { rest: 90 })
const pphul = {
  id: 'premium-phul', slug: 'phul', name: 'PHUL',
  shortDescription: 'Upper/lower split with two power days and two hypertrophy days: heavy low reps, then higher-rep size work.',
  longDescription: 'Four days a week: Upper Power, Lower Power, Upper Hypertrophy and Lower Hypertrophy. Power days use heavy compound lifts in 3–5 reps; hypertrophy days use moderate loads in 8–12 reps. Every muscle is trained twice a week. Weights progress with double progression: reach the top of the rep range on every set and the weight goes up.',
  goalTags: ['strength-muscle', 'hypertrophy', 'strength'], level: 'intermediate', daysPerWeek: 4, durationDescription: '4-week blocks, repeated',
  methodType: 'upper-lower', sourceType: 'established', author: { name: 'Described by Brandon Campbell', work: 'PHUL (Power Hypertrophy Upper Lower)' },
  evidenceSummary: 'Training each muscle about twice a week and mixing heavy and moderate rep ranges is a common recommendation supported by reviews of training frequency (e.g. Schoenfeld et al., 2016). The program itself has not been studied.',
  equipmentRequirements: ['barbell', 'rack', 'bench', 'dumbbells', 'cable machine'], progressionModel: 'double-progression',
  legal: { status: 'review', note: 'Acronym of a community method. Layout and exercise choice are original; confirm attribution/naming before promoting it.' },
  featured: false, badge: null,
  copy: {
    howItWorks: ['Two power days (3–5 reps) and two hypertrophy days (8–12 reps).', 'Every muscle twice a week.', 'Double progression: reach the top of the range in every set, then add weight.'],
    forWhom: ['You want to get stronger and bigger together.', 'You can train four days a week.', 'You already know the main lifts.'],
    notIdealIf: ['You prefer training one body part per day.', 'You can only train two or three days a week.', 'You are totally new to the gym.'],
    tracking: ['Your block, week and next session.', 'Progress inside each rep range.', 'Adherence to the four weekly days.'],
  },
  definition: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
    day('upper-power', 'Upper power', [power(ID.bench, 4), power(ID.row, 4), power(ID.press, 3), hyp(ID.chinup, 3, 6, 10), hyp(ID.curl, 2), hyp(ID.skull, 2)]),
    day('lower-power', 'Lower power', [power(ID.squat, 4), power(ID.deadlift, 3), hyp(ID.legPress, 3, 10, 15), hyp(ID.legCurl, 3, 8, 12), hyp(ID.calf, 4, 10, 15)]),
    day('upper-hyp', 'Upper hypertrophy', [hyp(ID.incline, 4), hyp(ID.cableRow, 4), hyp(ID.dbPress, 3), hyp(ID.lateral, 3, 12, 15), hyp(ID.hammer, 3), hyp(ID.pushdown, 3)]),
    day('lower-hyp', 'Lower hypertrophy', [hyp(ID.front, 4, 6, 10), hyp(ID.lunge, 3), hyp(ID.legExt, 3, 10, 15), hyp(ID.legCurl, 3, 10, 15), hyp(ID.calf, 4, 12, 20)]),
  ] })) },
  es: {
    shortDescription: 'Torso/pierna con dos días de potencia y dos de hipertrofia: pocas repeticiones pesadas y luego trabajo de tamaño con más repeticiones.',
    longDescription: 'Cuatro días por semana: Torso potencia, Pierna potencia, Torso hipertrofia y Pierna hipertrofia. Los días de potencia usan compuestos pesados a 3–5 repeticiones; los de hipertrofia, cargas moderadas a 8–12. Cada músculo se entrena dos veces por semana. Los pesos progresan con doble progresión: llega al máximo del rango en todas las series y el peso sube.',
    durationDescription: 'Bloques de 4 semanas, repetidos',
    evidenceSummary: 'Entrenar cada músculo unas dos veces por semana y mezclar rangos de repeticiones pesados y moderados es una recomendación habitual apoyada por revisiones sobre frecuencia de entrenamiento (p. ej. Schoenfeld et al., 2016). El programa en sí no se ha estudiado.',
    howItWorks: ['Dos días de potencia (3–5 repeticiones) y dos de hipertrofia (8–12).', 'Cada músculo, dos veces por semana.', 'Doble progresión: llega al máximo del rango en todas las series y luego añade peso.'],
    forWhom: ['Quieres ganar fuerza y tamaño a la vez.', 'Puedes entrenar cuatro días por semana.', 'Ya conoces los levantamientos principales.'],
    notIdealIf: ['Prefieres entrenar una parte del cuerpo por día.', 'Solo puedes entrenar dos o tres días por semana.', 'Eres totalmente nuevo en el gimnasio.'],
    tracking: ['Tu bloque, semana y próxima sesión.', 'El progreso dentro de cada rango de repeticiones.', 'La adherencia a los cuatro días semanales.'],
  },
}

const pphat = {
  id: 'premium-phat', slug: 'phat', name: 'PHAT',
  shortDescription: 'Five days: two power days (upper and lower) and three hypertrophy days focused on back and shoulders, legs, and chest and arms.',
  longDescription: 'A higher-frequency, higher-volume split. The two power days use heavy compound lifts in low reps; the three hypertrophy days split the body into back and shoulders, lower body, and chest and arms with moderate to high reps. Weights progress with double progression. It asks for five training days and good recovery.',
  goalTags: ['hypertrophy', 'strength-muscle'], level: 'advanced', daysPerWeek: 5, durationDescription: '4-week blocks, repeated',
  methodType: 'split', sourceType: 'established', author: { name: 'Described by Layne Norton', work: 'PHAT (Power Hypertrophy Adaptive Training)' },
  evidenceSummary: 'Combines heavy and moderate-rep work and trains each muscle about twice a week, in line with common recommendations on frequency and volume. The program itself has not been studied; high volume needs adequate recovery.',
  equipmentRequirements: ['barbell', 'rack', 'bench', 'dumbbells', 'cable machine', 'machines'], progressionModel: 'double-progression',
  legal: { status: 'review', note: 'Acronym of a named method by a public figure. Layout and exercises are original; confirm attribution/naming before promoting it.' },
  featured: false, badge: null,
  copy: {
    howItWorks: ['Day 1–2: upper and lower power. Day 3–5: hypertrophy by region.', 'More weekly volume than a four-day split.', 'Double progression inside each rep range.'],
    forWhom: ['You are an experienced lifter chasing size and strength.', 'You can train five days a week.', 'You recover well.'],
    notIdealIf: ['You have limited time or energy for five weekly sessions.', 'You are a beginner.', 'You are returning from a break or injury.'],
    tracking: ['Block, week and next session.', 'Adherence to five weekly days.', 'Progress per rep range.'],
  },
  definition: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
    day('upper-power', 'Upper power', [power(ID.bench, 3), power(ID.row, 3), power(ID.press, 3), hyp(ID.chinup, 2, 6, 10), hyp(ID.curl, 2, 6, 10), hyp(ID.skull, 2, 6, 10)]),
    day('lower-power', 'Lower power', [power(ID.squat, 3), power(ID.deadlift, 3), hyp(ID.legPress, 2, 6, 10), hyp(ID.calf, 2, 6, 10)]),
    day('back-shoulders', 'Back and shoulders hypertrophy', [hyp(ID.pendlay, 4, 8, 12), hyp(ID.pulldown, 3), hyp(ID.cableRow, 3), hyp(ID.dbPress, 3), hyp(ID.lateral, 4, 12, 20), hyp(ID.shrug, 3)]),
    day('lower-hyp', 'Lower hypertrophy', [hyp(ID.front, 3, 8, 12), hyp(ID.legPress, 3, 10, 15), hyp(ID.legExt, 3, 10, 15), hyp(ID.legCurl, 3, 10, 15), hyp(ID.calf, 4, 12, 20)]),
    day('chest-arms', 'Chest and arms hypertrophy', [hyp(ID.incline, 3, 8, 12), hyp(ID.dbFly, 3, 10, 15), hyp(ID.fly, 3, 12, 20), hyp(ID.hammer, 3, 8, 12), hyp(ID.curl, 3, 12, 20), hyp(ID.pushdown, 3, 10, 15)]),
  ] })) },
  es: {
    shortDescription: 'Cinco días: dos de potencia (torso y pierna) y tres de hipertrofia centrados en espalda y hombros, piernas, y pecho y brazos.',
    longDescription: 'Un reparto de mayor frecuencia y volumen. Los dos días de potencia usan compuestos pesados a pocas repeticiones; los tres de hipertrofia dividen el cuerpo en espalda y hombros, tren inferior, y pecho y brazos, con repeticiones moderadas o altas. Los pesos progresan con doble progresión. Exige cinco días de entrenamiento y buena recuperación.',
    durationDescription: 'Bloques de 4 semanas, repetidos',
    evidenceSummary: 'Combina trabajo pesado y de repeticiones moderadas y entrena cada músculo unas dos veces por semana, en línea con las recomendaciones habituales sobre frecuencia y volumen. El programa en sí no se ha estudiado; el volumen alto requiere buena recuperación.',
    howItWorks: ['Días 1–2: potencia de torso y de pierna. Días 3–5: hipertrofia por regiones.', 'Más volumen semanal que un reparto de cuatro días.', 'Doble progresión dentro de cada rango de repeticiones.'],
    forWhom: ['Eres un levantador con experiencia que busca tamaño y fuerza.', 'Puedes entrenar cinco días por semana.', 'Te recuperas bien.'],
    notIdealIf: ['Tienes poco tiempo o energía para cinco sesiones semanales.', 'Eres principiante.', 'Vuelves de una pausa o de una lesión.'],
    tracking: ['Bloque, semana y próxima sesión.', 'Adherencia a cinco días semanales.', 'Progreso por rango de repeticiones.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- DUP */
const dupDay = (key, title, scheme) => day(key, title, [
  main('squat', scheme.squat, { rest: 150 }), main('bench', scheme.bench, { rest: 150 }), main('deadlift', scheme.dead, { rest: 180 }), acc(ID.cableRow, 3, 8, 12),
])
const HEAVY = { squat: [S(0.8, 5), S(0.85, 3), S(0.85, 3), S(0.85, 3)], bench: [S(0.8, 5), S(0.85, 3), S(0.85, 3), S(0.85, 3)], dead: [S(0.85, 3), S(0.85, 3)] }
const MODERATE = { squat: Array.from({ length: 4 }, () => S(0.75, 6)), bench: Array.from({ length: 4 }, () => S(0.75, 6)), dead: [S(0.75, 6), S(0.75, 6)] }
const LIGHT = { squat: Array.from({ length: 3 }, () => S(0.65, 10)), bench: Array.from({ length: 3 }, () => S(0.65, 10)), dead: [S(0.65, 8)] }
const rot = [[HEAVY, MODERATE, LIGHT], [MODERATE, LIGHT, HEAVY], [LIGHT, HEAVY, MODERATE], [HEAVY, LIGHT, MODERATE]]
const pdup = {
  id: 'premium-dup', slug: 'dup', name: 'DUP — Daily Undulating Periodization',
  shortDescription: 'Three full-body days a week where the load and rep range change every session: heavy, moderate, light — and rotate.',
  longDescription: 'Instead of one rep range for weeks, each session has its own: a heavy day (low reps), a moderate day and a light, higher-rep day. The order rotates week to week so every lift meets every intensity. All weights are percentages of your Training Max, and after four weeks 2J proposes an update for you to confirm. Undulating periodization is a general scientific term, not a brand.',
  goalTags: ['hypertrophy', 'strength', 'strength-muscle'], level: 'intermediate', daysPerWeek: 3, durationDescription: '4-week cycles, repeated',
  methodType: 'undulating', sourceType: 'principles', author: { name: 'General periodization concept (e.g. Rhea et al., 2002)' },
  evidenceSummary: 'Studies comparing undulating with linear periodization show small and inconsistent differences once total volume is matched (for example systematic reviews such as Harries et al., 2015). Its practical advantage is variety and flexible fatigue management, not a proven superiority.',
  equipmentRequirements: ['barbell', 'rack', 'bench', 'cable machine'], progressionModel: 'undulating',
  legal: { status: 'none', note: 'Generic scientific term.' },
  featured: false, badge: null,
  copy: {
    howItWorks: ['Every session has its own rep range: heavy, moderate or light.', 'The order rotates so each lift sees every intensity.', 'Weights are percentages of your Training Max; you confirm changes each cycle.'],
    forWhom: ['You want strength and size without long monotony.', 'You can train three full-body days.', 'You know the basic lifts.'],
    notIdealIf: ['You want a single simple rep range.', 'You are brand new to lifting.', 'You need more than three weekly sessions.'],
    tracking: ['Cycle, week and which intensity today is.', 'Adherence.', 'Training Max updates — always confirmed by you.'],
  },
  definition: { schema: 1, cycleWeeks: 4, referenceLabel: 'Training Max', lifts: LIFTS4.slice(0, 3), progression: TM_RULE({ upper: { kg: 2.5, lb: 5 }, lower: { kg: 5, lb: 10 } }),
    weeks: rot.map((r, k) => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [dupDay('day-a', `Day A · ${r[0] === HEAVY ? 'Heavy' : r[0] === MODERATE ? 'Moderate' : 'Light'}`, r[0]), dupDay('day-b', `Day B · ${r[1] === HEAVY ? 'Heavy' : r[1] === MODERATE ? 'Moderate' : 'Light'}`, r[1]), dupDay('day-c', `Day C · ${r[2] === HEAVY ? 'Heavy' : r[2] === MODERATE ? 'Moderate' : 'Light'}`, r[2])] })) },
  es: {
    shortDescription: 'Tres días de cuerpo completo por semana donde la carga y el rango de repeticiones cambian cada sesión: pesado, moderado y ligero, y rotan.',
    longDescription: 'En lugar de un solo rango de repeticiones durante semanas, cada sesión tiene el suyo: un día pesado (pocas repeticiones), uno moderado y uno ligero de más repeticiones. El orden rota de semana en semana para que cada levantamiento pase por todas las intensidades. Todos los pesos son porcentajes de tu Training Max y, tras cuatro semanas, 2J te propone una actualización para que la confirmes. La periodización ondulante es un término científico general, no una marca.',
    durationDescription: 'Ciclos de 4 semanas, repetidos',
    evidenceSummary: 'Los estudios que comparan la periodización ondulante con la lineal muestran diferencias pequeñas e inconsistentes cuando se iguala el volumen total (por ejemplo, revisiones sistemáticas como Harries et al., 2015). Su ventaja práctica es la variedad y el manejo flexible de la fatiga, no una superioridad demostrada.',
    howItWorks: ['Cada sesión tiene su propio rango de repeticiones: pesado, moderado o ligero.', 'El orden rota para que cada levantamiento vea todas las intensidades.', 'Los pesos son porcentajes de tu Training Max; confirmas los cambios cada ciclo.'],
    forWhom: ['Quieres fuerza y tamaño sin monotonía.', 'Puedes entrenar tres días de cuerpo completo.', 'Conoces los levantamientos básicos.'],
    notIdealIf: ['Quieres un único rango de repeticiones sencillo.', 'Eres totalmente nuevo en el entrenamiento con pesas.', 'Necesitas más de tres sesiones semanales.'],
    tracking: ['Ciclo, semana y qué intensidad toca hoy.', 'Adherencia.', 'Las actualizaciones de Training Max, siempre confirmadas por ti.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- Upper/Lower Powerbuilding */
const pbMain = (lift, top, back) => main(lift, [S(0.65, 5), ...Array.from({ length: top }, () => S(0.8, 5)), ...Array.from({ length: back }, () => S(0.7, 8))], { rest: 150 })
const ppb = {
  id: 'premium-upper-lower-powerbuilding', slug: 'upper-lower-powerbuilding', name: 'Upper/Lower Powerbuilding',
  shortDescription: 'Four days (upper/lower twice): heavy compound lifts on a Training Max, then hypertrophy accessories.',
  longDescription: 'Each session starts with one heavy compound lift with loads set from your Training Max — a few heavy sets of five followed by lighter back-off sets of eight — and then moves on to hypertrophy accessories in the 8–15 rep range. Upper and lower days alternate, so every muscle is trained twice a week. After a four-week cycle 2J proposes a Training Max update for you to confirm.',
  goalTags: ['strength-muscle', 'strength', 'hypertrophy'], level: 'intermediate', daysPerWeek: 4, durationDescription: '4-week cycles, repeated',
  methodType: 'upper-lower', sourceType: 'principles', author: { name: 'Generic powerbuilding structure' },
  evidenceSummary: 'Pairing heavy compound work with moderate-rep accessories, and training each muscle about twice weekly, follows common recommendations on strength and hypertrophy. The arrangement itself has not been compared with others.',
  equipmentRequirements: ['barbell', 'rack', 'bench', 'dumbbells', 'cable machine'], progressionModel: 'training-max-cycle',
  legal: { status: 'none', note: 'Generic structure.' },
  featured: false, badge: null,
  copy: {
    howItWorks: ['One heavy compound lift per session, from your Training Max.', 'Then hypertrophy accessories in 8–15 reps.', 'Upper/lower alternate; confirm new Training Max values every cycle.'],
    forWhom: ['You want to look and lift better.', 'You can train four days a week.', 'You know the barbell basics.'],
    notIdealIf: ['You want a single-lift strength focus.', 'You are new to lifting.', 'You cannot access a barbell and a cable machine.'],
    tracking: ['Cycle, week and next session.', 'Adherence.', 'Training Max updates — always confirmed by you.'],
  },
  definition: { schema: 1, cycleWeeks: 4, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE(),
    weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: k === 3 ? 'Week 4 · Lighter week' : `Week ${k + 1}`, sessions: [
      day('upper-a', 'Upper A', [pbMain('bench', k === 3 ? 1 : 3, k === 3 ? 1 : 2), acc(ID.row, 3, 8, 12), acc(ID.dbPress, 3, 8, 12), acc(ID.lateral, 3, 12, 15), acc(ID.pushdown, 3, 10, 15)]),
      day('lower-a', 'Lower A', [pbMain('squat', k === 3 ? 1 : 3, k === 3 ? 1 : 2), acc(ID.rdl, 3, 8, 12), acc(ID.legCurl, 3, 10, 15), acc(ID.calf, 4, 10, 15)]),
      day('upper-b', 'Upper B', [pbMain('press', k === 3 ? 1 : 3, k === 3 ? 1 : 2), acc(ID.pulldown, 3, 8, 12), acc(ID.incline, 3, 8, 12), acc(ID.curl, 3, 8, 12), acc(ID.rearDelt, 3, 12, 15)]),
      day('lower-b', 'Lower B', [pbMain('deadlift', k === 3 ? 1 : 2, k === 3 ? 0 : 2), acc(ID.legPress, 3, 10, 15), acc(ID.lunge, 3, 8, 12), acc(ID.legRaise, 3, 10, 15)]),
    ] })) },
  es: {
    shortDescription: 'Cuatro días (torso/pierna dos veces): compuestos pesados sobre un Training Max y luego accesorios de hipertrofia.',
    longDescription: 'Cada sesión empieza con un compuesto pesado con cargas calculadas sobre tu Training Max (unas pocas series pesadas de cinco y luego series más ligeras de ocho) y continúa con accesorios de hipertrofia de 8–15 repeticiones. Los días de torso y de pierna se alternan, así que cada músculo se entrena dos veces por semana. Tras un ciclo de cuatro semanas, 2J te propone actualizar el Training Max para que lo confirmes.',
    durationDescription: 'Ciclos de 4 semanas, repetidos',
    evidenceSummary: 'Combinar trabajo compuesto pesado con accesorios de repeticiones moderadas, y entrenar cada músculo unas dos veces por semana, sigue las recomendaciones habituales de fuerza e hipertrofia. La disposición en sí no se ha comparado con otras.',
    howItWorks: ['Un compuesto pesado por sesión, desde tu Training Max.', 'Luego accesorios de hipertrofia de 8–15 repeticiones.', 'Torso/pierna se alternan; confirmas nuevos Training Max cada ciclo.'],
    forWhom: ['Quieres verte y rendir mejor.', 'Puedes entrenar cuatro días por semana.', 'Conoces lo básico de la barra.'],
    notIdealIf: ['Quieres centrarte solo en la fuerza de un levantamiento.', 'Eres nuevo en el entrenamiento con pesas.', 'No tienes barra ni polea.'],
    tracking: ['Ciclo, semana y próxima sesión.', 'Adherencia.', 'Las actualizaciones de Training Max, siempre confirmadas por ti.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- Full Body Hypertrophy */
const pfbh = {
  id: 'premium-full-body-hypertrophy', slug: 'full-body-hypertrophy', name: 'Full Body Hypertrophy',
  shortDescription: 'Three full-body days a week focused on muscle size, with simple double progression.',
  longDescription: 'Three alternating full-body sessions (A, B, C), each covering every major muscle with moderate reps (6–15). Every muscle is trained three times a week at a manageable volume. Weights progress with double progression: reach the top of the rep range on every set and the weight goes up. No percentages and no maximum tests are needed.',
  goalTags: ['hypertrophy'], level: 'beginner', daysPerWeek: 3, durationDescription: '4-week blocks, repeated',
  methodType: 'full-body', sourceType: 'principles', author: { name: 'Generic full-body structure' },
  evidenceSummary: 'Training each muscle several times a week at moderate volume is a common and practical way to build muscle (reviews of training frequency such as Schoenfeld et al., 2016). Progress depends mostly on total hard sets, effort, protein and consistency.',
  equipmentRequirements: ['barbell or dumbbells', 'bench', 'cable machine'], progressionModel: 'double-progression',
  legal: { status: 'none', note: 'Generic structure.' },
  featured: true, badge: 'new',
  copy: {
    howItWorks: ['Three full-body sessions: A, B and C.', 'Moderate reps (6–15) close to — not at — failure.', 'Double progression: top of the range in every set, then add weight.'],
    forWhom: ['You are starting out or returning after a break.', 'You can train three days a week.', 'You want size without a complex plan.'],
    notIdealIf: ['You want to train more than four days.', 'You prefer heavy low-rep strength work.', 'You need a specialised plan for competition.'],
    tracking: ['Block, week and next session.', 'Adherence.', 'Progress inside the rep ranges.'],
  },
  definition: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
    day('full-a', 'Full body A', [hyp(ID.squat, 3, 6, 10), hyp(ID.dbBench, 3, 8, 12), hyp(ID.cableRow, 3, 8, 12), hyp(ID.lateral, 2, 12, 15), hyp(ID.curl, 2, 10, 15), hyp(ID.crunch, 2, 12, 20)]),
    day('full-b', 'Full body B', [hyp(ID.rdl, 3, 6, 10), hyp(ID.dbPress, 3, 8, 12), hyp(ID.pulldown, 3, 8, 12), hyp(ID.lunge, 2, 8, 12), hyp(ID.pushdown, 2, 10, 15), hyp(ID.legRaise, 2, 10, 15)]),
    day('full-c', 'Full body C', [hyp(ID.legPress, 3, 8, 12), hyp(ID.incline, 3, 8, 12), hyp(ID.dbRow, 3, 8, 12), hyp(ID.legCurl, 3, 10, 15), hyp(ID.hammer, 2, 10, 15), hyp(ID.calf, 3, 10, 15)]),
  ] })) },
  es: {
    shortDescription: 'Tres días de cuerpo completo por semana centrados en el tamaño muscular, con una doble progresión sencilla.',
    longDescription: 'Tres sesiones alternas de cuerpo completo (A, B y C), cada una con todos los grupos musculares principales y repeticiones moderadas (6–15). Cada músculo se entrena tres veces por semana con un volumen asumible. Los pesos progresan con doble progresión: llega al máximo del rango en todas las series y el peso sube. No hacen falta porcentajes ni pruebas de máximos.',
    durationDescription: 'Bloques de 4 semanas, repetidos',
    evidenceSummary: 'Entrenar cada músculo varias veces por semana con volumen moderado es una forma habitual y práctica de ganar músculo (revisiones sobre frecuencia como Schoenfeld et al., 2016). El progreso depende sobre todo de las series duras totales, el esfuerzo, la proteína y la constancia.',
    howItWorks: ['Tres sesiones de cuerpo completo: A, B y C.', 'Repeticiones moderadas (6–15), cerca del fallo pero sin llegar.', 'Doble progresión: máximo del rango en todas las series y luego sube el peso.'],
    forWhom: ['Estás empezando o vuelves tras una pausa.', 'Puedes entrenar tres días por semana.', 'Quieres tamaño sin un plan complejo.'],
    notIdealIf: ['Quieres entrenar más de cuatro días.', 'Prefieres fuerza pesada de pocas repeticiones.', 'Necesitas un plan especializado de competición.'],
    tracking: ['Bloque, semana y próxima sesión.', 'Adherencia.', 'El progreso dentro de los rangos de repeticiones.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- 2J Recomposition */
const prec = {
  id: 'premium-2j-recomposition', slug: '2j-recomposition', name: '2J Recomposition',
  shortDescription: 'A 2J design to lose fat while keeping or building muscle: four sessions that pair strength work with conditioning.',
  longDescription: 'Often called “toning”, the practical goal is to reduce body fat while keeping or building muscle. Four sessions a week: two strength-focused full-body sessions to protect muscle, and two shorter hypertrophy sessions that finish with conditioning. Strength loads progress with the app’s progression; conditioning builds duration gradually. Training is only one side of the result — energy balance and protein matter too, and this program does not prescribe a diet.',
  goalTags: ['recomposition'], level: 'beginner', daysPerWeek: 4, durationDescription: '4-week blocks, repeated',
  methodType: 'recomposition', sourceType: 'own', author: { name: '2J Fitness Center' },
  evidenceSummary: 'Resistance training is the main signal for keeping muscle during fat loss; conditioning adds energy expenditure and fitness. How much fat you lose depends mostly on energy balance, which this program does not control. It is an original 2J design, not a published method.',
  equipmentRequirements: ['dumbbells', 'bench', 'cable machine', 'cardio machine'], progressionModel: 'double-progression',
  legal: { status: 'none', note: '2J original.' },
  featured: true, badge: 'featured',
  copy: {
    howItWorks: ['Two strength sessions protect muscle.', 'Two hypertrophy sessions finish with conditioning.', 'Loads and conditioning time progress gradually.'],
    forWhom: ['You want to lose fat and look more defined.', 'You can train four days a week.', 'You prefer a balanced plan over extremes.'],
    notIdealIf: ['You need medical supervision for a condition.', 'You want a pure powerlifting plan.', 'You expect the program alone to decide fat loss without any attention to food.'],
    tracking: ['Block, week and next session.', 'Adherence and conditioning time.', 'Body weight and composition trends if you log them.'],
  },
  definition: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
    day('strength-a', 'Strength A', [acc(ID.squat, 3, 6, 8), acc(ID.dbBench, 3, 6, 8), acc(ID.cableRow, 3, 8, 10), acc(ID.legRaise, 2, 10, 15)]),
    day('hyp-upper', 'Upper hypertrophy + conditioning', [acc(ID.incline, 3, 8, 12), acc(ID.pulldown, 3, 8, 12), acc(ID.lateral, 3, 12, 15), acc(ID.pushdown, 2, 10, 15), cond(ID.run, 15 + k * 2, { speed: 8, note: 'Steady, conversational effort.' })]),
    day('strength-b', 'Strength B', [acc(ID.rdl, 3, 6, 8), acc(ID.dbPress, 3, 6, 8), acc(ID.dbRow, 3, 8, 10), acc(ID.crunch, 2, 12, 20)]),
    day('hyp-lower', 'Lower hypertrophy + conditioning', [acc(ID.legPress, 3, 10, 15), acc(ID.lunge, 3, 8, 12), acc(ID.legCurl, 3, 10, 15), acc(ID.calf, 3, 12, 20), cond(ID.run, 15 + k * 2, { speed: 8, note: 'Steady, conversational effort.' })]),
  ] })) },
  es: {
    shortDescription: 'Un diseño de 2J para perder grasa manteniendo o ganando músculo: cuatro sesiones que combinan fuerza y acondicionamiento.',
    longDescription: 'A menudo llamado «tonificar», el objetivo práctico es reducir la grasa corporal manteniendo o ganando músculo. Cuatro sesiones por semana: dos sesiones de cuerpo completo centradas en la fuerza para proteger el músculo y dos sesiones de hipertrofia más cortas que terminan con acondicionamiento. Las cargas de fuerza progresan con la progresión de la app; el acondicionamiento aumenta la duración poco a poco. El entrenamiento es solo una parte del resultado: el balance de energía y la proteína también cuentan, y este programa no prescribe una dieta.',
    durationDescription: 'Bloques de 4 semanas, repetidos',
    evidenceSummary: 'El entrenamiento de fuerza es la señal principal para conservar músculo mientras pierdes grasa; el acondicionamiento suma gasto energético y forma física. Cuánta grasa pierdes depende sobre todo del balance de energía, que este programa no controla. Es un diseño original de 2J, no un método publicado.',
    howItWorks: ['Dos sesiones de fuerza protegen el músculo.', 'Dos sesiones de hipertrofia terminan con acondicionamiento.', 'Las cargas y el tiempo de acondicionamiento progresan poco a poco.'],
    forWhom: ['Quieres perder grasa y verte más definido.', 'Puedes entrenar cuatro días por semana.', 'Prefieres un plan equilibrado a los extremos.'],
    notIdealIf: ['Necesitas supervisión médica por alguna condición.', 'Quieres un plan puro de powerlifting.', 'Esperas que solo el programa decida la pérdida de grasa sin cuidar la comida.'],
    tracking: ['Bloque, semana y próxima sesión.', 'Adherencia y tiempo de acondicionamiento.', 'Tendencias de peso y composición si las registras.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- Concurrent Strength + Cardio */
const pcon = {
  id: 'premium-concurrent-strength-cardio', slug: 'concurrent-strength-cardio', name: 'Concurrent Strength + Cardio',
  shortDescription: 'Three strength days and two cardio days a week: get stronger and fitter at the same time.',
  longDescription: 'Strength and endurance in the same week. Three full-body strength sessions use the app’s linear progression on the main lifts; two cardio sessions build steady aerobic work with a little interval work. Keeping hard cardio away from heavy leg days and keeping weekly cardio volume moderate helps both qualities progress. Concurrent training is a general term, not a brand.',
  goalTags: ['conditioning', 'strength', 'recomposition'], level: 'intermediate', daysPerWeek: 5, durationDescription: '4-week blocks, repeated',
  methodType: 'concurrent', sourceType: 'principles', author: { name: 'General concurrent-training concept' },
  evidenceSummary: 'Combining endurance and resistance training can slightly blunt strength or size gains when endurance volume is high (the “interference effect”, e.g. Wilson et al., 2012 meta-analysis); moderate volumes and sensible spacing reduce the problem. The weekly arrangement here is a practical design, not a tested protocol.',
  equipmentRequirements: ['barbell', 'rack', 'bench', 'cardio machine'], progressionModel: 'linear',
  legal: { status: 'none', note: 'Generic training concept.' },
  featured: false, badge: null,
  copy: {
    howItWorks: ['Three strength sessions with linear progression.', 'Two cardio sessions: steady work plus intervals.', 'Hard cardio is kept away from heavy leg sessions.'],
    forWhom: ['You want strength and endurance together.', 'You can train five days a week.', 'You enjoy cardio.'],
    notIdealIf: ['Your only goal is maximum strength.', 'You can only train three days a week.', 'You are prone to overuse injuries and ramp up fast.'],
    tracking: ['Block, week and next session.', 'Strength progress and cardio time.', 'Adherence across five days.'],
  },
  definition: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
    day('strength-1', 'Strength 1', [heavy(ID.squat, 3, 5), heavy(ID.bench, 3, 5), acc(ID.cableRow, 3, 8, 12), acc(ID.legRaise, 2, 10, 15)]),
    day('cardio-1', 'Cardio · steady', [cond(ID.run, 25 + k * 3, { speed: 8, note: 'Steady, conversational effort.' })]),
    day('strength-2', 'Strength 2', [heavy(ID.deadlift, 3, 5), heavy(ID.press, 3, 5), acc(ID.pulldown, 3, 8, 12), acc(ID.lunge, 2, 8, 12)]),
    day('cardio-2', 'Cardio · intervals', [cond(ID.skierg, 20 + k * 2, { note: 'Alternate hard and easy minutes.' })]),
    day('strength-3', 'Strength 3', [heavy(ID.front, 3, 5), heavy(ID.incline, 3, 6), acc(ID.row, 3, 8, 12), acc(ID.crunch, 2, 12, 20)]),
  ] })) },
  es: {
    shortDescription: 'Tres días de fuerza y dos de cardio por semana: más fuerza y mejor forma física a la vez.',
    longDescription: 'Fuerza y resistencia en la misma semana. Tres sesiones de cuerpo completo usan la progresión lineal de la app en los levantamientos principales; dos sesiones de cardio construyen trabajo aeróbico constante con un poco de intervalos. Mantener el cardio intenso lejos de los días pesados de pierna y un volumen semanal moderado de cardio ayuda a que ambas cualidades progresen. El entrenamiento concurrente es un término general, no una marca.',
    durationDescription: 'Bloques de 4 semanas, repetidos',
    evidenceSummary: 'Combinar entrenamiento de resistencia y de fuerza puede atenuar un poco las ganancias de fuerza o tamaño cuando el volumen de resistencia es alto (el «efecto de interferencia», p. ej. el metaanálisis de Wilson et al., 2012); volúmenes moderados y un espaciado sensato reducen el problema. La disposición semanal es un diseño práctico, no un protocolo probado.',
    howItWorks: ['Tres sesiones de fuerza con progresión lineal.', 'Dos sesiones de cardio: trabajo constante e intervalos.', 'El cardio intenso se mantiene lejos de las sesiones pesadas de pierna.'],
    forWhom: ['Quieres fuerza y resistencia juntas.', 'Puedes entrenar cinco días por semana.', 'Disfrutas del cardio.'],
    notIdealIf: ['Tu único objetivo es la máxima fuerza.', 'Solo puedes entrenar tres días por semana.', 'Eres propenso a lesiones por sobreuso y subes rápido.'],
    tracking: ['Bloque, semana y próxima sesión.', 'Progreso de fuerza y tiempo de cardio.', 'Adherencia a lo largo de cinco días.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- Full Body Conditioning */
const pfbc = {
  id: 'premium-full-body-conditioning', slug: 'full-body-conditioning', name: 'Full Body Conditioning',
  shortDescription: 'Three approachable full-body sessions with short rests and a conditioning finish, for general fitness.',
  longDescription: 'A fitness-first program: three full-body sessions with simple movements, moderate loads, short rests and a conditioning finish. It builds work capacity, strength endurance and the habit of training regularly. No maximum tests and no complex percentages. A good starting point if your goal is to feel fitter and healthier.',
  goalTags: ['conditioning', 'health', 'recomposition'], level: 'beginner', daysPerWeek: 3, durationDescription: '4-week blocks, repeated',
  methodType: 'conditioning', sourceType: 'own', author: { name: '2J Fitness Center' },
  evidenceSummary: 'Regular resistance and conditioning work improves strength endurance and general fitness, and public-health guidance recommends both aerobic and muscle-strengthening activity each week. This is an original 2J design for general fitness, not a published protocol.',
  equipmentRequirements: ['dumbbells', 'bench', 'cardio machine'], progressionModel: 'double-progression',
  legal: { status: 'none', note: '2J original.' },
  featured: false, badge: null,
  copy: {
    howItWorks: ['Three full-body sessions with simple movements.', 'Short rests keep the heart rate up.', 'A short conditioning block finishes each session.'],
    forWhom: ['You want to feel fitter and healthier.', 'You are starting or restarting.', 'You can train three days a week.'],
    notIdealIf: ['You want to build maximum strength.', 'You need to follow a medical restriction without supervision.', 'You want a long, structured block.'],
    tracking: ['Block, week and next session.', 'Adherence.', 'Conditioning time.'],
  },
  definition: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
    day('conditioning-a', 'Full body A', [acc(ID.goblet, 3, 10, 15, { rest: 45 }), acc(ID.pushup, 3, 8, 15, { rest: 45 }), acc(ID.dbRow, 3, 10, 15, { rest: 45 }), acc(ID.crunch, 2, 12, 20, { rest: 30 }), cond(ID.run, 8 + k, { speed: 7 })]),
    day('conditioning-b', 'Full body B', [acc(ID.lunge, 3, 10, 12, { rest: 45 }), acc(ID.dbPress, 3, 8, 12, { rest: 45 }), acc(ID.pulldown, 3, 10, 15, { rest: 45 }), acc(ID.legRaise, 2, 10, 15, { rest: 30 }), cond(ID.skierg, 8 + k)]),
    day('conditioning-c', 'Full body C', [acc(ID.thrust, 3, 10, 15, { rest: 45 }), acc(ID.dbBench, 3, 8, 12, { rest: 45 }), acc(ID.cableRow, 3, 10, 15, { rest: 45 }), acc(ID.farmers, 3, 1, 1, { rest: 45, note: 'Walk with control for about 30 seconds.' }), cond(ID.run, 8 + k, { speed: 7 })]),
  ] })) },
  es: {
    shortDescription: 'Tres sesiones accesibles de cuerpo completo con descansos cortos y un final de acondicionamiento, para forma física general.',
    longDescription: 'Un programa centrado en la forma física: tres sesiones de cuerpo completo con movimientos sencillos, cargas moderadas, descansos cortos y un final de acondicionamiento. Construye capacidad de trabajo, resistencia a la fuerza y el hábito de entrenar con regularidad. Sin pruebas de máximos ni porcentajes complejos. Un buen punto de partida si tu objetivo es sentirte más en forma y más sano.',
    durationDescription: 'Bloques de 4 semanas, repetidos',
    evidenceSummary: 'El trabajo regular de fuerza y de acondicionamiento mejora la resistencia a la fuerza y la forma física general, y las guías de salud pública recomiendan actividad aeróbica y de fortalecimiento muscular cada semana. Es un diseño original de 2J para forma física general, no un protocolo publicado.',
    howItWorks: ['Tres sesiones de cuerpo completo con movimientos sencillos.', 'Los descansos cortos mantienen alto el pulso.', 'Un bloque corto de acondicionamiento termina cada sesión.'],
    forWhom: ['Quieres sentirte más en forma y más sano.', 'Estás empezando o volviendo a empezar.', 'Puedes entrenar tres días por semana.'],
    notIdealIf: ['Quieres construir la máxima fuerza.', 'Necesitas seguir una restricción médica sin supervisión.', 'Quieres un bloque largo y estructurado.'],
    tracking: ['Bloque, semana y próxima sesión.', 'Adherencia.', 'Tiempo de acondicionamiento.'],
  },
}

/* ---------------------------------------------------------------------------------------------------------------- the catalogue */
const ORDER = [p531, ptexas, pjug, pgzcl, pphul, pphat, pdup, ppb, pfbh, prec, pcon, pfbc]
const TEXT_KEYS = ['shortDescription', 'longDescription', 'durationDescription', 'evidenceSummary']
const LIST_KEYS = ['howItWorks', 'forWhom', 'notIdealIf', 'tracking']

// Cover photos: scripts/premium/fetch-covers.mjs downloads them into frontend/public/premium/covers and writes covers.json (author, licence, source page).
const COVERS = JSON.parse(readFileSync(new URL('./covers.json', import.meta.url), 'utf8'))

export const OFFICIAL_PROGRAMS = ORDER.map((p, i) => {
  const { definition, es, copy, badge, ...rest } = p
  if (!COVERS[p.slug]) throw new Error('no cover for ' + p.slug)
  return {
    ...rest, ...COVERS[p.slug],
    copy: { howItWorks: copy.howItWorks, forWhom: copy.forWhom, notIdealIf: copy.notIdealIf, tracking: copy.tracking },
    programDefinition: definition,
    locales: { es: Object.fromEntries([...TEXT_KEYS, ...LIST_KEYS].filter(k => es[k]).map(k => [k, es[k]])) },
    badge: badge || null, order: i + 1, version: 1, status: 'published', sourceKind: 'official',
    createdBy: '2j', updatedBy: '2j', createdAt: SEEDED, updatedAt: SEEDED, publishedAt: SEEDED,
  }
})
export const SEED_VERSION = 1
