# Entrena tus Oposiciones V1

Familia Premium especial: un plan **a largo plazo y adaptativo** para las pruebas físicas de una oposición (no una rutina). Rama
`codex/personalization-v2-premium-oposiciones`. Nada de esto se despliega solo: la entrada del catálogo y los cuatro perfiles
oficiales llegan **ocultos** y el administrador los publica.

## Principio rector

Las pruebas, las marcas mínimas y la fuente **nunca viven en el código**: son datos versionados (`OppositionProfile`). Si falta un
dato (una marca, el sexo/edad cuando las marcas dependen de ellos, una convocatoria que no está en el catálogo), el plan y la IA
**lo dicen** en lugar de inventarlo. Las fuentes son solo oficiales (BOE, BOC, BOP, el propio organismo); un blog o academia no es
una fuente (el validador exige `source.kind = 'official'` con organismo, referencia y fecha).

## Arquitectura (sin sistemas paralelos)

| Pieza | Dónde |
|---|---|
| Modelo puro compartido (validación, puntuación, niveles, horizontes, bloques, evaluación, propuesta, resúmenes) | `frontend/src/lib/opposition-model.js` → copia `api/lib/opposition-model.js` (`scripts/sync-opposition-model.mjs`) |
| Perfiles oficiales (datos) | `scripts/opposition/profiles.mjs` → `api/lib/opposition-official.json` (`scripts/build-opposition-profiles.mjs`, `--check` en CI) |
| Catálogo (overlay del admin, versiones, estados) | `api/lib/opposition-store.js` + `DATA/opposition.json` |
| Rutas | `api/lib/opposition-routes.js` (`/api/opposition/*`, mismo interruptor `premium`) |
| Estado del socio | `S.opposition = { v:1, plan, history }` (Sync V2 lo trata como opaco: sin cambios de API) |
| Entrenamiento | **Motor Premium**: el bloque en curso es `S.premium.active` (programId `opposition-<planId>-b<n>`) |
| Entrada del catálogo | programa Premium `entrena-tus-oposiciones` (`methodType: 'opposition'`, oculto por defecto; abrirlo lleva a `/oposiciones`) |
| Coach / IA | `api/lib/opposition-context.js` → fila del roster, ficha y `oppositionPlan` del payload de IA |
| Admin | Administración → Oposiciones (`/oposiciones/manage`) |

## OppositionProfile

`id, slug, name, body, organism, version, status, convocatoria{title,plazas,year,reference}, source{kind:'official',organism,document,
publication,date,reference}, validFrom, validUntil, scoring{model,maxPoints,minPoints,referencePoints,rule{kind:'all-min'|'average',min}},
categories{bySex,ageBands}, tests[], notes[], askBeforeStart[]`.

`Test`: `id, name, capacity, movement, kind(time|reps|hold|distance), unit, distanceM?, durationS?, only?(['m'|'f']), description, notes?,
marks{ categoría → [{p, v, label?}] }` — `v` es el valor que **gana** esos puntos (el tiempo más lento / las repeticiones más bajas de
la banda impresa). Categorías: `m`, `f`, `m:u35`, `*`… Las diferencias reales entre sexos (dominadas hombres / suspensión mujeres) son
dos pruebas con `only`.

### Perfiles que se entregan (todos `hidden`, versión 1)

| Perfil | Fuente oficial | Fecha |
|---|---|---|
| Policía Local · Canarias (convocatoria unificada) | BOC núm. 215, 30-10-2025, disp. 3702, Anexo II (BOC-A-2025-215-3702) | 2025-10-30 |
| Policía Nacional · Escala Básica | BOE núm. 167, 10-07-2026, Anexo II (BOE-A-2026-15055) | 2026-07-10 |
| Guardia Civil · Cabos y Guardias | BOE 08-05-2026, Resolución 160/38243/2026, Apéndice II (BOE-A-2026-9982) | 2026-05-08 |
| Bombero/a · Consorcio de Emergencias de Gran Canaria | BOP Las Palmas nº 153, 22-12-2025, Anexo III | 2025-12-22 |

Límites conocidos, dichos en el propio perfil (`notes`) y no rellenados:
- **Policía Local Canarias**: el BOC imprime `APTO 2.499 m` (H) y `2.299 m` (M) en el Cooper seguido de tramos de 6 puntos desde 2.500/2.300 m;
  en la suspensión de mujeres el tramo de 10 puntos es «83 a 94 s»; en el salto de mujeres 9 y 10 puntos solapan en 2,24 m. Se mantienen **como
  están impresos**.
