# AI_HANDOFF.md — 2J Fitness Center

> Punto de traspaso entre agentes (Claude Code / Codex). Resumen operativo, no sustituye
> inspeccionar el repo — ver "Protocolo de relevo" al final.

## Proyecto
2J Fitness Center — app de gimnasio real. Frontend React 19 + Vite + Zustand
(`frontend/`), backend Node `http`-module sin framework (`api/`), Docker Compose + Caddy
en producción (Contabo VPS, `app.2jfitnesscenter.com`).

## Rama actual
`feat/pwa-tanita-bunker-roadmap`

## Último commit de código relevante
`3e4e0b4` — "fix: allow active workout to be discarded safely"
(anterior: `85b45ad` — V2, `14afe9d` — V1)

Commits `2eb932d` (handoff), `85b45ad` (V2), `14afe9d` (V1) y `3e4e0b4` (este fix) están
todos en `origin/feat/pwa-tanita-bunker-roadmap`.

**V1, V2 y el fix del active atascado ESTÁN DESPLEGADOS en producción** — V1/V2 desde
2026-09-20 ~20:45 UTC, el fix desde ~21:05 UTC. Confirmado: `GET
https://app.2jfitnesscenter.com/api/admin/aux-ai` → 401 (V2); `POST
/api/active/clear` → 401, no 404 (el fix).

## Objetivo/tarea actual
Bug de producción prioritario (sesión activa atascada) corregido, testeado, desplegado
(ver sección propia más abajo) — **pendiente de que el usuario confirme desde su propia
UI** que su sesión fantasma real ("Espalda & Bíceps - Enfoque Principal") ya no reaparece
tras pulsar Descartar. Aparte de eso: cierre de V2 completado.

**V3 implementada y testeada, TODAVÍA NO DESPLEGADA NI COMMITEADA** (instrucción
explícita del usuario: "No hagas commit" hasta finalizar y validar V3 — ver su propia
sección más abajo para el detalle completo). Working tree con cambios sin commitear en
19 archivos modificados + 4 nuevos (ver `git status` en "Estado actual").

## Estado actual
- **Working tree con cambios SIN commitear (V3)**: 19 archivos modificados + 4 nuevos
  (`api/coach/adapters/openai.js`, `api/test/openai-adapter.test.js`,
  `api/test/routine-versions.test.js`, `frontend/src/components/PlanSummaryLine.jsx`).
  Todo lo anterior a V3 (hasta el fix del active, commit `3e4e0b4`) sigue commiteado y
  empujado a `origin/feat/pwa-tanita-bunker-roadmap`.
- **Producción desplegada y sana** con el fix incluido: `docker compose ps` →
  api/web/caddy `Up`, `media` en `Exited (0)` (normal, init container). `curl
  .../api/health` externo → `{"ok":true,"users":13}` (datos intactos en ambos despliegues
  de hoy).
- Backups pre-deploy: `/root/backups/2jfitness-2026-09-20_2041.tar.gz` (V1+V2) y
  `2026-09-20_2104.tar.gz` (fix del active), además de los nocturnos automáticos.
- **Incidente en el despliegue de V1+V2 (corregido en el momento, no repetido en el del
  fix)**: el `chown` post-tar usaba `--exclude`, que no es una opción válida de `chown`, y
  cambió por error la propiedad de `/opt/2jfitness/data` (debe ser `root:root`) —
  detectado y revertido antes de reiniciar los contenedores. En el despliegue del fix se
  usó en su lugar `find /opt/2jfitness -mindepth 1 -maxdepth 1 ! -name data | xargs chown`,
  que nunca toca `data/` en absoluto — verificado `root:root` antes y después, sin
  incidente esta vez. Ver "Problemas conocidos".
- No hay PR abierto para esta rama (sigue faltando `gh` CLI o sesión de GitHub en este
  entorno).

## Trabajo completado

**V1** (superseries, sustitución, importación CSV V1, impresión adaptativa):
- Colores/identificadores de superserie (A1/A2/B1/B2) deterministas por orden de
  aparición — `frontend/src/lib/superset-colors.js`.
- Selector de sustitución: alturas uniformes, scroll horizontal de filtros.
- Importador CSV: soporte Gravl, agrupación de superserie conservadora.
- Impresión/PDF rediseñada: tabla por día, densidad adaptativa, nombre de archivo
  siempre "Rutina Nombre Apellidos (DD-MM-AAAA)" (igual para rutina suelta que programa).

