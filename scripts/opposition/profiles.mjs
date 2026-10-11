// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* The official Oposiciones profiles, as DATA. scripts/build-opposition-profiles.mjs turns this into api/lib/opposition-official.json (the versioned seed the
 * API reads from the release on every boot). An administrator edits, versions, publishes, hides or archives each profile from Administration → Oposiciones;
 * a new convocatoria is a NEW VERSION and never changes a plan already under way (the plan pins the profile version it was built on).
 *
 * Provenance: every figure below was read from the official publication named in `source` (BOE, BOC, BOP Las Palmas and the organism's own announcements);
 * no blog, academy or forum is used as a source. Where the printed table looks odd, the value is kept as printed and the profile says so in `notes`.
 * Where an official table is an image that could not be read, or a mark is not printed, the profile says so instead of filling it in.
 * Content is Spanish: these are Spanish official documents; the app chrome around them is translated as usual.
 *
 * A scale lists, in ascending points, the value that EARNS those points (the slowest time / fewest reps / shortest distance of the printed band).
 */
const SEEDED = '2026-10-11T00:00:00.000Z'
const E = (p, v, label) => (label ? { p, v, label } : { p, v })
const ASCENDING_TIME = (...vs) => vs                // helper kept for readability in the tables below
const S = (first, values) => values.map((v, i) => E(first + i, v))
void ASCENDING_TIME

const COMMON_NOTE = 'Las marcas son las de la publicación oficial indicada y la fecha de la fuente figura en el perfil. Cada convocatoria puede cambiar las pruebas o las marcas: comprueba siempre las bases de la tuya.'

/* ---------------------------------------------------------------------------------------------------------------- Policía Nacional */
const pn = {
  id: 'opp-policia-nacional', slug: 'policia-nacional', name: 'Policía Nacional · Escala Básica', body: 'policia-nacional',
  organism: 'Dirección General de la Policía · Ministerio del Interior',
  convocatoria: { title: 'Proceso selectivo de ingreso en la Escala Básica del Cuerpo Nacional de Policía (2.704 plazas: 2.163 de oposición libre y 541 reservadas)', plazas: 2704, year: 2026, reference: 'Resolución de 7 de julio de 2026, de la Dirección General de la Policía' },
  source: { kind: 'official', organism: 'Dirección General de la Policía', document: 'Anexo II · Pruebas de aptitud física (bases de la convocatoria)', publication: 'BOE núm. 167, de 10 de julio de 2026, págs. 96257 a 96305', date: '2026-07-10', reference: 'BOE-A-2026-15055' },
  validFrom: '2026-07-10', validUntil: null,
  scoring: { model: 'points', maxPoints: 10, minPoints: 1, referencePoints: 5, rule: { kind: 'average', min: 5, note: 'La calificación de la prueba es la media aritmética de los tres ejercicios; hacen falta 5 puntos y un 0 en cualquier ejercicio elimina (base 6.1.2).' } },
  categories: { bySex: true, ageBands: null },
  tests: [
    { id: 'agilidad', name: 'Circuito de agilidad', capacity: 'agility', movement: 'agility', kind: 'time', unit: 's', attempts: 1,
      description: 'Circuito con vallas, salida de pie tras la línea. Se cronometra en segundos y décimas hasta tocar el suelo tras la última valla. Nulo si se modifica el recorrido o se derriba, apoya o agarra algún elemento. Tiempo máximo: 11,7 s (hombres) y 12,8 s (mujeres): superarlo elimina.',
      notes: 'El gráfico del circuito es una imagen y no está recogido: practica con vallas y cambios de dirección y revisa el recorrido en las bases.',
      marks: { m: S(1, [11.6, 11.4, 11.2, 10.9, 10.5, 10.1, 9.7, 9.3, 8.8, 8.2]), f: S(1, [12.7, 12.5, 12.3, 12.0, 11.6, 11.2, 10.8, 10.3, 9.8, 9.3]) } },
    { id: 'dominadas', name: 'Dominadas (hombres)', capacity: 'pull', movement: 'pullup', kind: 'reps', unit: 'rep.', attempts: 1, only: ['m'],
      description: 'Suspendido de la barra en agarre prono, brazos extendidos. Máximo de dominadas sin oscilaciones ni impulso; la barbilla debe superar claramente la barra y se hace una pausa mínima entre repeticiones (no más de 5 s colgado entre ellas).',
      marks: { m: [E(1, 5), E(2, 6), E(3, 7), E(4, 8), E(5, 10), E(6, 12), E(7, 14), E(8, 15), E(9, 16), E(10, 17)] } },
    { id: 'suspension', name: 'Suspensión en barra (mujeres)', capacity: 'pull', movement: 'hang', kind: 'hold', unit: 's', attempts: 1, only: ['f'],
      description: 'Suspendida en agarre supino, brazos flexionados y barbilla por encima de la barra, cuerpo estático. Se mantiene el mayor tiempo posible; termina cuando la barbilla queda a la altura de la barra o por debajo. Sin flexionar la cadera ni balancearse.',
      marks: { f: [E(1, 36), E(2, 41), E(3, 46), E(4, 52), E(5, 57), E(6, 63), E(7, 70), E(8, 78), E(9, 86), E(10, 95)] } },
    { id: '1000m', name: 'Carrera de 1.000 m', capacity: 'endurance', movement: 'run', kind: 'time', unit: 's', distanceM: 1000, attempts: 1,
      description: 'Carrera de 1.000 m en grupo sobre superficie lisa, plana y dura, con calzado deportivo (sin zapatillas de clavos). Un solo intento. El tiempo se anota en segundos en esta app (3 min 24 s = 204 s).',
      marks: { m: S(1, [228, 222, 216, 210, 204, 198, 192, 186, 180, 174]), f: S(1, [285, 276, 267, 258, 249, 240, 231, 222, 213, 204]) } },
  ],
  notes: [COMMON_NOTE, 'Puntuación de 0 a 10 por ejercicio. El texto oficial no incluye requisito de altura. Edad: 18 años cumplidos y no exceder la edad máxima de jubilación en la Policía Nacional.', 'El tiempo máximo del circuito de agilidad (11,7 s / 12,8 s) y el 0 en cualquier ejercicio son eliminatorios.'],
  askBeforeStart: [],
}

/* ---------------------------------------------------------------------------------------------------------------- Guardia Civil */
const gcBands = [{ id: 'u35', label: 'Menos de 35 años', from: 0, to: 34 }, { id: 'm35', label: '35 a 39 años', from: 35, to: 39 }, { id: 'o40', label: '40 años o más', from: 40, to: 99 }]
const gc = {
  id: 'opp-guardia-civil', slug: 'guardia-civil', name: 'Guardia Civil · Cabos y Guardias', body: 'guardia-civil',
  organism: 'Dirección General de la Guardia Civil · Ministerio del Interior',
  convocatoria: { title: 'Ingreso en la Escala de Cabos y Guardias de la Guardia Civil (3.240 plazas: 1.704 de acceso libre)', plazas: 3240, year: 2026, reference: 'Resolución 160/38243/2026, de 5 de mayo, de la Dirección General de la Guardia Civil' },
  source: { kind: 'official', organism: 'Dirección General de la Guardia Civil', document: 'Apéndice II · Pruebas físicas (bases de la convocatoria)', publication: 'BOE de 8 de mayo de 2026', date: '2026-05-08', reference: 'BOE-A-2026-9982' },
  validFrom: '2026-05-08', validUntil: null,
  scoring: { model: 'pass-fail', maxPoints: 1, minPoints: 1, referencePoints: 1, rule: { kind: 'all-min', note: 'Calificación de «apto» o «no apto»: quien no supere un ejercicio queda excluido en ese momento (base 8.1.1). El Tribunal decide el orden.' } },
  categories: { bySex: true, ageBands: gcBands },
  tests: [
    { id: 'carrera-2000', name: 'Resistencia · carrera de 2.000 m (R2)', capacity: 'endurance', movement: 'run', kind: 'time', unit: 's', distanceM: 2000, attempts: 1,
      description: 'Carrera de 2.000 metros lisos, salida en pie, un único intento. El tiempo se anota en segundos en esta app (9 min 25 s = 565 s).',
      marks: { 'm:u35': [E(1, 565, 'Apto')], 'm:m35': [E(1, 588, 'Apto')], 'm:o40': [E(1, 633, 'Apto')], 'f:u35': [E(1, 674, 'Apto')], 'f:m35': [E(1, 695, 'Apto')], 'f:o40': [E(1, 769, 'Apto')] } },
    { id: 'circuito-agilidad', name: 'Agilidad y coordinación · circuito de vallas (C1)', capacity: 'agility', movement: 'agility', kind: 'time', unit: 's', attempts: 2,
      description: 'Circuito de vallas según un gráfico, con dos intentos. Tiempo en segundos y centésimas.',
      notes: 'El gráfico del circuito es una imagen y no está recogido: revisa el recorrido en las bases.',
      marks: { 'm:u35': [E(1, 14.0, 'Apto')], 'm:m35': [E(1, 14.4, 'Apto')], 'm:o40': [E(1, 15.1, 'Apto')], 'f:u35': [E(1, 16.0, 'Apto')], 'f:m35': [E(1, 16.4, 'Apto')], 'f:o40': [E(1, 17.9, 'Apto')] } },
    { id: 'extensiones-brazos', name: 'Potencia del tren superior · extensiones de brazos (P3)', capacity: 'push', movement: 'pushup', kind: 'reps', unit: 'rep.', attempts: 2,
      description: 'Extensiones de brazos desde posición de tierra inclinada, con dos intentos. La marca es un número mínimo de repeticiones.',
      marks: { 'm:u35': [E(1, 16, 'Apto')], 'm:m35': [E(1, 16, 'Apto')], 'm:o40': [E(1, 14, 'Apto')], 'f:u35': [E(1, 11, 'Apto')], 'f:m35': [E(1, 11, 'Apto')], 'f:o40': [E(1, 9, 'Apto')] } },
    { id: 'natacion-50', name: 'Soltura acuática · 50 m estilo libre (O1)', capacity: 'swim', movement: 'swim', kind: 'time', unit: 's', distanceM: 50, attempts: 1,
      description: '50 metros de natación estilo libre, un único intento.',
      marks: { 'm:u35': [E(1, 70, 'Apto')], 'm:m35': [E(1, 71, 'Apto')], 'm:o40': [E(1, 73, 'Apto')], 'f:u35': [E(1, 81, 'Apto')], 'f:m35': [E(1, 83, 'Apto')], 'f:o40': [E(1, 88, 'Apto')] } },
  ],
  notes: [COMMON_NOTE, 'Las pruebas son de aptitud (apto / no apto): el perfil usa la marca mínima oficial y, para tu objetivo, un margen de seguridad sobre ella (no es una marca oficial).', 'Edad: 18 años cumplidos en 2026 y no cumplir 41 en ese año.'],
  askBeforeStart: [],
}

/* ---------------------------------------------------------------------------------------------------------------- Policía Local · Canarias */
const plc = {
  id: 'opp-policia-local-canarias', slug: 'policia-local-canarias', name: 'Policía Local · Canarias (convocatoria unificada)', body: 'policia-local',
  organism: 'Dirección General de Estudios, Formación e Investigación en Seguridad Pública · Gobierno de Canarias',
  convocatoria: { title: 'Tercera convocatoria anual unificada de acceso a la Escala Básica de los Cuerpos de Policía Local de Canarias (Grupo C, Subgrupo C1)', plazas: 180, year: 2025, reference: 'Resolución de 20 de octubre de 2025' },
  source: { kind: 'official', organism: 'Boletín Oficial de Canarias', document: 'Anexo II · Prueba de aptitud física (bases)', publication: 'BOC núm. 215, de 30 de octubre de 2025, disposición 3702, págs. 44851 a 44856', date: '2025-10-30', reference: 'BOC-A-2025-215-3702' },
  validFrom: '2025-10-30', validUntil: null,
  scoring: { model: 'points', maxPoints: 10, minPoints: 5, referencePoints: 5, rule: { kind: 'all-min', note: 'Cada prueba es apta o no apta según la marca mínima; los tramos de 6 a 10 puntos puntúan por encima del mínimo.' } },
  categories: { bySex: true, ageBands: null },
  tests: [
    { id: 'salto-horizontal', name: 'Salto horizontal', capacity: 'power', movement: 'jump', kind: 'distance', unit: 'm', attempts: 2,
      description: 'Salto a pies juntos desde detrás de una línea, con lanzamiento de brazos. Se mide la distancia perpendicular desde la línea hasta la huella más cercana, en metros y centímetros (se redondea hacia abajo). Dos intentos; si se supera en el primero, se da por apta.',
      notes: 'Mujeres: el BOC imprime los tramos de 9 y 10 puntos con un solape (2,19 a 2,24 y 2,24 o más); se mantiene tal cual.',
      marks: { m: [E(5, 2.2, 'Apto'), E(6, 2.21), E(7, 2.27), E(8, 2.33), E(9, 2.39), E(10, 2.45)], f: [E(5, 2.0, 'Apta'), E(6, 2.01), E(7, 2.07), E(8, 2.13), E(9, 2.19), E(10, 2.24)] } },
    { id: 'flexiones-barra', name: 'Flexiones de brazos en barra (hombres)', capacity: 'pull', movement: 'pullup', kind: 'reps', unit: 'rep.', attempts: 1, only: ['m'],
      description: 'Suspensión completa en barra con palmas al frente (supinación) y brazos extendidos; el mayor número de flexiones asomando la barbilla sobre la barra y extendiendo los codos. No cuenta si hay balanceo de más de 0,5 m, ayuda de las piernas o hiperextensión del cuello. Sin guantes.',
      marks: { m: [E(5, 8, 'Apto'), E(6, 9), E(7, 10), E(8, 12), E(9, 14), E(10, 17)] } },
    { id: 'flexion-mantenida', name: 'Flexión de brazos mantenida (mujeres)', capacity: 'pull', movement: 'hang', kind: 'hold', unit: 's', attempts: 1, only: ['f'],
      description: 'Brazos flexionados con las palmas hacia atrás, piernas extendidas sin tocar el suelo y la barbilla por encima de la barra sin contacto con ella. Se mide el tiempo en segundos que se mantiene la posición; sin balanceo ni mover las manos.',
      notes: 'El BOC imprime el tramo de 10 puntos como «83 a 94 s»; se toma 83 s como marca de 10 puntos y se mantiene el resto tal cual.',
      marks: { f: [E(5, 44, 'Apta'), E(6, 45), E(7, 52), E(8, 61), E(9, 71), E(10, 83)] } },
    { id: 'cooper', name: 'Test de Cooper (12 minutos)', capacity: 'endurance', movement: 'run', kind: 'distance', unit: 'm', durationS: 720, attempts: 1,
      description: 'Correr durante 12 minutos la mayor distancia posible en pista de atletismo (grupos de hasta 10 personas). Se anota la distancia en metros. Un solo intento.',
      notes: 'Las marcas mínimas se mantienen como las imprime el BOC: Apto 2.499 m (hombres) y 2.299 m (mujeres), seguidas del tramo de 6 puntos que empieza en 2.500 m y 2.300 m.',
      marks: { m: [E(5, 2499, 'Apto'), E(6, 2500), E(7, 2600), E(8, 2700), E(9, 2800), E(10, 2900)], f: [E(5, 2299, 'Apta'), E(6, 2300), E(7, 2400), E(8, 2500), E(9, 2600), E(10, 2700)] } },
    { id: 'natacion-50', name: 'Adaptación al medio acuático · 50 m libre', capacity: 'swim', movement: 'swim', kind: 'time', unit: 's', distanceM: 50, attempts: 2,
      description: '50 metros estilo libre lo más rápido posible sin salirse de la calle, en piscina de 50 m o de 25 m con viraje. Dos intentos solo si no se supera la marca mínima en el primero. Se anota en segundos y centésimas.',
      marks: { m: [E(5, 50.0, 'Apto'), E(6, 49.99), E(7, 46.99), E(8, 43.99), E(9, 40.99), E(10, 37.99)], f: [E(5, 55.0, 'Apta'), E(6, 54.99), E(7, 51.99), E(8, 48.99), E(9, 45.99), E(10, 42.99)] } },
  ],
  notes: [COMMON_NOTE, 'Cada ayuntamiento de Canarias que convoque por su cuenta puede usar sus propias bases: comprueba si tu convocatoria es la unificada.', 'Marcas por sexo; el BOC no distingue por edad en estas tablas.'],
  askBeforeStart: ['convocatoria'],
}

/* ---------------------------------------------------------------------------------------------------------------- Bomberos · CEGC */
const cegc = {
  id: 'opp-bomberos-cegc', slug: 'bomberos-cegc', name: 'Bombero/a · Consorcio de Emergencias de Gran Canaria', body: 'bomberos',
  organism: 'Consorcio de Emergencias de Gran Canaria (CEGC)',
  convocatoria: { title: 'Concurso-oposición, turno libre, de 37 plazas de Bombero/a del personal funcionario del CEGC', plazas: 37, year: 2025, reference: 'Bases y convocatoria publicadas en el BOP de Las Palmas núm. 153, de 22 de diciembre de 2025' },
  source: { kind: 'official', organism: 'Consorcio de Emergencias de Gran Canaria', document: 'Anexo III · Pruebas físicas (bases de la convocatoria)', publication: 'Boletín Oficial de la Provincia de Las Palmas núm. 153, lunes 22 de diciembre de 2025, págs. 21859 a 21865', date: '2025-12-22', reference: 'BOP Las Palmas nº 153 · Anexo III', note: 'Las marcas coinciden con los anuncios del Tribunal calificador de junio de 2026 (cinco pruebas, de 5 a 10 puntos cada una).' },
  validFrom: '2025-12-22', validUntil: null,
  scoring: { model: 'points', maxPoints: 10, minPoints: 5, referencePoints: 5, rule: { kind: 'all-min', note: 'Cinco pruebas obligatorias, eliminatorias y puntuables: hay que sacar entre 5 y 10 puntos en cada una; la nota del ejercicio es la media de las cinco.' } },
  categories: { bySex: true, ageBands: null },
  tests: [
    { id: 'natacion-50', name: 'Natación · 50 m', capacity: 'swim', movement: 'swim', kind: 'time', unit: 's', distanceM: 50, attempts: 1,
      description: '50 metros a nado en la calle asignada y a estilo libre, en un tiempo máximo de 52 s. En piscina de 25 m se permite el volteo si se toca la pared con los pies. Un solo intento; dos salidas nulas descalifican.',
      marks: { m: S(5, [52, 46, 42, 38, 34, 30]), f: S(5, [52, 48, 44, 40, 36, 32]) } },
    { id: 'dominadas', name: 'Dominadas', capacity: 'pull', movement: 'pullup', kind: 'reps', unit: 'rep.', attempts: 1,
      description: 'Suspendido de una barra horizontal con agarre digito-palmar hacia el frente: flexiones hasta sobrepasar la barbilla la barra y descenso hasta la extensión total de brazos. Sin límite de tiempo; la prueba termina al alcanzar la marca máxima. Descolgarse antes del mínimo o tocar el suelo descalifica.',
      marks: { m: S(5, [8, 10, 12, 14, 16, 18]), f: S(5, [8, 10, 11, 12, 14, 16]) } },
    { id: 'press-banca', name: 'Press de banca (40 kg)', capacity: 'push', movement: 'bench', kind: 'reps', unit: 'rep.', attempts: 1,
      description: 'En decúbito supino sobre un banco, levantar 40 kg (±5 %) en un tiempo máximo de 30 s: mínimo de 15 repeticiones válidas (hombres) o 10 (mujeres). Extensión completa de codos, la barra toca el pecho en cada repetición, glúteos en el banco y los dos pies en el suelo.',
      notes: 'El texto oficial solo imprime la marca mínima (5 puntos) y la máxima (10 puntos): hombres 15 y 40 repeticiones, mujeres 10 y 32. Los puntos intermedios no figuran en las bases.',
      marks: { m: [E(5, 15), E(10, 40)], f: [E(5, 10), E(10, 32)] } },
    { id: 'velocidad-200', name: 'Velocidad · 200 m', capacity: 'speed', movement: 'sprint', kind: 'time', unit: 's', distanceM: 200, attempts: 1,
      description: '200 metros en pista homologada sin salirse de la calle, en un tiempo máximo de 40 s (hombres) y 43 s (mujeres). Salida de pie o agachado, sin tacos. Un solo intento con salida válida.',
      marks: { m: S(5, [40, 37, 34, 32, 30, 28]), f: S(5, [43, 40, 38, 35, 32, 30]) } },
    { id: 'resistencia-1500', name: 'Resistencia · 1.500 m', capacity: 'endurance', movement: 'run', kind: 'time', unit: 's', distanceM: 1500, attempts: 1,
      description: '1.500 metros en pista homologada en un tiempo máximo de 7 min 00 s. Salida desde parado. Un solo intento. El tiempo se anota en segundos en esta app (6 min 45 s = 405 s).',
      notes: 'Las bases imprimen las mismas marcas para hombres y mujeres.',
      marks: { '*': S(5, [420, 405, 390, 375, 360, 345]) } },
  ],
  notes: [COMMON_NOTE, 'Este perfil recoge la convocatoria de 37 plazas del CEGC. Otros organismos de bomberos (diputaciones, ayuntamientos, consorcios) no comparten batería nacional: cada convocatoria tiene la suya y el plan te pedirá el organismo y la versión de las pruebas.', 'Antes de las pruebas físicas la convocatoria exigió certificado médico oficial.'],
  askBeforeStart: ['organism', 'convocatoria', 'testVersion'],
}

const ORDER = [plc, pn, gc, cegc]
export const OFFICIAL_PROFILES = ORDER.map((p, i) => ({ ...p, version: 1, status: 'hidden', order: i + 1, sourceKind: 'official', createdBy: '2j', updatedBy: '2j', createdAt: SEEDED, updatedAt: SEEDED }))
export const SEED_VERSION = 1
