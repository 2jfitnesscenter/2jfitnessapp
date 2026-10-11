// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Second wave of the official Premium catalogue: 17 programs that ship HIDDEN. The seed carries them so an administrator can review, edit, publish,
 * feature, mark NEW and reorder each one from Administration → Premium; nothing here is visible to members until that happens.
 *
 * Same editorial rules as official-programs.mjs: public principles described in our own words with attribution, no book text, no paid template, no
 * protected table. Names that sound like somebody's trademark carry `legal.status: 'review'` and neutral wording ("inspired by", never "official").
 * Functional / mixed-modal / race programs use DESCRIPTIVE names: no affiliation with any brand, league or event is implied anywhere.
 * Evidence is stated honestly: where there is no controlled study of the method as such, the text says so.
 *
 * Built as a function of the shared helpers (see official-programs.mjs) so the two files never import each other.
 */
export function buildExtras(K) {
  const { ID, LIFTS4, INC_STD, TM_RULE, main, supp, acc, heavy, cond, S, day, weeksOf } = K
  const BIKE = '0003', KB = '0549', ROPE = '2612', THRUSTER = '3305', STEPUP = '0114', BEAR = '3360', BATTLE = '0128'
  const rep = (n, pct, reps, o) => Array.from({ length: n }, () => S(pct, reps, o))
  const r2 = x => Math.round(x * 100) / 100
  const pair = (en, es) => ({ en, es })

  /** One program from compact, paired text. `t` holds [en, es] pairs; `lists` hold arrays of [en, es]. */
  const P = (c) => {
    const en = k => c.t[k][0], es = k => c.t[k][1]
    const list = k => c.lists[k].map(x => x[0]), listEs = k => c.lists[k].map(x => x[1])
    return {
      id: 'premium-' + c.slug, slug: c.slug, name: c.name, status: 'hidden',
      shortDescription: en('short'), longDescription: en('long'),
      goalTags: c.goal, level: c.level, daysPerWeek: c.days, durationDescription: en('dur'),
      methodType: c.method, sourceType: c.source, author: c.author, evidenceSummary: en('evidence'),
      equipmentRequirements: c.equip, progressionModel: c.prog, legal: c.legal, featured: false, badge: null,
      copy: { howItWorks: list('how'), forWhom: list('who'), notIdealIf: list('not'), tracking: list('track') },
      definition: c.def,
      es: { shortDescription: es('short'), longDescription: es('long'), durationDescription: es('dur'), evidenceSummary: es('evidence'),
        howItWorks: listEs('how'), forWhom: listEs('who'), notIdealIf: listEs('not'), tracking: listEs('track') },
    }
  }
  const REVIEW = note => ({ status: 'review', note })
  const NONE = note => ({ status: 'none', note })
  const COMMON_TRACK = [['Cycle, week and next session.', 'Ciclo, semana y próxima sesión.'], ['Adherence and how each session felt.', 'Adherencia y cómo te sentiste en cada sesión.']]

  /* ------------------------------------------------------------------------------------------------ 1 · Linear 5x5 */
  const lin5 = P({
    slug: 'linear-5x5', name: 'Linear 5×5', goal: ['strength'], level: 'beginner', days: 3, method: 'full-body', source: 'established', prog: 'linear',
    author: { name: 'Classic novice linear progression (popularised by Mark Rippetoe, Bill Starr and others)' },
    equip: ['barbell', 'rack', 'bench'], legal: REVIEW('Generic 5×5 linear progression; several commercial programs use similar names. Original description. Confirm naming before promoting.'),
    t: {
      short: ['Three full-body sessions a week, alternating two workouts, five sets of five and a little more weight whenever you complete them.', 'Tres sesiones de cuerpo completo por semana, alternando dos entrenamientos, cinco series de cinco y un poco más de peso cuando las completas.'],
      long: ['Workout A and Workout B alternate on non-consecutive days. The squat is trained every session; bench press and overhead press, and rowing and deadlift, take turns. Each lift is done for five sets of five (the deadlift for one set of five). When you complete all the reps, the app proposes a small increase for next time; when you do not, you repeat the weight. It is a deliberately simple way to learn the main lifts and add strength quickly while you are new to them.', 'El Entrenamiento A y el B se alternan en días no consecutivos. La sentadilla se entrena en todas las sesiones; el press banca y el press militar, y el remo y el peso muerto, se turnan. Cada ejercicio se hace con cinco series de cinco (el peso muerto, una serie de cinco). Cuando completas todas las repeticiones, la app propone una pequeña subida para la próxima vez; si no, repites el peso. Es una forma deliberadamente sencilla de aprender los levantamientos básicos y ganar fuerza rápido mientras eres nuevo en ellos.'],
      dur: ['4-week blocks, repeated', 'Bloques de 4 semanas, repetidos'],
      evidence: ['Linear progression suits beginners because they adapt to almost any sensible stimulus; reviews of periodization show a small advantage of planned variation for trained people (Williams et al., 2017, Sports Medicine; Rhea & Alderman, 2004). No controlled study isolates this program; expect it to stop working within months, at which point a more structured program is the next step.', 'La progresión lineal funciona con principiantes porque se adaptan a casi cualquier estímulo razonable; las revisiones sobre periodización muestran una pequeña ventaja de la variación planificada en personas entrenadas (Williams et al., 2017, Sports Medicine; Rhea y Alderman, 2004). Ningún estudio controlado aísla este programa; es normal que deje de funcionar en pocos meses y entonces conviene pasar a uno más estructurado.'],
    },
    lists: {
      how: [['Alternate Workout A and B, three non-consecutive days a week.', 'Alterna el Entrenamiento A y el B, tres días no consecutivos por semana.'], ['Five sets of five on each lift; complete every rep before adding weight.', 'Cinco series de cinco en cada ejercicio; completa todas las repeticiones antes de añadir peso.'], ['If you miss reps you repeat the weight; technique comes before load.', 'Si no completas las repeticiones repites el peso; la técnica va antes que la carga.']],
      who: [['You are new to barbell training or returning after a long break.', 'Eres nuevo en el entrenamiento con barra o vuelves tras un parón largo.'], ['You want a short, simple plan with clear numbers.', 'Quieres un plan corto y sencillo con números claros.']],
      not: [['You cannot access a barbell, rack and bench.', 'No tienes acceso a barra, rack y banco.'], ['You have a pain or injury that the lifts aggravate: ask a professional first.', 'Tienes un dolor o lesión que los ejercicios agravan: consulta antes con un profesional.']],
      track: [['Weight on every lift, every session.', 'El peso de cada ejercicio, sesión a sesión.'], ...COMMON_TRACK],
    },
    def: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => {
      const a = (key, t) => day(key, t, [heavy(ID.squat, 5, 5, { rest: 180 }), heavy(ID.bench, 5, 5, { rest: 180 }), heavy(ID.pendlay, 5, 5, { rest: 180, role: 'supplemental' })])
      const b = (key, t) => day(key, t, [heavy(ID.squat, 5, 5, { rest: 180 }), heavy(ID.press, 5, 5, { rest: 180 }), heavy(ID.deadlift, 1, 5, { rest: 240, role: 'supplemental' })])
      const first = k % 2 === 0
      return { label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: first ? [a('day-1', 'Workout A'), b('day-2', 'Workout B'), a('day-3', 'Workout A')] : [b('day-1', 'Workout B'), a('day-2', 'Workout A'), b('day-3', 'Workout B')] }
    }) },
  })

  /* ------------------------------------------------------------------------------------------------ 2 · Heavy / Light / Medium */
  const hlm = (() => {
    const ramp = [0.75, 0.80, 0.85, 0.65]
    return P({
      slug: 'heavy-light-medium', name: 'Heavy / Light / Medium', goal: ['strength', 'strength-muscle'], level: 'intermediate', days: 3, method: 'weekly-load', source: 'established', prog: 'training-max-cycle',
      author: { name: 'Bill Starr', work: 'The Strongest Shall Survive (1976) — heavy/light/medium weekly structure' },
      equip: ['barbell', 'rack', 'bench'], legal: REVIEW('Describes a classic weekly structure in our own words. Confirm attribution before promoting.'),
      t: {
        short: ['Three full-body days with a heavy, a light and a medium session, so you train often without grinding every day.', 'Tres días de cuerpo completo con una sesión pesada, una ligera y una media, para entrenar a menudo sin machacarte cada día.'],
        long: ['Each week has a heavy day, a light day and a medium day. On the heavy day the main lifts are loaded as a percentage of your Training Max and rise a little each week; the light day uses lower weights to practise and recover; the medium day sits in between. Week 4 is a deload. After the block 2J proposes a small Training Max increase for you to confirm.', 'Cada semana tiene un día pesado, uno ligero y uno medio. El día pesado, los ejercicios principales se cargan como porcentaje de tu Training Max y suben un poco cada semana; el día ligero usa pesos menores para practicar y recuperar; el medio queda en el punto intermedio. La semana 4 es una descarga. Tras el bloque, 2J propone una pequeña subida del Training Max para que la confirmes.'],
        dur: ['4-week blocks, repeated', 'Bloques de 4 semanas, repetidos'],
        evidence: ['Varying intensity within the week is a long-standing way to manage fatigue; the ACSM position stand on progression models (Ratamess et al., 2009) supports varied loading for trained people. The specific heavy/light/medium arrangement has not been tested against others in controlled trials.', 'Variar la intensidad dentro de la semana es una forma antigua de manejar la fatiga; la declaración de posición del ACSM sobre modelos de progresión (Ratamess et al., 2009) apoya la carga variada en personas entrenadas. La disposición pesado/ligero/medio como tal no se ha comparado con otras en ensayos controlados.'],
      },
      lists: {
        how: [['Heavy day: the week’s hardest sets from your Training Max.', 'Día pesado: las series más duras de la semana desde tu Training Max.'], ['Light day: lower weights, crisp technique, easy recovery.', 'Día ligero: pesos menores, técnica limpia, recuperación fácil.'], ['Medium day: in between. Week 4 is a deload; you confirm the new Training Max.', 'Día medio: intermedio. La semana 4 es una descarga; confirmas el nuevo Training Max.']],
        who: [['You have trained a few months and no longer add weight every session.', 'Llevas varios meses entrenando y ya no puedes añadir peso en cada sesión.'], ['You prefer three days with a clear rhythm.', 'Prefieres tres días con un ritmo claro.']],
        not: [['You are brand new to the lifts.', 'Eres totalmente nuevo en los levantamientos.'], ['You want a bodybuilding split.', 'Quieres una rutina dividida de culturismo.']],
        track: [['Heavy-day loads and whether the week was completed.', 'Cargas del día pesado y si se completó la semana.'], ...COMMON_TRACK],
      },
      def: { schema: 1, cycleWeeks: 4, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE(), weeks: ramp.map((p, k) => ({ label: `Week ${k + 1}${k === 3 ? ' · Deload' : ''}`, phase: k === 3 ? 'Deload' : `Week ${k + 1}`, sessions: [
        day('heavy', 'Heavy day', [main('squat', rep(5, p, 5), { rest: 180 }), main('bench', rep(5, p, 5), { rest: 180 }), acc(ID.pendlay, 3, 6, 8)]),
        day('light', 'Light day', [main('squat', rep(4, r2(p * 0.8), 5), { rest: 120 }), main('press', rep(4, r2(p * 0.85), 5), { rest: 120 }), acc(ID.backExt, 3, 8, 12)]),
        day('medium', 'Medium day', [main('squat', rep(4, r2(p * 0.9), 5), { rest: 150 }), main('bench', rep(4, r2(p * 0.9), 5), { rest: 150 }), supp('deadlift', rep(1, p, 5), { rest: 240 })]),
      ] })) },
    })
  })()

  /* ------------------------------------------------------------------------------------------------ 3 · Conjugate Strength */
  const conj = (() => {
    const me = [[S(0.6, 3), S(0.7, 3), S(0.8, 3), S(0.85, 3)], [S(0.6, 2), S(0.75, 2), S(0.85, 2), S(0.9, 2)], [S(0.6, 1), S(0.75, 1), S(0.85, 1), S(0.9, 1), S(0.95, 1)], [S(0.5, 3), S(0.6, 3), S(0.7, 3)]]
    const wave = [0.5, 0.55, 0.6, 0.45]
    return P({
      slug: 'conjugate-strength', name: 'Conjugate Strength', goal: ['strength'], level: 'advanced', days: 4, method: 'split', source: 'established', prog: 'training-max-cycle',
      author: { name: 'Louie Simmons and Westside Barbell', work: 'Conjugate / max-effort + dynamic-effort method (descriptive use of the term)' },
      equip: ['barbell', 'rack', 'bench', 'cable machine'], legal: REVIEW('“Conjugate” and the max-effort / dynamic-effort split come from a commercial gym’s method. Description is original; confirm naming and attribution before promoting.'),
      t: {
        short: ['Four days: a max-effort and a dynamic-effort day for the lower body and for the upper body each week.', 'Cuatro días: cada semana un día de esfuerzo máximo y uno de esfuerzo dinámico para el tren inferior y otro par para el superior.'],
        long: ['Each week has a max-effort lower day, a max-effort upper day and two dynamic-effort (speed) days. On max-effort days you work up to a heavy set of one to three reps and stop while technique is still good; the app shows the ramp as percentages of your Training Max. On dynamic-effort days you move lighter bar weight fast for many low-rep sets. In the original method the max-effort exercise changes every one to three weeks; here the main lift stays fixed and the notes suggest variations you can swap in with your coach. Week 4 is a deload.', 'Cada semana tiene un día de esfuerzo máximo de tren inferior, otro de tren superior y dos días de esfuerzo dinámico (velocidad). En los días de esfuerzo máximo subes hasta una serie pesada de una a tres repeticiones y paras mientras la técnica sigue siendo buena; la app muestra la rampa como porcentajes de tu Training Max. En los días dinámicos mueves la barra ligera con rapidez en muchas series de pocas repeticiones. En el método original el ejercicio de esfuerzo máximo cambia cada una a tres semanas; aquí el ejercicio principal es fijo y las notas sugieren variantes que puedes cambiar con tu entrenador. La semana 4 es una descarga.'],
        dur: ['4-week blocks, repeated', 'Bloques de 4 semanas, repetidos'],
        evidence: ['No controlled trial has tested the method as a whole. Some of its parts are consistent with research (moving submaximal loads with maximal intent, Wilson et al., 1993; rotating exercise variations), but its claimed advantages come from coaching experience. Max-effort days are demanding: they are for people with solid technique.', 'Ningún ensayo controlado ha probado el método completo. Algunas de sus partes son coherentes con la investigación (mover cargas submáximas con intención máxima, Wilson et al., 1993; rotar variantes de ejercicios), pero sus ventajas proclamadas proceden de la experiencia de entrenadores. Los días de esfuerzo máximo son exigentes: son para personas con buena técnica.'],
      },
      lists: {
        how: [['Max-effort days: work up to a heavy 1–3 rep set, never to failure.', 'Días de esfuerzo máximo: sube hasta una serie pesada de 1–3 repeticiones, nunca al fallo.'], ['Dynamic-effort days: light bar, maximum speed, many short sets.', 'Días de esfuerzo dinámico: barra ligera, velocidad máxima, muchas series cortas.'], ['Week 4 is a deload and you confirm the new Training Max.', 'La semana 4 es una descarga y confirmas el nuevo Training Max.']],
        who: [['You are an experienced lifter with a spotter or safeties.', 'Eres un levantador con experiencia y tienes ayuda o seguros.'], ['You like training heavy and fast in separate sessions.', 'Te gusta entrenar pesado y rápido en sesiones separadas.']],
        not: [['You are a beginner or still unsure of your technique.', 'Eres principiante o dudas de tu técnica.'], ['You train alone without safeties: max-effort singles need a spotter.', 'Entrenas solo sin seguros: las series máximas necesitan ayuda.']],
        track: [['Top set of each max-effort day.', 'La serie principal de cada día de esfuerzo máximo.'], ...COMMON_TRACK],
      },
      def: { schema: 1, cycleWeeks: 4, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE(), weeks: me.map((ramp, k) => ({ label: `Week ${k + 1}${k === 3 ? ' · Deload' : ''}`, phase: k === 3 ? 'Deload' : `Week ${k + 1}`, sessions: [
        day('me-lower', 'Max effort · lower', [main('deadlift', ramp, { rest: 240, note: 'Work up to the top set and stop while technique is still good. A variation (deficit, block pull) can replace it.' }), acc(ID.goodMorning, 3, 5, 8), acc(ID.legCurl, 3, 8, 12), acc(ID.legRaise, 3, 8, 15)]),
        day('de-upper', 'Dynamic effort · upper', [main('bench', rep(k === 3 ? 6 : 9, wave[k], 3), { rest: 60, note: 'Move the bar as fast as you can; every rep crisp.' }), acc(ID.dip, 3, 6, 10), acc(ID.row, 4, 8, 10), acc(ID.pushdown, 3, 10, 15)]),
        day('me-upper', 'Max effort · upper', [main('bench', ramp, { rest: 240, note: 'Work up to the top set; a close-grip or board variation can replace the lift.' }), acc(ID.incline, 3, 6, 10), acc(ID.pulldown, 4, 8, 12), acc(ID.rearDelt, 3, 12, 15)]),
        day('de-lower', 'Dynamic effort · lower', [main('squat', rep(k === 3 ? 6 : 10, wave[k], 2), { rest: 60, note: 'Sit back and drive up fast; stop a set when speed drops.' }), supp('deadlift', rep(k === 3 ? 3 : 6, wave[k], 1), { rest: 60 }), acc(ID.legCurl, 3, 8, 12), acc(ID.crunch, 3, 10, 20)]),
      ] })) },
    })
  })()

  /* ------------------------------------------------------------------------------------------------ 4 · Block periodization */
  const block = (() => {
    const phases = [
      { name: 'Accumulation', range: [0, 4], pct: [0.65, 0.68, 0.70, 0.72], sets: 4, reps: 8, accs: 3 },
      { name: 'Intensification', range: [4, 8], pct: [0.78, 0.80, 0.83, 0.85], sets: 4, reps: 4, accs: 2 },
      { name: 'Realization', range: [8, 11], pct: [0.90, 0.93, 0.96], sets: 3, reps: 2, accs: 1 },
    ]
    const at = k => (k === 11 ? { name: 'Deload', pct: 0.55, sets: 3, reps: 5, accs: 1 } : (() => { const p = phases.find(x => k >= x.range[0] && k < x.range[1]); return { name: p.name, pct: p.pct[k - p.range[0]], sets: p.sets, reps: p.reps, accs: p.accs } })())
    return P({
      slug: 'block-periodization-strength', name: 'Block Periodization Strength', goal: ['strength'], level: 'advanced', days: 4, method: 'percentage-wave', source: 'principles', prog: 'training-max-cycle',
      author: { name: 'Block periodization (Vladimir Issurin; Tudor Bompa on classic periodization)' },
      equip: ['barbell', 'rack', 'bench', 'dumbbells', 'cable machine'], legal: NONE('Generic periodization concept.'),
      t: {
        short: ['Twelve weeks in three blocks — build volume, raise intensity, then express your strength — followed by a deload.', 'Doce semanas en tres bloques —construir volumen, subir la intensidad y expresar la fuerza— seguidas de una descarga.'],
        long: ['Four sessions a week, one per main lift. The first four weeks accumulate work (more sets, moderate weights). The next four intensify (heavier weights, fewer reps). The following three realize: low-volume, high-intensity work that lets the fatigue fall away so you can express your strength. Week 12 is a deload. You can then test your lifts, update your Training Max and start again.', 'Cuatro sesiones por semana, una por ejercicio principal. Las cuatro primeras semanas acumulan trabajo (más series, pesos moderados). Las cuatro siguientes intensifican (pesos más altos, menos repeticiones). Las tres siguientes realizan: trabajo de bajo volumen y alta intensidad que deja caer la fatiga para que puedas expresar tu fuerza. La semana 12 es una descarga. Después puedes probar tus levantamientos, actualizar tu Training Max y empezar otra vez.'],
        dur: ['12 weeks, then a new cycle', '12 semanas y un nuevo ciclo'],
        evidence: ['Block periodization is described by Issurin (Sports Medicine, 2010) mainly for athletes. A controlled study in trained athletes (Bartolomei et al., 2014) found block and traditional models comparable for maximal strength, with some differences in hypertrophy and power. For recreational lifters the main benefit is a clear structure and planned fatigue management, not a proven superiority.', 'La periodización por bloques la describe Issurin (Sports Medicine, 2010), sobre todo para deportistas. Un estudio controlado en atletas entrenados (Bartolomei et al., 2014) halló modelos de bloques y tradicional comparables en fuerza máxima, con algunas diferencias en hipertrofia y potencia. Para quien entrena de forma recreativa el beneficio es una estructura clara y un manejo planificado de la fatiga, no una superioridad demostrada.'],
      },
      lists: {
        how: [['Accumulation (weeks 1–4): more sets at moderate weights.', 'Acumulación (semanas 1–4): más series con pesos moderados.'], ['Intensification (weeks 5–8): heavier, fewer reps.', 'Intensificación (semanas 5–8): más pesado y menos repeticiones.'], ['Realization (weeks 9–11) and a deload in week 12.', 'Realización (semanas 9–11) y descarga en la semana 12.']],
        who: [['You are an experienced lifter with a goal date or a test of your lifts.', 'Eres un levantador con experiencia y una fecha objetivo o una prueba de tus levantamientos.'], ['You can commit to four sessions a week for twelve weeks.', 'Puedes comprometerte con cuatro sesiones por semana durante doce semanas.']],
        not: [['You are new to barbell training.', 'Eres nuevo en el entrenamiento con barra.'], ['You cannot keep a stable weekly schedule.', 'No puedes mantener un horario semanal estable.']],
        track: [['Block, week and the top set of each lift.', 'Bloque, semana y la serie principal de cada ejercicio.'], ...COMMON_TRACK],
      },
      def: { schema: 1, cycleWeeks: 12, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE(), weeks: weeksOf(12, k => {
        const b = at(k)
        const tail = [acc(ID.row, 3, 8, 12), acc(ID.legRaise, 3, 8, 15), acc(ID.lateral, 3, 12, 15)].slice(0, b.accs)
        const mk = (key, title, lift, sets) => day(key, title, [main(lift, rep(sets, b.pct, b.reps), { rest: b.reps <= 4 ? 210 : 150 }), ...tail])
        return { label: `Week ${k + 1} · ${b.name}`, phase: b.name, sessions: [mk('squat', 'Squat day', 'squat', b.sets), mk('bench', 'Bench day', 'bench', b.sets), mk('deadlift', 'Deadlift day', 'deadlift', Math.max(2, b.sets - 1)), mk('press', 'Press day', 'press', b.sets)] }
      }) },
    })
  })()

  /* ------------------------------------------------------------------------------------------------ 5 · DUP Powerbuilding */
  const dupPb = (() => {
    const strength = [0.80, 0.83, 0.86, 0.65], volume = [0.65, 0.67, 0.70, 0.55]
    return P({
      slug: 'dup-powerbuilding', name: 'DUP Powerbuilding', goal: ['strength-muscle', 'strength', 'hypertrophy'], level: 'intermediate', days: 4, method: 'undulating', source: 'principles', prog: 'training-max-cycle',
      author: { name: 'Daily undulating periodization applied to an upper/lower split (Rhea et al., 2002)' },
      equip: ['barbell', 'rack', 'bench', 'dumbbells', 'cable machine'], legal: NONE('Generic training concepts.'),
      t: {
        short: ['Upper/lower four days a week: each movement pattern has a strength day (heavy, low reps) and a muscle day (moderate, higher reps).', 'Tren superior/inferior cuatro días por semana: cada patrón tiene un día de fuerza (pesado, pocas repeticiones) y un día de músculo (moderado, más repeticiones).'],
        long: ['Each week has two upper and two lower sessions. The first of each pair is a strength day: a main lift from your Training Max for four sets of four. The second is a muscle day: the lift at lighter weights for four sets of ten, followed by more accessory volume. Weights rise a little in weeks 1–3 and week 4 is a deload. The load and rep range undulate from session to session; the app proposes a Training Max update after the block.', 'Cada semana tiene dos sesiones de tren superior y dos de inferior. La primera de cada pareja es un día de fuerza: un ejercicio principal desde tu Training Max con cuatro series de cuatro. La segunda es un día de músculo: el ejercicio con pesos más ligeros en cuatro series de diez, seguido de más volumen accesorio. Los pesos suben un poco en las semanas 1–3 y la semana 4 es una descarga. La carga y el rango de repeticiones ondulan de sesión en sesión; la app propone una actualización del Training Max tras el bloque.'],
        dur: ['4-week cycles, repeated', 'Ciclos de 4 semanas, repetidos'],
        evidence: ['Undulating and linear periodization give similar results when volume is matched (Harries et al., 2015; Rhea et al., 2002 found an edge for undulating in one study). Training each muscle about twice a week is supported for hypertrophy (Schoenfeld et al., 2016). This arrangement is a practical design, not a tested protocol.', 'La periodización ondulante y la lineal dan resultados similares cuando se iguala el volumen (Harries et al., 2015; Rhea et al., 2002 hallaron ventaja ondulante en un estudio). Entrenar cada músculo unas dos veces por semana tiene respaldo para la hipertrofia (Schoenfeld et al., 2016). Esta disposición es un diseño práctico, no un protocolo probado.'],
      },
      lists: {
        how: [['Strength days: four sets of four from your Training Max.', 'Días de fuerza: cuatro series de cuatro desde tu Training Max.'], ['Muscle days: lighter weights, four sets of ten, more accessories.', 'Días de músculo: pesos más ligeros, cuatro series de diez y más accesorios.'], ['Week 4 is a deload; you confirm the new Training Max.', 'La semana 4 es una descarga; confirmas el nuevo Training Max.']],
        who: [['You want strength and size together.', 'Quieres fuerza y tamaño a la vez.'], ['You can train four days with a barbell and dumbbells.', 'Puedes entrenar cuatro días con barra y mancuernas.']],
        not: [['You are new to the main lifts.', 'Eres nuevo en los levantamientos principales.'], ['You can only train two or three days.', 'Solo puedes entrenar dos o tres días.']],
        track: [['Strength-day top sets and muscle-day reps.', 'Series principales de los días de fuerza y repeticiones de los de músculo.'], ...COMMON_TRACK],
      },
      def: { schema: 1, cycleWeeks: 4, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE(), weeks: strength.map((p, k) => ({ label: `Week ${k + 1}${k === 3 ? ' · Deload' : ''}`, phase: k === 3 ? 'Deload' : `Week ${k + 1}`, sessions: [
        day('upper-strength', 'Upper · strength', [main('bench', rep(4, p, 4), { rest: 180 }), main('press', rep(3, r2(p - 0.08), 5), { rest: 150 }), acc(ID.pendlay, 4, 5, 8), acc(ID.chinup, 3, 5, 10)]),
        day('lower-strength', 'Lower · strength', [main('squat', rep(4, p, 4), { rest: 180 }), supp('deadlift', rep(2, r2(p - 0.05), 4), { rest: 210 }), acc(ID.legCurl, 3, 8, 12), acc(ID.calf, 3, 10, 15)]),
        day('upper-muscle', 'Upper · muscle', [main('bench', rep(4, volume[k], 10), { rest: 90 }), acc(ID.dbPress, 3, 10, 12), acc(ID.cableRow, 4, 10, 12), acc(ID.lateral, 3, 12, 15), acc(ID.curl, 3, 10, 12), acc(ID.pushdown, 3, 10, 15)]),
        day('lower-muscle', 'Lower · muscle', [main('squat', rep(4, volume[k], 10), { rest: 120 }), acc(ID.rdl, 3, 8, 12), acc(ID.split, 3, 10, 12), acc(ID.legExt, 3, 12, 15), acc(ID.calf, 3, 12, 20)]),
      ] })) },
    })
  })()

  /* ------------------------------------------------------------------------------------------------ 6 · PPL Powerbuilding */
  const ppl = (() => {
    const p = [0.75, 0.78, 0.81, 0.62]
    return P({
      slug: 'ppl-powerbuilding', name: 'PPL Powerbuilding', goal: ['strength-muscle', 'hypertrophy'], level: 'intermediate', days: 6, method: 'split', source: 'principles', prog: 'training-max-cycle',
      author: { name: 'Push / pull / legs split with a strength-based first lift' },
      equip: ['barbell', 'rack', 'bench', 'dumbbells', 'cable machine', 'pull-up bar'], legal: NONE('Generic training split.'),
      t: {
        short: ['Six days of push, pull and legs, repeated twice a week: one heavy compound lift first, then hypertrophy work.', 'Seis días de empuje, tirón y pierna, repetidos dos veces por semana: primero un ejercicio compuesto pesado y después trabajo de hipertrofia.'],
        long: ['Each muscle group is trained twice a week. The first lift of every session (bench, deadlift, squat, then press, pull-ups and front squat variations) is loaded from your Training Max; the rest of the session uses moderate reps (8–15) with double progression. Day A leans toward strength, day B toward volume. Weights rise a little in weeks 1–3 and week 4 is a deload. This is a high-frequency plan: it only works if you can sleep, eat and recover for six days of training.', 'Cada grupo muscular se entrena dos veces por semana. El primer ejercicio de cada sesión (banca, peso muerto, sentadilla y luego press, dominadas y sentadilla frontal) se carga desde tu Training Max; el resto usa repeticiones moderadas (8–15) con doble progresión. El día A se inclina a la fuerza y el B al volumen. Los pesos suben un poco en las semanas 1–3 y la semana 4 es una descarga. Es un plan de alta frecuencia: solo funciona si puedes dormir, comer y recuperarte durante seis días de entrenamiento.'],
        dur: ['4-week cycles, repeated', 'Ciclos de 4 semanas, repetidos'],
        evidence: ['Training each muscle at least twice a week gives a small hypertrophy advantage over once a week when volume is matched (Schoenfeld et al., 2016), and higher frequencies mainly help strength through extra volume (Grgic et al., 2018). The split itself is a convention; six days is more than most people need.', 'Entrenar cada músculo al menos dos veces por semana da una pequeña ventaja en hipertrofia frente a una vez cuando se iguala el volumen (Schoenfeld et al., 2016), y las frecuencias altas ayudan sobre todo a la fuerza por el volumen adicional (Grgic et al., 2018). La división es una convención; seis días son más de los que la mayoría necesita.'],
      },
      lists: {
        how: [['Push, pull and legs, twice a week.', 'Empuje, tirón y pierna, dos veces por semana.'], ['First lift from your Training Max; accessories by double progression.', 'Primer ejercicio desde tu Training Max; accesorios con doble progresión.'], ['Week 4 is a deload; you confirm the new Training Max.', 'La semana 4 es una descarga; confirmas el nuevo Training Max.']],
        who: [['You enjoy long, frequent training and recover well.', 'Disfrutas de entrenar mucho y con frecuencia y te recuperas bien.'], ['You can train six days a week.', 'Puedes entrenar seis días por semana.']],
        not: [['You have limited time or high stress outside the gym.', 'Tienes poco tiempo o mucho estrés fuera del gimnasio.'], ['You are new to training.', 'Eres nuevo en el entrenamiento.']],
        track: [['Top set of each first lift.', 'La serie principal del primer ejercicio de cada día.'], ...COMMON_TRACK],
      },
      def: { schema: 1, cycleWeeks: 4, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE(), weeks: p.map((x, k) => ({ label: `Week ${k + 1}${k === 3 ? ' · Deload' : ''}`, phase: k === 3 ? 'Deload' : `Week ${k + 1}`, sessions: [
        day('push-a', 'Push A', [main('bench', rep(4, x, 5), { rest: 180 }), acc(ID.incline, 3, 8, 12), acc(ID.lateral, 3, 12, 15), acc(ID.pushdown, 3, 10, 15)]),
        day('pull-a', 'Pull A', [main('deadlift', rep(3, x, 5), { rest: 210 }), acc(ID.pulldown, 3, 8, 12), acc(ID.cableRow, 3, 8, 12), acc(ID.curl, 3, 10, 12)]),
        day('legs-a', 'Legs A', [main('squat', rep(4, x, 5), { rest: 180 }), acc(ID.legPress, 3, 10, 15), acc(ID.legCurl, 3, 10, 15), acc(ID.calf, 3, 10, 15)]),
        day('push-b', 'Push B', [main('press', rep(4, r2(x - 0.1), 6), { rest: 150 }), acc(ID.dbBench, 3, 8, 12), acc(ID.fly, 3, 12, 15), acc(ID.skull, 3, 10, 12)]),
        day('pull-b', 'Pull B', [acc(ID.chinup, 4, 5, 10, { role: 'main', rest: 150 }), acc(ID.dbRow, 3, 8, 12), acc(ID.rearDelt, 3, 12, 15), acc(ID.hammer, 3, 10, 12)]),
        day('legs-b', 'Legs B', [acc(ID.front, 4, 5, 8, { role: 'main', rest: 180 }), acc(ID.rdl, 3, 8, 12), acc(ID.split, 3, 8, 12), acc(ID.legExt, 3, 12, 15), acc(ID.calf, 3, 12, 20)]),
      ] })) },
    })
  })()

  /* ------------------------------------------------------------------------------------------------ 7 · High Frequency Strength */
  const hfs = (() => {
    const w = [0.78, 0.80, 0.82, 0.62]
    return P({
      slug: 'high-frequency-strength', name: 'High Frequency Strength', goal: ['strength'], level: 'advanced', days: 5, method: 'split', source: 'principles', prog: 'training-max-cycle',
      author: { name: 'High-frequency practice of the main lifts (see Grgic et al., 2018; Zourdos et al., 2016)' },
      equip: ['barbell', 'rack', 'bench', 'pull-up bar'], legal: NONE('Generic training concept.'),
      t: {
        short: ['Five days a week where you squat, bench and press almost every session at moderate weights, practising the lifts often.', 'Cinco días por semana en los que haces sentadilla, banca y press casi en cada sesión con pesos moderados, practicando los levantamientos con frecuencia.'],
        long: ['The idea is to practise the competition-style lifts frequently without ever training to failure: each lift appears two to four times a week at 75–85 % of your Training Max, in short sets of two to five reps. Total weekly volume rises a little over three weeks and falls in week 4. It demands good technique, good sleep and honest self-regulation: if a day feels bad, the plan expects you to do less, not to push through.', 'La idea es practicar con frecuencia los levantamientos de competición sin entrenar nunca al fallo: cada ejercicio aparece de dos a cuatro veces por semana al 75–85 % de tu Training Max, en series cortas de dos a cinco repeticiones. El volumen semanal sube un poco durante tres semanas y baja en la semana 4. Exige buena técnica, buen sueño y autorregulación honesta: si un día te sientes mal, el plan espera que hagas menos, no que fuerces.'],
        dur: ['4-week cycles, repeated', 'Ciclos de 4 semanas, repetidos'],
        evidence: ['Meta-analyses suggest higher frequencies do not by themselves increase strength once volume is equal, but they let you distribute that volume (Grgic et al., 2018); a study in powerlifters found good results from a high-frequency undulating model (Zourdos et al., 2016). Not suitable for everyone: the injury and fatigue risk rises if recovery is poor.', 'Los metaanálisis sugieren que las frecuencias altas no aumentan por sí solas la fuerza si el volumen es igual, pero permiten repartirlo (Grgic et al., 2018); un estudio en powerlifters halló buenos resultados con un modelo ondulante de alta frecuencia (Zourdos et al., 2016). No es para todos: el riesgo de lesión y de fatiga sube si la recuperación es mala.'],
      },
      lists: {
        how: [['Short, crisp sets at 75–85 % of your Training Max, never to failure.', 'Series cortas y limpias al 75–85 % de tu Training Max, nunca al fallo.'], ['Squat, bench and press appear on several days each week.', 'Sentadilla, banca y press aparecen varios días cada semana.'], ['Week 4 reduces volume; you confirm the new Training Max.', 'La semana 4 reduce el volumen; confirmas el nuevo Training Max.']],
        who: [['You are an experienced lifter with solid technique.', 'Eres un levantador con experiencia y buena técnica.'], ['You can train five days and sleep well.', 'Puedes entrenar cinco días y dormir bien.']],
        not: [['You are new to lifting or under heavy life stress.', 'Eres nuevo en el entrenamiento o tienes mucho estrés vital.'], ['You have joint pain that frequent loading aggravates.', 'Tienes dolor articular que la carga frecuente agrava.']],
        track: [['Reps in reserve each session (honest effort).', 'Repeticiones en reserva en cada sesión (esfuerzo real).'], ...COMMON_TRACK],
      },
      def: { schema: 1, cycleWeeks: 4, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE(), weeks: w.map((p, k) => ({ label: `Week ${k + 1}${k === 3 ? ' · Deload' : ''}`, phase: k === 3 ? 'Deload' : `Week ${k + 1}`, sessions: [
        day('d1', 'Day 1 · Squat + Bench', [main('squat', rep(5, p, 3), { rest: 150 }), main('bench', rep(5, p, 3), { rest: 150 }), acc(ID.chinup, 3, 5, 8)]),
        day('d2', 'Day 2 · Deadlift + Press', [main('deadlift', rep(3, p, 3), { rest: 210 }), main('press', rep(4, r2(p - 0.05), 4), { rest: 150 }), acc(ID.cableRow, 3, 8, 12)]),
        day('d3', 'Day 3 · Squat + Bench (light)', [main('squat', rep(3, r2(p - 0.08), 5), { rest: 120 }), main('bench', rep(4, r2(p - 0.08), 5), { rest: 120 }), acc(ID.row, 3, 8, 10)]),
        day('d4', 'Day 4 · Press + Deadlift', [main('press', rep(5, p, 3), { rest: 150 }), supp('deadlift', rep(2, r2(p - 0.08), 5), { rest: 180 }), acc(ID.pulldown, 3, 8, 12)]),
        day('d5', 'Day 5 · Squat + Bench (heavy)', [main('squat', rep(3, r2(p + 0.06), 2), { rest: 210 }), main('bench', rep(3, r2(p + 0.06), 2), { rest: 210 }), acc(ID.legRaise, 3, 8, 15)]),
      ] })) },
    })
  })()

  /* ------------------------------------------------------------------------------------------------ 8 · Progressive Load Hypertrophy (HST-style) */
  const hst = (() => {
    const mesos = [{ reps: 15, base: 0.50 }, { reps: 10, base: 0.62 }, { reps: 5, base: 0.78 }]
    return P({
      slug: 'hst-style-hypertrophy', name: 'Progressive Load Hypertrophy', goal: ['hypertrophy'], level: 'intermediate', days: 3, method: 'full-body', source: 'established', prog: 'training-max-cycle',
      author: { name: 'Inspired by Bryan Haycock’s HST ideas (progressive load, frequent stimulation)' },
      equip: ['barbell', 'rack', 'bench', 'dumbbells', 'cable machine'], legal: REVIEW('Inspired by a commercially named method (HST). Neutral name used; do not describe it as official HST. Confirm before promoting.'),
      t: {
        short: ['Three full-body days where the weight rises a little every session, moving from 15 to 10 to 5 reps over six weeks.', 'Tres días de cuerpo completo donde el peso sube un poco en cada sesión, pasando de 15 a 10 y a 5 repeticiones durante seis semanas.'],
        long: ['Six weeks in three two-week mesocycles. In each one the reps are fixed (15, then 10, then 5) and the weight goes up a small step every session, so the muscles always face a slightly new load. Every muscle is trained three times a week with two sets per exercise. After the 5-rep block, 2J proposes an update of your Training Max for you to confirm. This is an inspired-by design in our own words; it is not the official method.', 'Seis semanas en tres mesociclos de dos semanas. En cada uno las repeticiones son fijas (15, luego 10 y luego 5) y el peso sube un pequeño paso en cada sesión, de modo que el músculo siempre se enfrenta a una carga algo nueva. Cada músculo se entrena tres veces por semana con dos series por ejercicio. Tras el bloque de 5 repeticiones, 2J propone actualizar tu Training Max para que lo confirmes. Es un diseño inspirado en las ideas del método, descrito con nuestras palabras; no es el método oficial.'],
        dur: ['6-week cycles, repeated', 'Ciclos de 6 semanas, repetidos'],
        evidence: ['Muscle growth occurs across a wide range of loads when sets are taken close to failure (Schoenfeld et al., 2017), and training each muscle about three times a week is a reasonable frequency (Schoenfeld et al., 2016). Whether raising load every session is better than other progressions is not established.', 'El crecimiento muscular ocurre con un amplio rango de cargas cuando las series se acercan al fallo (Schoenfeld et al., 2017), y entrenar cada músculo unas tres veces por semana es una frecuencia razonable (Schoenfeld et al., 2016). No está demostrado que subir la carga en cada sesión sea mejor que otras progresiones.'],
      },
      lists: {
        how: [['Fixed reps per two-week block: 15, then 10, then 5.', 'Repeticiones fijas por bloque de dos semanas: 15, luego 10 y luego 5.'], ['The weight rises a small step every session.', 'El peso sube un pequeño paso en cada sesión.'], ['You confirm the new Training Max when the cycle ends.', 'Confirmas el nuevo Training Max cuando termina el ciclo.']],
        who: [['You want muscle growth and like a clear, fixed rhythm.', 'Quieres crecimiento muscular y te gusta un ritmo claro y fijo.'], ['You can train three non-consecutive days.', 'Puedes entrenar tres días no consecutivos.']],
        not: [['You are new to lifting and do not know your working weights yet.', 'Eres nuevo en el entrenamiento y aún no conoces tus pesos de trabajo.'], ['You dislike 15-rep sets.', 'No te gustan las series de 15 repeticiones.']],
        track: [['Weight on each lift every session.', 'El peso de cada ejercicio en cada sesión.'], ...COMMON_TRACK],
      },
      def: { schema: 1, cycleWeeks: 6, referenceLabel: 'Training Max', lifts: LIFTS4, progression: TM_RULE(), weeks: weeksOf(6, k => {
        const m = mesos[Math.floor(k / 2)]
        const at = i => r2(m.base + 0.02 * ((k % 2) * 3 + i))
        return { label: `Week ${k + 1} · ${m.reps}s`, phase: `${m.reps}-rep block`, sessions: [
          day('full-a', 'Full body A', [main('squat', rep(2, at(0), m.reps), { rest: 120 }), main('bench', rep(2, at(0), m.reps), { rest: 120 }), acc(ID.pulldown, 2, m.reps, m.reps + 2), acc(ID.curl, 2, 10, 15)]),
          day('full-b', 'Full body B', [main('deadlift', rep(2, at(1), m.reps), { rest: 150 }), main('press', rep(2, r2(at(1) - 0.1), m.reps), { rest: 120 }), acc(ID.cableRow, 2, m.reps, m.reps + 2), acc(ID.pushdown, 2, 10, 15)]),
          day('full-c', 'Full body C', [main('squat', rep(2, at(2), m.reps), { rest: 120 }), main('bench', rep(2, at(2), m.reps), { rest: 120 }), acc(ID.dbRow, 2, m.reps, m.reps + 2), acc(ID.lateral, 2, 12, 15)]),
        ] }
      }) },
    })
  })()

  /* ------------------------------------------------------------------------------------------------ 9 · BFR */
  const bfrNote = 'Light load with the cuff: 30-15-15-15 reps, 30 seconds rest. Moderate pressure only; take the cuff off at the end of the exercise and stop if you feel numbness, tingling or pain.'
  const bfr = (() => {
    const bfrSet = (ex, extra = {}) => acc(ex, 4, 15, 30, { rest: 30, note: bfrNote, ...extra })
    return P({
      slug: 'bfr-hypertrophy', name: 'Blood Flow Restriction Hypertrophy', goal: ['hypertrophy'], level: 'intermediate', days: 4, method: 'split', source: 'principles', prog: 'double-progression',
      author: { name: 'Blood flow restriction (BFR) training — see Patterson et al., 2019; Lixandrão et al., 2018' },
      equip: ['dumbbells', 'cable machine', 'leg press', 'BFR cuffs'], legal: NONE('Generic training technique. Needs proper cuffs and a professional’s guidance.'),
      t: {
        short: ['Four days of upper and lower training that add light-load sets with blood flow restriction cuffs for the arms and legs. Needs proper equipment and guidance.', 'Cuatro días de tren superior e inferior que añaden series con carga ligera y manguitos de restricción del flujo sanguíneo en brazos y piernas. Requiere material adecuado y supervisión.'],
        long: ['Each session starts with a normal compound exercise and then moves to isolation work done with cuffs: very light loads (about 20–30 % of your maximum) in a 30-15-15-15 rep scheme with short rests. The method can build muscle with light loads, which is useful when heavy training is not possible, and it is only appropriate with cuffs made for the purpose and moderate pressure. It is not a replacement for heavy training. Anyone with a health condition should speak to a professional before using it.', 'Cada sesión empieza con un ejercicio compuesto normal y sigue con trabajo de aislamiento con manguitos: cargas muy ligeras (alrededor del 20–30 % de tu máximo) en un esquema de 30-15-15-15 repeticiones con descansos cortos. El método puede construir músculo con cargas ligeras, útil cuando no se puede entrenar pesado, y solo es adecuado con manguitos fabricados para ello y presión moderada. No sustituye al entrenamiento pesado. Quien tenga una condición de salud debe consultar a un profesional antes de usarlo.'],
        dur: ['4-week blocks, repeated', 'Bloques de 4 semanas, repetidos'],
        evidence: ['A meta-analysis found low-load resistance training with BFR produces greater hypertrophy than low load alone, and similar strength gains to heavy training only in some cases (Lixandrão et al., 2018). The consensus on safety and method is in Patterson et al. (Frontiers in Physiology, 2019): correct cuff width and pressure are essential, and it is not suitable for people with clotting, cardiovascular or similar conditions without medical advice.', 'Un metaanálisis halló que el entrenamiento de fuerza con carga baja y BFR produce más hipertrofia que la carga baja sola, y ganancias de fuerza similares al entrenamiento pesado solo en algunos casos (Lixandrão et al., 2018). El consenso sobre seguridad y método está en Patterson et al. (Frontiers in Physiology, 2019): el ancho del manguito y la presión correcta son esenciales, y no es adecuado sin consejo médico en personas con problemas de coagulación, cardiovasculares o similares.'],
      },
      lists: {
        how: [['A normal compound exercise first, then light isolation sets with cuffs.', 'Primero un ejercicio compuesto normal y luego series ligeras de aislamiento con manguitos.'], ['30-15-15-15 reps, 30 seconds of rest, moderate pressure.', '30-15-15-15 repeticiones, 30 segundos de descanso y presión moderada.'], ['Remove the cuff after each exercise and stop at the first sign of pain, numbness or tingling.', 'Quita el manguito después de cada ejercicio y para ante cualquier dolor, entumecimiento u hormigueo.']],
        who: [['You have cuffs made for BFR and have been shown how to use them.', 'Tienes manguitos fabricados para BFR y te han enseñado a usarlos.'], ['You want to add muscle with light loads (for example around a joint issue).', 'Quieres ganar músculo con cargas ligeras (por ejemplo, alrededor de un problema articular).']],
        not: [['You have heart or circulation problems, clotting issues, high blood pressure, are pregnant or have had recent surgery or a recent fracture.', 'Tienes problemas de corazón o circulación, de coagulación, hipertensión, estás embarazada o has tenido una cirugía o fractura recientes.'], ['You do not have proper cuffs. Do not improvise with ropes or bands.', 'No tienes manguitos adecuados. No improvises con cuerdas ni bandas.']],
        track: [['Whether the session felt safe and the cuff pressure you used.', 'Si la sesión te pareció segura y la presión del manguito que usaste.'], ...COMMON_TRACK],
      },
      def: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
        day('upper-a', 'Upper A', [acc(ID.dbPress, 3, 8, 10, { role: 'main' }), acc(ID.cableRow, 3, 8, 10), bfrSet(ID.curl), bfrSet(ID.pushdown)]),
        day('lower-a', 'Lower A', [acc(ID.legPress, 3, 8, 10, { role: 'main' }), acc(ID.rdl, 3, 8, 10), bfrSet(ID.legExt), bfrSet(ID.calf)]),
        day('upper-b', 'Upper B', [acc(ID.pulldown, 3, 8, 10, { role: 'main' }), acc(ID.incline, 3, 8, 10), bfrSet(ID.lateral), bfrSet(ID.hammer)]),
        day('lower-b', 'Lower B', [acc(ID.split, 3, 8, 10, { role: 'main' }), acc(ID.thrust, 3, 8, 10), bfrSet(ID.legCurl), bfrSet(ID.calf)]),
      ] })) },
    })
  })()

  /* ------------------------------------------------------------------------------------------------ 10 · Polarized Endurance */
  const pol = P({
    slug: 'polarized-endurance', name: 'Polarized Endurance', goal: ['conditioning'], level: 'intermediate', days: 5, method: 'conditioning', source: 'principles', prog: 'none',
    author: { name: 'Polarized training intensity distribution (Stephen Seiler; Seiler & Kjerland, 2006)' },
    equip: ['cardio machine'], legal: NONE('Generic training concept.'),
    t: {
      short: ['Five endurance days: most of the work easy, a little very hard — about 80 % easy and 20 % hard.', 'Cinco días de resistencia: la mayor parte del trabajo fácil y un poco muy duro, aproximadamente 80 % fácil y 20 % duro.'],
      long: ['A polarized week mixes long, truly easy sessions (you can hold a conversation) with two sessions of hard intervals (about 4 minutes hard, 3–4 minutes easy). There is very little time at moderate “grey zone” effort. Durations rise gradually over four weeks. Use whatever you prefer for the easy days: running, a bike, a machine. Easy means easy: if you cannot talk, slow down.', 'Una semana polarizada combina sesiones largas y realmente fáciles (puedes mantener una conversación) con dos sesiones de intervalos duros (unos 4 minutos duros y 3–4 fáciles). Hay muy poco tiempo en esfuerzo moderado o «zona gris». Las duraciones suben poco a poco durante cuatro semanas. Usa lo que prefieras en los días fáciles: correr, bici o máquina. Fácil significa fácil: si no puedes hablar, baja el ritmo.'],
      dur: ['4-week blocks, repeated', 'Bloques de 4 semanas, repetidos'],
      evidence: ['Observational work on elite athletes shows most train about 80 % at low intensity and 20 % at high intensity (Seiler & Kjerland, 2006; Seiler, 2010). A controlled study in trained cyclists/runners found polarized training improved key endurance variables more than threshold-heavy training (Stöggl & Sperlich, 2014), though results vary between studies.', 'Estudios observacionales en atletas de élite muestran que la mayoría entrena alrededor del 80 % a baja intensidad y 20 % a alta (Seiler y Kjerland, 2006; Seiler, 2010). Un estudio controlado en deportistas entrenados halló que el entrenamiento polarizado mejoraba variables clave de resistencia más que el centrado en el umbral (Stöggl y Sperlich, 2014), aunque los resultados varían entre estudios.'],
    },
    lists: {
      how: [['Three easy sessions at conversation pace.', 'Tres sesiones fáciles a ritmo de conversación.'], ['Two interval sessions: 4 minutes hard, 3–4 minutes easy.', 'Dos sesiones de intervalos: 4 minutos duros y 3–4 fáciles.'], ['Duration builds gradually over four weeks.', 'La duración aumenta poco a poco durante cuatro semanas.']],
      who: [['You want to improve aerobic fitness for running, cycling or general endurance.', 'Quieres mejorar la forma aeróbica para correr, pedalear o resistencia general.'], ['You can train five days a week.', 'Puedes entrenar cinco días por semana.']],
      not: [['You have a heart condition or have not been cleared for hard efforts.', 'Tienes una condición cardíaca o no te han autorizado a hacer esfuerzos duros.'], ['You want to build strength; add a strength program alongside.', 'Quieres ganar fuerza; añade un programa de fuerza.']],
      track: [['Minutes done and how easy the easy days felt.', 'Minutos hechos y qué fáciles se sintieron los días fáciles.'], ...COMMON_TRACK],
    },
    def: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
      day('easy-1', 'Easy 1', [cond(ID.run, 30 + k * 4, { speed: 8, note: 'Conversation pace (zone 1–2). If you cannot talk, slow down.' })]),
      day('hard-1', 'Intervals 1', [cond(BIKE, 8, { note: 'Warm-up, easy.' }), cond(ID.run, 16 + k * 2, { note: 'Intervals of 4 minutes hard (about 9 out of 10), 3–4 minutes easy between. Build from 3 to 5 intervals across the block.' }), cond(BIKE, 6, { note: 'Cool-down, easy.' })]),
      day('easy-2', 'Easy 2', [cond(BIKE, 40 + k * 5, { note: 'Conversation pace.' })]),
      day('hard-2', 'Intervals 2', [cond(ID.skierg, 8, { note: 'Warm-up, easy.' }), cond(ID.skierg, 16 + k * 2, { note: 'Intervals of 4 minutes hard (about 9 out of 10), 3–4 minutes easy between. Build from 3 to 5 intervals across the block.' }), cond(ID.skierg, 6, { note: 'Cool-down, easy.' })]),
      day('long', 'Long easy', [cond(ID.run, 50 + k * 6, { speed: 8, note: 'The longest session of the week, truly easy.' })]),
    ] })) },
  })

  /* ------------------------------------------------------------------------------------------------ 11 · Threshold Builder */
  const thr = P({
    slug: 'threshold-builder', name: 'Threshold Builder', goal: ['conditioning'], level: 'intermediate', days: 4, method: 'conditioning', source: 'principles', prog: 'none',
    author: { name: 'Threshold (tempo and cruise-interval) training, a long-standing endurance method' },
    equip: ['cardio machine'], legal: NONE('Generic training concept.'),
    t: {
      short: ['Four days built around sustained “comfortably hard” work near your threshold, with easy days to recover.', 'Cuatro días construidos en torno a un trabajo sostenido «cómodamente duro» cerca de tu umbral, con días fáciles para recuperar.'],
      long: ['Two sessions a week are threshold work: cruise intervals (repeats of 6–10 minutes at a strong, steady effort with one minute of rest) and one continuous tempo. Two others are easy running or cycling. The time at threshold grows over four weeks. Threshold effort is “comfortably hard”: you can say short phrases but not hold a conversation. Do not turn easy days into hard ones.', 'Dos sesiones por semana son trabajo de umbral: intervalos «crucero» (repeticiones de 6–10 minutos a un esfuerzo fuerte y estable con un minuto de descanso) y un tempo continuo. Otras dos son carrera o bici fáciles. El tiempo en umbral crece durante cuatro semanas. El esfuerzo de umbral es «cómodamente duro»: puedes decir frases cortas pero no mantener una conversación. No conviertas los días fáciles en duros.'],
      dur: ['4-week blocks, repeated', 'Bloques de 4 semanas, repetidos'],
      evidence: ['Threshold training reliably improves endurance performance, but studies of training-intensity distribution suggest a mostly easy week with a smaller dose of hard work does at least as well (Seiler, 2010; Esteve-Lanao et al., 2007). Threshold work is best used in moderation, especially when time is short.', 'El entrenamiento de umbral mejora de forma fiable el rendimiento de resistencia, pero los estudios sobre distribución de intensidades sugieren que una semana mayormente fácil con una dosis menor de trabajo duro funciona al menos igual de bien (Seiler, 2010; Esteve-Lanao et al., 2007). El trabajo de umbral se usa mejor con moderación, sobre todo si hay poco tiempo.'],
    },
    lists: {
      how: [['Two threshold sessions: cruise intervals and a continuous tempo.', 'Dos sesiones de umbral: intervalos crucero y un tempo continuo.'], ['Two easy sessions in between.', 'Dos sesiones fáciles entre medias.'], ['Time at threshold grows over four weeks.', 'El tiempo en umbral crece durante cuatro semanas.']],
      who: [['You can already run or ride for 30–40 minutes comfortably.', 'Ya puedes correr o pedalear 30–40 minutos con comodidad.'], ['You race 10 km to half marathon or want a strong steady engine.', 'Compites de 10 km a media maratón o quieres un motor fuerte y estable.']],
      not: [['You are new to endurance training.', 'Eres nuevo en el entrenamiento de resistencia.'], ['You are recovering from an injury or illness.', 'Te estás recuperando de una lesión o enfermedad.']],
      track: [['Minutes at threshold and how repeatable the effort felt.', 'Minutos en umbral y qué tan repetible se sintió el esfuerzo.'], ...COMMON_TRACK],
    },
    def: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
      day('easy-1', 'Easy 1', [cond(ID.run, 30 + k * 3, { speed: 8, note: 'Truly easy: you can hold a conversation.' })]),
      day('cruise', 'Cruise intervals', [cond(ID.run, 10, { note: 'Warm-up, easy.' }), cond(ID.run, 18 + k * 4, { note: 'Repeats of 6–10 minutes at threshold effort, one minute easy between. Start with 2–3 repeats and add time week by week.' }), cond(ID.run, 8, { note: 'Cool-down, easy.' })]),
      day('easy-2', 'Easy 2', [cond(BIKE, 35 + k * 4, { note: 'Easy spin or ride.' })]),
      day('tempo', 'Tempo', [cond(ID.run, 10, { note: 'Warm-up, easy.' }), cond(ID.run, 18 + k * 3, { note: 'One continuous block at threshold effort.' }), cond(ID.run, 8, { note: 'Cool-down, easy.' })]),
    ] })) },
  })

  /* ------------------------------------------------------------------------------------------------ 12 · Aerobic Base + Intervals */
  const base = P({
    slug: 'aerobic-base-intervals', name: 'Aerobic Base + Intervals', goal: ['conditioning', 'health'], level: 'beginner', days: 4, method: 'conditioning', source: 'principles', prog: 'none',
    author: { name: 'Base-then-intervals structure (Arthur Lydiard; Laursen & Buchheit, 2019)' },
    equip: ['cardio machine'], legal: NONE('Generic training concept.'),
    t: {
      short: ['Eight weeks: first build an easy aerobic base, then add a weekly interval session once the base is in place.', 'Ocho semanas: primero construye una base aeróbica fácil y después añade una sesión semanal de intervalos cuando la base ya está.'],
      long: ['Weeks 1–6 are mostly easy aerobic work, increasing duration gradually with one short, light session of strides or hills once a week. In weeks 7–8 one of the sessions becomes a proper interval workout (4 × 4 minutes hard). The long session grows by about 10 % a week. Choose running, cycling or a machine for each session. It is a good starting point for people who are new to endurance or returning to it.', 'Las semanas 1–6 son sobre todo trabajo aeróbico fácil, aumentando poco a poco la duración con una sesión corta y ligera de progresiones o cuestas una vez por semana. En las semanas 7–8 una de las sesiones pasa a ser un entrenamiento de intervalos propiamente dicho (4 × 4 minutos duros). La sesión larga crece cerca de un 10 % por semana. Elige correr, bici o máquina en cada sesión. Es un buen punto de partida para quien empieza en resistencia o la retoma.'],
      dur: ['8 weeks, then repeat or progress', '8 semanas y después repetir o progresar'],
      evidence: ['A foundation of low-intensity volume supports the adaptations that high-intensity work then builds on (Seiler, 2010); interval training is a time-efficient way to raise aerobic capacity once a base exists (Buchheit & Laursen, 2013; Laursen & Buchheit, 2019). The exact split between base and intervals is a judgement, not a tested ratio.', 'Una base de volumen de baja intensidad respalda las adaptaciones sobre las que luego se construye el trabajo intenso (Seiler, 2010); el entrenamiento por intervalos es una forma eficiente de subir la capacidad aeróbica cuando ya existe una base (Buchheit y Laursen, 2013; Laursen y Buchheit, 2019). La proporción exacta entre base e intervalos es un criterio, no una relación probada.'],
    },
    lists: {
      how: [['Weeks 1–6: easy aerobic work with a slow build.', 'Semanas 1–6: trabajo aeróbico fácil con una subida lenta.'], ['One light session a week of strides or gentle hills.', 'Una sesión ligera por semana de progresiones o cuestas suaves.'], ['Weeks 7–8: one proper interval session of 4 × 4 minutes.', 'Semanas 7–8: una sesión de intervalos de 4 × 4 minutos.']],
      who: [['You are starting or returning to endurance training.', 'Empiezas o retomas el entrenamiento de resistencia.'], ['You prefer a gradual build.', 'Prefieres una subida gradual.']],
      not: [['You already train hard intervals every week.', 'Ya haces intervalos duros cada semana.'], ['You have not been cleared for hard efforts (heart or other conditions).', 'No te han autorizado a hacer esfuerzos duros (corazón u otras condiciones).']],
      track: [['Weekly minutes and the long-session time.', 'Minutos semanales y el tiempo de la sesión larga.'], ...COMMON_TRACK],
    },
    def: { schema: 1, cycleWeeks: 8, weeks: weeksOf(8, k => {
      const intervals = k >= 6
      return { label: `Week ${k + 1}${intervals ? ' · Intervals' : ' · Base'}`, phase: intervals ? 'Intervals' : 'Base', sessions: [
        day('easy-1', 'Easy 1', [cond(ID.run, 25 + k * 3, { speed: 7.5, note: 'Easy, conversation pace.' })]),
        day('light', intervals ? 'Intervals' : 'Strides', intervals
          ? [cond(BIKE, 8, { note: 'Warm-up, easy.' }), cond(BIKE, 20 + (k - 6) * 3, { note: '4 × 4 minutes hard (about 8–9 out of 10), 3 minutes easy between.' }), cond(BIKE, 6, { note: 'Cool-down, easy.' })]
          : [cond(ID.run, 20 + k, { speed: 8, note: 'Easy, with 4–6 relaxed strides of about 20 seconds near the end.' })]),
        day('easy-2', 'Easy 2', [cond(BIKE, 30 + k * 3, { note: 'Easy spin or ride.' })]),
        day('long', 'Long', [cond(ID.run, Math.round(40 * Math.pow(1.1, k)), { speed: 7.5, note: 'The longest session of the week, easy.' })]),
      ] }
    }) },
  })

  /* ------------------------------------------------------------------------------------------------ 13 · Functional Fitness Engine */
  const ffe = P({
    slug: 'functional-fitness-engine', name: 'Functional Fitness Engine', goal: ['conditioning', 'strength-muscle'], level: 'intermediate', days: 4, method: 'concurrent', source: 'principles', prog: 'linear',
    author: { name: '2J Fitness Center, based on high-intensity functional training (HIFT) principles' },
    equip: ['barbell', 'rack', 'dumbbells', 'kettlebell', 'cardio machine'], legal: NONE('Descriptive name; no brand or league affiliation. HIFT is an academic term (Feito et al., 2018).'),
    t: {
      short: ['Four days mixing strength lifts with mixed-modal conditioning: running, rowing-type machines, jumps, carries and bodyweight work.', 'Cuatro días que mezclan ejercicios de fuerza con acondicionamiento mixto: correr, máquinas, saltos, acarreos y trabajo con el propio peso.'],
      long: ['Two strength-plus-short-conditioning days, one engine day (steady aerobic work) and one mixed-modal day. The conditioning is written as timed blocks with simple movements you can scale; the strength lifts use the app’s linear progression. Quality matters more than speed: pick loads that let you keep good form when you are tired. This is a general-fitness design, not a competition program.', 'Dos días de fuerza más un acondicionamiento corto, un día de motor (trabajo aeróbico constante) y un día mixto. El acondicionamiento se escribe como bloques de tiempo con movimientos sencillos que puedes escalar; los ejercicios de fuerza usan la progresión lineal de la app. La calidad importa más que la velocidad: elige cargas que te permitan mantener buena forma cuando estés cansado. Es un diseño de forma física general, no un programa de competición.'],
      dur: ['4-week blocks, repeated', 'Bloques de 4 semanas, repetidos'],
      evidence: ['High-intensity functional training (HIFT) is defined as varied movements at relatively high intensity (Feito et al., 2018) and improves aerobic fitness and body composition in many studies, but the research is short-term and mixed; injury risk depends mostly on technique, scaling and supervision. This is an original 2J design.', 'El entrenamiento funcional de alta intensidad (HIFT) se define como movimientos variados a intensidad relativamente alta (Feito et al., 2018) y mejora la forma aeróbica y la composición corporal en muchos estudios, aunque la investigación es de corto plazo y desigual; el riesgo de lesión depende sobre todo de la técnica, el escalado y la supervisión. Es un diseño original de 2J.'],
    },
    lists: {
      how: [['Two strength days with a short finisher.', 'Dos días de fuerza con un final corto.'], ['One steady-engine day and one mixed-modal day.', 'Un día de motor constante y un día mixto.'], ['Scale every movement to keep good form.', 'Escala cada movimiento para mantener buena forma.']],
      who: [['You want strength and conditioning in the same week.', 'Quieres fuerza y acondicionamiento en la misma semana.'], ['You know basic barbell and bodyweight movements.', 'Conoces los movimientos básicos con barra y con el propio peso.']],
      not: [['You are new to training or to the lifts.', 'Eres nuevo en el entrenamiento o en los levantamientos.'], ['You have an injury that jumping or heavy loading aggravates.', 'Tienes una lesión que saltar o cargar pesado agrava.']],
      track: [['Strength loads and the time of each conditioning block.', 'Cargas de fuerza y tiempo de cada bloque de acondicionamiento.'], ...COMMON_TRACK],
    },
    def: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
      day('strength-a', 'Strength A + finisher', [heavy(ID.squat, 4, 5, { rest: 180 }), heavy(ID.press, 3, 5, { rest: 150 }), acc(ID.chinup, 3, 5, 10), cond(KB, 6 + k, { note: 'Kettlebell swings in sets of 10–15 with short rests; stop before your form fades.' })]),
      day('engine', 'Engine', [cond(ID.run, 20 + k * 3, { speed: 8, note: 'Steady aerobic work, conversation pace.' }), cond(ID.skierg, 8 + k, { note: 'Smooth, moderate effort.' })]),
      day('strength-b', 'Strength B + finisher', [heavy(ID.deadlift, 3, 5, { rest: 210 }), heavy(ID.bench, 3, 5, { rest: 150 }), acc(ID.lunge, 3, 8, 12), cond(ID.burpee, 5 + k, { note: 'Burpees in short sets; scale to step-backs if needed.' })]),
      day('mixed', 'Mixed-modal', [cond(ROPE, 6, { note: 'Warm-up: jump rope or light skipping.' }), cond(THRUSTER, 10 + k * 2, { note: 'Rounds of dumbbell or barbell thrusters, farmers walks and bear crawls with short rests. Keep the loads light enough to repeat.' }), cond(BATTLE, 5, { note: 'Battle ropes, intervals of 20 seconds on, 40 off.' })]),
    ] })) },
  })

  /* ------------------------------------------------------------------------------------------------ 14 · Fitness Race Prep */
  const race = P({
    slug: 'fitness-race-prep', name: 'Fitness Race Prep', goal: ['conditioning'], level: 'intermediate', days: 5, method: 'concurrent', source: 'principles', prog: 'none',
    author: { name: '2J Fitness Center, for functional and hybrid competition formats' },
    equip: ['dumbbells', 'kettlebell', 'barbell', 'cardio machine', 'running route'], legal: NONE('Descriptive name only. It does not refer to, and implies no affiliation with, any specific event, brand or league.'),
    t: {
      short: ['An 8-week base for events that mix running with functional stations: carries, lunges, ski-erg and bodyweight work.', 'Una base de 8 semanas para eventos que mezclan carrera con estaciones funcionales: acarreos, zancadas, ergómetro de esquí y trabajo con el propio peso.'],
      long: ['Five days: two running sessions (one easy, one with intervals), a strength-endurance day with lunges, step-ups and carries, a machine-and-bodyweight “station” day, and a long session that links running with stations (a “compromised” run). The load rises for six weeks and then tapers slightly. It prepares you for formats that combine running and functional stations; it does not simulate any specific event, and it should not be used as a plan for an event with rules you have not read.', 'Cinco días: dos sesiones de carrera (una fácil y otra con intervalos), un día de resistencia a la fuerza con zancadas, step-ups y acarreos, un día de «estaciones» con máquinas y peso corporal y una sesión larga que enlaza carrera con estaciones (carrera «comprometida»). La carga sube durante seis semanas y luego se reduce un poco. Prepara para formatos que combinan carrera y estaciones funcionales; no simula ningún evento concreto y no debe usarse como plan para un evento cuyas reglas no hayas leído.'],
      dur: ['8 weeks, then repeat or advance', '8 semanas y después repetir o avanzar'],
      evidence: ['There is little published research on hybrid fitness races as such. The plan applies general principles: concurrent training of endurance and strength with sensible spacing (Wilson et al., 2012), a mostly easy aerobic base (Seiler, 2010) and specific practice of the movements involved. Treat it as a reasoned design, not a validated protocol.', 'Hay poca investigación publicada sobre las carreras de fitness híbridas como tales. El plan aplica principios generales: entrenamiento concurrente de resistencia y fuerza con un espaciado sensato (Wilson et al., 2012), una base aeróbica mayormente fácil (Seiler, 2010) y práctica específica de los movimientos implicados. Considéralo un diseño razonado, no un protocolo validado.'],
    },
    lists: {
      how: [['Two running sessions, one easy and one with intervals.', 'Dos sesiones de carrera, una fácil y otra con intervalos.'], ['A strength-endurance day and a station day.', 'Un día de resistencia a la fuerza y un día de estaciones.'], ['A long session that links running and stations.', 'Una sesión larga que enlaza carrera y estaciones.']],
      who: [['You plan to take part in a functional or hybrid fitness race.', 'Planeas participar en una carrera de fitness funcional o híbrida.'], ['You can run 5 km comfortably and train five days.', 'Puedes correr 5 km con comodidad y entrenar cinco días.']],
      not: [['You are new to running or exercise.', 'Eres nuevo en la carrera o el ejercicio.'], ['You need to follow the exact standards of a specific event; check its rules.', 'Necesitas seguir los estándares exactos de un evento concreto; consulta sus reglas.']],
      track: [['Minutes run, station loads and how the long session felt.', 'Minutos corridos, cargas de las estaciones y cómo fue la sesión larga.'], ...COMMON_TRACK],
    },
    def: { schema: 1, cycleWeeks: 8, weeks: weeksOf(8, k => {
      const t = k >= 6 ? 0.75 : 1 + k * 0.08
      const m = x => Math.round(x * t)
      return { label: `Week ${k + 1}${k >= 6 ? ' · Taper' : ''}`, phase: k >= 6 ? 'Taper' : `Week ${k + 1}`, sessions: [
        day('run-easy', 'Easy run', [cond(ID.run, m(30), { speed: 8, note: 'Easy, conversation pace.' })]),
        day('strength-endurance', 'Strength endurance', [acc(ID.lunge, 3, 12, 20, { rest: 45 }), acc(STEPUP, 3, 10, 15, { rest: 45 }), acc(ID.farmers, 3, 1, 1, { rest: 60, note: 'Heavy carry, about 40 meters or 40 seconds.' }), acc(BEAR, 3, 1, 1, { rest: 45, note: '20–30 seconds of bear crawl.' })]),
        day('run-intervals', 'Run intervals', [cond(ID.run, 10, { note: 'Warm-up, easy.' }), cond(ID.run, m(16), { note: 'Repeats of 3–5 minutes at a hard but sustainable pace, 2 minutes easy between.' }), cond(ID.run, 8, { note: 'Cool-down, easy.' })]),
        day('stations', 'Stations', [cond(ID.skierg, m(12), { note: 'Moderate to hard, steady rhythm.' }), cond(ID.burpee, m(8), { note: 'Burpees in short sets, switch to step-backs if form fades.' }), cond(KB, m(8), { note: 'Kettlebell swings in sets of 15–20.' })]),
        day('long-compromised', 'Run + stations', [cond(ID.run, m(20), { speed: 9, note: 'Run at a steady pace.' }), cond(ID.skierg, m(8), { note: 'Immediately after the run, keep a steady effort.' }), cond(ID.run, m(12), { speed: 9, note: 'Run again on tired legs.' })]),
      ] }
    }) },
  })

  /* ------------------------------------------------------------------------------------------------ 15 · Fitness Race Advanced */
  const raceAdv = P({
    slug: 'fitness-race-advanced', name: 'Fitness Race Advanced', goal: ['conditioning', 'strength-muscle'], level: 'advanced', days: 6, method: 'concurrent', source: 'principles', prog: 'none',
    author: { name: '2J Fitness Center, for functional and hybrid competition formats' },
    equip: ['dumbbells', 'kettlebell', 'barbell', 'cardio machine', 'running route'], legal: NONE('Descriptive name only. No affiliation with, or reference to, any specific event, brand or league.'),
    t: {
      short: ['A 12-week, six-day plan for experienced athletes preparing for functional or hybrid competition formats: more volume, more specificity.', 'Un plan de 12 semanas y seis días para deportistas con experiencia que se preparan para formatos de competición funcional o híbrida: más volumen y más especificidad.'],
      long: ['Builds on the base of Fitness Race Prep with a third strength day and longer sessions that combine running and stations. Weeks 1–4 build volume, weeks 5–9 raise specificity and week 10–11 sharpen, with a deload in week 12. You need an established base of running and strength; if your sessions become unmanageable, the plan expects you to take an easier day rather than push through. It does not reproduce any specific event’s rules.', 'Se apoya en la base de Fitness Race Prep con un tercer día de fuerza y sesiones más largas que combinan carrera y estaciones. Las semanas 1–4 construyen volumen, las semanas 5–9 elevan la especificidad y las semanas 10–11 afinan, con una descarga en la semana 12. Necesitas una base consolidada de carrera y fuerza; si las sesiones se vuelven inmanejables, el plan espera que hagas un día más fácil en lugar de forzar. No reproduce las reglas de ningún evento concreto.'],
      dur: ['12 weeks, then rest and reassess', '12 semanas y después descansar y reevaluar'],
      evidence: ['Concurrent training of strength and endurance is feasible with enough recovery (Wilson et al., 2012), but high volumes of both increase fatigue and the risk of overuse injury. Published research on hybrid fitness races is limited; this is a reasoned design for athletes who can already handle significant training.', 'El entrenamiento concurrente de fuerza y resistencia es viable con suficiente recuperación (Wilson et al., 2012), pero los volúmenes altos de ambos aumentan la fatiga y el riesgo de lesiones por sobreuso. La investigación publicada sobre carreras de fitness híbridas es limitada; es un diseño razonado para deportistas que ya aguantan una carga de entrenamiento considerable.'],
    },
    lists: {
      how: [['Weeks 1–4 build volume; 5–9 add specificity; 10–11 sharpen.', 'Semanas 1–4 construyen volumen; 5–9 añaden especificidad; 10–11 afinan.'], ['Three strength days and three conditioning days.', 'Tres días de fuerza y tres de acondicionamiento.'], ['Week 12 is a deload; take easier days when needed.', 'La semana 12 es una descarga; haz días más fáciles cuando haga falta.']],
      who: [['You have completed a base block and train six days comfortably.', 'Has completado un bloque base y entrenas seis días con comodidad.'], ['You are preparing for a hybrid or functional competition format.', 'Te preparas para un formato de competición híbrida o funcional.']],
      not: [['You have not trained consistently for months.', 'No has entrenado de forma constante en meses.'], ['You have a niggle that high volume would aggravate.', 'Tienes una molestia que el alto volumen agravaría.']],
      track: [['Weekly volume, long-session time and how recovered you feel.', 'Volumen semanal, tiempo de la sesión larga y lo recuperado que te sientes.'], ...COMMON_TRACK],
    },
    def: { schema: 1, cycleWeeks: 12, weeks: weeksOf(12, k => {
      const t = k === 11 ? 0.6 : k >= 9 ? 0.85 : 1 + k * 0.05
      const m = x => Math.round(x * t)
      const phase = k < 4 ? 'Volume' : k < 9 ? 'Specificity' : k < 11 ? 'Sharpen' : 'Deload'
      return { label: `Week ${k + 1} · ${phase}`, phase, sessions: [
        day('strength-a', 'Strength A', [heavy(ID.squat, 4, 5, { rest: 180 }), heavy(ID.press, 3, 5, { rest: 150 }), acc(ID.chinup, 3, 5, 10)]),
        day('run-intervals', 'Run intervals', [cond(ID.run, 10, { note: 'Warm-up, easy.' }), cond(ID.run, m(22), { note: 'Repeats of 4–6 minutes at a hard but sustainable pace, 2 minutes easy between.' }), cond(ID.run, 8, { note: 'Cool-down, easy.' })]),
        day('strength-b', 'Strength B', [heavy(ID.deadlift, 3, 5, { rest: 210 }), heavy(ID.bench, 3, 5, { rest: 150 }), acc(ID.lunge, 3, 10, 14)]),
        day('stations', 'Stations', [cond(ID.skierg, m(14), { note: 'Moderate to hard, steady rhythm.' }), cond(KB, m(10), { note: 'Kettlebell swings in sets of 15–20.' }), acc(ID.farmers, 4, 1, 1, { rest: 45, note: 'Heavy carry, about 40 meters or 40 seconds.' }), cond(ID.burpee, m(8), { note: 'Burpees in short sets.' })]),
        day('strength-c', 'Strength endurance', [acc(STEPUP, 4, 10, 15, { rest: 45 }), acc(ID.lunge, 4, 12, 20, { rest: 45 }), acc(BEAR, 3, 1, 1, { rest: 45, note: '30 seconds of bear crawl.' }), cond(BATTLE, 6, { note: 'Battle ropes, 20 seconds on, 40 off.' })]),
        day('long-compromised', 'Long run + stations', [cond(ID.run, m(28), { speed: 9, note: 'Run at a steady pace.' }), cond(ID.skierg, m(10), { note: 'Immediately after the run.' }), cond(ID.run, m(15), { speed: 9, note: 'Run again on tired legs.' }), cond(KB, m(6), { note: 'Finish with kettlebell swings.' })]),
      ] }
    }) },
  })

  /* ------------------------------------------------------------------------------------------------ 16 · Strength + Zone 2 Cut */
  const cut = P({
    slug: 'strength-zone2-cut', name: 'Strength + Zone 2 Cut', goal: ['recomposition', 'health'], level: 'intermediate', days: 6, method: 'recomposition', source: 'principles', prog: 'double-progression',
    author: { name: '2J Fitness Center' },
    equip: ['barbell', 'rack', 'bench', 'dumbbells', 'cardio machine'], legal: NONE('2J design with generic concepts.'),
    t: {
      short: ['Three strength days to protect muscle and three easy “zone 2” cardio days to add energy expenditure while you lose fat.', 'Tres días de fuerza para proteger el músculo y tres días de cardio fácil «zona 2» para aumentar el gasto energético mientras pierdes grasa.'],
      long: ['A fat-loss phase works best when you keep lifting. Three full-body strength sessions keep the weights moving; three steady cardio sessions at a conversational effort (zone 2) add energy expenditure without competing much with your lifting. Cardio time grows slowly. This program does not set a diet: fat loss depends on a moderate energy deficit and enough protein, and a large deficit hurts training and recovery.', 'Una fase de pérdida de grasa funciona mejor si sigues levantando. Tres sesiones de cuerpo completo mantienen el peso en movimiento; tres sesiones de cardio constante a esfuerzo conversacional (zona 2) suman gasto energético sin competir mucho con el levantamiento. El tiempo de cardio crece despacio. Este programa no fija una dieta: la pérdida de grasa depende de un déficit energético moderado y de suficiente proteína, y un déficit grande perjudica el entrenamiento y la recuperación.'],
      dur: ['4-week blocks, repeated', 'Bloques de 4 semanas, repetidos'],
      evidence: ['Keeping resistance training in a calorie deficit helps preserve lean mass; a slower rate of loss preserves it better (Garthe et al., 2011) and strength is largely maintained when the deficit is moderate (Murphy & Koehler, 2022). Zone 2 is a low-intensity aerobic range associated with high fat oxidation (San-Millán & Brooks, 2018), but it is not shown to be superior for fat loss to other cardio.', 'Mantener el entrenamiento de fuerza en un déficit calórico ayuda a conservar la masa magra; una pérdida más lenta la conserva mejor (Garthe et al., 2011) y la fuerza se mantiene en gran parte con un déficit moderado (Murphy y Koehler, 2022). La zona 2 es un rango aeróbico de baja intensidad asociado con una alta oxidación de grasa (San-Millán y Brooks, 2018), pero no se ha demostrado que sea superior a otro cardio para perder grasa.'],
    },
    lists: {
      how: [['Three full-body strength days with double progression.', 'Tres días de fuerza de cuerpo completo con doble progresión.'], ['Three easy cardio days at conversation pace.', 'Tres días de cardio fácil a ritmo de conversación.'], ['Cardio time grows slowly over the block.', 'El tiempo de cardio crece lentamente durante el bloque.']],
      who: [['You want to lose fat and keep your muscle.', 'Quieres perder grasa y conservar tu músculo.'], ['You can train six days, some of them short.', 'Puedes entrenar seis días, algunos de ellos cortos.']],
      not: [['You have a history of disordered eating or need medical supervision for your diet.', 'Tienes antecedentes de trastornos de la conducta alimentaria o necesitas supervisión médica en tu dieta.'], ['You want to maximise muscle gain.', 'Quieres maximizar la ganancia muscular.']],
      track: [['Strength loads and weekly cardio minutes.', 'Cargas de fuerza y minutos semanales de cardio.'], ['Body weight and energy levels, if you log them.', 'Peso corporal y niveles de energía, si los registras.']],
    },
    def: { schema: 1, cycleWeeks: 4, weeks: weeksOf(4, k => ({ label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
      day('strength-a', 'Strength A', [acc(ID.squat, 3, 6, 10, { role: 'main', rest: 150 }), acc(ID.dbBench, 3, 6, 10), acc(ID.cableRow, 3, 8, 12), acc(ID.legRaise, 2, 10, 15)]),
      day('zone2-1', 'Zone 2 · cardio', [cond(BIKE, 30 + k * 3, { note: 'Easy: you can speak in full sentences.' })]),
      day('strength-b', 'Strength B', [acc(ID.rdl, 3, 6, 10, { role: 'main', rest: 150 }), acc(ID.dbPress, 3, 6, 10), acc(ID.pulldown, 3, 8, 12), acc(ID.crunch, 2, 12, 20)]),
      day('zone2-2', 'Zone 2 · cardio', [cond(ID.run, 30 + k * 3, { speed: 7.5, note: 'Easy, conversation pace; brisk walking is fine.' })]),
      day('strength-c', 'Strength C', [acc(ID.legPress, 3, 8, 12, { role: 'main', rest: 120 }), acc(ID.incline, 3, 8, 12), acc(ID.dbRow, 3, 8, 12), acc(ID.lateral, 2, 12, 15)]),
      day('zone2-3', 'Zone 2 · cardio', [cond(ID.skierg, 25 + k * 3, { note: 'Smooth, easy rhythm.' })]),
    ] })) },
  })

  /* ------------------------------------------------------------------------------------------------ 17 · Metabolic Resistance Progression */
  const met = P({
    slug: 'metabolic-resistance-progression', name: 'Metabolic Resistance Progression', goal: ['conditioning', 'recomposition'], level: 'beginner', days: 4, method: 'conditioning', source: 'principles', prog: 'double-progression',
    author: { name: '2J Fitness Center, based on circuit-style resistance training' },
    equip: ['dumbbells', 'bench', 'kettlebell', 'cardio machine'], legal: NONE('Generic circuit-style training.'),
    t: {
      short: ['Four circuit-style sessions with short rests and simple compound movements, adding reps then weight over six weeks.', 'Cuatro sesiones en circuito con descansos cortos y movimientos compuestos sencillos, añadiendo repeticiones y luego peso durante seis semanas.'],
      long: ['Each session is a circuit of simple compound movements (lunges, presses, rows, hip hinges, carries) done with short rests so the heart rate stays up. The app’s double progression adds reps first and then weight, so the progression is gradual and safe. A short conditioning finisher grows from 6 to 10 minutes. It is a good option when time is limited and you want both strength endurance and fitness; it does not target maximal strength.', 'Cada sesión es un circuito de movimientos compuestos sencillos (zancadas, presses, remos, bisagras de cadera, acarreos) con descansos cortos para mantener alto el pulso. La doble progresión de la app añade repeticiones primero y después peso, de modo que la progresión es gradual y segura. Un final corto de acondicionamiento crece de 6 a 10 minutos. Es una buena opción cuando hay poco tiempo y quieres resistencia a la fuerza y forma física a la vez; no apunta a la fuerza máxima.'],
      dur: ['6-week blocks, repeated', 'Bloques de 6 semanas, repetidos'],
      evidence: ['Circuit-style resistance training with short rests improves muscular endurance and cardiorespiratory fitness and is consistent with general exercise guidelines (Garber et al., 2011, ACSM position stand). Strength and size gains are smaller than with longer rests and heavier loads.', 'El entrenamiento de fuerza en circuito con descansos cortos mejora la resistencia muscular y la forma cardiorrespiratoria y es coherente con las guías generales de ejercicio (Garber et al., 2011, declaración del ACSM). Las ganancias de fuerza y tamaño son menores que con descansos más largos y cargas más pesadas.'],
    },
    lists: {
      how: [['Circuits of simple compound movements with short rests.', 'Circuitos de movimientos compuestos sencillos con descansos cortos.'], ['Reps first, then weight, as you improve.', 'Primero las repeticiones y luego el peso, a medida que mejoras.'], ['A conditioning finisher that grows from 6 to 10 minutes.', 'Un final de acondicionamiento que crece de 6 a 10 minutos.']],
      who: [['You have limited time and want strength-endurance and fitness.', 'Tienes poco tiempo y quieres resistencia a la fuerza y forma física.'], ['You are starting or restarting.', 'Estás empezando o volviendo a empezar.']],
      not: [['Your goal is maximal strength.', 'Tu objetivo es la fuerza máxima.'], ['You need to follow a medical restriction without supervision.', 'Necesitas seguir una restricción médica sin supervisión.']],
      track: [['Reps and weights per circuit.', 'Repeticiones y pesos por circuito.'], ...COMMON_TRACK],
    },
    def: { schema: 1, cycleWeeks: 6, weeks: weeksOf(6, k => {
      const hi = 12 + Math.min(k, 3), fin = 6 + Math.floor((k * 4) / 5)
      return { label: `Week ${k + 1}`, phase: `Week ${k + 1}`, sessions: [
        day('circuit-a', 'Circuit A', [acc(ID.goblet, 3, 10, hi, { rest: 30 }), acc(ID.pushup, 3, 8, hi, { rest: 30 }), acc(ID.dbRow, 3, 10, hi, { rest: 30 }), acc(ID.lunge, 3, 10, hi, { rest: 30 }), cond(ID.run, fin, { speed: 8, note: 'Finisher: steady, hard-but-sustainable effort.' })]),
        day('circuit-b', 'Circuit B', [acc(ID.dbPress, 3, 10, hi, { rest: 30 }), acc(ID.thrust, 3, 10, hi, { rest: 30 }), acc(ID.pulldown, 3, 10, hi, { rest: 30 }), acc(ID.crunch, 3, 12, 20, { rest: 30 }), cond(BIKE, fin, { note: 'Finisher: intervals of 30 seconds hard, 30 easy.' })]),
        day('circuit-c', 'Circuit C', [acc(KB, 3, 12, 20, { rest: 30 }), acc(ID.split, 3, 8, hi, { rest: 30 }), acc(ID.dbBench, 3, 10, hi, { rest: 30 }), acc(ID.farmers, 3, 1, 1, { rest: 30, note: 'Walk with control for about 30 seconds.' }), cond(ID.skierg, fin, { note: 'Finisher: smooth, steady rhythm.' })]),
        day('circuit-d', 'Circuit D', [acc(STEPUP, 3, 8, hi, { rest: 30 }), acc(ID.incline, 3, 10, hi, { rest: 30 }), acc(ID.cableRow, 3, 10, hi, { rest: 30 }), acc(ID.legRaise, 3, 10, 15, { rest: 30 }), cond(ROPE, fin, { note: 'Finisher: jump rope or light skipping.' })]),
      ] }
    }) },
  })

  /* ------------------------------------------------------------------------------------------------ 18 · Entrena tus Oposiciones (special family) */
  // The catalogue entry of the Oposiciones family. Its programDefinition is a placeholder that is never run: opening it goes to the Oposiciones flow, which
  // builds a long-term plan from the official profile of the member's exam (tests, minimum marks, source and date live in api/lib/opposition-official.json).
  const opo = P({
    slug: 'entrena-tus-oposiciones', name: 'Entrena tus Oposiciones', goal: ['conditioning', 'strength'], level: 'intermediate', days: 3, method: 'opposition', source: 'own', prog: 'none',
    author: { name: '2J Fitness Center, with official convocatoria data' },
    equip: ['running route', 'pull-up bar', 'pool', 'cardio machine'], legal: NONE('Uses only official, public convocatoria data (BOE, BOC, BOP, organisms). No affiliation with any body.'),
    t: {
      short: ['A long-term plan for the physical tests of your public-service exam, built on the official tests and minimum marks of your convocatoria.', 'Un plan a largo plazo para las pruebas físicas de tu oposición, construido sobre las pruebas y marcas mínimas oficiales de tu convocatoria.'],
      long: ['Choose your exam, tell us about your marks, your time and your equipment, and 2J builds a plan in phases (Base, Development, Specificity and Competitive) over 6, 12, 18 or 24 months, training every capacity of the real tests. Every few weeks a control week measures your marks against the official minimum and your target, and proposes the next block — you confirm it; nothing changes by itself. If a figure is missing or your convocatoria is not in the catalogue, the app says so instead of inventing it.', 'Elige tu oposición, cuéntanos tus marcas, tu tiempo y tu material, y 2J construye un plan por fases (Base, Desarrollo, Especificidad y Competitiva) a 6, 12, 18 o 24 meses, entrenando todas las capacidades de las pruebas reales. Cada pocas semanas una semana de control mide tus marcas frente al mínimo oficial y a tu objetivo, y propone el siguiente bloque: tú lo confirmas; nada cambia solo. Si falta un dato o tu convocatoria no está en el catálogo, la app lo dice en lugar de inventarlo.'],
      dur: ['6, 12, 18 or 24 months', '6, 12, 18 o 24 meses'],
      evidence: ['Tests and minimum marks come from the official publication of each convocatoria (source and date shown). The training follows general principles of periodization (base, development, specificity, taper) and specificity of the tested capacities; no controlled study supports this exact plan. Marks change between convocatorias: always check the bases of yours.', 'Las pruebas y las marcas mínimas proceden de la publicación oficial de cada convocatoria (se muestran la fuente y la fecha). El entrenamiento sigue principios generales de periodización (base, desarrollo, especificidad, puesta a punto) y de especificidad de las capacidades evaluadas; ningún estudio controlado respalda este plan concreto. Las marcas cambian entre convocatorias: comprueba siempre las bases de la tuya.'],
    },
    lists: {
      how: [['Pick your exam and its official tests.', 'Elige tu oposición y sus pruebas oficiales.'], ['A plan in phases to your exam date, with a control week every 5 weeks.', 'Un plan por fases hasta tu fecha de examen, con una semana de control cada 5 semanas.'], ['You confirm every change of block.', 'Tú confirmas cada cambio de bloque.']],
      who: [['You are preparing the physical tests of a public-service exam.', 'Preparas las pruebas físicas de una oposición.'], ['You want to see your marks against the official minimum.', 'Quieres ver tus marcas frente al mínimo oficial.']],
      not: [['Your convocatoria is not in the catalogue yet: ask your trainer to add it.', 'Tu convocatoria aún no está en el catálogo: pide a tu entrenador que la añada.'], ['You have a medical restriction that has not been cleared for hard efforts.', 'Tienes una restricción médica sin autorización para esfuerzos duros.']],
      track: [['Marks per test, level per capacity and time left.', 'Marcas por prueba, nivel por capacidad y tiempo restante.'], ['Adherence and control results.', 'Adherencia y resultados de los controles.']],
    },
    def: { schema: 1, cycleWeeks: 1, weeks: [{ label: 'Plan', phase: 'Plan', sessions: [
      day('endurance', 'Endurance', [cond(ID.run, 30, { speed: 8, note: 'Placeholder: the real sessions are built in the Oposiciones flow.' })]),
      day('strength', 'Strength', [acc(ID.chinup, 3, 5, 10)]),
      day('tests', 'Control tests', [cond(ID.run, 15, { note: 'Placeholder: the control tests come from your official profile.' })]),
    ] }] },
  })

  return [lin5, hlm, conj, block, dupPb, ppl, hfs, hst, bfr, pol, thr, base, ffe, race, raceAdv, cut, met, opo]
}