**V2** (IA auxiliar, importación inteligente, equipamiento):
- Tercer perfil de IA `auxiliary_ai` (siempre Gemini), aislado de `staff_trainer`
  (Claude, panel entrenador) y `user_trainer` (Coach de socios, hoy OpenAI Codex CLI en
  producción). Credencial/prompt/log propios — `api/lib/aux-ai-config.js`.
- Capabilities de `auxiliary_ai`: `exercise_import_matching`, `machine_scan`,
  `measurements_scan`, `routine_scan` (los 3 escáneres migrados desde el Coach de socios
  en el último ajuste de esta sesión).
- Pipeline de importación CSV con revisión: alias gym-wide confirmados por humanos →
  candidatos locales → sugerencia opcional de Gemini (nunca aplicada sin confirmación) →
  pantalla "Revisar equivalencias" — `frontend/src/lib/import-match.js`.
- Antiduplicados real por huella de contenido, **por nombre de ejercicio (no por id)** —
  ver "Decisiones arquitectónicas" abajo, es la causa de un bug ya corregido.
- Disponibilidad de equipamiento a nivel de sala, independiente del bloqueo manual de
  ejercicio existente.

## Trabajo pendiente
- **Crear el PR** (rama lista, sin PR abierto — falta `gh` CLI o login de GitHub).
- **Smoke test autenticado en producción** (login/passkey, Admin, panel entrenador,
  Bunker, entrenamiento normal, historial, importación CSV real) — requiere que el
  usuario lo haga él mismo o conceda acceso temporal, Claude no tiene passkey.
- El usuario debe **configurar la API key real de Gemini** en Ajustes → Administración →
  "IA auxiliar" → Usar una clave de API, para poder probar de verdad
  `exercise_import_matching`/`machine_scan`/`measurements_scan`/`routine_scan`. Disparo
  manual de cada capability:
  - `machine_scan`: Progreso o Ajustes → "Escanear máquina" (según dónde esté montado en
    la UI del socio) → foto de una máquina/ejercicio.
  - `measurements_scan`: Ajustes → Medidas/Bioimpedancia → "Escanear informe" → foto/PDF
    de un informe de báscula de bioimpedancia.
  - `routine_scan`: Plan → "Escanear rutina" (o desde el panel de entrenador, por socio) →
    foto/PDF de una rutina impresa o manuscrita.
  - `exercise_import_matching`: Ajustes → Datos → "Importar de otra app" → subir un CSV
    con nombres de ejercicio que la biblioteca no reconozca sin alias previo.
- **V3 ya implementada y testeada** (ver su propia sección más abajo) — pendiente de
  revisión/autorización del usuario para commit + despliegue. Incluye la migración de
  `user_trainer` a OpenAI REST directo (adaptador nuevo, sin activar por defecto).

## Archivos principales modificados/creados (V1+V2, ambos ya commiteados)

Backend:
- `api/server.js` — rutas nuevas (equipamiento, aliases de importación, aux-ai, import-match)
- `api/lib/aux-ai-config.js`, `api/lib/aux-ai-routes.js`, `api/lib/import-exercise-match.js` (nuevos)
- `api/lib/machine-scan.js`, `measurements-scan.js`, `routine-scan.js` (migrados a auxAI)

Frontend:
- `frontend/src/lib/import-csv.js` — `workoutFingerprint()`, `mergeImport()` actualizado
- `frontend/src/lib/import-match.js` (nuevo) — pipeline de resolución de importación
- `frontend/src/lib/exercises.js` — `isUnavailable`/`isEquipmentUnavailable`
- `frontend/src/lib/alternatives.js`, `progression.js`, `views/RoutineEdit.jsx` — usan `isUnavailable`
- `frontend/src/sheets.jsx` — `ImportSummary` + nueva `ImportMatchReview`
- `frontend/src/views/AdminAuxAI.jsx` (nuevo), `views/Admin.jsx` — UI equipamiento + IA auxiliar
- `frontend/src/lib/plan-share.js`, `lib/superset-colors.js` — V1 impresión/superseries
- `frontend/src/locales/es.js` — claves nuevas V1+V2

## V2: IMPLEMENTADA · TESTEADA · DESPLEGADA

