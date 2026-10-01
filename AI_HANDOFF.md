# AI_HANDOFF.md — 2J Fitness Center

> Punto de traspaso entre sesiones (Claude Code / Codex). Resumen operativo del estado REAL;
> Git y el código son la fuente de verdad. El detalle histórico de cada sprint (V1–V3, Sync V2,
> Bunker, Health, Constructor, etc.) está en el historial de este archivo:
> `git show 75317b0:AI_HANDOFF.md` y en `CHANGELOG.md`.

## 1. Estado actual (checkpoint 2026-10-01)

- **Producción actual (confirmada por el usuario):** `b4e7baad74131a90cc002d662cad1e4a21f973ce`.
  **Sprint 4.5 DESPLEGADO y cerrado** (Entrena con 2J Admin + expansión de contenido + calidad/admin de la
  biblioteca + inventario oficial del Gym Profile con kettlebells + switch de visibilidad del Studio).
  Resumen y cifras en §13b. Todo lo anterior (Bunker Live V2, auto-finish, carga inicial segura, Gym Profiles,
  Series Feedback…) está incluido en ese release. Checkpoints de producción previos: `78b22bb` (Bunker Live V2 +
  auto-finish) y `760008e` (Sprint 4.5 sin el switch); solo históricos. Las referencias a `abe3265` y
  anteriores en las notas de abajo describen checkpoints pasados, no el estado actual.
- **Rollback del último deploy:** `760008e564c0c17438313b8b8d3852bc47d8e429` (árbol exacto; el runner lo verifica).
- Trabajo tras `013c3b7`: `db69559` actualizó solo handoff; `2920370` añadió progreso visual por
  panel Bunker y media GIF existente. `013c3b7` conserva la UX de edición de equipo Gym Profiles.
- `7ebb722708a6b27c33aafe60f799b1dada8fbc59` es un checkpoint anterior de Gym Profiles V1;
  no representa la producción actual. El polish visual `70080f1` es un checkpoint anterior.
- **Rollback conocido seguro:** `4aab27eaed769505c70d7d742be8de99e4052e5f` (Legal/credits).
- **Nunca** usar como rollback código anterior a `SYNC_V2_ROLLBACK_BASE` (`51a221d`); `90d98fe`
  o anteriores no son válidos sobre datos Sync V2.
- Tests en a9b6453: frontend **864/864** (`cd frontend && npx vitest run`), API **261/261**
  (`cd api && node --test`). `package.json` sigue en 1.3.0: identificar releases por commit.
- Gym Profiles V1: **894/894 frontend, 264/264 API**. Tras el polish visual: **895/895 frontend**,
  build OK, español completo y `git diff --check` OK; API sin cambios por el polish.
- Servidor: `/opt/2jfitness` (release extraída de tarballs, no es repo git), datos en
  `/opt/2jfitness/data`, backups en `/root/backups`, URL `https://app.2jfitnesscenter.com`.

### Pre-deploy — auto-finish + carga inicial segura (2026-10-01; histórico, desplegado en `78b22bb`)

- Commits separados: `f127e06` auto-finish; `4801d61` Progressive Overload; `2d6d13b` protege
  edits offline posteriores al cierre servidor (409 conserva draft; retry idéntico 200). En aquel
  momento producción estaba en `abe32659d5bc20179f3270cd2f7d2612ea132623` (histórico; hoy §1).
- Auto-finish reutiliza el finish idempotente existente, PR/exWeights/history/program completion.
  `lastActivityAt` vive en el active local/persistido; cambia por sets, carga/reps, cardio,
  navegación de ejercicio, swaps o cambios reales de Guided. Polling/render/revalidación no lo renuevan.
  `WORKOUT_INACTIVITY_MS` = 60 min, modelo único frontend/API comprobado por
  `scripts/sync-workout-activity.mjs --check`. Revisión cada 30 s; deadline independiente por socio.
- Bunker: sweep servidor sobre active persistido, independiente de panel/board; móvil: el shell
  detecta al abrir/reconectar y usa finish autenticado con validación de actividad/conflictos.
  El pulso móvil envía solo id + timestamp original; no adquiere autoridad de snapshot ni cambia Sync V2.
  Actividad reconocida de otro dispositivo impide un cierre stale. Cola finish Bunker existente conservada;
  no nueva queue/store. Guardas de revisión/id/tombstone y dedupe; un draft móvil que cambia durante
  la petición no se elimina. `finishReason=inactivity_timeout`, `finishedAt` real, `end` último
  cambio fiable para no sumar la hora inactiva; legacy sin timestamp usa el end normal. Nota discreta en detalle.
- Límite: un active solo local necesita abrir/reconectar el cliente para finalizar; offline conserva draft
  y difiere finish hasta respuesta válida. El servidor no puede conocer edits offline no reconocidos;
  una divergencia conserva el draft y requiere el flujo de conflicto existente, nunca overwrite ciego.
- Progressive Overload: `exWeights/topW` conservan máxima/PR pero no pisan los sets completados
  posicionales. `workingLoadEvidence` deriva la primera serie done excluyendo warmup/drop; no añade
  metadata histórica. readSession/suggestOverload/recommendProgression/Intelligence usan esa base.
  RPE/RIR y feel hard/fail vetan aumentos; sin evidencia de esfuerzo repite carga. Doble progresión
  exige dos exposiciones completas con base igual y esfuerzo seguro; políticas lineales explícitas
  mantienen su regla tras una exposición segura. Sugerencias siguen siendo opcionales/confirmadas.
- Rampa/backoff conserva posiciones y aplica el incremento realizable existente; straight sets siguen
  iguales; %1RM explícito conserva su prescripción. Sin historial no se inventa progreso; exWeights
  queda solo como fallback legacy sin series comparables. Series Feedback NEXT SET no se modificó.
  Limitación: historial sin type no permite inferir que un set era warmup; respeta semántica existente.
- Validación: frontend **983/983**, API **323/323** (incluye Bunker/Sync/Guided/Intelligence/Community),
  12 tests actividad frontend + 11 API + 14 carga inicial A–L/Intelligence; build OK, ES **3623/3623**,
  protocolo/modelos/seeds/catálogo OK, diff check OK. Deuda histórica: chunks grandes, otros idiomas
  incompletos y 28 ejercicios sin movimiento canónico; no causada por estos fixes.
- `deploy-4f8e80c.ps1` y su release quedan OBSOLETOS. Preparar runner NUEVO para el HEAD documental
  final, baseline/rollback `abe3265` (nota histórica, ya cumplida por los runners posteriores), artefactos exactos, backup, protección datos/Sync V2, retry,
  runtime/image probes, PrepareOnly e install/rollback local antes de cualquier aprobación de deploy.

### Community V2 + Notifications + Sharing — desplegado (2026-09-27)

- Anteriores commits preservados: `0fb027c` (API/permisos), `119cb5a` (frontend/UX), `e1d92d1`
  (handoff/changelog parcial). Cierre funcional: `fa4d080`; el commit documental posterior no forma
  parte del release de producción.
  **Desplegado**; producción confirmada en aquel checkpoint: `3c0129ad39970e8a87e8663c2402405df6199139`.
- Reutiliza `friends.json`, `chat.json`, `social.json`, Web Push/VAPID existente, HashRouter,
  service worker y exportador PNG. `notifications.json` guarda un máximo de 100 avisos por usuario
  y 5.000 en total; no contiene imágenes/blobs. `social-sharing.json` contiene referencias de
  shares y reportes; las tarjetas se reconstruyen desde el contenido fuente actual con allowlist.
