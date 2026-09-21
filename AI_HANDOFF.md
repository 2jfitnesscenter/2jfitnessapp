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
`ee7c0e5` — "feat: v1.3.0 — Bunker multi-session resume, changelog"
(anterior: `96533f1` — V3, `3e4e0b4` — fix active atascado, `85b45ad` — V2, `14afe9d` — V1)

Commits `2eb932d` (handoff), `85b45ad` (V2), `14afe9d` (V1), `3e4e0b4` (fix active),
`96533f1` (V3), `ee7c0e5` (fix Bunker + versión 1.3.0 + changelog) y `1fb283f` (docs) están
todos en `origin/feat/pwa-tanita-bunker-roadmap`. **PR #10 abierto** —
[github.com/2jfitnesscenter/2jfitnessapp/pull/10](https://github.com/2jfitnesscenter/2jfitnessapp/pull/10),
`feat/pwa-tanita-bunker-roadmap` → `2jfitness-dev` (la rama por defecto real del repo —
`main` no existe), `MERGEABLE`, 61 archivos. `gh` CLI SÍ está instalado en este entorno,
solo que no en el `PATH` de la sesión de shell activa — el binario está en
`C:\Program Files\GitHub CLI\gh.exe`, ya autenticado como `2jfitnesscenter`. Usar la ruta
completa o `--repo 2jfitnesscenter/2jfitnessapp` explícito: el `remote upstream` de este
repo (`alexpcosta/opengym`) hace que `gh` sin `--repo` resuelva al fork equivocado.

**V1, V2, el fix del active atascado, V3 y el fix del Bunker (minimizar/volver) ESTÁN
DESPLEGADOS en producción** — V1/V2 desde 2026-09-20 ~20:45 UTC, el fix del active desde
~21:05 UTC, V3 desde ~21:47 UTC, el fix del Bunker + v1.3.0 desde 2026-09-21 ~09:35 UTC.
Confirmado: `GET https://app.2jfitnesscenter.com/api/admin/aux-ai` → 401 (V2); `POST
/api/active/clear` → 401, no 404 (el fix); `GET /api/trainer/routine-versions` y
`/api/trainer/program-versions` → 401, no 404 (V3); el bundle en producción contiene el
código del fix del Bunker (`bk-card-resume`) y la entrada `v1.3.0` del changelog;
`coach.provider` está en `gemini` (cambiado por el propio usuario entre sesiones, no por
ningún despliegue de esta sesión).

## Objetivo/tarea actual
Bug de producción prioritario (sesión activa atascada) corregido, testeado, desplegado
(ver sección propia más abajo) — **pendiente de que el usuario confirme desde su propia
UI** que su sesión fantasma real ("Espalda & Bíceps - Enfoque Principal") ya no reaparece
tras pulsar Descartar. Cierre de V2 completado.

**V3 implementada, testeada, commiteada y DESPLEGADA EN PRODUCCIÓN** (autorización
explícita del usuario: "commitea y despliega todo que funcione, esta semana se probará").
Ver su propia sección más abajo para el detalle completo.

**Bug reportado en producción tras el despliegue de V3 (usando el Bunker real): "minimizo mi
sesión para que otro socio entre, y luego no puedo volver a la mía — aparece pero no puedo
acceder".** Diagnosticado, corregido, testeado (unitario + E2E real local) y **DESPLEGADO EN
PRODUCCIÓN** (autorización explícita: "commitea, publica, despliega y sube todo a github").
Ver su propia sección más abajo para el detalle completo.

**Versión de la app subida a 1.3.0** (`frontend/package.json`, `api/package.json`) —
`CHANGELOG.md` y el changelog interno (`frontend/src/lib/changelog.js`, con sus
traducciones en `es.js`) documentan ahora todo lo entregado desde v1.2.3: V1, V2, el fix
del active, V3 y el fix del Bunker. Antes de esto, ninguno de esos cinco entregables tenía
ni una línea en el changelog — es lo que el usuario reportó como "no veo versiones nuevas".

Pendiente: que el usuario y sus socios prueben todo esta semana en producción (notas,
versionado, últimas sesiones, resumen, Bunker multiusuario, y opcionalmente OpenAI como
proveedor del Coach desde Admin).

## Estado actual
- **Working tree limpio, rama al día con origin** — todo commiteado y empujado, incluido el
  fix del Bunker + versión 1.3.0 + changelog (`ee7c0e5`).
- **Producción desplegada y sana** con todo lo anterior incluido: `docker compose ps` →
  api/web/caddy `Up`, `media` en `Exited (0)` (normal, init container). `curl
  .../api/health` externo → `{"ok":true,"users":13}` (datos intactos en todos los despliegues
  de esta sesión, incluido el de hoy 2026-09-21).
- Backups pre-deploy: `/root/backups/2jfitness-2026-09-20_2041.tar.gz` (V1+V2),
  `2026-09-20_2104.tar.gz` (fix del active), `2026-09-20_2044.tar.gz` (V3 — nombre por
  hora del servidor, tomado justo antes del despliegue de V3) y
  `2026-09-21_0832.tar.gz` (fix del Bunker + v1.3.0), además de los nocturnos automáticos.
- **Rama por defecto real del repo en GitHub: `2jfitness-dev`, NO `main`** (descubierto al
  intentar abrir el PR — `main` no existe como rama en este repositorio). Cualquier comando
  `gh pr create --base main` de sesiones anteriores está mal — usar
  `--base 2jfitness-dev`. `feat/pwa-tanita-bunker-roadmap` está 11 commits por delante de
  `2jfitness-dev` y 1 por detrás (confirmado en
  `github.com/2jfitnesscenter/2jfitnessapp/compare/2jfitness-dev...feat/pwa-tanita-bunker-roadmap`).
- **Incidente en el despliegue de V1+V2 (corregido en el momento, no repetido en ninguno
  de los siguientes)**: el `chown` post-tar usaba `--exclude`, que no es una opción válida
  de `chown`, y cambió por error la propiedad de `/opt/2jfitness/data` (debe ser
  `root:root`) — detectado y revertido antes de reiniciar los contenedores. En los
  despliegues siguientes (fix del active y V3) se usó en su lugar `find /opt/2jfitness
  -mindepth 1 -maxdepth 1 ! -name data | xargs chown`, que nunca toca `data/` en
  absoluto — verificado `root:root` antes y después en ambos, sin incidente. Ver
  "Problemas conocidos".
- PR #10 abierto (ver arriba).

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
- ~~Crear el PR~~ — hecho, PR #10 abierto.
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
- **V3 implementada, testeada, commiteada y desplegada** (ver su propia sección más
  abajo). Incluye la migración de `user_trainer` a OpenAI REST directo (adaptador nuevo,
  sin activar por defecto — sigue en `codex`).

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
- PR #10 abierto (ver arriba).
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
4. ~~Crear el PR~~ — hecho: PR #10,
   [github.com/2jfitnesscenter/2jfitnessapp/pull/10](https://github.com/2jfitnesscenter/2jfitnessapp/pull/10),
   `feat/pwa-tanita-bunker-roadmap` → `2jfitness-dev`, `MERGEABLE`. `gh` SÍ está instalado
   en este entorno (`C:\Program Files\GitHub CLI\gh.exe`, no en el `PATH` de la sesión de
   shell activa) y ya autenticado como `2jfitnesscenter` — usar siempre `--repo
   2jfitnesscenter/2jfitnessapp` explícito, porque el remote `upstream`
   (`alexpcosta/opengym`) hace que `gh` sin `--repo` resuelva al fork equivocado (y con él,
   a la rama `main` equivocada). Queda pendiente del usuario: revisar y mergear el PR
   cuando quiera.
5. **V1–V3, el fix del active y el fix del Bunker están todos desplegados en producción**
   (ver sus propias secciones). Pendiente de uso real esta semana: probar el flujo de
   entrenador (notas, versionado, resumen), el Bunker con varios socios reales a la vez, y
   si se activa OpenAI como proveedor del Coach, probar el botón "Probar el Coach" en Admin
   con una API key real y saldo.

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

## V3 — Programación y seguimiento — IMPLEMENTADA · TESTEADA · COMMITEADA · DESPLEGADA

**Estado**: todo lo pedido está implementado, con tests en verde (frontend 553/553,
backend 150/150, build de producción OK), commiteado (`96533f1`, empujado a
`origin/feat/pwa-tanita-bunker-roadmap`) y **desplegado en producción** el 2026-09-20
~21:47 UTC, autorizado explícitamente por el usuario ("commitea y despliega todo que
funcione, esta semana se probará"). Backup previo
`/root/backups/2jfitness-2026-09-20_2044.tar.gz`, mismo procedimiento validado (tar+ssh,
`chown` con `find ... ! -name data`, `data/` verificado `root:root` antes y después, sin
incidente). Smoke test post-deploy: `/api/health` interno y externo OK (`users:13`
intacto), `GET /api/trainer/routine-versions` y `/api/trainer/program-versions` → 401 (no
404, confirma que las rutas nuevas llegaron), `coach.provider` sigue `codex` (OpenAI no se
activó automáticamente), logs de `api`/`web`/`caddy` sin errores, app carga visualmente y
muestra login sin errores de consola.

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

## BUG: Bunker — no se puede volver a la sesión propia tras minimizar — CORREGIDO Y DESPLEGADO

**Síntoma reportado**: "cuando entro al principio perfecto, cuando minimizo mi pantalla para
que otro usuario entre en la suya ya no me da la opción de regresar a mi plantilla, aparece
pero no puedo acceder."

**Causa**: la tarjeta de un socio minimizado en el tablero comunitario del Bunker
(`BunkerBoard`, `frontend/src/views/Bunker.jsx`) nunca tuvo ningún `onClick` — no es una
regresión, nunca se construyó esa acción (confirmado por `git log -p` del archivo). El
propio backend documenta la decisión: "Minimizing back to the room dashboard... Nothing to
do server-side, so there is no endpoint for it" (`api/bunker/routes.js:316-319`). El único
camino real de vuelta era pulsar el botón genérico "Unirme al Bunker" y volver a teclear el
PIN — que sí restauraba el entreno correctamente, pero no estaba etiquetado como "continuar",
así que no se percibía como la opción de volver: la tarjeta "aparecía" (seguía en el tablero,
con su nombre y tiempo transcurrido) pero tocarla no hacía nada.

**Modelo anterior**: `Bunker.jsx` guardaba una única sesión (`session`, `{token, name}`) en
estado React de la raíz. Minimizar era literalmente `setSession(null)` — el token se perdía
sin más, no había ningún sitio donde recuperarlo salvo repetir el checkin con PIN.

**Modelo nuevo — reutiliza el token existente tal cual, sin tocar el backend**:
inspeccionado primero el token del Bunker (`sign('bunker:' + uid + ':' + exp)`,
`api/bunker/routes.js`) — es una credencial firmada, sin estado, ya scoped a un único uid;
`GET /api/bunker/session` no comprueba nada más que la firma y la caducidad. Es decir: el
backend YA soporta varias credenciales simultáneas sin ningún cambio — bastaba con que el
frontend dejara de tirar el token al minimizar. **No se ha tocado ni una línea de
`api/bunker/routes.js` ni `api/bunker/store.js`.**

`Bunker.jsx` pasa de `session` (uno) a:
- `credentials`: `{ [uid]: { token, name, exp } }` — todos los socios que ESTE dispositivo
  ha autenticado con PIN durante esta visita.
- `activeUid`: cuál de esas credenciales está a pantalla completa ahora mismo (o `null` →
  tablero).

Minimizar (`setActiveUid(null)`) ya NUNCA borra `credentials` — antes sí, por diseño.

**Dónde se guardan las credenciales temporales**: en memoria (estado React), NUNCA en
`localStorage` ni en ningún sitio que sobreviva a un recargo de página — decisión de
seguridad explícita, no un descuido (ver punto 8 de la petición): el Bunker es un dispositivo
físico compartido en medio del gimnasio; dejar credenciales de varios socios legibles desde
el almacenamiento del navegador tras un recargo es exactamente el tipo de cosa que no debe
sobrevivir. Ya era así para la única sesión que existía antes de este fix — el cambio no
introduce una degradación de seguridad, la extiende de 1 a N credenciales con la misma
política.

**Cuándo se eliminan**: una función pura `purgeStaleCredentials(credentials, board,
activeUid)` (`frontend/src/lib/bunker-credentials.js`, testeada con 7 tests unitarios) se
ejecuta en cada refresco del tablero (cada 4s): una credencial sobrevive solo si su tarjeta
sigue en el tablero (minimizar nunca la retira, ver arriba) o si es la sesión abierta ahora
mismo (para que una reconciliación del tablero nunca interrumpa un entreno activo). Cubre de
forma unificada, sin casos especiales por cada motivo: finalizar entreno (`store.endSession`
retira la tarjeta), cierre forzado por un admin (idem), y el `IDLE_TTL` de 15 min de
`api/bunker/store.js` (tarjeta no tocada → se purga sola). Además: si al tocar "Continuar" el
`GET /api/bunker/session` fallara (token realmente caducado — caso raro del límite de 4h,
`PIN_TOKEN_TTL`), la credencial se autopurga (`onInvalid`) y la tarjeta vuelve a pedir PIN en
el siguiente toque, en vez de quedarse muerta silenciosamente.

**Comportamiento de las tarjetas**: todas son ahora pulsables (antes ninguna lo era). Si
`credentials[uid]` existe para esta tarjeta: badge verde "Continuar" + reabre exactamente esa
sesión sin PIN. Si no: toca igual que el botón genérico "Unirme al Bunker" — abre el teclado
de PIN normal, nunca asume ni insinúa de quién es el PIN que hay que teclear (evita el caso
del punto 9: la tarjeta de alguien fichado desde OTRO dispositivo nunca concede acceso).

**Tras refresh/reabrir la PWA**: TODAS las credenciales de este dispositivo se pierden a la
vez (estado React, no persistido — ver arriba) — verificado en el E2E real (ver abajo).
Decisión explícita, no arbitraria: es la misma política de seguridad que ya tenía la sesión
única antes de este fix, aplicada uniformemente a N sesiones en vez de 1. La alternativa
(persistir en `localStorage`) habría sido un cambio de postura de seguridad real para un
dispositivo público, no una mejora de UX gratuita.

**Aislamiento A/B**: cada token está firmado con un único uid (`bunker:<uid>:<exp>`); no hay
ningún endpoint que acepte "para qué uid" además de lo que ya dice el propio token, así que
es estructuralmente imposible que el token de A lea o escriba el estado de B. Verificado con
tests backend reales (ver abajo) y con el E2E manual (checkin A → minimizar → checkin B →
minimizar → tocar A → exactamente su entreno, set ya marcado incluido → tocar B → exactamente
el suyo, sin rastro de A).

**Interacción con `S.active`/`clearActive`/protección del Bunker**: ninguna — este fix no
toca `api/bunker/routes.js`, `api/server.js` ni `frontend/src/store/useStore.js`. El fix del
active atascado (`POST /api/active/clear`, commit `3e4e0b4`) y la protección de `PUT
/api/data` siguen exactamente igual; suite backend completa (156/156) incluye esos tests sin
tocarlos y todos siguen en verde.

**Tests**:
- `frontend/src/lib/bunker-credentials.test.js` (7 tests): sobrevive si la tarjeta sigue en
  el tablero; se elimina si desaparece; nunca se elimina la del panel activo aunque falte
  momentáneamente del tablero; A y B se gestionan de forma independiente; alternar A→B→A→B
  varias veces mantiene ambas credenciales intactas; misma referencia de objeto cuando no
  cambia nada (evita un re-render innecesario); mapas/tableros vacíos sin excepción.
- `api/test/bunker-multi-session.test.js` (6 tests, nuevo — mismo patrón in-process que
  `bunker-finish.test.js`/`bunker-handoff.test.js`, sin servidor HTTP real): dos PIN
  distintos producen dos tokens independientes; ambos aparecen a la vez en el tablero sin
  desplazarse; el token de A solo puede leer la sesión de A, nunca la de B, haya quien haya
  fichado; escrituras alternadas A→B→A→B nunca mezclan `S.active`; A finalizando retira solo
  su tarjeta, B sigue intacto; un re-checkin del mismo socio nunca invalida un token ya
  emitido para él. **Este backend NO se modificó** — estos tests bloquean una regresión
  futura en una propiedad de la que ahora depende directamente el frontend.
- Suite completa: frontend 560/560, backend 156/156, build de producción OK.

**E2E real** (no simulado): backend local levantado con `DATA_DIR` propio y dos usuarios de
prueba con PIN conocido (sin necesidad de passkey — el Bunker nunca usa la cookie de sesión
normal), frontend en modo dev, todo el flujo dirigido de verdad en el navegador: Alice entra
con PIN → panel propio → minimiza → tarjeta con "Continuar" → Bob entra con PIN → panel
propio (rutina distinta) → minimiza → dos tarjetas con "Continuar" → toca la de Alice →
vuelve exactamente a su sesión sin PIN, con el set ya marcado intacto → marca otro set →
minimiza → el tablero refleja en vivo su ejercicio/serie/descanso mientras la tarjeta de Bob
sigue sin cambios → toca la de Bob → su sesión exacta, sin rastro de Alice → recarga real de
página (`window.location.reload()`) → ambas tarjetas pierden el badge "Continuar" → tocar
cualquiera vuelve a pedir PIN. Los 9 pasos del flujo pedido en el punto 7/17 de la petición
quedan cubiertos.

**Archivos modificados**: `frontend/src/views/Bunker.jsx` (modelo `credentials`/`activeUid`,
tarjetas pulsables, `onMinimize`/`onFinish`/`onInvalid` en vez de un único `onExit`),
`frontend/src/index.css` (`.bk-card` pulsable, `.resumable`, badge `.bk-card-resume`).
**Archivos nuevos**: `frontend/src/lib/bunker-credentials.js` + su test,
`api/test/bunker-multi-session.test.js`. **Nada en `api/` fuera del test nuevo.**

**Riesgos/limitaciones conocidas**:
- El escenario "admin fuerza el cierre de una sesión mientras ese socio la tiene abierta EN
  ESE MOMENTO en su propio panel" no revoca el token en curso (ya era así antes de este fix
  — `readBunkerToken` no consulta `store.getSession`) — solo afecta a alguien activamente
  entrenando cuando un admin lo cierra a la vez, un caso ya preexistente y fuera del alcance
  de "minimizar/volver" que pedía este fix.
- No hay test automatizado del `IDLE_TTL` de 15 min en sí (requeriría mockear el reloj) — su
  efecto sobre `purgeStaleCredentials` (tarjeta ausente → credencial se purga) sí está
  cubierto; el propio `IDLE_TTL` no se tocó.
- Sin passkey de producción no se pudo repetir este E2E contra `app.2jfitnesscenter.com`
  directamente — se hizo con un backend local equivalente, mismo código, mismos PIN reales.

**Desplegado en producción** el 2026-09-21 ~09:35 UTC, commit `ee7c0e5` (junto con la subida
de versión a 1.3.0 y el changelog). Backup previo `/root/backups/2jfitness-2026-09-21_0832.tar.gz`,
mismo procedimiento validado (tar+ssh, `chown` con `find ... ! -name data`, `data/` verificado
`root:root` antes y después). Smoke test: `/api/health` interno y externo OK (`users:13`
intacto); el bundle nuevo (`index-XZpwaXkv.js`) contiene el código del fix (`bk-card-resume`,
`resumable`) y la entrada `v1.3.0` del changelog; `https://app.2jfitnesscenter.com/#/bunker`
carga correctamente en vivo (tablero vacío, sin tocar sesiones reales de socios); logs de
`api`/`web` sin errores. `coach.provider` en producción ahora está en `gemini` (cambiado por
el propio usuario en algún punto entre sesiones, no por este despliegue — se preserva
correctamente en `data/coach.json`, que el deploy nunca toca).

---

## CURRENT CHECKPOINT — v1.3.1 stabilization — 2026-09-21

Punto de traspaso explícito Claude → Codex. Este checkpoint resume el estado real tras la
validación cruzada de dos auditorías independientes sobre v1.3.0/PR #10 y la Fase 1 de
corrección que siguió. **No sustituye leer las secciones propias de la validación cruzada y
de esta fase más arriba en este mismo archivo — son la fuente completa de evidencia.**

### FASE 1 COMPLETADA

- **A1 parcialmente resuelto de forma segura** (`PUT /api/data`):
  - `workouts` protegidos — unión por id, un cliente antiguo ya no puede borrar uno que el
    servidor ganó después (Bunker, etc.); borrado real solo vía `POST /api/workouts/delete`
    o `wipe: true` explícito (Reset everything / Import backup).
  - `routineVersions` protegidos — el servidor siempre gana, igual que `active`.
  - `programVersions` protegidos — igual.
  - **`routines`/`programs`/`dayPlan` TODAVÍA SIN PROTECCIÓN** frente a un cliente
    desactualizado — decisión deliberada de detenerse (autorizada explícitamente), no un
    olvido: hoy no hay forma segura de distinguir "edición deliberada del socio" de
    "móvil desactualizado" sin un timestamp por registro que el esquema no tiene.
- **A4 resuelto**: `POST /api/bunker/finish` idempotente por `workout.id`; `POST
  /api/bunker/active` rechaza (409) una escritura para un id que ya se finalizó — una
  sesión terminada ya no puede resucitar por una escritura tardía.
- **X1 resuelto**: `POST /api/exercises/import-alias` (tabla global de aliases de
  importación CSV) exige ahora `requireTrainer`. La lectura sigue abierta a cualquier
  socio; la importación de un socio normal sigue resolviendo bien su propia rutina, solo
  deja de propagar la confirmación a la tabla compartida del gimnasio.
- **A3 resuelto**: `readBunkerToken`/`readAdminToken` revalidan `disabled`/`isTrainer` en
  **cada uso**, no solo al emitir el token — un token criptográficamente válido ya no basta
  si la cuenta fue desactivada o el trainer fue degradado mientras tanto. Aislamiento A/B
  del sistema multiusuario verificado sin cambios.
- **X2 resuelto**: CI instala las dependencias de `api/` que el job `test` (frontend)
  necesita de verdad (`coach.test.js` importa `api/coach/...` directamente) y que al job
  `api` le faltaban por completo (comentario obsoleto que ya no era cierto).
- Lockfiles (`frontend/package-lock.json`, `api/package-lock.json`) sincronizados a 1.3.0.
- Frontend **560/560**, backend **179/179** (156 previos + 23 nuevos), build OK.
- E2E real del flujo "Eliminar entrenamiento" (backend local + navegador): confirmado por
  red y por estado real del servidor que el borrado llega y no vuelve.

### DEUDA NUEVA DESCUBIERTA (durante Fase 1, no corregida todavía)

- `POST /api/exercises/alias` (tabla `db.machineAliases`, aliases de escaneo de máquina)
  tiene **exactamente el mismo patrón** de escritura global por cualquier socio que tenía
  `import-alias` antes de X1. No corregido — mismo arreglo (`requireTrainer`) sería
  aplicable si se decide hacerlo.
- `coach.test.js` (frontend) mantiene el acoplamiento directo a `api/coach/...` — X2 lo
  hizo pasar en CI instalando las dependencias correctas, pero no deshizo el acoplamiento
  en sí (refactor mayor, fuera de alcance de esta fase).
- `routines`/`programs`/`dayPlan` necesitan una solución explícita de concurrencia/
  versionado (timestamp por registro, o similar) antes de poder protegerlos como A1 hizo
  con `workouts`/`routineVersions`/`programVersions` — sin eso, cualquier intento de merge
  ahí arriesga romper una edición o un borrado legítimos.

### FASE 2 PENDIENTE

A2 (PIN/rate-limit) · A5 (offline Bunker) · A6 (límite IA auxiliar) · A7 (CSV mismo día) ·
M1 (alias/fingerprint) · M2 (equipment unavailable) · M4 (expiración Bunker) · + revisar
permisos de `machineAliases` (deuda descubierta arriba).

### FASE 3 PENDIENTE

gzip/Caddy · cache de assets · security headers/CSP · service worker · `invite_only` ·
deep links (riesgo secundario, ya diagnosticado — ver la sección de validación cruzada) ·
code splitting (no urgente).

### DECISIONES

- No se aplicaron patches externos.
- No se usó `git am`.
- No se introdujo 5/3/1 ni ninguna feature nueva.
- Prioridad: integridad de datos antes que rendimiento.
- **PR #10 NO se ha mergeado todavía.**
- **Fase 1 NO se ha desplegado todavía** — queda pendiente de revisión/continuación,
  posiblemente con Codex.

### Estado de git en este checkpoint

Rama `feat/pwa-tanita-bunker-roadmap`, comparada contra `origin/2jfitness-dev` (rama por
defecto real del repo — ver sección del PR #10 más arriba). Commit de esta fase:
`fix: stabilize sync bunker auth and CI`. Empujado a origin. Working tree limpio tras el
commit.

### NEXT — para quien continúe (Codex u otra sesión)

1. Leer este checkpoint + la sección de validación cruzada completa antes de tocar nada.
2. **No mergear el PR #10 sin decisión explícita del usuario.**
3. **No desplegar Fase 1 sin decisión explícita del usuario** — sigue pendiente aunque
   esté commiteada y pusheada.
4. Si se continúa con Fase 2: empezar por A2 (rate-limit del PIN del Bunker) y A7 (CSV
   mismo día) — son los de menor riesgo de romper algo existente. M1/M2/M4/A5/A6 tocan
   áreas ya bastante intervenidas esta sesión (importación CSV, Bunker, IA auxiliar);
   revisar con cuidado antes de tocar de nuevo.
5. Antes de cualquier cambio: `git status`, confirmar HEAD, releer el diff de Fase 1
   completo (no solo este resumen) para entender exactamente qué se protegió y qué no.
6. La deuda de `machineAliases` (mismo patrón que X1) es la corrección más barata y
   aislada si se quiere adelantar algo de Fase 2 sin abrir alcance nuevo.

---

## Revisión Codex — retry de borrado A1 — 2026-09-21 (sin commit)

Base: `b22d329`, rama `feat/pwa-tanita-bunker-roadmap`. No se inició Fase 2.

La reproducción se convirtió primero en un test Vitest del store real, con API,
localStorage y document simulados, sin añadir jsdom. Falló antes del fix:
delete falla → pending → reinicio/pull recupera workout → retry borra servidor →
la copia local sobrevive → push resucita workout.

Fix mínimo en `frontend/src/store/useStore.js`: tras confirmar DELETE, eliminar también
el workout de S y persistir localStorage antes de retirar el pendiente. Los deletes
pendientes del boot se esperan en serie: cada uno hace push primero y no debe enviar
una copia anterior al borrado precedente. Sin cambios en la reconciliación del servidor.

Nuevo `frontend/src/store/useStore.test.js`: 6 casos, reproducción exacta, delete online,
fallo de PUT y DELETE offline, múltiples pendientes con segundo fallo y recuperación,
reset explícito online e import backup online. Verifica S, localStorage y push posterior.
Frontend completo 566/566; backend completo 179/179; build Vite OK (aviso previo de
chunks grandes). Ejecución local Node 24.19.0; workflow conserva Node 22.

A1: stale PUT conserva workouts/versions, DELETE explícito funciona, retry corregido,
active conserva su protección; tests backend y frontend pasan. A4: doble finish y
rechazo de active finalizado pasan, nueva sesión de distinto id funciona. X1: escritura
de import aliases exige trainer/admin. A3: revocación y aislamiento A/B pasan.

**Bloqueo adicional observado al revisar reset/import (no corregido aquí):**
`replaceStateOnServer` hace `pushState(true)`, pero si falla solo queda `gym_dirty`.
Un reintento normal usa `pushState()` sin wipe y la unión conserva los workouts antiguos.
La intención de reemplazo offline no es durable. Reset/import online sí están probados.
No declarar Fase 1 completamente validada hasta decidir/corregir este camino.
Además, esta corrección local no introduce tombstones multi-dispositivo: otro cliente
que todavía envíe explícitamente un workout borrado puede reintroducirlo (limitación
ya presente en el test backend E1). No se cambió la deuda routines/programs/dayPlan.

X2: dependencias y Node 22 coherentes. PR #10 abierto en b22d329; api/api-image pasan,
job test falla en `node scripts/check-locales.mjs`. Causa preexistente, no de Fase 1:
árbol locales idéntico en b22d329 y su padre (50444786a129afd4a048058bb10aae17e60204d4),
comprobador idéntico (ffc00360abd3786bdc104369744e4beac17aa9c6); tampoco se añadieron
claves t() en el diff. El check local adicional de library falla solo por CRLF de Windows:
contenido normalizado a LF coincide exactamente con el generado; no se regeneró el archivo.
Unión 2135 claves: de/fr/hi/it/ko/pl/pt/ru/tr/zh tienen 805 cada
uno (1330 ausentes por idioma), es tiene 2125 (10 ausentes). El script enumera cada
clave exacta. Inventario completo generado fuera del repositorio:
`C:/Users/juanj/AppData/Local/Temp/2j-fase1-missing-locales.json`.
Las 10 ausentes en es: `After how many workouts`, `Endurance`,
`FitNotes, Strong, Hevy — or body weight from Apple Health`, `General fitness`,
`Get stronger`, `Rest-timer alerts, even if 2J Fitness Center is closed.`,
`endurance`, `general`, `muscle`, `strength`. No se tocaron traducciones.

Sin commit, push, merge ni deploy. Próximo paso: revisar el bloqueo de wipe offline;
no continuar automáticamente con Fase 2.

## CURRENT CHECKPOINT — Sync V2 Core — 2026-09-21 — SIN COMMIT

Base `90d98fe` (`fix: preserve workout deletion across retry`), ya commiteado y
pusheado por autorización expresa. Rama `feat/pwa-tanita-bunker-roadmap`.
El diseño Sync V2 fue aprobado en conversación: revisión global, concurrencia
optimista, operationId, generation, tombstones, cola durable; sin CRDT/event sourcing.

**Estado actual: VALIDADO para commit/push.** Sync V2 Core queda cerrado con pruebas de
integración A/B y todos los escritores secundarios que modifican state bajo revisión,
generation y recibos idempotentes, o bajo una operación estrecha e idempotente propia.
No se convirtieron ni invalidaron históricos `{d,w,t}` porque no contienen la unidad de
origen; esa ambigüedad queda como deuda no bloqueante. `lastBW` usa fecha efectiva y
desempate por `t`, sin depender del orden del array. Una medición nueva con peso actualiza
`S.bodyweight`, incrementa revisión y converge por Sync V2.

### Implementado

- `state-store`: metadata `_sync` cifrada (schemaVersion/revision/generation/tombstones/
  receipts); metadata no enumerable en objetos de dominio para que no viaje en backups.
  Migración en lectura sin alterar datos. Archivo ilegible lanza STATE_CORRUPT y no puede
  sobrescribirse como vacío. Toda escritura incrementa revisión y registra eliminaciones.
- Servicio `api/lib/sync.js`: transacción síncrona sin await read/check/apply/write
  (serialización efectiva en el único proceso Node actual). Receipts antes del rechazo
  de revisión para reconocer respuestas perdidas; digest impide reutilizar operationId
  con contenido distinto. Save conserva active/versiones y exige listas explícitas de
  eliminaciones; delete/reset/replace mantienen semántica propia. Reset/replace cambian
  generation; tombstones para workouts/routines/programs.
- GET/POST /api/sync con autenticación; owner de cola evita envíos a otra cuenta tras
  cambio de sesión. Conflictos 409 estructurados con estado/revisión canónicos.
- Activación gradual por usuario: primer GET /api/sync marca enabled. Desde entonces
  PUT /api/data y DELETE legacy devuelven SYNC_UPGRADE_REQUIRED. Los usuarios que nunca
  abrieron Sync V2 aún conservan protocolo legacy: no afirmar protección universal
  antes de activar/migrar sus clientes.
- Cola PWA/web por usuario en localStorage: base confirmada, operaciones inmutables,
  borrador y conflicto. Registro adicional por operationId preserva operaciones ante
  sustitución del journal por otra pestaña. GET antes de vaciar cola, retries con el
  mismo payload/ID, confirmación canónica antes de retirar la operación.
- Revalidación startup/login, visible/focus y online. Sin polling periódico.
  Las copias legacy divergentes se conservan como recuperación/conflicto, no se suben
  atribuyéndoles arbitrariamente una revisión nueva. Banner de conflicto, sin editor.
- Trainer member-routine/member-program usa revisión del plan leído, recibos y
  operationId persistido; builders y PlanReviewCard pasan contexto de revisión.
- Los escritores admin/trainer de perfil, features, bioimpedancia, starter plan y
  asignación social de rutina/programa usan revisión del estado y operationId durable.
  Una respuesta perdida se reintenta con el mismo cuerpo y recibo; un escritor stale
  recibe conflicto y no sobrescribe el cambio confirmado.
- Bunker finish avanza revisión por el writer central y es idempotente. Las escrituras
  de sets usan una `activeRevision` separada, receipt por operationId y una cola serial
  persistida del kiosco; respuestas perdidas se reconocen una vez y snapshots stale o
  clientes antiguos se rechazan después de activar V2. La asistencia admin usa la misma
  precondición. Handoff/clear son operaciones estrechas por id sobre estado fresco y
  finish deriva el resultado en servidor, por lo que no aceptan snapshots genéricos.

### Validación

Frontend completo **576/576** (32 archivos); backend completo **198/198**;
build Vite OK (aviso preexistente de chunks grandes); `git diff --check` OK.
Node local 24.19.0.
10 tests nuevos frontend y 18 backend, más adaptación de los 6 tests del store.
Incluyen revisión concurrente, borrado de las tres entidades, respuesta perdida,
reset/import offline y reload, trainer, Bunker, HTTP/owner, migración/corrupción,
conflicto conservando borrador, foreground offline sin volver a un draft antiguo,
y fecha efectiva de peso. La integración HTTP con dos clientes independientes demuestra
N→N+1, rechazo stale, revalidación y convergencia; también cubre delete sin resurrección,
Bunker finish sin duplicado y bioimpedancia propagada. No se añadieron llamadas reales
a proveedores.
Se repitió frontend/backend/build al detectar y corregir en revisión final dos casos:
revalidación offline podía reponer draft antiguo sin pendientes; cuenta cambiada durante
sync necesitaba vincular owner explícitamente al request.

### Límites y deuda

- Peso histórico ambiguo: no hacer conversiones inferidas por magnitud. Los registros
  nuevos conservan la semántica actual de la cuenta; normalizar históricos requiere una
  política explícita de unidad por registro.
- Receipts/tombstones sin poda todavía; snapshots en cola pueden consumir cuota local.
  El test de crecimiento confirma una entrada por operación aceptada, ninguna adicional
  por retry y tombstones únicos: crecimiento lineal, no explosivo.
- No hay resolución interactiva de conflictos; borradores/operaciones se conservan.
- Serialización es monoproceso, no un lock entre varios procesos o contenedores.
- La prueba multidispositivo es integración automatizada con dos clientes HTTP simulados,
  no dos navegadores reales; cubre las garantías de backend sin añadir Playwright.
- No integrar nativo VITE_MOBILE=1. No Fase 2, infraestructura, traducciones, merge o deploy.
- CI de traducciones sigue con deuda previa; no se modificaron locales ni workflow.

### Archivos de este cambio

AI_HANDOFF.md
api/bunker/routes.js
api/lib/state-store.js
api/lib/sync.js (nuevo)
api/server.js
api/test/bunker-finish.test.js
api/test/put-data-reconciliation.test.js
api/test/state-store.test.js
api/test/sync.test.js (nuevo)
frontend/src/App.jsx
frontend/src/lib/bunker-api.js
frontend/src/lib/history.js
frontend/src/lib/social-api.js
frontend/src/lib/state-action.js (nuevo)
frontend/src/lib/state-action.test.js (nuevo)
frontend/src/lib/sync-client.js (nuevo)
frontend/src/lib/sync-client.test.js (nuevo)
frontend/src/lib/trainer-api.js
frontend/src/store/useStore.js
frontend/src/store/useStore.test.js
frontend/src/views/Admin.jsx
frontend/src/views/Bunker.jsx
frontend/src/views/BunkerAdminPage.jsx
frontend/src/views/Settings.jsx
frontend/src/views/trainer/PlanReviewCard.jsx
frontend/src/views/trainer/TrainerProgramBuilder.jsx
frontend/src/views/trainer/TrainerRoutineBuilder.jsx

Checkpoint preparado para el commit `feat: add conflict-safe multi-device sync` y push
a `feat/pwa-tanita-bunker-roadmap`. No mergear PR #10. No se desplegó: antes hacen falta
un backup nuevo y recuperable de producción y una comprobación explícita del rollback
con metadata Sync V2 ya escrita.

### CHECKPOINT DE ROLLBACK POST-SYNC — 2026-09-21

`51a221d8ef524776334d8d67109fb9102407eff2` queda fijado como la base mínima de runtime
para cualquier producción que haya activado Sync V2. Nunca desplegar ni usar como rollback
`90d98fe` o anterior sobre esos datos. El marcador raíz `SYNC_V2_ROLLBACK_BASE` permite
rechazar un archivo de release incompatible antes de extraerlo; el procedimiento exacto está
en `docs/DEPLOY_RAIOLA.md`. El rollback conserva `data/` y cambia solo el código por un
archivo compatible conocido. Si esa base no arranca, la política es corregir hacia delante.

Test `api/test/rollback-sync-v2.test.js`: parte de revision/generation/receipts/tombstones,
simula una escritura con el runtime mínimo, verifica que metadata no baja ni desaparece,
rechaza un cliente stale y bloquea la resurrección de un workout tombstoned.
Validación local: frontend **576/576**, backend **199/199**, build Vite OK y
`git diff --check` OK. El aviso de chunks grandes sigue siendo el preexistente.

Checkpoint commiteado y pusheado como `437a13c` (`ops: establish Sync V2 rollback
baseline`). Deploy detenido antes de tocar producción: este entorno no dispone de una
credencial SSH aceptada por `root@app.2jfitnesscenter.com` ni por
`2jfitness@app.2jfitnesscenter.com` (ambos devuelven `Permission denied`). Por tanto no se
creó backup predeploy ni se copió/reinició nada. Producción sigue en el checkpoint anterior
`ee7c0e5`; health público continúa OK (`users:14` en la comprobación no destructiva).
Para continuar solo hace falta provisionar en este entorno la clave SSH de producción;
después ejecutar backup/verificación, crear y conservar el release archive compatible,
desplegar y hacer smoke tests. Nunca usar `90d98fe` como rollback.

### DEPLOY SYNC V2 COMPLETADO — 2026-09-21

Producción fue actualizada manualmente por SSH interactivo desde `ee7c0e5` al release
compatible `6c548f7` (`1.3.0`). Antes del deploy se creó y verificó el backup recuperable
`/root/backups/2jfitness-2026-09-21_2127.tar.gz`; contiene `data/db.json`, `data/secret`
y los estados de usuario. También quedó verificado en el servidor el release de rollback
`/root/backups/2jfitness-code-6c548f7.tar.gz`, SHA-256
`52d3ee9b6481dd3bc425c0bc6b1d25bf30f326b3d82ed257069af68df5901a64`, con el marcador
`SYNC_V2_ROLLBACK_BASE` que fija `51a221d8ef524776334d8d67109fb9102407eff2` como base
mínima. No usar `90d98fe` ni código anterior sobre datos que ya contengan metadata V2.

Los contenedores `api`, `web` y `caddy` quedaron activos. Health interno y externo
respondieron 200 con `{"ok":true}`; `/api/sync` sin autenticación respondió 401 y el board
de Bunker respondió 200. Smoke web/PWA: portada, manifest, service worker e iconos 192/512
respondieron 200; el bundle desplegado contiene los identificadores de Sync V2. Con sesión
autenticada se comprobaron Home, historial, plan y peso en escritorio y viewport móvil,
sin errores de consola; Bunker público cargó correctamente. No se modificaron datos reales.

La convergencia PC↔móvil continúa respaldada por la prueba automatizada con dos clientes
HTTP. No se ejecutó una mutación cruzada en producción porque no había una cuenta/datos de
prueba identificados y no se deben alterar usuarios reales. Frontend **576/576**, backend
**199/199**, build Vite y `git diff --check` estaban verdes antes del deploy. PR #10 sigue
sin mergear.

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