- **Policía Nacional / Guardia Civil**: el circuito de agilidad es una imagen y no se recoge; el plan entrena agilidad genérica y lo dice.
- **Guardia Civil**: pruebas apto / no apto: no hay puntos; el objetivo "sólido/alto" es un margen de seguridad sobre el mínimo (no una marca oficial).
- **Bomberos CEGC**: el press de banca solo imprime mínimo (5 p) y máximo (10 p); los puntos intermedios no existen en las bases. El 1.500 m
  imprime las mismas marcas para hombres y mujeres. Otros organismos de bomberos **no** comparten batería nacional: el asistente pregunta
  organismo, convocatoria y versión de las pruebas y avisa si el perfil es de otro organismo; el administrador puede crear el perfil de otra.
- La biblioteca de ejercicios no tiene natación ni circuito de vallas: los bloques de piscina/agilidad usan un ejercicio sustituto con la nota
  que lo explica (el tiempo se anota igualmente).

## Plan

1. **Intake** (asistente de 6 pasos, `views/Opposition.jsx`): oposición y datos de la convocatoria → sexo/edad **solo si las marcas dependen
   de ellos** → experiencia, años entrenando, nivel percibido → días/semana, minutos/sesión, material, restricciones (zonas codificadas, sin
   texto libre) → fecha de examen y/o horizonte 6/12/18/24 meses + ambición (mínimo / margen sólido / alto) → marcas actuales por prueba
   (vacías = no se inventan) → resumen con nivel, fases y avisos (reemplazo de planificación activa, datos que faltan).
2. **Nivel por capacidad** desde las marcas (posición entre el mínimo de referencia y la marca máxima: <0,25 principiante, <0,65 intermedio,
   si no avanzado). La auto-percepción solo cubre lo que no se puede medir y queda marcada `estimated`.
3. **Fases, no cuatro rutinas gigantes**: Base · Desarrollo · Especificidad · Competitiva (6 m: 20/40/30/10 %, 12 m: 30/35/25/10, 18 m:
   35/35/20/10, 24 m: 40/30/20/10; con fecha de examen la duración es hasta ese día).
4. **Bloques de 5 semanas** (4 de entrenamiento, la última más ligera + **semana de control** con las pruebas oficiales repartidas como en
   una convocatoria). Se entrenan **todas** las capacidades de las pruebas reales; las más débiles más veces. Ritmos y objetivos salen de
   las marcas del socio y del objetivo oficial. Restricciones: el ejercicio que carga la zona se sustituye y el bloque lo dice.
5. **Control**: el socio introduce las marcas; la app compara inicial / anterior / actual / mínimo oficial / objetivo / proyección y asigna
   estado por prueba (`above-target`, `on-track`, `stalled`, `at-risk`, `no-data`).
6. **Adaptación = propuesta + confirmación**: volumen −20 % (dolor/fatiga alta), −15 % (adherencia <60 %), +10 % (adherencia ≥85 % y sin
   puntos débiles); más trabajo en capacidades estancadas/en riesgo; cambio de fase; alerta de revisión humana (`review`) si hay riesgo,
   adherencia <50 % o dolor. Nunca se aplica solo; solo se guarda la propuesta pequeña y el bloque se regenera de forma determinista.
7. **Nueva convocatoria = nueva versión**: el plan fija una copia (`plan.profile`) de la versión con la que se creó; la app ofrece la
   nueva con el listado de cambios y solo el socio la acepta (la anterior queda en `plan.profileHistory`). Un plan activo no cambia nunca
   en silencio.

## Administración y permisos

- Administrador: crear, editar, versionar, publicar, ocultar, archivar; ver historial y versiones anteriores. Cambiar pruebas, marcas,
  puntuación, categorías o fuente **crea una versión nueva** (la anterior queda en el historial); un cambio de nombre/notas no.
  Solo se borra un borrador nunca publicado ni usado; lo demás se archiva.
- Entrenador y socio: solo leen los perfiles **publicados**. El interruptor global `premium` los apaga para socios (403 `feature_off`).
- La entrada del catálogo Premium (`entrena-tus-oposiciones`) sigue las reglas normales (oculta/publicada/destacada/NUEVO).

## Coach e IA

Fila del roster, ficha (versión + fecha de fuente, tiempo restante, fase, nivel por capacidad, marcas frente a mínimo y objetivo,
adherencia, alertas) y `oppositionPlan` en la IA: `oppositionId, oppositionVersion, sourceDate, examDate, monthsPlan, weeksLeft, phase,
week, block, levelByCapacity, testResults, weakPoints, officialThresholds, testStatus, missingData, adherence, alerts, restrictionAreas`.
**Nunca** nombre, sexo, edad, categoría ni texto libre del socio. El prompt obliga a usar los umbrales reales y a decir que falta un dato.

## Pruebas

`api/test/opposition-catalog.test.js` (6), `api/test/opposition-coach.test.js` (6), `frontend/src/lib/opposition-model.test.js` (27),
`opposition.test.js` (11), `views/opposition-ui.test.jsx` (9), más las de Premium (segunda ola). Marcas verificadas una a una contra las
tablas oficiales transcritas.