- Relaciones: amistad aceptada permite chat directo; bloquear corta amistad y acceso. Desbloquear
  no recrea la amistad. Perfil social solo expone id/nombre/avatar. Comunidad/chat/detalle vuelven a
  comprobar privacidad, relación, bloqueos y existencia del target al leer; cambios a privado o
  eliminación producen fallback inaccesible. No se incluyen Health, medidas, notas, restricciones
  ni datos de administración en perfiles o snapshots de shares.
- API añadida/completada: `GET /api/notifications`, `POST /api/notifications/read|read-all`,
  `GET|POST /api/social/preferences`, `GET /api/social/profile?id=...`,
  `POST /api/chat/direct`, `POST /api/friends/block|unblock`,
  `POST /api/social/shares`, `GET /api/social/shares|shares/item`,
  `POST /api/social/shares/delete`, `POST /api/social/reports`,
  `GET /api/admin/social-reports`, `POST /api/admin/social-reports/resolve`.
- Mensaje compartido usa `type: "share"` + `shareId`; no copia PNG ni el estado de entrenamiento.
  La tarjeta se hidrata al leer y desaparece de forma segura si deja de ser visible. El feed social
  solo recibe contenido al tocar “Compartir”; ningún entrenamiento se publica automáticamente.
  workout, PR, badge/logro, racha, reto, rutina y programa tienen entry point o destino compatible;
  la exportación visual conserva los detalles de entrenamiento elegidos, nunca el perfil corporal.
- Notificaciones: solicitud/aceptación, mensaje, share directo y participación en reto; estas últimas
  usan dedupe key. Push social reutiliza la infraestructura VAPID, está OFF por defecto y requiere
  activación expresa; no hay push por evento del feed ni por Health. El centro in-app permanece activo
  con permiso del navegador denegado. Destinos permitidos incluyen friends, chat, social/share,
  reto, notifications y admin/social-reports; HashRouter resuelve los targets y los borrados tienen
  fallback. Community intro: `community-intro:v1:<userId>`; ayuda de share:
  `community-share-help:v1:<userId>`.
- La superficie nueva incluye tab “Momentos”, tarjetas visuales, compartir workout tras completar,
  PR, badges desbloqueados, rachas, rutinas/programas y retos; cards de chat, reportar/borrar,
  revisión de reportes solo para admin. Entrenador no-admin y socio reciben 403 en moderación. Se
  corrige el API wiring para llamar al helper existente `sendSocialPush` (no `socialPush`).
- Protección de privacidad añadida: permisos de shares directos se vuelven a validar también en el
  endpoint de detalle, además de al resolver la tarjeta de chat. La integración HTTP comprueba
  revocación y restauración del permiso, blocks/unblocks y que unblock por sí solo no recrea amistad.
- Tests verificados localmente: frontend **910/910**; API **274/274**. Build Vite OK; español
  **3342/3342**. Otros idiomas están en la deuda histórica **805/3342**, no causada por este sprint.
  Build conserva avisos de chunks grandes; vistas Community/Social/Chat/Notifications y reports
  salen como chunks lazy separados. `git diff --check` OK.
- QA funcional: API HTTP efímera con datos aislados (socio A/B, admin y trainer no-admin) pasó
  amistades, privacidad/perfil, share community/chat, unread, dedupe, avisos, reto, bloqueo, reportes,
  permisos, retirada del target y prueba negativa de fuga de datos. El API que antes dio 502 fallaba
  porque el handler nuevo usaba un nombre incorrecto de helper de push; se corrigió y el child API
  real pasa. QA visual parcial (2026-09-27) con fixture sintético local: Home vacío y navegación
  en anchos CSS 390/768/1200, tema oscuro; Momentos y notificaciones en claro; Amigos, chat con
  texto/tarjeta, privacidad y reportar en oscuro. Se revisaron onboarding (primera apertura, omitir,
  reabrir guía y completar), solicitudes/amigos/bloqueados, perfil accesible e inaccesible,
  notificaciones unread/todas leídas y primera ayuda/destinos del Share Sheet. Se corrigió el
  apilado de mensaje/fecha en avisos, el import ausente de `Icon` que dejaba en blanco el primer
  Share Sheet, y el ancho de tarjeta que mostraba scroll horizontal en el diálogo de compartir.
  Los fixes están en `d4933e9` y no se han desplegado.
  **La matriz visual sigue incompleta**: no se recorrieron export y destinos de los siete tipos de
  tarjeta, la moderación admin, chats/avisos vacíos, estados offline/servidor/contenido eliminado,
  revocación visual de privacidad ni movimiento reducido. Push-denied se vio en el navegador local;
  **PUSH_DEVICE_QA=PENDING_REAL_DEVICE**. Frontend **910/910**, API **274/274**, build OK, ES
  **3342/3342**, `git diff --check` OK. Estos checks no convierten la inspección parcial en
  release ya desplegado y validado en producción según confirmación del usuario; queda como nota
  histórica que la matriz visual local de Community no se recorrió por completo. No hay deploy de
  Community pendiente.
- Sin cola offline nueva: cada share/chat se confirma con respuesta del servidor. No tocar Sync V2,
  Training Protocol, Health, Gym Profiles, Library, Bunker ni infra.

### Sprint 2 — Guided Programs V2 (completo; desplegado después, ver §1; 2026-09-28)

- Foundation `1bbf316` conservada: rutas `/train2j/programs` y `/train2j/program/:id`, onboarding reabrible, Gym Profile por sesión, progreso desde workouts reales, pausa/reanudación/abandono, asignación trainer con receipt e idempotencia y snapshot de rutinas. `src2j.program`, `S.programs` y `activeProgramId` reutilizan Workout/Sync V2 sin cambiar su núcleo ni duplicar entrenamientos. Catálogo cacheado por uid permite consulta offline; no hay cola offline nueva.
- Contenido local ampliado de **39 a 69 rutinas** (fuerza/hipertrofia, movilidad, HIIT/Tabata y otras), de **155 a 158 bloques** y de **4 a 13 programas** de varias semanas; 8 colecciones, 3 destacadas. Los nuevos programas cubren retorno, fuerza, full body, tren superior/inferior, PPL, glúteo, casa, core y hotel. Semillas/protocolo espejados con generadores `--check`; referencias de días y bloques comprobadas. No hay contenido externo.
- Admin puede curar únicamente nombre, descripción, activo y destacado de programas oficiales; semanas y rutinas de la semilla son inmutables. Se filtran programas inactivos para socios, Coach y asignación trainer. Coach sigue recibiendo resúmenes filtrados por objetivo/nivel y compatibilidad del Gym Profile bajo consentimiento; la IA queda subordinada a `validateAgainst2JProtocol` v1.0.
- Library Quality Pass: 1324 IDs/medios/historial preservados; 3 duplicados con instrucciones/metadata coincidentes reciben `preferredId`, 4 pares de variantes quedan explícitamente separados, 43 asignaciones de movimiento, 3 aliases y selección curada de movilidad. Quedan **18 grupos posibles** sin evidencia para fusionar y **28 ejercicios sin movimiento canónico**. Sin fuzzy matching ni cambios de equipo inventados. Detalle generado en `docs/EXERCISE_LIBRARY_AUDIT.md`.
- QA visual local con API y usuarios sintéticos: catálogo/detalle en 390/768/1280 px, claro/oscuro sin overflow; onboarding, start, pausa, reanudación, abandono, asignación trainer→socio, compatibilidad 2J/Casa, completed 100 % con estado sintético, curación admin y error HTTP 503; catálogo cacheado con API caída. El estado completed se verificó con fixture, no con nueve entrenamientos manuales ni en dispositivo real. Se corrigieron textos españoles y posición de CTA en tablet.
- Validación local: frontend **930/930**, API **281/281**, build OK (warning histórico de chunks grandes), español **3520/3520**; generadores de rutinas/bloques, auditoría/catálogo, espejo de protocolo (9 archivos) y `git diff --check` OK. Otros idiomas: cobertura parcial con fallback inglés (805/3520). Sin llamadas reales a IA.
- Commits de cierre local: `245e460` (Library), `798d226` (contenido/programas), `2a8c2fe` (curación admin). En aquel checkpoint producción estaba en `3c0129ad39970e8a87e8663c2402405df6199139`; esta nota de 2026-09-28 no determina el estado de despliegue actual (§1).

