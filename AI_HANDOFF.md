# AI_HANDOFF.md — 2J Fitness Center

> Punto de traspaso entre sesiones (Claude Code / Codex). Resumen operativo del estado REAL;
> Git y el código son la fuente de verdad. El detalle histórico de cada sprint (V1–V3, Sync V2,
> Bunker, Health, Constructor, etc.) está en el historial de este archivo:
> `git show 75317b0:AI_HANDOFF.md` y en `CHANGELOG.md`.

## 1. Estado de producción (checkpoint 2026-09-27)

- **Producción estable actual (confirmada por el usuario):** `3c0129ad39970e8a87e8663c2402405df6199139`.
  Community V2 + Notifications + Sharing está desplegado y validado según confirmación del usuario.
- `7ebb722708a6b27c33aafe60f799b1dada8fbc59` es un checkpoint anterior de Gym Profiles V1;
  no representa la producción actual. El polish visual `70080f1` sigue sin desplegar.
- **Rollback conocido seguro:** `4aab27eaed769505c70d7d742be8de99e4052e5f` (Legal/credits).
- **Nunca** usar como rollback código anterior a `SYNC_V2_ROLLBACK_BASE` (`51a221d`); `90d98fe`
  o anteriores no son válidos sobre datos Sync V2.
- Tests en a9b6453: frontend **864/864** (`cd frontend && npx vitest run`), API **261/261**
  (`cd api && node --test`). `package.json` sigue en 1.3.0: identificar releases por commit.
- Gym Profiles V1: **894/894 frontend, 264/264 API**. Tras el polish visual: **895/895 frontend**,
  build OK, español completo y `git diff --check` OK; API sin cambios por el polish.
- Servidor: `/opt/2jfitness` (release extraída de tarballs, no es repo git), datos en
  `/opt/2jfitness/data`, backups en `/root/backups`, URL `https://app.2jfitnesscenter.com`.

### Community V2 + Notifications + Sharing — desplegado (2026-09-27)

- Anteriores commits preservados: `0fb027c` (API/permisos), `119cb5a` (frontend/UX), `e1d92d1`
  (handoff/changelog parcial). Cierre funcional: `fa4d080`; el commit documental posterior no forma
  parte del release de producción.
  **Desplegado**; producción actual confirmada por el usuario: `3c0129ad39970e8a87e8663c2402405df6199139`.
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

### Sprint 2 — Guided Programs V2 (completo en la rama local; NO desplegado; 2026-09-28)

- Foundation `1bbf316` conservada: rutas `/train2j/programs` y `/train2j/program/:id`, onboarding reabrible, Gym Profile por sesión, progreso desde workouts reales, pausa/reanudación/abandono, asignación trainer con receipt e idempotencia y snapshot de rutinas. `src2j.program`, `S.programs` y `activeProgramId` reutilizan Workout/Sync V2 sin cambiar su núcleo ni duplicar entrenamientos. Catálogo cacheado por uid permite consulta offline; no hay cola offline nueva.
- Contenido local ampliado de **39 a 69 rutinas** (fuerza/hipertrofia, movilidad, HIIT/Tabata y otras), de **155 a 158 bloques** y de **4 a 13 programas** de varias semanas; 8 colecciones, 3 destacadas. Los nuevos programas cubren retorno, fuerza, full body, tren superior/inferior, PPL, glúteo, casa, core y hotel. Semillas/protocolo espejados con generadores `--check`; referencias de días y bloques comprobadas. No hay contenido externo.
- Admin puede curar únicamente nombre, descripción, activo y destacado de programas oficiales; semanas y rutinas de la semilla son inmutables. Se filtran programas inactivos para socios, Coach y asignación trainer. Coach sigue recibiendo resúmenes filtrados por objetivo/nivel y compatibilidad del Gym Profile bajo consentimiento; la IA queda subordinada a `validateAgainst2JProtocol` v1.0.
- Library Quality Pass: 1324 IDs/medios/historial preservados; 3 duplicados con instrucciones/metadata coincidentes reciben `preferredId`, 4 pares de variantes quedan explícitamente separados, 43 asignaciones de movimiento, 3 aliases y selección curada de movilidad. Quedan **18 grupos posibles** sin evidencia para fusionar y **28 ejercicios sin movimiento canónico**. Sin fuzzy matching ni cambios de equipo inventados. Detalle generado en `docs/EXERCISE_LIBRARY_AUDIT.md`.
- QA visual local con API y usuarios sintéticos: catálogo/detalle en 390/768/1280 px, claro/oscuro sin overflow; onboarding, start, pausa, reanudación, abandono, asignación trainer→socio, compatibilidad 2J/Casa, completed 100 % con estado sintético, curación admin y error HTTP 503; catálogo cacheado con API caída. El estado completed se verificó con fixture, no con nueve entrenamientos manuales ni en dispositivo real. Se corrigieron textos españoles y posición de CTA en tablet.
- Validación local: frontend **930/930**, API **281/281**, build OK (warning histórico de chunks grandes), español **3520/3520**; generadores de rutinas/bloques, auditoría/catálogo, espejo de protocolo (9 archivos) y `git diff --check` OK. Otros idiomas: cobertura parcial con fallback inglés (805/3520). Sin llamadas reales a IA.
- Commits de cierre local: `245e460` (Library), `798d226` (contenido/programas), `2a8c2fe` (curación admin). Producción permanece en `3c0129ad39970e8a87e8663c2402405df6199139` según confirmación del usuario; este sprint **no está desplegado** y no tiene runner. Siguiente paso: revisión del diff/QA por el usuario y, solo tras aprobación, preparar runner para el HEAD exacto; no desplegar ni hacer push automáticamente.