- **Commit desplegado**: `2eb932d` (incluye `85b45ad` V2 y `14afe9d` V1)
- **Fecha de despliegue**: 2026-09-20, ~20:45 UTC
- **Procedimiento**: el habitual de `docs/DEPLOY_RAIOLA.md` — copia de árbol (`git
  ls-files` + tar por SSH, `rsync` no disponible en este entorno) a `/opt/2jfitness`,
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. `data/`
  no se tocó (backup previo + incidente de permisos corregido, ver "Problemas conocidos").

## Tests pre-deploy (última ejecución, contra el commit desplegado)
- Frontend: `npx vitest run` → **538/538 OK**
- Backend: `node --test` → **123/123 OK**
- Build producción: `npx vite build` → OK (aviso preexistente de chunk >1500kB, no relacionado)
- E2E manual en navegador (backend de scratch, cuenta admin real, sesión previa): importación
  de los 3 CSV reales, revisión de equivalencias, antiduplicados, disponibilidad de
  equipamiento, aislamiento entre los 3 perfiles de IA.

## Smoke test post-deploy en producción real
- Infraestructura (sin sesión, verificado por Claude): `/api/health` interno y externo OK
  (`users:13`, datos intactos), contenedores `api`/`web`/`caddy` `Up`, `media` `Exited(0)`
  normal, logs de arranque sin errores, imagen de ejercicio (`/img/...`) sirve 200,
  `/api/admin/aux-ai` ya no da 404 (ahora 401 correcto), `/api/config` incluye
  `unavailableEquipment`, app carga visualmente y muestra la pantalla de login sin errores
  de consola (solo el 401 esperado de `/api/me` sin sesión).
- **Autenticado (login, Admin, panel entrenador, Bunker, entrenamiento, historial,
  importación CSV real, panel IA auxiliar): PENDIENTE — requiere passkey real del
  usuario**, no completado por Claude en esta sesión.

## Decisiones arquitectónicas importantes para continuar

1. **Huella antiduplicados por NOMBRE de ejercicio, no por id.** Un ejercicio no
   reconocido en un CSV recibe un id aleatorio nuevo (`'im'+uid()`) en cada parseo, así
   que una huella basada en id nunca coincide entre dos importaciones del mismo archivo.
   `workoutFingerprint(w, customExList)` resuelve el nombre real vía `EXIDX` o la lista de
   `customEx` pasada. **Si tocas esto, hazlo con mucho cuidado — ya se rompió una vez en
   pruebas E2E y se corrigió.**
2. **`auxiliary_ai` es 100% stateless** — una llamada = una respuesta, sin memoria entre
   llamadas, sin compartir prompt/contexto con `staff_trainer` ni `user_trainer`. No
   añadir estado compartido entre perfiles.
3. **Una sugerencia de Gemini nunca se aplica sola.** Solo se persiste como alias/id real
   cuando el usuario confirma explícitamente en "Revisar equivalencias" (o ya había un
   alias confirmado antes). Si tocas `import-match.js`, no rompas esa garantía.
4. **`GET /api/config` es público** (sin sesión) y expone `coach.provider`/`providerLabel`
   solo cuando el Coach está `enabled && connected` — útil para diagnosticar sin login,
   pero no expone nada de `auxiliary_ai` a propósito (se comprueba vía `/api/admin/aux-ai`,
   que requiere sesión admin).
5. Los 3 escáneres (`machine-scan`, `measurements-scan`, `routine-scan`) comparten el
   adaptador Gemini (`api/coach/adapters/gemini.js`) con `exercise_import_matching`, pero
   cada uno mantiene su propio prompt/schema — no fusionar los prompts.

## Problemas conocidos
- No hay PR abierto (falta `gh` CLI / sesión GitHub en este entorno).
- **Incidente de despliegue (corregido, sin impacto real)**: al extraer el tar en el
  servidor, `chown -R 2jfitness:2jfitness /opt/2jfitness --exclude=data` no es una opción
  válida de `chown`, y el fallback recursivo cambió por error la propiedad de
  `/opt/2jfitness/data` de `root:root` a `2jfitness:2jfitness`. Detectado inmediatamente
  (antes de reiniciar los contenedores) y revertido con `chown -R root:root
  /opt/2jfitness/data`. **Si vuelves a desplegar por este método (tar+ssh en vez de
  rsync), haz el `chown` del código ANTES de extraer sobre `data/`, o usa `rsync`
  directamente si está disponible — nunca un `chown -R` recursivo sobre todo `/opt/2jfitness`.**