### Bugfix estabilidad IA 2J (desplegado después; 2026-09-28)

- **Causa raíz:** el Agent SDK informa los errores de API (529 overloaded, 5xx, 429, auth) como
  `result` con `subtype:'success'` + `is_error:true` y el texto del error en `result`. El adaptador
  Claude lo tomaba como respuesta del modelo → `extractJSON` sacaba el objeto del error → contrato
  inválido → gastaba la reparación → `unusable`, sin retry. Además: si el runtime salía con código ≠0
  tras un resultado completo se perdía como `missing`; `/token/` clasificaba como auth cualquier
  mensaje con "max_tokens"; el poll del panel trainer no se re-armaba tras "Generar" (pantalla fija
  en "Generando…" → reintentos → `busy`) y el socio nunca veía la causa del fallo.
- **Fix:** `coach/ai-run.js` (clasificación + retry + logs) usado por `jobs.js` y `trainer-jobs.js`;
  `adapters/claude.js` (`readStream`) respeta `is_error`/`api_error_status`/errores assistant y
  conserva un resultado ya recibido; `extractJSON` prueba todos los bloques ```` ``` ```` y objetos
  balanceados, prefiere el que trae `coach_contract`. Frontend: poll re-armado (socio y trainer),
  botón bloqueado hasta ver el job, tarjeta "última revisión no terminó" con la causa (`status.last`).
- **Retry:** máx. 3 llamadas (timeout máx. 2), backoff 1,5 s / 4 s, solo timeout, 429, 5xx/529,
  red, runtime caído, respuesta vacía. Nunca auth/config/runtime ausente/4xx. FAIL del protocolo o
  JSON inválido: 1 reparación y descartar. Timeout por intento sin cambios: 5 min.
- **Logs:** `[coach] AI_REQUEST_START|AI_ATTEMPT|AI_TIMEOUT|AI_PROVIDER_ERROR|AI_PARSE_ERROR|AI_REPAIR|AI_SUCCESS|AI_FINAL_FAILURE`
  con flow/job/provider/attempt/class/status/ms; sin prompts, respuestas, tokens ni datos.
- **Tests:** `api/test/ai-stability.test.js` (19); fixture con modos `overloaded-then-valid`,
  `503-twice-then-valid`, `503-always`, `auth`, `fenced`. API 300/300, frontend 930/930.
- **Limitaciones:** sin reproducción contra Claude real (sin acceso a logs de producción); la causa
  se confirmó leyendo el SDK 0.3.220 instalado. Escáneres aux-AI (medidas/máquina/rutina/import)
  no usan aún `ai-run.js` (solo se benefician del nuevo `extractJSON`).

### Inteligencia 2J V2 — completa en el alcance autorizado (2026-09-28; NO desplegada)

- Base obligatoria conservada: `c4e005a` (fix de estabilidad IA de Claude). No se ha cambiado
  `ai-run.js`, Sync V2, Workout engine, programas, Gym Profiles ni Bunker. Producción
  confirmada entonces estaba en `3c0129ad39970e8a87e8663c2402405df6199139`; esta nota
  histórica no determina el estado de despliegue actual (§1).
- Commits locales: `946abdd` (motor/señales), `7563be5` (superficies/onboarding),
  `d87ec18` (explicación opcional y tests API) y `25b3dda` (UI/Admin/tests); sin push.
- `frontend/src/lib/intelligence.js` deriva un contexto acotado del estado existente: últimas 36
  sesiones, programa activo/progreso por receipts, contexto declarado de `memberContext`, Gym Profile
  y categorías disponibles. No crea historial/cola/sync paralelos. No incluye Health, Community,
  conversaciones ni notas privadas; no llama a un proveedor.
- Señales deterministas: siguiente sesión del plan/programa, adherencia, sesión pendiente, retorno
  tras 14 días, progresión tras dos exposiciones positivas con RPE/Series Feedback e incremento real,
  dos exposiciones difíciles, plateau tras tres, PR reciente, conflicto de material y contenido oficial
  compatible. Restricciones explícitas y material incompatible frenan consejos de carga; un swap se
  ofrece solo desde el motor existente y no se afirma válido si hay restricciones no verificadas.
  Máximo tres recomendaciones, prioridad/dedupe y caducidad de evidencia; ninguna modifica estado.
- UI local: “Para ti hoy” en Home, tarjetas contextuales en Workout/Program Detail/Mi 2J y siguiente
  sesión tras Workout. Cada tarjeta distingue sugerencia automática, acción explícita, razón/fuente,
  aplazamiento y ocultación por usuario en localStorage; introducción de tres pasos reabrible.
  Las acciones navegan a los flujos existentes para revisión, sin aplicar cambios en silencio.
- Explicación generativa **opcional y a petición**: tras abrir la razón, un usuario con consentimiento
  Coach vigente puede pedir mejor redacción. API reutiliza proveedor, `invokeWithRetry`, logs,
  single-flight y límites diarios existentes; envía solo tipo cerrado de señal + números acotados,
  nunca historial bruto, Health, Community, notas ni identidad. Acepta únicamente una frase cauta,
  sin decisión/acción nueva; inválido, proveedor caído o sin consentimiento dejan intacta y visible
  la tarjeta determinista. `ai-run.js` de Claude no se modificó.
- Superficie staff compacta en detalle de socio **solo admin**: hasta 3 señales de historial,
  razón/fuente/confianza y enlace al historial existente; distingue sugerencia automática de decisión
  del entrenador. El endpoint trainer actual no concede historial; no se amplían permisos ni se
  expone esta vista a trainer no-admin. Health/recovery se deja fuera: WHOOP solo aporta último valor,
  sin patrón reciente ni consentimiento específico para ese uso; no inferir fatiga ni enviar Health
  al proveedor. Ambos límites requieren decisión de permisos/datos antes de ampliarse.
- Validación local final: frontend **948/948**, API **304/304**, build OK con aviso histórico de
  chunks; español **3607/3607** y `git diff --check` OK. QA visual con datos sintéticos: 390/768/1280
  px, claro/oscuro; 0/1/3 tarjetas, progresión, esfuerzo alto, plateau, equipo, programa, sesión
  pendiente, retorno, PR, contenido oficial, onboarding y vista admin. Se inspeccionaron apertura de
  razón y CTA, sin overflow horizontal; corregido contraste de texto/CTA. Offline/IA no disponible
  mantienen tarjetas deterministas (pruebas). No hay QA en dispositivo real ni llamada real a IA.
- Los umbrales son heurísticas conservadoras de producto, no ciencia clínica ni nueva versión del
  protocolo; véase `docs/EVIDENCE.md`.

### Constructor UX mini-sprint (desplegado después; 2026-09-27)

- Días del programa arriba en barra horizontal (`DayBar` en `views/trainer/Constructor.jsx`):
  orden, activo, weekdays, resumen, "sin guardar", scroll horizontal, + Añadir día.
- Grid `cx-grid tri`: **Biblioteca de ejercicios** (izq., `ExercisePicker` de `sheets.jsx` en modo
  `inline`, sin segunda biblioteca) | rutina del día | **Biblioteca de bloques** (der., sin cambios).
- Responsive: ≥1100 px tres columnas; <1100 px rutina sola y ambas bibliotecas como drawers
  (ejercicios izq., bloques der.) con botones Ejercicios/Bloques. "+ Añadir ejercicio" inferior se
  mantiene: enfoca la búsqueda (desktop) o abre el drawer.
- Drag & drop nativo: ejercicio → antes de la fila donde cae (se une a su bloque) o al final;
  bloque → al final como su botón Añadir. Tipos en `components/constructor/drag.js`. Guardado,
  validador, Sync V2 y endpoints trainer sin cambios.
- Tests: `views/trainer/constructor-ux.test.jsx` (12). QA visual local con API efímera sintética:
  1440/1280 (oscuro/claro), 820, 390; guardar + recargar OK.
- Limitaciones: drag & drop solo con ratón (táctil usa botones); `BlockLibrary`/`GuidedAdmin` no
  cambian; `TrainerRoutineBuilder` mantiene su picker propio.

## 2. Ramas y PRs

- Trabajo: `feat/pwa-tanita-bunker-roadmap`. Base/default en GitHub: `2jfitness-dev`
  (**no hay `main`** de trabajo).
- PR #10 (feat → 2jfitness-dev) sigue abierta: **no fusionar automáticamente**.
- PR #11 (legal) fusionada en `2jfitness-dev`; GitHub detecta `agpl-3.0`.
- Dependabot PRs: no fusionar en masa; revisarlas en un sprint específico.
- No atribuir a Claude cambios realizados por otro agente; conservar la autoría real.

## 3. Features desplegadas (resumen)

| Área | Qué hay | Dónde mirar |
|---|---|---|
| Sync V2 | revisión/generación, tombstones, receipts, conflictos multidispositivo; DELETE explícito autoritativo | `api/lib/sync.js`, `frontend/src/lib/sync-client.js` |
| Offline Training V1 | entreno local, sincroniza una sola vez al volver | `lib/sync-client.js`, `store/useStore.js` |
| Training V2 | vista simple/detallada, teclado 2J, discos, guía | `views/Workout.jsx`, `components/SetPad.jsx` |
| Progressive Overload V1 | recomendación por ejercicio con motivo y confianza | `lib/overload.js`, `lib/progression.js` |
| Mi 2J | rangos, logros, récords, celebraciones | `lib/mi2j.js`, `views/Mi2J.jsx` |
| Health V2 / Fitness V1 | evolución física, segmental, check-in, WHOOP/Strava/BLE, zonas | `views/Health.jsx`, `lib/fitness.js` |
| Constructor V2 / V2.1 | programa → día → bloques → ejercicios; bloques guiados con timing; sugerencias 2J | `views/trainer/Constructor.jsx`, `components/constructor/*` |
| Protocolo 2J v1.0 | reglas, validador determinista, save policy, puerta IA | `lib/protocol/*` (copia en `api/lib/protocol`) |
| Official Blocks (desplegado) | 158 maestros | `api/lib/blocks-official.json`, `scripts/protocol/official-blocks.matrix.mjs` |
| Guided Blocks | ejecutor circuito/intervalos/HIIT/Tabata/movilidad en el entreno | `lib/guided.js`, `components/GuidedRunner.jsx` |
| Entrena con 2J / Guided Programs V2 (desplegado) | 69 rutinas, 13 programas, 8 colecciones, 3 destacadas | ver §1 y §7 |
| Legal / credits | AGPL, atribución, pantalla Legal | ver §8 |
| Exercise Library V2 | taxonomía, recomendados, familias, búsqueda, swap | ver §4–5 |
| Bunker | pantalla de sala multiusuario | ver §10 |
| Trainer tools | panel, asignar, duplicar, IA de rutinas, escaneo | `views/trainer/*`, `lib/trainer-api.js` |
| AI protocol gate | la IA recibe reglas + contenido oficial; FAIL → reparar una vez → descartar | `api/coach/protocol-gate.js`, `api/coach/prompts/*` |

## 4. Exercise Library V2 — desplegado

Doc: `docs/EXERCISE_LIBRARY_V2.md`. Métricas generadas: `docs/EXERCISE_LIBRARY_AUDIT.md`.

| Métrica | Valor |
|---|---|
| Ejercicios | 1324 (ids históricos preservados, mismo orden) |
| Recomendados 2J / curados | 210 / 189 |
| Con movimiento canónico / sin él | 1305 / 19 (solo biblioteca completa) |
| Movimientos canónicos | 35 (sin categorías nuevas; se asignaron más ejercicios a las existentes) |
| Equipamiento | 28 tipos en 6 familias |
| Deprecated con preferredId | 26 |
| Grupos de posibles duplicados (pendientes) | 0 (revisados; ver 13b) |
| Aliases | 102 (en 57 ejercicios) |
| Nombres compartidos entre ejercicios vivos | 0 |
| Con material / imagen / GIF | 1324 / 1324 / 1324 |

**Arquitectura:** dataset original (`lib/exercises-data.js`, `names/es.js`) + capa 2J
(`lib/protocol/movements.js` taxonomía compartida con la API; `lib/library/overrides.js`
decisiones: `DEPRECATED`, `EXTRA_RECOMMENDED`, `MOVEMENT_OVERRIDE`, `ALIASES`,
`REVIEWED_VARIANTS`) + `lib/library/core.js` (puro: `facetsOf`, `RECOMMENDED`, `preferredOf`,
`similarVariants`, `checkLibrary`) + `lib/library/index.js` (app: búsqueda, familias, favoritos,
recientes, `scopeList`, `prioritize`). Clasificador: `lib/protocol/classify.js`.

- **El id original es la identidad histórica.** NO se migró historial, PR, workouts ni snapshots.
  Solo cambiaron 14 nombres EN y 12 ES (mojibake, pares que compartían nombre, "treadmill run").
- **Deprecated:** nunca se borran; siguen resolviendo historial; no aparecen en selección normal
  ni en la IA; imports y selecciones nuevas usan el preferredId.
- `eq` del dataset no se toca (rutinas oficiales y disponibilidad lo leen); la precisión va en
  la capa canónica (`EQUIPMENT_OVERRIDE`: 0576 plate-loaded, 0577 selectorized, 0798 bike,
  2331 elliptical).
- Estiramientos = mobility (sin volumen directo); curl de muñeca ≠ bíceps; side bridge ≠ hip thrust.
- Validador: nota `high_overlap` (no cambia PASS / PASS_WITH_REASON).
- Favoritos: `S.favEx` con `update()` como `excludedEx` (sin sync nueva).

**UX — Plan → Ejercicios:** Ejercicios 2J (familias por región) · Biblioteca completa ·
búsqueda V2 · favoritos · recientes · filtros músculo / movimiento / material · ficha con
movimiento, material, variantes y aviso de duplicado · revisión de metadata en Admin.
Búsquedas verificadas: "remo máquina", "glúteo barra", "bisagra", "hip thrust", "treadmill".
Imports: alias 2J + nombre traducido exacto; deprecated → preferido; empates = candidatos.

## 5. Swap V2 (determinista, sin IA)

Compartido por Workout, Constructor (DayCanvas), TrainerRoutineBuilder, RoutineEdit y Bunker
(misma hoja `alternativesSheet`, flujo del Bunker sin cambios). `lib/alternatives.js`
`getReplacementGroups`: primero "Variantes similares" (mismo movimiento canónico → patrón →
material → lateralidad → ángulo; recomendados en empate) con razones visibles ("Mismo patrón",
"Mismo tipo de máquina"), después alternativas por músculo. Máximo 8. Nunca deprecated.

## 6. IA + Library V2

- `api/coach/library.json` (generado por `scripts/build-coach-library.mjs`) conserva los 1324 ids
  con metadata `mv`, `rec`, `pref`. La validación sigue impidiendo ids inventados.
- Política: bloques/rutinas oficiales > ejercicios recomendados > máster compatible > generación.
- `librarySlice` (`api/coach/payload.js`): excluye deprecated y ocultos, recomendados primero.
- **IMPORTANTE:** `data/hidden-exercises.json` (lista negra del gimnasio) puede ocultar muchos
  recomendados. La política es **recomendados primero ENTRE LOS VISIBLES**; nunca asumir un
  mínimo fijo. Producción reporta `hidden_ex=773`, `ai_rec_first=125`: **válido**. El probe de
  75317b0 falló por asumir ≥150; corregido y con test (`api/test/library-v2.test.js`).

## 7. Contenido oficial y Entrena con 2J

- 198 bloques oficiales: 198 PASS, 0 FAIL, 0 PASS_WITH_REASON (desplegado).
- 155 rutinas guiadas oficiales, 15 colecciones, 22 programas, 3 destacadas (`api/lib/guided-official.json`,
  `scripts/build-official-routines.mjs`). Ninguna semilla usa un deprecated.
- **Entrena con 2J** (`views/Train2J.jsx`, `components/train2j/parts.jsx`, `lib/train2j.js`,
  `lib/guided-api.js`, API `api/lib/guided-*.js`): storefront, rutas `/train2j`, `/train2j/c/:id`,
  `/train2j/r/:id`; colecciones, destacados, Para ti (determinista), favoritos, recientes/repetir,
  portadas SVG (`components/WorkoutCover.jsx`). Empezar = free-session snapshot (`routineId: null`,
  `src2j` en historial); nunca toca week/dayPlan/program/rutina maestra. Trainer asigna (copia) y
  duplica; admin gestiona oficiales y colecciones (`/trainer/guided`). Favoritos y caché locales
  por uid (`g2j_favs:`, `g2j_catalog:`). `DATA/guided.json` solo guarda overlays/propias.

## 8. Legal / autoría

AGPL-3.0-or-later. Original: **openGym — Duarte Santos**. Fork intermedio (AI Coach):
**Alex Costa**. Contribuidor original: **Octavio Di Marco**. Fork 2J: **Copyright (C) 2026
Juan Jose Perez Sanchez — 2J Fitness Center**. Archivos: `LICENSE` (texto AGPL intacto, no
tocar), `NOTICE.md`, `AUTHORS.md`, `TRADEMARKS.md`, `THIRD_PARTY_NOTICES.md`; pantalla Ajustes →
Legal y créditos (`views/Legal.jsx`); cabeceras SPDX en archivos propios (204). **No eliminar
la atribución original.**

## 9. Protocolo 2J

`docs/TRAINING_PROTOCOL_2J.md`, `docs/EVIDENCE.md`. Versión **v1.0** (no subirla por taxonomía).
Copia runtime: `api/lib/protocol` = **9 archivos** (`node scripts/sync-protocol.mjs --check`).
Jerarquía permanente: restricciones explícitas > seguridad/permisos > Protocolo 2J > programa
existente > contenido oficial > IA generativa. IA FAIL → reparar una vez → descartar.
Restricción explícita: nunca overridable. Override metodológico manual: solo entrenador con motivo.

## 10. Bunker

Multiusuario con aislamiento por PIN; handoff móvil → Bunker; descanso prescrito (fallback 90 s);
superseries; sustitución V2; herramientas; Health nunca visible en la sala; bloques guiados no se
ejecutan como player completo en el Bunker (aviso). `views/Bunker.jsx`, `lib/bunker-workout.js`,
`api/bunker/*`.

### Bunker Live V2 — Sprint 4 cerrado (2026-10-01; desplegado después, ver §1)

- Al inspeccionar el HEAD `db69559` (desde `013c3b7`, solo el handoff había cambiado), se encontró
  ya disponible: navegación horizontal por todos los ejercicios, selección de rutina o freestyle
  cuando no hay sesión asignada, sets/cardio, supersets A1/A2, swaps existentes, minimización por
  socio, sesiones simultáneas por panel, herramientas globales, cola local/retry de cambios y finish
  idempotente ya existente. Bunker conserva el contexto oficial 2J. Los bloques guiados muestran una
  nota: su temporización completa sigue en el teléfono.
- Commit `2920370`: añadió barra derivada de progreso (ejercicios/sets hechos) dentro de cada panel y
  preferencia por el GIF catalogado del ejercicio, con imagen catalogada como fallback. El progreso
  se calcula desde `active.entries` local del mismo panel; no crea estado, persistencia ni sincronía.
- `13087d5`: minimizar y abrir administración ya no desmontan los paneles; conservan índice,
  borrador y descanso local. `/session` devuelve el descanso del store existente. Swaps reutilizan
  el selector compartido (Modals montado en la ruta Bunker), con contexto del socio del panel y
  perfil oficial 2J; no usan los ejercicios personalizados de otra cuenta.
- Red: un fallo de carga no revoca credenciales. La cola existente conserva operationId/revisión
  y el borrador ante fallos y 409; muestra pendiente/Reintentar o conflicto. No hay overwrite ciego:
  solo la elección explícita de descartar y cargar una lectura exitosa elimina el borrador.
  Finish pendiente conserva payload; no puede limpiar otra sesión instalada concurrentemente.
- Handoff normal/repetido, 409/force y dos usuarios revalidados. Correcciones mínimas: una copia
  divergente del mismo ID mientras está en el kiosco requiere confirmación; una sesión finalizada
  o tombstoned no puede reabrirse, tampoco con force. El teléfono no ofrece reemplazarla.
- Finish conserva `src2j.program` y topW, sets/targets/RPE/feedback/cardio. History cuenta cada
  sesión una vez, calcula la siguiente y completa el programa. API usa copia generada del MISMO
  helper puro del teléfono (`scripts/sync-guided-program-model.mjs --check` + test de paridad);
  no existe segundo motor de programas ni cambio de Sync V2.
- QA real en navegador local con socios ficticios: 1/2/3 paneles a 1440×900, 1024×768, 768×1024
  y 390×844; GIFs catalogados, navegación/superseries, progreso, descanso, swap, herramientas,
  minimizar/restaurar y finish de uno manteniendo los otros. Desconexión real conserva set y
  descanso; Reintentar confirma el set tras recuperar conexión. Conflicto concurrente conserva
  borrador y bloquea mutaciones. Se corrigieron botoneras recortadas en móvil/tablet. 4 paneles
  degradan con scroll sin overflow global. No se añadió onboarding: PIN y controles actuales bastan.
- Tests finales: frontend **957/957**, API **312/312**, Bunker frontend **24/24**; 8 regresiones API
  en `bunker-live.test.js`. Build OK; español **3620/3620**, paridad y `git diff --check` OK.
  `ec0d77a`: los dos fallos de volumen mensual eran fixtures dependientes de la fecha (el 1/oct
  la semana comienza en septiembre y no cuenta); no hubo cambios de Bunker en esa lógica.
  Pruebas fijadas a mediados de mes + caso explícito del límite mensual; cálculo sin modificar.
- Límites conservados: temporización guiada completa en teléfono; PIN requerido tras recarga
  (credenciales solo en memoria), colas existentes ligadas al token y almacenamiento best-effort.
  No se garantiza recuperar un borrador sin confirmar tras recarga con NUEVO token; no se ha
  rediseñado esa persistencia. Descanso de sala efímero tras reinicio API; aviso conocido de chunks
  grandes. Antes de deploy: aprobación y prueba en el dispositivo físico; no runner/push/deploy
  en este cierre. Producción es la indicada en §1.

## 10b. Series Feedback V1 (desplegado en 133a52c)

`lib/set-feedback.js` + componente `SetFeedback` en `views/Workout.jsx` (ambas vistas). Tras
una serie de trabajo hecha, las opciones son easy/good/hard/fail y se guardan en `set.feel`
(opcional). La sugerencia es solo para la siguiente serie, usa `stepWeight`/`realizableToward` y
nunca es automática. Aceptar cambia solo `sets[next].w`; `fbDone` cierra la fila. No toca la
rutina ni el target. RPE ≥ 9 / RIR ≤ 1 frena "muy fácil". El ~10 % de "No pude" es una
heurística práctica 2J V1, no una regla científica universal. No se muestra en logs pasados ni en el
Bunker (pospuesto: `views/Bunker.jsx` tiene su propio flujo de series).

## 11. Deploy

- El runner local `deploy-7ebb722.ps1` se usó para el release Gym Profiles V1; los runners por
  release son herramientas locales/no versionadas. No existe runner para el polish `70080f1`.
- Práctica: PowerShell en Windows + Git Bash; OpenSSH interactivo, **la contraseña la teclea el
  usuario, nunca se guarda ni automatiza**; validación local completa (tests con recuentos exactos,
  build, locales, todos los `--check`); tarball `git archive` con SHA-256; release exact match;
  backup de todo `data/` con hashes/propietarios; probe de solo lectura en el contenedor; smoke HTTP
  completo; rollback exacto automático sin tocar `data/`. `-PrepareOnly` para validar sin tocar el
  servidor. Crear un runner nuevo por HEAD a partir del último, actualizando invariantes.
- Corrección clave: `remove_obsolete_release_files` elimina también directorios target-only vacíos
  (install y rollback); `verify-current-production` aborta ante contaminación real (archivo del
  target, directorio no vacío, archivo de código fuera del manifiesto) y solo retira el residuo
  vacío. **Nunca `git clean` indiscriminado en producción.**
- Checks de dominio: `sync-protocol`, `build-official-blocks`, `build-official-routines`,
  `build-coach-library` (todos `--check`), `check-exercise-library`, `audit-exercise-library --check`,
  `sync-gym-profiles --check`, `frontend/scripts/check-locales.mjs`, `git diff --check`.
- No desplegar ni crear runner sin prompt explícito; no hacer push/merge remoto sin autorización.
- Existe local y sin versionar `deploy-b890a26.ps1`, preparado para el HEAD anterior `b890a26`.
  Su `-PrepareOnly` se validó en el checkpoint anterior; tras Gym Profiles V1.1 ya no coincide con
  HEAD y no debe ejecutarse para este sprint. No hay runner de V1.1.

## 12. Gym Profiles — historial y mejora local de material personal

Commits V1: funcional `d50fa9e`, relevo/documentación `7ebb722`. Release checkpoint anterior
`7ebb722708a6b27c33aafe60f799b1dada8fbc59`; ver producción actual en §1. Contexto
sobre Library V2, no nuevo catálogo ni metodología.

- Modelo canónico: `frontend/src/lib/gym-profile-model.js`; copia API generada mediante
  `node scripts/sync-gym-profiles.mjs` (test de igualdad + `--check`). Ambos contenedores siguen
  siendo independientes; frontend no importa archivos de API. No modificar la copia a mano.
- Persistencia: `S.gymProfiles = { activeId, overrides: { home, hotel }, custom: [...] }` mediante
  `useStore.update()`, almacenamiento offline y Sync V2 existentes. Ausencia/null → 2J sin migrar.
  Cada perfil expone `id`, `name`, `type`, `availableEquipment` (ids de la taxonomía existente).
  Máximo 12 perfiles propios; no se copian perfiles a workouts ni rutinas.
- Oficiales: `2j`, `home`, `hotel`. 2J de solo lectura: bodyweight/dumbbell/barbell/machine/selectorized,
  según categorías documentadas en `lib/equipment.js`, NO inventario de máquinas concretas.
  Casa/Hotel empiezan con peso corporal; permiten configurar incluso una lista vacía. Otro gimnasio
  y Personalizado son perfiles del usuario con id estable `gym-*`, nombre y material configurable.
- `components/GymProfile.jsx`: selector visual contextual y gestor en Ajustes. Sin cambios en Home.
  Library/pickers priorizan compatibles y permiten filtrar; biblioteca completa sigue accesible.
  Swap determinista: compatibles antes de variantes/músculo, máximo 8 recomendados y fallback.
  Constructor avisa en las filas sin bloquear; Workout muestra sustitución voluntaria en ambas vistas,
  nunca cambia ejercicios/targets/master al abrir. Train2J calcula compatibilidad de las tarjetas,
  sin generar rutinas duplicadas. No se migran historial/PR ni se modifican seeds/protocolo.
- IA socio/entrenador: `api/coach/payload.js` envía solo tipo/material y alcance, sin nombres privados.
  Tras seleccionar perfil prioriza compatibles dentro del catálogo; usuarios legacy mantienen orden
  previo. Disponibilidad está subordinada a restricciones explícitas, seguridad y Protocolo 2J.
- Bunker: perfiles personales pospuestos; su swap fija contexto 2J, no hereda Casa del operador.
  Bloqueos temporales de material 2J se respetan en compatibilidad/swap, sin aplicarlos a Casa/Hotel.
- Validación V1: 15 pruebas frontend nuevas y 3 API (contexto IA, orden y copia); sin llamadas reales
  a IA. V1 desplegado según confirmación del usuario.
- Polish visual, commit `70080f1` (desplegado después): fila compacta en Ajustes con ayuda; hoja
  mobile-first con cinco tarjetas, indicador textual de perfil activo, material en chips y español.
  El modelo, persistencia, API y Sync V2 no cambian. Frontend **895/895**, build OK, español
  completo, `git diff --check` OK. El checkpoint local `b890a26` incluye la documentación de ese
  polish. No se hizo validación manual del polish en dispositivo real.
- **Gym Profiles V1.1 — editor global 2J (desplegado después):** `data/gym-profile.json` es una
  única configuración global del gimnasio, con fallback al inventario incluido en el release.
  `GET /api/config` la expone (son solo categorías públicas); `POST /api/admin/gym-profile/official`
  exige admin y persiste cambios mediante escritura temporal + rename. Los perfiles personales no
  contienen el inventario oficial. El cliente guarda el último valor conocido en
  `gym_official_equipment_v1`, fuera de `gym_state_v1` y Sync V2, para seguir mostrando compatibilidad
  offline; al reconectar/volver al foco consulta de nuevo la fuente del servidor.
- El editor visual agrupa los toggles por las seis familias de la taxonomía existente, con guardar,
  cancelar y restaurar el inventario recomendado. Solo admin ve/usa la acción de edición; miembro y
  trainer no-admin ven el perfil 2J en lectura. Backend rechaza ambos roles al escribir.
- Inventario recomendado mapeado a ids existentes: bodyweight, barbell, ez_bar, dumbbell, cable,
  weighted, selectorized (máquina genérica de placas guiadas), machine (palancas), plate_loaded,
  smith, sled, stability_ball, roller, treadmill, bike, elliptical, stepmill y skierg. No se amplió
  la taxonomía.
- Library, Swap, Constructor, Workout y Train2J leen el contexto canónico ya existente y reaccionan
  al refresco del inventario. Coach toma el mismo contexto actualizado y conserva la jerarquía de
  restricciones/seguridad/protocolo. Bunker usa su contexto fijo `2j` en el selector de swaps, por
  lo que también consume el inventario compartido; no tiene perfil del operador ni copia propia.
  Las rutinas/historial no se reescriben ni se crean snapshots por cambios de material.
- Verificación local V1.1: frontend **898/898**, API **266/266**, modelo frontend/API sincronizado,
  locales ES completas, build y `git diff --check` OK. Test HTTP verifica 401 anónimo, 403 miembro y
  trainer, guardado admin, persistencia tras reinicio y lectura común. El checkpoint de producción
  de esa verificación fue `7ebb722708a6b27c33aafe60f799b1dada8fbc59`. Esta nota histórica
  no determina el despliegue actual ni tiene runner
  válido (el runner local previo apunta a `b890a26` y ya no coincide con HEAD).
- Limitación: otros dispositivos actualizan al iniciar, volver al foco o reconectar; no hay
  notificación realtime global. Las categorías expresan disponibilidad general, no una máquina o
  accesorio concreto. Falta QA visual manual de este editor en móvil/tema claro/oscuro.
- Límites V1: compatibilidad por equipo principal, no comprueba accesorios secundarios (banco/barra
  de dominadas) ni todas las máquinas de una categoría; no inventar banco/TRX/esterilla en taxonomía.
  Train2J solo etiqueta; no filtra ni adapta rutinas. No hay editor de bloques por lugar ni perfiles
  compartidos. Cambios simultáneos de preferencias siguen la resolución existente de Sync V2.

**GYM PROFILES — USER EQUIPMENT UX (commit `013c3b7`; histórico; desplegado después, ver §1):**
Casa, Hotel y perfiles personalizados ya admitían edición del material por el usuario. Este commit
añade búsqueda en el catálogo existente, contador de seleccionados, selección temporal y botón
explícito «Guardar equipamiento». El perfil oficial muestra que 2J Fitness Center gestiona su
material: socio en solo lectura, admin con el editor oficial existente. Se reutilizan los mismos
equipment IDs; guardar actualiza la compatibilidad existente para Exercise Library, swaps,
Constructor, Workout, Train2J e Intelligence 2J, sin rehacer esas integraciones. Tests locales:
frontend **949/949**, API **304/304**, build OK, español completo y `git diff --check` OK.
La selección no guardada se descarta al salir. (En aquel momento producción estaba en
`abe32659d5bc20179f3270cd2f7d2612ea132623`; hoy §1.)

**Nota para Sprint 4:** partir de `013c3b7378a72facc35420cd2197ea9887a3c950`;
no rehacer la edición de equipamiento de Gym Profiles.

**Siguiente paso para la mejora de material personal:** revisión del commit `013c3b7` antes de
preparar cualquier despliegue; `deploy-b890a26.ps1` es un artefacto local obsoleto para este HEAD.
No desplegar sin autorización explícita.

**Pendientes Library V2 no bloqueantes:** revisar visualmente los 18 grupos de posibles
duplicados; clasificar los 28 sin movimiento; precisar plate-loaded/selectorized con evidencia;
posible editor admin de metadata; etiquetas heredadas "(male)" visibles en la biblioteca completa.

**Siguiente trabajo:** revisión/aprobación del cierre local de Sprint 4; no rehacer Gym Profiles
ni Bunker Live. Otras ideas de roadmap (Health V2, Library V2) requieren priorización explícita.

**Deuda conocida (no autorizada como trabajo):** retención/poda de receipts, tombstones y journal
de Sync V2; Sync V2 es monoproceso; unidades de pesos históricos; traducciones parciales en
idiomas distintos del español (política: fallback a inglés).

## 13b. Sprint 4.5 — Entrena con 2J Admin + contenido + calidad de biblioteca (DESPLEGADO)

**DEPLOY STATUS: DEPLOYED.** Producción: `b4e7baad74131a90cc002d662cad1e4a21f973ce` (rollback exacto `760008e`).
Rama `feat/pwa-tanita-bunker-roadmap`; commits del sprint: `05268ea` (calidad de biblioteca), `870b533` (backend admin),
`fb88893` (contenido), `791312e` (Studio + frontend), `ebef26c`/`76a6518` (QA predeploy y test de compatibilidad),
`760008e` (Gym Profile oficial con kettlebells, 19 ids) y `b4e7baa` (switch de visibilidad en las filas del Studio y
las cards de bloques: ON = visible, OFF = oculto, guardado inmediato con los endpoints existentes; filtros
Todos/Visibles/Ocultos; el menú «…» queda para editar/duplicar/borrar).

**ENTRENA CON 2J ADMIN — arquitectura.** Persistencia propia en `DATA/guided.json` (nunca en el estado/Sync V2 del
socio): overlays sobre las semillas (`overrides`, `officialCustom`, `programsCustom`, `collections`), las semillas de
`api/lib/*.json` no se sobrescriben. Estados `draft → active → hidden` (draft implica active:false); los socios solo ven
`active`; el admin ve todo. `contentRev` + `GET /api/config`→`guidedRev` invalidan la caché del cliente.
Endpoints (`api/lib/guided-routes.js`): `GET /api/guided`, `POST /api/guided/{save,duplicate(official),active,status,delete,curate,reorder,collection,collection/delete,program/{save,curate,duplicate,delete}}`
y `GET /api/admin/library`, `POST /api/admin/library/save`. **Permisos en backend:** admin escribe contenido oficial,
programas, colecciones y biblioteca; trainer solo duplica/edita/borra sus propias rutinas y asigna (snapshot vía
`/api/trainer/member-routine`); socio solo lee. Todo contenido oficial pasa por `validateAgainst2JProtocol` + refs,
ids, no-deprecated, equipo, nivel/duración, tiempos/rondas; programas validan semanas/días/refs/publicación con
`saveProgram(..., {dryRun})`. Snapshots de rutinas/programas ya empezados o asignados nunca se mutan.
**Frontend (lazy, solo admin):** `views/trainer/studio/` — `StudioAdmin.jsx` (Rutinas/Programas/Colecciones: filtros por
estado/tipo/búsqueda, publicar/ocultar/borrador, destacar, reordenar, duplicar como borrador, vista previa como socio,
editor de colección con rutinas y programas), `ProgramEditor.jsx` (semanas, días, selector de rutinas, copiar semana,
validación en vivo del servidor, publicar), `LibraryQuality.jsx`, `parts.jsx`, `studio.css`; helpers puros en
`lib/studio.js` y `lib/library-quality.js`. El editor de rutina (`GuidedEditor`) añade estado, finalidad, portada y notas.
Rutas: `/trainer/guided` (admin→Studio, trainer→su página), `/trainer/guided/program/:id`, `/trainer/library-quality`.
Ayuda de primer uso: 3 pasos, reabrible con el botón ⓘ (`studio_help_v1` en localStorage).
**Caché/offline:** catálogo `g2j_catalog:<uid>` + `useGuided.notifyRev` recarga si cambia `guidedRev`; overlay de biblioteca
`lib_overlay_v1` (sin notas del curador) aplicado desde `/api/config` y restaurado al arrancar sin red.

**CONTENT EXPANSION (antes → después).** Bloques 158 → **198** (todos PASS); rutinas 69 → **155** (todas PASS); colecciones 8 → **15**
(+Calentamientos, Vuelta a la calma y estiramientos, Recuperación, Finales de sesión, Sin material, Bajo impacto, 30 min o más);
programas 13 → **22**. Campo `purpose` (warmup/cooldown/recovery/stretch/finisher) separado de la categoría (sin portadas
nuevas). Distribución: movilidad 37 (calentamientos 7, vueltas a la calma 4, estiramientos 10, recuperación 2; además 3 finales de sesión de 5 min), HIIT 16,
Tabata 14, intervalos 12, circuitos 9, core 5, mixtas 6, fuerza 56; niveles 54/80/21 (iniciado/intermedio/avanzado);
duraciones 5·19, 10·20, 15·15, 20·36, 25·12, 30·17, 35·11, 40·9, 45·10, 50·4, 55·1, 60·1 (min·nº). Máquinas: cinta, bici,
elíptica, escaladora, SkiErg (añadido a `GYM_EQ`). Compatibilidad con Gym Profile en 3 niveles (Compatible / Parcialmente
compatible / Requiere otro material) con los ejercicios que faltan; nunca se oculta una rutina por un ejercicio.
Generación: `scripts/protocol/official-{blocks,routines}.matrix.mjs` → `build-official-{blocks,routines}.mjs`; el build
exige español (`es.js`) para todo texto de rutina y colección.

**LIBRARY QUALITY.** Deprecated 14 → **26** (con evidencia en `overrides.js`; deprecated→preferido sin cadenas ni ciclos, ids
nunca borrados); movimiento canónico 1296 → **1305/1324** (19 sin movimiento, solo biblioteca completa); Recommended 2J 186 → **210**;
grupos de posibles duplicados pendientes **0** (audit) — 7 pares revisados mantenidos como variantes; alias 102 en 57
ejercicios; nombres/mojibake corregidos vía `NAME_OVERRIDE`. Pendiente sin evidencia suficiente: los 19 sin movimiento y
1 par "push up on bosu ball" / "push-up (bosu ball)" que la herramienta marca como posible duplicado.
**LIBRARY ADMIN.** Editable por admin: nombre visible (EN/ES), alias, movimiento canónico, material, Recommended 2J,
preferido/deprecated, nota del curador. Persistencia `DATA/library-admin.json` (overlay con `rev`), reglas compartidas
`frontend/src/lib/library/overlay.js` → copia generada `api/lib/library-overlay.js` (`scripts/sync-library-overlay.mjs --check`).
Rechaza cadenas, ciclos, otro movimiento, nombre ambiguo y duplicar algo que el contenido oficial activo usa. La IA y los
validadores leen la biblioteca efectiva (overlay aplicado).

**QA predeploy (2026-10-01):** revisión visual 1440/1920/móvil y muestreo de contenido; correcciones objetivas: títulos con minutos reales (`cool-down-fullbody-15`, `stretch-global-20`), circuitos "sin material" sin mancuerna/máquina (walking lunge, abducción de cadera), colección `c2j-home` renombrada «Casa y hotel» (evitaba rail duplicado), etiquetas de material del programa `g2j-bodyweight-hiit-3w`, contraste de inputs y botones alineados en Studio. Contenido de producción (158 bloques/69 rutinas/13 programas) idéntico byte a byte.

**IA.** `compatibleRoutines/Programs` solo ofrecen contenido oficial `active`, con preferencia por destacados/compatible con
el equipo; nunca deprecated (test en `studio-admin.test.js`).
**TESTS.** API 346/346; frontend 1005/1005 (nuevos: `lib/studio.test.js` 15, `views/trainer/studio/studio-runtime.test.jsx` 5);
build OK; español 3968/3968; checks de sincronía (protocol, coach library, bloques, rutinas, overlay, gym profiles, audit,
check-exercise-library) OK. **Limitaciones:** no hay test e2e de navegador del Studio (QA visual manual con API efímera
sintética: escritorio/tablet/móvil, claro/oscuro); el editor de rutina reutiliza el Constructor (sin arrastrar y soltar para
reordenar rutinas: botones subir/bajar); subir portadas propias no está implementado (se elige entre las portadas por tipo).

**EXTERNAL_CONTENT_REQUIRED=YES** (no se importó nada). Huecos: movilidad torácica específica (open book / thread the needle),
cat-cow, postura del niño, 90/90 y paloma de cadera, couch stretch, movilidad de muñeca (solo hay `0721` y curls) y de tobillo
(solo `1368` círculos; falta rodilla-a-pared), movilidad de hombro con banda (pass-through/dislocates), cardio de remo
(rowing ergometer), air bike/assault bike, sled push/pull y carries, foam rolling. Opinión: **free-exercise-db** (Unlicense,
~870 ejercicios en JSON con campos compatibles) para completar estiramientos/movilidad; **wger** (CC-BY-SA, API, nombres y
descripciones en varios idiomas) si se quiere traducción; evitar datasets de Kaggle sin licencia clara; cualquiera exige
revisar duplicados contra los 1324 ids y aportar medios propios (imagen/GIF).

## 13. Workflow con Claude (ahorro de contexto)

1. Leer este archivo. 2. Inspeccionar solo los archivos relevantes. 3. No reauditar toda la app.
4. No explicar planes largos antes de actuar. 5. Implementar → tests → informe. 6. No tocar áreas
fuera del sprint. 7. No desplegar salvo prompt explícito. 8. No crear runner hasta que el sprint
esté aprobado. 9. No releer conversaciones previas si este archivo tiene la respuesta.
10. Actualizar este archivo al final de cada sprint importante. Comunicar en español.
Entorno: los heredocs de Git Bash alteran las barras invertidas — usar la herramienta Write para
scripts con `\b`, `\x..` o `\u..`.

## Protocolo de relevo

- Git y el código actual son la fuente de verdad; este archivo es un resumen operativo.
- Antes de continuar: rama, `git status`, últimos commits y diff.
- No rehacer trabajo marcado como completado sin demostrar un problema.
- Antes de entregar, ejecutar los tests relevantes.
- Si hay cambios sin commit, indicarlos explícitamente.
- Si una decisión puede causar pérdida de datos, cambio de arquitectura, auth, sync o seguridad,
  detenerse y preguntar.
- Claude y Codex no deben editar simultáneamente el mismo working tree.