### Bugfix estabilidad IA 2J (local, no desplegado; 2026-09-28)

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

### Constructor UX mini-sprint (local, no desplegado; 2026-09-27)

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
| Official Blocks (rama local; no desplegado) | 158 maestros | `api/lib/blocks-official.json`, `scripts/protocol/official-blocks.matrix.mjs` |
| Guided Blocks | ejecutor circuito/intervalos/HIIT/Tabata/movilidad en el entreno | `lib/guided.js`, `components/GuidedRunner.jsx` |
| Entrena con 2J / Guided Programs V2 (rama local; no desplegado) | 69 rutinas, 13 programas, 8 colecciones, 3 destacadas | ver §1 y §7 |
| Legal / credits | AGPL, atribución, pantalla Legal | ver §8 |
| Exercise Library V2 | taxonomía, recomendados, familias, búsqueda, swap | ver §4–5 |
| Bunker | pantalla de sala multiusuario | ver §10 |
| Trainer tools | panel, asignar, duplicar, IA de rutinas, escaneo | `views/trainer/*`, `lib/trainer-api.js` |
| AI protocol gate | la IA recibe reglas + contenido oficial; FAIL → reparar una vez → descartar | `api/coach/protocol-gate.js`, `api/coach/prompts/*` |

## 4. Exercise Library V2 — estado de la rama local (no desplegado)

Doc: `docs/EXERCISE_LIBRARY_V2.md`. Métricas generadas: `docs/EXERCISE_LIBRARY_AUDIT.md`.

| Métrica | Valor |
|---|---|
| Ejercicios | 1324 (ids históricos preservados, mismo orden) |
| Recomendados 2J / curados | 186 / 165 |
| Con movimiento canónico / sin él | 1296 / 28 (solo biblioteca completa) |
| Movimientos canónicos | 35 (sin categorías nuevas; se asignaron más ejercicios a las existentes) |
| Equipamiento | 28 tipos en 6 familias |
| Deprecated con preferredId | 14 |
| Grupos de posibles duplicados (pendientes) | 18 |
| Aliases | 82 |
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

- 158 bloques oficiales: 158 PASS, 0 FAIL, 0 PASS_WITH_REASON (rama local; no desplegado).
- 69 rutinas guiadas oficiales, 8 colecciones, 3 destacadas (`api/lib/guided-official.json`,
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

## 12. Gym Profiles V1 — desplegado; polish y editor V1.1 locales

Commits V1: funcional `d50fa9e`, relevo/documentación `7ebb722`. Release checkpoint anterior
`7ebb722708a6b27c33aafe60f799b1dada8fbc59`; la producción actual es `3c0129a...` (§1). Contexto
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
- Polish visual local, commit `70080f1` (no desplegado): fila compacta en Ajustes con ayuda; hoja
  mobile-first con cinco tarjetas, indicador textual de perfil activo, material en chips y español.
  El modelo, persistencia, API y Sync V2 no cambian. Frontend **895/895**, build OK, español
  completo, `git diff --check` OK. El checkpoint local `b890a26` incluye la documentación de ese
  polish. No se hizo validación manual del polish en dispositivo real.
- **Gym Profiles V1.1 — editor global 2J, local y no desplegado:** `data/gym-profile.json` es una
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
  de esa verificación fue `7ebb722708a6b27c33aafe60f799b1dada8fbc59`; la producción actual es
  `3c0129a...`. Este sprint no se ha desplegado ni tiene runner
  válido (el runner local previo apunta a `b890a26` y ya no coincide con HEAD).
- Limitación: otros dispositivos actualizan al iniciar, volver al foco o reconectar; no hay
  notificación realtime global. Las categorías expresan disponibilidad general, no una máquina o
  accesorio concreto. Falta QA visual manual de este editor en móvil/tema claro/oscuro.
- Límites V1: compatibilidad por equipo principal, no comprueba accesorios secundarios (banco/barra
  de dominadas) ni todas las máquinas de una categoría; no inventar banco/TRX/esterilla en taxonomía.
  Train2J solo etiqueta; no filtra ni adapta rutinas. No hay editor de bloques por lugar ni perfiles
  compartidos. Cambios simultáneos de preferencias siguen la resolución existente de Sync V2.

**Siguiente paso:** revisión manual del polish y del editor V1.1 en móvil/desktop y en claro/oscuro.
Cuando el sprint esté aprobado, preparar runner nuevo para el HEAD exacto; ni el polish ni el
editor V1.1 están desplegados. `deploy-b890a26.ps1` es un artefacto local obsoleto para este HEAD.
No desplegar sin autorización explícita.

**Pendientes Library V2 no bloqueantes:** revisar visualmente los 18 grupos de posibles
duplicados; clasificar los 28 sin movimiento; precisar plate-loaded/selectorized con evidencia;
posible editor admin de metadata; etiquetas heredadas "(male)" visibles en la biblioteca completa.

**Siguiente trabajo:** Guided Programs V2 está cerrado localmente (§1). Revisar el sprint y,
si se aprueba, preparar runner seguro para el HEAD exacto; NO desplegar todavía. Community V2 + Notifications
está desplegado en `3c0129a...`; no está pendiente de deploy. Otras ideas de roadmap (Health V2,
Library V2, Bunker Live) no se inician hasta priorización explícita.

**Deuda conocida (no autorizada como trabajo):** retención/poda de receipts, tombstones y journal
de Sync V2; Sync V2 es monoproceso; unidades de pesos históricos; traducciones parciales en
idiomas distintos del español (política: fallback a inglés).

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