- No se ha probado `auxiliary_ai` contra una API key real de Gemini en producción — el
  usuario debe añadirla desde el panel admin (ver "Trabajo pendiente").
- Smoke test autenticado (login, Admin, Bunker, entrenamiento, panel IA auxiliar UI,
  importación CSV real) sin verificar en producción — pendiente del usuario.
- String preexistente sin traducir en Admin.jsx (tarjeta "Room admin", línea ~553) — no
  introducido por V1/V2, no tocado.

## Siguiente acción recomendada
1. **El usuario prueba desde su propia UI** que pulsar Descartar en su sesión fantasma
   real ("Espalda & Bíceps - Enfoque Principal") la elimina de verdad y no reaparece.
2. El usuario hace el resto del smoke test autenticado en producción (login, Admin, panel
   entrenador, Bunker, entrenamiento, historial, IA auxiliar UI).
3. El usuario añade su API key de Gemini en "IA auxiliar" y prueba los 4 capabilities
   (comandos de disparo manual en "Trabajo pendiente" arriba).
4. Crear el PR (`gh pr create` o vía navegador autenticado) — comando ya preparado en el
   historial de la sesión.
5. **V3 ya implementada y testeada** (ver su propia sección más abajo) — pendiente de que
   el usuario la revise y autorice explícitamente commit + despliegue, igual que V1/V2.
   Antes de desplegar: probar el flujo de entrenador (notas, versionado, resumen) con una
   sesión real de trainer, y si se activa OpenAI como proveedor del Coach, probar el botón
   "Probar el Coach" en Admin con una API key real.

## BUG: sesión activa atascada ("Espalda & Bíceps...") — CORREGIDO Y DESPLEGADO

**Síntoma real reportado**: una sesión de entrenamiento activa reaparecía siempre al
volver a Entrenar, aunque el usuario la cerrara — mostrando un timer enorme (455:09) y
0 series hechas.

**Causa exacta (caso B de los propuestos)**: `PUT /api/data` (api/server.js) reinyecta
deliberadamente el `active` que YA tiene el servidor cada vez que es verdadero — protección
a propósito para que un sync normal del móvil nunca borre una sesión corriendo en el
Bunker. Pero eso significa que NINGÚN camino normal (ni Descartar ni Finalizar) podía
jamás limpiar `active` en servidor: ambos solo hacían `s.active = null` local +
`pushState()` genérico, y el propio PUT deshacía ese `null` reinyectando lo que ya había
en disco. Confirmado por inspección de código y reproducido en E2E real (ver abajo) —
**el mismo bug afectaba también a un Finalizar normal**, no solo a Descartar (nunca
reportado porque en el mismo dispositivo el usuario rara vez vuelve a arrancar la app
justo después, pero el "fantasma" queda en disco esperando el próximo pull con `active`
local vacío).

**Qué hacía la X realmente**: ya estaba correctamente etiquetada "Descartar" con
confirmación (`Workout.jsx`) — no era un problema de UX/semántica, el botón siempre quiso
decir "descartar", el problema era 100% de persistencia servidor.

**Solución**: nuevo endpoint `POST /api/active/clear` (en `api/bunker/routes.js`, sesión
de cookie normal, no token de Bunker) — el único camino autorizado para terminar
`S.active` de verdad:
- Body `{ id }`: solo limpia si `S.active.id` coincide (protege contra una carrera —
  nunca borra una sesión distinta que la haya reemplazado).
- **Protección extra para Bunker**: si `store.getSession(uid)` dice que el socio está
  fichado en el Bunker AHORA MISMO, devuelve 409 y no toca nada — cubre el caso de un
  segundo dispositivo con la sesión pre-handoff todavía abierta intentando descartarla
  (el `id` por sí solo no lo detecta, porque un handoff no cambia el `id`).
- Idempotente, nunca cruza cuentas (usa `readSession` → solo el propio usuario).
- Llamado desde `Workout.jsx` (botón Descartar) y `sheets.jsx`'s `doFinishWorkout`, ambos
  vía la nueva acción `clearActiveOnServer(id)` en `useStore.js`, que primero hace
  `pushState()` (para no perder lo que se acaba de finalizar) y LUEGO llama al endpoint;
  si falla (offline), lo reintenta una vez en el siguiente `boot()` (`localStorage`
  `gym_pending_active_clear`, mismo patrón que `gym_dirty`).

