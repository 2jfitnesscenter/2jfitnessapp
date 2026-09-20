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
tras pulsar Descartar. Aparte de eso: cierre de V2 completado. Pendiente de que el
usuario haga el smoke test autenticado (login/passkey, Admin, panel entrenador, Bunker,
entrenamiento, IA auxiliar UI) — Claude no tiene passkey de producción.
**V3 no ha empezado todavía** — es la siguiente tarea de la sesión (notas de programación,
versionado, últimas sesiones, resumen de rutina, y OpenAI REST — ahora explícitamente API
REST directa, NO Codex CLI, ver la propia sección).

## Estado actual
- Working tree limpio, rama al día con origin (todo commiteado y empujado, incluido el
  fix del active atascado, commit `3e4e0b4`).
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
- Migración de `user_trainer` a ChatGPT/OpenAI API real — explícitamente fuera de V2,
  parte del alcance de V3 (ver más abajo, sección 13 de la petición original).
- **V3 no iniciada**: notas de programación por ejercicio, versionado de rutinas/programas,
  vista rápida "últimas 3 sesiones", resumen de rutina/programa en biblioteca, indicador de
  equipamiento no disponible en el resumen, e investigación (no necesariamente
  implementación) de OpenAI REST como proveedor de `user_trainer`. Pedida en la misma
  sesión que el cierre de V2 pero pospuesta para no comprometer el despliegue — empezar
  inspeccionando el modelo real de `routines`/`programs`/`entries`/`target`/`plan` antes
  de tocar nada, tal como pide la propia petición.

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
5. **Empezar V3** (notas de programación + versionado + últimas sesiones + resumen de
   rutina + OpenAI REST directo) — inspeccionando primero el modelo real de
   `routines`/`programs`/`entries` antes de tocar nada, alcance grande.

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

## OpenAI REST para el Entrenador IA de socios — pendiente para V3

El usuario ya probó Codex CLI en producción y confirmó que falla
(`Permission denied (os error 13)` al inicializar `app-server` — problema de permisos del
contenedor, **no intentar arreglarlo subiendo privilegios**). Instrucción explícita para
cuando se aborde V3: sustituir el mecanismo `user_trainer` completo por integración REST
directa (`2J frontend → backend 2J → OpenAI API`), NUNCA Codex CLI/device-code/app-server/
subprocess. Requisitos: API key desde Administración, cifrada en backend, nunca vuelve al
frontend, test de conexión, modelo configurable, errores de OpenAI distinguibles de una
sesión 2J caducada. No tocar Claude staff ni Gemini `auxiliary_ai`. Esto reemplaza (no
amplía) lo que se había anotado antes sobre "investigar OpenAI REST" — ahora es un
requisito concreto a implementar en V3, no solo investigar.

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