**Timer 455:09**: no es un bug — `Elapsed` calcula `Date.now() - start`, tal cual. Un
`active` fantasma de horas de antigüedad produce exactamente ese número. Confirmado.

**Tests**: nuevo `api/test/active-discard.test.js`, 10/10 (servidor real spawneado, mismo
patrón que `data-active-preserve.test.js`) — cubre discard normal, idempotencia, id
distinto no borra la sesión correcta, Finalizar sigue limpiando, PUT normal sigue
preservando un active ajeno (regresión), handoff a Bunker sigue funcionando, aislamiento
entre usuarios, **rechazo mientras la sesión está viva en el Bunker (409)**, y que vuelve
a funcionar en cuanto esa sesión del Bunker termina. Suite completa: backend 133/133,
frontend 538/538 (sin tests de frontend nuevos — `useStore.js` usa `localStorage`
directamente y este proyecto no tiene jsdom configurado en vitest, así que no es
testeable ahí sin un cambio de entorno más amplio; cubierto en su lugar por E2E real).

**E2E real** (backend de scratch, estado escrito directamente en disco para simular un
usuario real con sesión ya persistida — no un usuario nuevo, que esconde el bug por tener
`readState()===null` la primera vez): reproducido el síntoma exacto ("Espalda & Bíceps -
Enfoque Principal", "455:1X · 0/1 series") tras un boot limpio; Descartar → boot limpio →
ya NO reaparece (`Empezar entrenamiento`); Finalizar → guarda el workout con récord
detectado → boot limpio → tampoco reaparece. Ambos verificados con `active:null` explícito
en el servidor entre medias.

**Estado**: **CORREGIDO · TESTEADO · DESPLEGADO EN PRODUCCIÓN.** Commit `3e4e0b4` ("fix:
allow active workout to be discarded safely"), desplegado 2026-09-20 ~21:05 UTC.

**Archivos modificados**: `api/bunker/routes.js` (nuevo endpoint), `frontend/src/store/useStore.js`
(`clearActiveOnServer`, retry en `boot()`), `frontend/src/views/Workout.jsx` (botón
Descartar), `frontend/src/sheets.jsx` (`doFinishWorkout`), `api/test/active-discard.test.js` (nuevo).

**Despliegue**: backup previo (`/root/backups/2jfitness-2026-09-20_2104.tar.gz`), tar+ssh
igual que V2 pero esta vez el `chown` post-extracción usó `find ... ! -name data | xargs
chown` en vez del `--exclude` inválido que causó el incidente de V2 — `data/` confirmado
`root:root` antes y después del despliegue, sin incidente. `docker compose ... up -d
--build`, contenedores sanos, `users:13` intacto.

**Smoke test post-deploy**: `/api/health` interno y externo OK; `POST /api/active/clear`
ya responde 401 (no 404) — confirma que el endpoint nuevo llegó; `/api/data` sigue
gateado; Bunker (`/api/bunker/board`, `/settings`, `/checkin`, `/handoff`) responde con su
comportamiento normal, nada roto; `coach` (Entrenador IA de socios) sin cambios
(`provider: codex`); logs de los 3 contenedores sin errores nuevos.

**PUT /api/data sigue preservando el active del servidor**: confirmado — el propio `git
diff` de este fix no toca esa función en absoluto (0 líneas cambiadas en el handler de
`PUT /api/data`), y el test de regresión dedicado (`active-discard.test.js`, caso 7)
pasa contra este mismo commit. **No se tocó `S.active` del usuario real en producción a
propósito** (instrucción explícita) — no se generó una cuenta sintética para probarlo en
vivo porque habría sido una escritura de datos de producción fuera del flujo normal de la
app, más arriesgada que necesaria dado que el propio handler no cambió.

**Prueba manual pendiente del usuario**: tiene ahora mismo su sesión fantasma real
"Espalda & Bíceps - Enfoque Principal" en producción — va a pulsar él mismo Descartar
desde la UI (con su passkey real) y confirmar que ya no reaparece. Resultado esperado:
Descartar → confirmación → vuelve a Entrenar → `Empezar entrenamiento` (nada atascado).

## V3 — Programación y seguimiento — IMPLEMENTADA Y TESTEADA, SIN COMMITEAR NI DESPLEGAR

**Estado**: todo lo pedido está implementado y con tests en verde (frontend 553/553,
backend 150/150, build de producción OK). **Sin commit, sin desplegar** — instrucción
explícita del usuario para V3 era no commitear hasta terminar y validar; el commit/deploy
en sí necesita una nueva autorización explícita, igual que en V1/V2.

### 1-4. Notas de entrenador (ya existían — solo faltaban 2 huecos)
`routine.ex[i].note` **ya existía completo end-to-end** antes de esta sesión (edición
desde "…" → Notas en `RoutineEdit.jsx`/`TrainerRoutineBuilder.jsx`, viaja automáticamente
a `S.active.entries[].target.note` vía el spread de `progression.js`'s
`buildRoutineEntries`, y sobrevive a un workout finalizado como snapshot congelado —
nunca cambia retroactivamente un entrenamiento ya hecho). Los dos huecos reales:
- **Visible durante el entrenamiento**: nuevo `ExerciseNoteLine` en `Workout.jsx`, línea
  compacta de una sola línea con "tap para expandir", nunca confundida con la línea de
  "Last time"/overload/PR/aviso naranja de no-disponible (todas en filas separadas).
- **Impresión**: `dayTableHTML` (`plan-share.js`) ahora incluye la nota bajo el nombre del
  ejercicio (`class="ex-note"`), truncada a 70 caracteres con "…" — nunca rompe la
  densidad adaptativa ni el objetivo de página (2 días≈1 página, 5 días≈2 páginas), sin
  rediseñar el PDF de V1. 3 tests nuevos en `plan-share.test.js`.

### 5-7. Versionado de rutinas/programas asignados — traceability, no restauración
Enganchado en el ÚNICO punto de sobrescritura que tienen `POST
/api/trainer/member-routine`/`member-program` (`api/server.js`): antes de reemplazar una
rutina/programa YA EXISTENTE (`existingIdx >= 0`), `snapshotVersionIfChanged()` compara el
contenido real (todo menos `id`) del objeto viejo contra el nuevo — si cambió de verdad,
guarda el OBJETO VIEJO completo + `versionedAt` en `S.routineVersions[id]` /
`S.programVersions[id]` (array, más reciente al final, tope de 20 por id). Si es un
re-guardado idéntico (sin cambios reales), **no crea versión** — nada de spam. Un cambio
de equipamiento disponible nunca crea versión porque el estado de equipamiento no forma
parte del objeto rutina/programa en absoluto.
- Alcance deliberadamente limitado a rutinas/programas **asignados por el entrenador**
  (los dos endpoints de trainer) — la edición de una rutina propia por el propio socio va
  por un camino distinto (`PUT /api/data`, sobrescritura completa del estado) y no se
  tocó; versionar eso habría sido un cambio bastante más grande y no es lo que pide la
  petición ("rutina o programa asignado").
- Consulta: `GET /api/trainer/routine-versions`/`program-versions?memberId=&routineId=`
  (o `programId=`) → `{ current, versions }`, versiones más recientes primero. Sin
  endpoint de restauración (ni se pidió — "traceability, no editor de diff").
- UI: botón "Version history" (icono reloj) en `TrainerRoutineBuilder.jsx`/
  `TrainerProgramBuilder.jsx`, visible solo si la rutina/programa ya tiene id (no en
  "nueva"), abre una sheet nueva (`routineVersionsSheet`/`programVersionsSheet` en
  `sheets.jsx`) con fecha+hora y un resumen (nº ejercicios o nº rutinas) por versión.
- 8 tests nuevos en `api/test/routine-versions.test.js` (creación sin versión, cambio real
  → 1 versión con el contenido VIEJO, re-guardado idéntico → 0 versiones, varias versiones
  acumuladas en orden, workouts finalizados nunca tocados, mismo comportamiento para
  programas, aislamiento no-entrenador en lectura y escritura).

### 8-9. Últimas 3 sesiones — contexto rápido de ejercicio
`recentEntriesFor(S, exId, n=3)` nuevo en `history.js`, generaliza el `lastEntryFor`
existente (que ahora es un wrapper de una línea sobre este) — mismo criterio de siempre
(solo sets reales hechos, excluye warmup/no-hecho, respeta cardio, busca por id exacto así
que una sustitución mid-sesión no fusiona historiales, comportamiento ya existente sin
cambios). UI: la sheet `ExerciseDetail` ya existente (icono "Detalles" durante el
entrenamiento) gana un botón "Mostrar/ocultar sesiones anteriores" colapsado por defecto
que revela las sesiones 2-3 — la sesión 1 ("Last session") sigue siempre visible igual que
antes, nunca se muestran 3 sesiones completas de forma permanente. 8 tests nuevos en
`history.test.js`.

### 10-11. Resumen de rutina/programa en biblioteca/panel de entrenador
`routineSummaryOf(ex)` nuevo en `superset-colors.js` (import de `isUnavailable` desde
`exercises.js` — confirmado sin ciclo: `exercises.js` no importa de `history.js` ni de
`superset-colors.js`) → `{ exCount, superGroups, unavailable }`. Nuevo componente
compartido `frontend/src/components/PlanSummaryLine.jsx` (`RoutineSummaryLine`,
`ProgramSummaryLine`) usado en las filas de lista de `views/Plan.jsx` y
`views/trainer/TrainerClientPlan.jsx`: "N ejercicios · N superseries · N no disponibles
ahora" (en naranja, mismo tono que el aviso de no-disponible en `RoutineEdit.jsx`), cada
parte omitida si es 0 — nunca "0 superseries". Para programas también cuenta días
programados (`Object.keys(week).length`) y ejercicios no disponibles sumados en sus
rutinas. **Fecha/versión se deja fuera del resumen deliberadamente** — la propia petición
dice "si existe", y aunque el versionado (sección 5-7) ya existe, mostrarlo en la fila de
lista habría requerido pasar el conteo de versiones a cada fila (una llamada extra por
fila) y no se pidió explícitamente ahí; queda disponible vía el botón "Version history"
dentro del propio builder. No se inventó ninguna duración estimada (no hay fórmula/datos
fiables). 4 tests nuevos en `superset-colors.test.js`. Verificado visualmente en el
navegador (modo `VITE_DEMO=1`, temas claro y oscuro) inyectando una superserie de prueba.

### 12. Flujo E2E entrenador → socio
No hay passkey de producción disponible para un E2E autenticado real de extremo a extremo
en el navegador. Cubierto en su lugar por: (a) los 8 tests de `routine-versions.test.js`
que ejercitan el flujo real de guardado del entrenador vía HTTP contra un servidor real
(crear rutina → editar con cambio real → verificar versión → consultar); (b) el hecho
demostrado de que notas/últimas-sesiones ya eran (notas) o ahora son (últimas sesiones)
puramente funciones sobre snapshots ya verificados por sus propios tests unitarios; (c)
verificación visual en navegador del resumen de rutina. Sin cobertura E2E autenticada real
del panel de entrenador (`/trainer/*`, requiere sesión + flag `trainer:true`) — pendiente
de que el usuario lo prueba él mismo o conceda una sesión de prueba.

### 13. OpenAI REST directo para el Entrenador IA de socios — IMPLEMENTADO
Sustituye la idea de arreglar Codex CLI (que fallaba con `Permission denied (os error 13)`
por permisos del contenedor — **no se tocaron permisos del contenedor**, tal como se
instruyó). Nuevo adaptador `api/coach/adapters/openai.js`, calcado de `gemini.js`: una
petición HTTPS a `POST https://api.openai.com/v1/chat/completions` (Chat Completions,
`response_format: json_object`), sin CLI/subprocess/device-code/app-server. Registrado en
`api/coach/adapters/index.js` (`ADAPTERS.openai`) y en `api/coach/config.js`
(`PROVIDERS.openai = { label: 'OpenAI', runtime: 'OpenAI API', apiKeyEnv:
'OPENAI_API_KEY', oauthEnv: null }`, mismo patrón exacto que Gemini — sin
`setupToken`/`deviceLogin`).
- **Confirmado por inspección de código, no solo por diseño previo**: `jobEnv()`,
  `isConnected()`, `oauth.js`'s `setApiKey`/`authStatus`/`disconnect`, `jobs.js`'s
  `testRun()`/clasificación de errores (`errorClass`, regex sobre el texto del error —
  agnóstica de proveedor), y `coach/routes.js`'s listado de `providers` para el admin son
  TODOS genéricos por proveedor — **cero cambios adicionales en backend o frontend** más
  allá del adaptador y las dos entradas de registro. El chip "OpenAI" aparece solo en el
  panel Admin → Coach con el flujo "Usar una clave de API" ya existente, igual que Gemini.
- API key: solo desde Administración, cifrada en reposo (mismo `crypto.js` que el resto),
  **nunca llega al frontend** (el backend solo expone `provider`/`providerLabel` cuando
  está `enabled && connected`, nunca el valor de la clave). Modelo configurable
  (`cfg.model`, por defecto `gpt-5.1`). Test de conexión: el botón "Guardar y probar" /
  "Probar el Coach" ya existente en Admin llama a `testRun()`, que ahora también funciona
  con `provider: 'openai'` sin cambios.
- **No se ha cambiado el proveedor activo en producción** (sigue siendo `codex`) — activar
  OpenAI es una acción del usuario desde Admin cuando quiera, con su propia API key.
- No toca `staff_trainer` (Claude) ni `auxiliary_ai` (Gemini) — perfiles completamente
  aislados, confirmado por inspección (cada uno con su propio `config.js`/credencial/log).
- **"Distinguir errores de OpenAI de una sesión 2J caducada"**: confirmado (ya en la
  investigación previa a esta sesión) que "sesión 2J caducada" no es un concepto que
  exista en este flujo — la sesión de cookie de 2J se comprueba en el borde HTTP
  (`readSession`) antes y de forma completamente separada de cualquier error de proveedor
  del Coach; un fallo de autenticación de OpenAI (401/403) se clasifica como `errorClass:
  'auth'` por el propio texto del error ("Incorrect API key..."), un fallo de red/servidor
  como `'provider'`, un timeout como `'timeout'` — igual que cualquier otro proveedor.
- 10 tests nuevos: `api/test/openai-adapter.test.js` (check/invoke con fetch mockeado —
  key ausente, respuesta 200, 401→código 2/auth, 500→código 1, respuesta vacía, timeout,
  identidad del adaptador) + 1 test en `config.test.js` (registro del proveedor, cifrado,
  `jobEnv` no toca `CODEX_HOME`) + actualizada la aserción de la lista de proveedores.
- **No se rediseñaron prompts** (fuera de alcance, tal como se pidió).

### 15. Compatibilidad de datos — verificado
Todo lo de V3 es aditivo: `S.routineVersions`/`S.programVersions` son campos nuevos que no
existen en estados antiguos (`(S.routineVersions || {})[id] || []` en todas partes, nunca
asume que existan); ninguna rutina/programa/workout/active/dayPlan/alias/equipamiento
existente se toca ni se reescribe; un usuario sin estas versiones simplemente ve un
historial vacío la primera vez que se le crea. `routineSummaryOf`/`recentEntriesFor` son
funciones puras de lectura, cero migración. Confirmado con la suite completa contra datos
de ejemplo ya existentes (`sampleState()` en `helpers.mjs`, sin campos nuevos) — todo
sigue funcionando sin tocarlos.

### 16. Tests — resumen
- Frontend: `npx vitest run` → **553/553 OK** (29 archivos).
- Backend: `node --test` → **150/150 OK**.
- Build de producción: `npx vite build` → OK (mismo aviso preexistente de chunk >1500kB,
  no relacionado con V3).

### 14. No implementado (tal como se pidió que no se hiciera)
Nada de lo explícitamente excluido en la petición de V3 se tocó: sin estadísticas nuevas,
sin rediseño de Bunker, sin funciones sociales nuevas, sin recomendaciones/chatbot de
Gemini, sin builder nuevo, sin análisis biométrico, sin logros nuevos, sin cambios de
superseries, sin rediseño del PDF, sin formatos de CSV nuevos, sin que la IA modifique la
programación sola, sin editor de diff complejo, sin notificaciones nuevas.

---

## Protocolo de relevo

- Git y el código actual son la fuente de verdad.
- `AI_HANDOFF.md` es un resumen operativo, no sustituye inspeccionar el repositorio.
- Antes de continuar, comprobar rama, `git status`, últimos commits y diff.
- No rehacer trabajo marcado como completado sin demostrar un problema.
- Antes de entregar, ejecutar los tests relevantes.
- Al terminar una sesión de trabajo, actualizar `AI_HANDOFF.md`.
- Si hay cambios sin commit, indicarlos explícitamente.
- Si una decisión puede causar pérdida de datos, cambio de arquitectura, auth, sync o
  seguridad, detenerse y preguntar.
- Claude y Codex no deben editar simultáneamente el mismo working tree.
