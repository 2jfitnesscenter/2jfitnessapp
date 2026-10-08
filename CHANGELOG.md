# Changelog

### Training Quality V1 + Routine Review por programa — candidato, NO desplegado

- Revisión del programa activo agrupada en una sola tarjeta/ciclo; los días incluidos ya no generan tarjetas individuales. Las rutinas independientes mantienen su ciclo anterior.
- Registro aditivo `S.programReviews`: marca de última revisión y próxima fecha a 28 días; cierre elimina el aviso hasta la fecha nueva. Se conservan rutinas, historial, metadata existente y Sync V2.
- El resumen de revisión incorpora adherencia de las semanas transcurridas, tendencia de progresión, señales de plateau/omisiones y el análisis estructural existente. La IA profesional recibe facts acotados y solo genera un borrador para revisión del entrenador.
- QA local sintética encontró y corrigió dos defectos: el panel Training Quality carecía de estilos para patrones/hallazgos/días y una revisión marcada podía volver de inmediato a pendientes por la misma señal de plateau. La revisión no reabre antes de `nextReviewAt` (+28 días); el test comprueba también que vuelve a ser elegible al llegar esa fecha.
- QA visual manual autenticada en claro/oscuro a 1280×720: panel de análisis, Admin Follow Up y Trainer Client Plan; ciclo de programa compacto y separado de la rutina independiente. 1440/768/390 y caso equilibrado/sin hallazgos aún no certificados por limitación de viewport/fixtures.
- Validación final: frontend 1466/1466 secuencial (la ejecución paralela bajo carga tuvo timeouts); API 455/455 sin skips con Git Bash/OpenSSL; build, español 4577/4577 y diff-check OK. PrepareOnly/simulaciones y verificación del marker/runtime remoto pendientes. Sin deploy.

### Web Push diagnóstico para alertas de descanso PWA (2026-10-07) — NO DESPLEGADO

- Se añade alta explícita de suscripciones por cuenta/dispositivo y una cola persistente `db.restAlerts` con recuperación tras reinicio, cancelación, idempotencia, expiración y reintentos acotados. Reutiliza VAPID, `db.subs` y el service worker actual.
- Ajustes → Entrenamiento permite activar notificaciones web y programar una prueba independiente a +5 s. El aviso usa texto genérico y no incluye datos de entrenamiento. El temporizador real todavía no agenda Web Push; el comportamiento Capacitor Android permanece intacto.
- Incluye tests de rutas, pertenencia, privacidad, scheduler/recovery, deduplicación del service worker y limpieza al borrar cuenta. Validación local frontend 1420/1420, API 442 pass + 5 skips operativos (los cinco ejecutados por separado en contenedor compatible), build/locales/diff-check OK. Sin deploy; la prueba física PWA minimizada/pantalla apagada sigue pendiente.

### Shared Staff Device PIN (2026-10-06) — desplegado

- Acceso PIN personal para trainers/admins en dispositivos autorizados por passkey, con sesiones revocables, límites y reautenticación. El propietario confirmó despliegue en `831f691ca1b30a9c252bb60e8336d93edf448114` y QA real correcto.

### Alerta local Android al terminar el descanso (2026-10-07) — NOT DEPLOYED

- Android nativo programa una notificación local privada usando el final del temporizador JS existente; el mismo aviso se sustituye o cancela al ajustar, pausar, reanudar, cancelar o iniciar otro descanso. No duplica el push PWA ni cambia Bunker.
- El permiso POST_NOTIFICATIONS solo se solicita al activar el ajuste; si se deniega, el temporizador continúa y Ajustes explica cómo habilitarlo. `allowWhileIdle` se usa con el permiso de alarma exacta existente cuando Android lo permite y mantiene fallback inexacto.
- Origen `deb9f7d`, integrado en `90085e2` sobre producción `831f691`. Focalizados 25/25, frontend 1417/1417, API 431/431 sin skips, build web y Android OK. Capacitor sync, `testDebugUnitTest` y `assembleDebug` OK. QA física Android y PrepareOnly pendientes; no desplegado.

### Búsqueda tolerante de ejercicios — candidato v1.4.0 (2026-10-06) — NOT DEPLOYED

- Adapta únicamente el fallback de erratas probado en openGym v1.3.9 (`e6c920e`): la búsqueda actual y su ranking prevalecen; si no hay resultados, acepta hasta una edición (incluida inversión adyacente) en un token de nombre/alias de 5+ caracteres y exige que el resto de tokens también coincida con nombre o alias. Sin fuzzy sobre equipo/músculos/movimientos; mantiene Recommended 2J y deprecated-last.
- Frontend 1402/1402; build, español y catálogo OK. Sin cambios de API, IDs, catálogo ni datos. Producción de partida `16a1bb7`; no desplegado.

### Sprint 2 — Cardio inteligente + tests útiles (2026-10-06) — NOT DEPLOYED

- El motor `progression.js` ahora progresa cardio de forma determinista: duración primero (+1 min hasta 30), ritmo después (+0,5 km/h); un fallo mantiene y dos reducen solo la variable incumplida. Guarda el objetivo de cada sesión dentro de la entrada histórica existente, sin editar la rutina.
- Progreso muestra resultado reciente/mejor, comparación y fecha para VAM y cada tipo de ergómetro, meta para repetir el test y recordatorio suave a partir de 8 semanas. Una VAM cercana a seis minutos deriva bandas de ritmo orientativas. 1RM no cambia.
- Frontend 1372/1372; API 422 passed, 5 skipped; build y locales correctos. **No desplegado**; producción de partida confirmada: `bcb3eae`.

### Sprint 3 — Modo Express + reordenación semanal (2026-10-06) — NOT DEPLOYED

- Añade vista previa Express de 15/25/40 min aplicada solo a la sesión: recorta trabajo accesorio primero, protege anclas/restricciones y registra el plan realmente ejecutado sin editar la rutina base. Superseries solo con compatibilidad conservadora; cardio conserva sus objetivos.
- Home puede proponer recolocar la sesión perdida al hueco cercano más temprano que respeta disponibilidad/recuperación; si no cabe, ofrece Express. Derivado de `dayPlan`, programa efectivo e historial, sin segundo planificador ni cambios a Sync V2.
- Tests focalizados Sprint 3: frontend 22/22, API 1/1; suite frontend 1394/1394; API 423 pass, 5 skipped en Windows directo; build/locales OK. Producción de partida: `bcb3eae`.

## Unreleased — v1.4.0 candidate (after v1.3.0, 2026-09-21)

Everything since v1.3.0. Production is `e41f4f9` (2026-10-04: Experience V2 phases 1–4, Sprint 1 WOW, the Progress section order and the Settings add-place form fix; `4c78ecb` carried phases 1–2, `eee3bc2` phases 3–4). The
version number in `package.json` is bumped when the release is tagged. Entries below say whether each item is deployed.

### Readiness, fatigue and proposed deload (2026-10-06) — NOT DEPLOYED

- RPE/RIR now shape the next load: three completed, clearly easy sessions allow one more real step; two completed sessions at RPE ≥ 9 hold the load (always with a reason, never from one session). `S.autoreg = false` turns it off.
- Daily readiness (4 states, real reasons only, works without a wearable) and accumulated fatigue (normal / elevated / high) from effort trends, hard sessions, repeated misses, sleep, recovery and volume.
- High fatigue proposes a 1-week deload (≈ 35 % fewer sets, ≈ 7.5 % lighter, RIR 3) the member can apply or decline; it is a temporary, reversible adjustment applied when sessions are built — routines are never changed. Staff see `fatigue_high` in "Needs attention".

### Seguimiento V4 — routine review loop (2026-10-06) — NOT DEPLOYED

- A routine is reviewed in week 5 of its cycle, or in week 4 when the logged data shows a clear plateau (≥ 3 sessions; never from one bad session). Deterministic rules on loads/reps, missed sets, RPE/RIR and the post-set feeling; the routine is never edited.
- Member: notice on Seguimiento and Home with the reason from their own numbers (cannot close it). Staff: `routine_review` alert in "Needs attention" with "Routine reviewed" (restarts the cycle, clears manual dates), and editable start / review dates in the staff Seguimiento (manual prevails; reset = automatic). Cycle derived from existing data; manual dates are additive fields — no migration.
- `POST /api/admin/user/routine-reviewed` and `POST /api/admin/user/routine-cycle` (trainer or admin; the trainer panel gets the cycle editor via `GET /api/trainer/routine-cycles`); `POST /api/admin/user/role` (admin only: member / trainer / admin, never leaves the system without an enabled admin); `GET /api/admin/user/followup` also returns the member's sync revision. Tests: `lib/routine-review.test.js`, `views/routine-review-ui.test.jsx`, `api/test/routine-review.test.js`.

### Sprint 3 — Hardening, privacy and release readiness (2026-10-04) — NOT DEPLOYED

- Enforced Content-Security-Policy and Permissions-Policy, pinch-zoom viewport, bounded service-worker caches, screen-reader announcement of toasts.
- Private workout notes no longer sent to the AI provider; privacy test across Health/WHOOP/composition/ids.
- Android release signing hook, passkey fingerprint helper, no auto-backup; HealthKit status documented (READY_FOR_DEVICE_VALIDATION).
- Encrypted off-site backup + restore rehearsal + disk guard (needs a destination and passphrase); data map and encryption proposal.
- Sync V2 receipt table bounded without changing semantics.

### Sprint 2 WOW — Progress V3, Mi 2J V2, 2J Story (2026-10-04) — NOT DEPLOYED

- **Progress V3.** Cover with week/month toggle, real-comparison deltas only (previous period must exist), volume zones bars, timeline month headings and streak milestones. Section order unchanged.
- **Mi 2J V2.** Athlete passport, gold records with "before" evolution, achievements grouped Recent / Special / Almost there; empty blocks disappear.
- **2J Story.** Shareable 9:16 week/month card built on the existing image export. Weight/composition only when explicitly included; Health, recovery, WHOOP, restrictions and notes are never read.
- Tests (`views/s2.test.jsx`), i18n keys (es complete, core strings in the 10 delayed packs).

### Experience V2 / 2.0.1 — Visual V2, Health V2, Social V2, Seguimiento V2 (2026-10-02/03)

- **Phase 1 Visual V2 — DEPLOYED (`4c78ecb`).** Design layer (`--v2-*` tokens, glass only on floating surfaces, 150–250 ms motion, reduced-motion), Home hero, premium body map, post-workout summary, record/achievement card, exercise meta hierarchy, bottom-nav capsule, optional activity indicators and progress timeline (new feature keys `activity` and `timeline`; the list is now **15** keys).
- **Phase 2 Health V2 — DEPLOYED (`4c78ecb`).** Health overview, energy source (measured / aggregated / estimated, `≈` only for estimates), indicators without invented percentages, body-map depth per muscle, Health timeline, single Composition entry. Presentation only; Health stays private.
- **Sprint 1 WOW — DEPLOYED (`e41f4f9`).** Training V3 (session progress ring and stepper, next-up, grouped supersets, quick RPE/RIR values, rest ring with what comes next), a bigger post-workout recap with a gold hero only for records/achievements, and a Home that reacts to the moment (session in progress, just finished, fresh record, rest day with the next planned session). Presentation only; every piece follows the admin gates and the Simple/Detailed, image, effort and feedback preferences.
- **Phase 3 Social V2 — DEPLOYED (`eee3bc2`).** The existing Community, Friends, Chat and shared-moments screens in the same visual language (soft cards, skeleton loading, calm empty states, day-separated chat bubbles with a glass composer, moment-kind chips — gold only for records / achievements / streaks). No new features, no backend change, permissions untouched.
- **Phase 4 Seguimiento V2 — DEPLOYED (`eee3bc2`).** The existing follow-up (next review, last review, weight since the last review, one action) as a member card in Health, Progress and (when due) Home, and a restyled staff card. No new data, no scores.
- New strings are complete in Spanish; 39 core strings are translated in the ten delayed packs and the rest fall back to English.

### Profile / Settings tidy-up and Admin → Artificial intelligence (2026-10-02; NOT DEPLOYED)

- Profile: "Training priorities" is one compact row (current choice as subtitle) that opens its own screen (`/profile/priorities`) with exactly the same two pickers and the same storage; back returns to Profile.
- Settings: Account is the first group, then My experience, Training, Progress & metrics, Health, Appearance, Notifications, Social & privacy, Advanced. No control removed.
- Admin → "Artificial intelligence" (`/admin/ai`): the three existing AIs (AI Coach, Trainer panel AI, Auxiliary AI) in one screen — name, purpose, honest state (off / no credential / expired / last job failed with the reason / working) and "Configure", which opens that AI's own existing controls in place (AdminCoach / AdminTrainerAI / AdminAuxAI, not reimplemented). The three remain isolated.
- AI check: the member Coach runs end to end (fixture provider → plan proposal) and the Claude runtime reports exact reasons ("Not logged in", "401 OAuth access token is invalid"); no code defect found — a failing real provider needs its credential reconnected from the new screen. API ai-admin.test.js (7), frontend ux-ai.test.jsx (8).

### Adaptive UX + feature control + personalised onboarding (2026-10-02; NOT DEPLOYED)

- Rule: the ADMIN decides which modules exist; the MEMBER decides which of those to see; the DATA decides how much depth a
  screen shows. Admin off = gone for everyone and never re-enabled from the client; absent / offline / older config = on, so
  nothing changes for existing profiles. Nothing is deleted — hiding keeps the data.
- Admin → "App features" (`/admin/features`): 13 real modules at the time (AI Coach, suggestions, effort RPE/RIR, volume analysis, Train with 2J,
  Health, bioimpedance, recovery, body weight, Social, chat, friends, challenges); two more were added by Experience V2 (activity indicators, progress timeline) — 15 today. Server: `api/lib/features-store.js` +
  `features-routes.js`, persisted in `features.json` (separate from Sync V2); `GET /api/features` for signed-in users,
  `POST /api/admin/features` admin-only (trainers refused), unknown keys / non-booleans refused. Cached on the client for offline.
- Member preferences live in the existing synced state (`S.ux`, no second system). "Personalise my experience": a short visual
  setup (presets Just train / Balanced / Everything, then Training / Health / Experience cards in plain language) for brand-new
  profiles right after the physical-profile wizard, and the same configurator in Settings → My experience for anyone, any
  time. Existing profiles are not forced: one discreet, dismissible invitation on Home. The configurator only offers what the
  admin allows, so there is never a switch that does nothing.
- Home is simple: greeting, news, today's workout, Train with 2J, "Your week", one suggestion. Recovery, the coloured body map,
  body-weight logging, the latest step / closest goal, Whoop and the bioimpedance nudge moved to Progress (Stats), each shown only
  when allowed, chosen and with data (no empty panels; an empty weight log is a one-line invitation, effort without ratings a minimal one).
- Profile leads with photo, name, essentials and training priorities; Mi 2J, Body & health and Social & connections follow as
  quiet groups. Settings is grouped: My experience, Training, Progress & metrics, Health, Appearance, Notifications, Social &
  privacy, Account, Advanced. Training settings hide effort / progression / volume controls that are off.
- Gates: admin + member for effort (`effortOf`), suggestions (cards, post-workout, progression assistant), volume zones, Train with 2J
  (promos and routes), health, bioimpedance, recovery, body weight, Social tab and routes, chat / friends (routes and watchers); the Coach
  also respects the admin switch.
- Tests: API features.test.js (6); frontend features.test.js and adaptive.test.jsx (28). Spanish complete.

### Home news / notices (2026-10-02; NOT DEPLOYED)

- Official notices on Home, written only by admins. Each notice has title, text (**bold**, line breaks and https
  links — rendered as React nodes, never as HTML), an accent colour, an optional image, an active switch, an
  order and optional publish / expiry dates. One notice shows as a compact card; several as a snap-scrolling
  carousel with a discreet indicator; none, no block. The client also honours the dates, keeps a per-user offline copy.
- Admin → News / Notices: list with status (live / scheduled / expired / off), direct switch, move up/down, edit with
  live preview, image upload (the existing private-upload storage, served by `/api/social/media`), delete.
- Backend: `api/lib/news-store.js` + `news-routes.js`, persisted in `news.json` (separate from Sync V2).
  `GET /api/news` for any signed-in member; `GET /api/admin/news` and `POST /api/admin/news/{save,active,reorder,delete}`
  admin-only (trainers refused). No auth, Sync V2, Health, iOS or Android change.
- Tests: API news.test.js (10, real server: roles, active, windows, order, validation, images, persistence), frontend
  news.test.js and NewsBlock.test.jsx (13: hidden when empty, one card, carousel, safe rendering). Spanish complete.

### Sprint 5 — Health Native Bridge, Android + web (2026-10-02; release 1a403fe prepared, NOT DEPLOYED)

- Web bridge (`lib/health-bridge.js`, one contract for Health Connect and HealthKit): separate read and write consent,
  per-user state, privacy by default, no new backend or sync. Read workouts, active calories, useful heart rate,
  steps / daily activity; export of 2J workouts (idempotent by id `2j:<workout id>`, never with measured kcal,
  failures queued and never blocking the workout); own sessions are dropped when read back.
- Energy layer (`lib/energy.js`, `lib/energy-reconcile.js`): one number per workout by priority — measured wearable >
  aggregated Health > labelled 2J estimate; measured vs estimated always distinguished, never summed, active energy
  only. Policy "never duplicate calories": any external active energy in the store's official aggregate blocks a 2J
  estimate (no coverage threshold); with read + write permission and a still-zero aggregate after ~15 min, Android writes
  ONE estimate `2j:<id>:kcal-est` (guard re-checked right before inserting) and deletes only that sample if an external
  source appears later. iOS never writes kcal (HealthKit cannot tell "no data" from "not allowed"). Transitional local
  queue; Sync V2 untouched.
- Android plugin TwoJHealth (Kotlin, Health Connect 1.1.0): availability, read workouts / activity / energy, write
  workouts and the labelled estimate, delete only own samples. Validated on a Galaxy S25 Ultra (export without
  duplicates, estimate written once, blocked when WHOOP energy exists, idempotent, third-party data untouched).
  13 JVM contract tests. Health screen: connect / sync / write toggles, today's steps and active kcal, manual
  permission-recovery guidance.
- Android remote shell: Capacitor loading https://app.2jfitnesscenter.com (config `capacitor.remote.config.json`, standalone
  config untouched), WebAuthn through Credential Manager in the WebView, TwoJHealth available. Production support added
  and validated: `/.well-known/assetlinks.json` (get_login_creds + handle_all_urls, debug certificate), Caddy serving
  the fully-qualified Host `app.2jfitnesscenter.com.` that Google's Digital Asset Links uses, and the API accepting the
  exact `android:apk-key-hash:<hash>` origin next to the web origin (no wildcards; `ANDROID_APK_KEY_HASHES` for the release
  keystore). Verified: passkey login, real session, Sync V2 data. Release keystore hash still to be added.
- Fix: the saved language is loaded before the first render (no flash of the default language).
- iOS HealthKit is NOT part of this release (preserved on branch `wip/ios-healthkit-v2`, needs a Mac / Xcode).
- Tests: frontend 1073/1073, API 355/355, Android 13 JVM tests, builds, Spanish complete.

### Deployed since v1.3.0 (previously listed as Unreleased)

- Production `b4e7baa` (2026-10-01): Sprint 4.5, Studio visibility switch, inactivity auto-finish, starting-load fixes,
  Inteligencia 2J V2, Gym Profiles and the earlier items below. Production `4622505`: `b4e7baa` + Digital Asset Links,
  the Caddy FQDN host and the Android WebAuthn origin.

### Sprint 4.5 — Entrena con 2J Admin, content expansion and Library Quality (2026-10-01; deployed, production b4e7baa)

- Admin Studio (lazy, admin-only) for the official catalogue: routines, programs and collections with
  draft / active / hidden states, preview as a member, publish, hide, feature, reorder, duplicate as a
  draft; program editor (weeks, days, live server dry-run); collection editor with routines and programs;
  routine editor gains state, purpose, cover and notes. Roles enforced in the backend; started or
  assigned content is a snapshot and never changes. Separate persistence in `guided.json`; catalogue
  cache refreshes on `guidedRev`; a first-use guide of three steps can be reopened.
- Library Quality tool and overlay (names EN/ES, aliases, canonical movement, equipment, Recommended 2J,
  preferred/deprecated with no chains or cycles, curator notes) persisted in `library-admin.json`,
  applied from `/api/config` with an offline copy; the AI and validators read the effective library.
- Library pass: deprecated duplicates 14 → 26, canonical movement 1296 → 1305, Recommended 2J 186 → 210,
  names/aliases/equipment reviewed; ids never removed.
- Content: blocks 158 → 198, routines 69 → 155, collections 8 → 15, programs 13 → 22 — warm-ups,
  cool-downs, stretching, recovery, machine HIIT/Tabata/intervals (SkiErg added), bodyweight HIIT, home
  circuits, strength splits, strength + cardio sessions from 5 to 60 min; routines carry a `purpose`.
  Gym Profile compatibility shows Compatible / Partially compatible / Needs other equipment.
- Predeploy QA fixes: titles match real durations, "no equipment" circuits use bodyweight only, collection "Home and hotel", program gear labels, Studio input contrast. Existing production content unchanged.
- Tests: API 346, frontend 1005; build, Spanish 3969/3969 and sync checks pass. Not deployed.


### Pre-deploy safety — inactivity finish / first working load (2026-10-01)

- Auto-finish after 60 min of real inactivity, using the existing idempotent finish transaction.
  Activity metadata persists on active; sets/cardio/swaps/exercise navigation update it, passive
  polling does not. Server checks persisted Bunker sessions; phone handles its local active on
  reopen/reconnect. Acknowledged cross-device activity and revision guards prevent stale closure.
  Shared activity model mirrored by generator. Effective end excludes idle tail when known;
  finishedAt records the actual closure and history shows its inactivity reason. Offline/conflicting
  drafts are retained; a newer offline draft gets 409 even if the server already expired the
  last acknowledged snapshot, while identical retries succeed. Unseen offline edits cannot inform the server deadline. No Sync V2 changes.
- Starting loads now derive from the first completed work set rather than the session maximum.
  Positional history wins over tracked PR weights. RPE/RIR/Series Feedback gate increases; missing
  effort evidence repeats the load, double progression needs two supported exposures. Existing
  equipment rules preserve ramp/backoff positions; straight and explicit %1RM prescriptions remain.
  PR/topW semantics and NEXT SET feedback unchanged; Intelligence uses the corrected base.
- Added 12 frontend activity tests, 11 API inactivity tests and 14 starting-load regressions,
  including A–L, ramp/backoff application and Intelligence. Full frontend 983/983, API 323/323;
  build, Spanish 3623/3623, models/protocol/seeds/catalog and diff checks pass. Not deployed.


### Inteligencia 2J V2 — local completion, not deployed

- Adds bounded, read-only training context and explainable signals for program/plan continuation,
  progression, repeated high effort, plateau, missed sessions, return after a gap, PRs, equipment
  conflicts and compatible official content. It reuses existing workout history, program receipts,
  Gym Profiles, equipment increments, swap ranking and member restrictions. No silent mutation,
  parallel sync/history, provider request or Health/Community data transmission.
- Adds a compact “For you today” surface with user-scoped onboarding, reason/source disclosure,
  explicit navigation actions and dismiss controls, plus contextual cards in Workout, program detail,
  Mi 2J and the post-workout summary. Spanish strings are complete. A container-width layout fix
  keeps single cards legible in narrower app shells.
- Adds an optional, user-requested Coach explanation for a deterministic card. The server enforces
  existing Coach consent, single-flight and daily caps; sends only an allowlisted signal type and
  bounded numeric facts through the existing adapter/retry/logging path. A short validated sentence
  may supplement the card but cannot replace its reason, priority or action. Invalid/unavailable AI
  falls back immediately to the deterministic card. No Health, Community, notes or raw workouts go
  to the provider; Claude's `ai-run.js` stability fix is unchanged.
- Adds a compact admin-only member insight panel using the admin history already permitted by
  `/api/admin/user`. It shows at most three automatic signals with reason, source and a link to
  history; trainers without admin access do not gain workout-history rights. WHOOP recovery remains
  outside Intelligence: the current integration has no recent baseline or scoped permission for
  that inference, so no low-recovery/fatigue signal is invented.
- Synthetic visual QA at 390/768/1280 px in light/dark covered empty, one/three cards, progression,
  repeated high effort, plateau, equipment conflict, program next/missed, return, PR, official
  content, onboarding and admin view; reason expansion and wrapping checked, no horizontal overflow.
  Improved card text contrast and admin CTA. No real-device or live-provider acceptance yet.
  Frontend **948/948**, API **304/304**, build OK (historic chunk warning), Spanish **3607/3607**,
  `git diff --check` OK. Production stays at `3c0129a`.

### Guided Programs V2 — partial local work, not deployed (`1bbf316`)

- Adds four multi-week catalog plans over the existing official guided routines, with lazy catalog/detail routes, first-use help, Gym Profile session-fit indicators, pause/resume/end and workout-history-derived progress. Sessions still run through the existing Workout V2 flow; no Sync V2 core or second workout engine was added.
- Trainers can assign a versioned program/routine snapshot through the existing member-program endpoint; the member chooses when to start. The Coach receives goal/level-filtered program references with Gym Profile equipment-fit counts and a minimal active-program progress summary under the existing plan consent.
- Validates catalog references and every program week with the existing 2J program validator. Frontend **916/916**, API **279/279**, build OK, official routine seed check OK (39 routines/7 collections), Spanish **3392/3392**, `git diff --check` OK.
- Not a completed sprint: no official strength/hypertrophy program content, no broad guided content expansion, no Exercise Library quality decisions, no admin program curation, and required visual QA was not completed. Library unchanged: 1324 exercises, 39 routines, 155 blocks, 43 masters, 7 collections, 3 featured. No external source was used. Do not deploy.

### Community V2 + Notifications + Sharing — deployed (`3c0129a`)

- Adds explicit sharing from completed workouts, PRs, unlocked badges, streaks, routines, programs
  and challenges to Community, direct chat or an exported 2J image. A chat share is a small
  reference, hydrated only while the target and current privacy/relationship rules permit it.
- Adds the Community Moments feed, user reports, admin-only report review/removal, deduplicated
  share/challenge notifications and opt-in social Web Push. No workout is published automatically;
  no Health or body-composition data enters social profiles or share snapshots.
- Fixes the real-API push helper wiring and revalidates privacy for direct-share detail reads. An
  isolated HTTP integration covers member A/B, admin, trainer without admin, sharing, unread,
  dedupe, block/unblock, privacy revocation, reports, challenge alerts, and safe deleted-target
  fallback. Frontend 910/910, API 274/274, build OK, Spanish 3342/3342, `git diff --check` OK.
- The full visual QA matrix is still outstanding; only Community Home/onboarding at 720×768 in dark
  mode was visually inspected in an isolated local setup. Do not mark the sprint accepted or deploy until the
  requested 390/tablet/desktop, light/dark, conversation/share/report/admin/empty/offline/fallback
  states are reviewed. Production is confirmed by the user at `3c0129ad39970e8a87e8663c2402405df6199139`.

### Gym Profiles UI polish — local, not deployed (`70080f1`)

- Replaces the native place selector with a compact Settings row and a visual, mobile-first picker:
  five profile cards, explicit active state, equipment chips and contextual help.
- No model, persistence, API or Sync V2 changes. Frontend 895/895; build and Spanish locale checks OK.
- This UI polish has not been deployed.

### Gym Profiles V1.1 — admin equipment editor — local, not deployed

- Admins can edit the official 2J equipment categories in a grouped visual editor; members and
  non-admin trainers can read/use the inventory but cannot write it. The API enforces this role.
- One gym-wide `data/gym-profile.json` value feeds the existing Gym Profiles equipment context,
  including library compatibility, swaps, Constructor/Workout, Train2J and Coach payloads. It is
  not copied into member Sync V2 state; clients keep only a separate last-known offline cache.
- Uses the existing taxonomy (18 categories; no taxonomy ids added). Existing routines and workout
  history are not rewritten. The release checkpoint at that time was `7ebb722`; production was
  later confirmed at `3c0129ad39970e8a87e8663c2402405df6199139`. This sprint has not been deployed.

## Previous production checkpoint 7ebb722 — Gym Profiles V1 — confirmed 2026-09-27

- Equipment-category context for 2J, Home, Hotel and personal gym profiles, shared with existing
  library compatibility, deterministic swaps, Constructor/Workout warnings, Train2J and AI context.
- Uses existing offline state and Sync V2. No workout/history migration; Bunker retains the 2J
  equipment context. Categories do not guarantee a specific machine or secondary accessories.
- Functional commit `d50fa9e`; release/deployment checkpoint `7ebb722708a6b27c33aafe60f799b1dada8fbc59`.

## Production 133a52c — confirmed 2026-09-26

### Series Feedback V1 — "¿Cómo fue?" after each set

- After a finished working set (reps mode), the workout asks *Muy fácil / Bien / Difícil / No pude*
  in both views. Optional and ignorable.
- A deterministic, conservative suggestion for the NEXT set only ("80 kg → 85 kg sugeridos",
  [Aceptar] [Mantener 80 kg]). Very easy with every rep done means one real step up, unless a
  logged RPE ≥ 9 or RIR ≤ 1 says otherwise. Good means keep. Hard means keep, and one step down
  only below the rep range. Couldn't means about 10 % lighter, at least one step (a practical 2J
  V1 heuristic, not a universal scientific rule).
- Loads come from `lib/equipment.js` (2J dumbbell rack, machine stack, custom increments). Never
  automatic. It never touches the routine, the target, the program or future workouts.
- The optional `set.feel` field lives in `S.active` (offline, same sync) and is kept in history
  on finish. No migration; RPE/RIR are not replaced or mapped. `lib/set-feedback.js`.
- Bunker: postponed.

### Exercise Library V2 — canonical movements, variants, equipment and discovery

Deployed and retained in 133a52c. No exercise id changed, nothing was deleted and no history, PR or routine was
migrated. Protocol version stays 1.0 (no methodology change). Details in
[docs/EXERCISE_LIBRARY_V2.md](docs/EXERCISE_LIBRARY_V2.md); numbers in the generated
[docs/EXERCISE_LIBRARY_AUDIT.md](docs/EXERCISE_LIBRARY_AUDIT.md).

- 🧭 **Canonical movements and equipment.** Every exercise gets a movement (35, derived from the
  patterns 2J really uses — squat, hinge, hip thrust, row…) and a normalised equipment (28 ids in
  six kinds). Stretches no longer count as training volume; wrist curls are no longer biceps curls.
- ⭐ **2J exercises vs the full library.** Plan › Exercises opens the 179 Recommended 2J exercises
  grouped by movement family; the full 1324-exercise library is one tap away.
- 🔎 **Search in plain words**, Spanish or English: name, alias, movement, muscle, equipment
  ("remo máquina", "glúteo barra", "bisagra", "treadmill").
- 🔁 **Smarter swaps.** Replacing an exercise shows similar variants of the same movement first,
  with the reason ("Same pattern · Same equipment"), in the workout, routines, the Constructor and
  the Bunker.
- ❤️ **Favourite exercises**, and recents from your own workouts.
- 🧹 **Duplicates handled safely.** 11 exercises that were the same one filmed twice point to a
  preferred version: hidden from normal search, still working in your history. 7 pairs that shared
  a name but are different exercises now have distinct names; 4 broken names fixed.
- 📥 **Imports** understand Spanish names and aliases, keep historical names, and ask when a name
  is ambiguous.
- 🤖 **AI and validator.** The Coach is offered Recommended 2J first and never a duplicate; the
  validator notes two exercises of the same movement on the same equipment (a note, not a failure).
- 🛠️ **Admin** can review the library metadata (recommended, duplicates, without a movement,
  corrected by 2J). New checks: `scripts/check-exercise-library.mjs`,
  `scripts/audit-exercise-library.mjs`.

### Credits, copyright and attribution

No app behaviour changes. The original project's attribution, removed in an earlier rebrand,
is restored, and the fork's own work is credited separately.

- 📜 **NOTICE.md** now names the original project — openGym, Copyright (C) 2026 Duarte Santos —
  and, separately, the modifications and additional development by 2J Fitness Center
  (Copyright (C) 2026), with a short list of the areas developed here. The license stays
  **AGPL-3.0-or-later**; LICENSE is the unmodified AGPL text.
- 👥 **AUTHORS.md**, **THIRD_PARTY_NOTICES.md** (exercise dataset, MuscleMap, AI runtimes,
  libraries, fonts — moved verbatim from NOTICE.md and completed) and **TRADEMARKS.md** (the
  2J name and logo are not licensed as marks; the code stays under the AGPL).
- 🏷️ Source files created in this fork carry a two-line `Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center`
  / `SPDX-License-Identifier: AGPL-3.0-or-later` header. Files inherited from openGym were
  left as they were.
- ℹ️ **Settings → Legal & credits**: the app, its fork credits, "based on openGym" with the
  original author, the license, the source code and third parties.
- 📝 README gains a short "2J Fitness Center fork" section; docs/MOBILE.md no longer claims an
  app-store exception this fork does not carry.
- ✍️ The fork's copyright holder is named in full: **Juan Jose Perez Sanchez — 2J Fitness Center** (NOTICE, AUTHORS, TRADEMARKS,
  README, the Legal screen and the source headers). Links to the AI strategy slide deck, no
  longer in the repository, were removed from the README and the docs.

### Guided Routines V1 — "Entrena con 2J", the official guided workout library

Not deployed yet. No protocol revision (still v1.0) and no new evidence: docs/EVIDENCE.md is
unchanged. [docs/TRAINING_PROTOCOL_2J.md](docs/TRAINING_PROTOCOL_2J.md) documents how the official
routines are composed (a product decision, heuristic).

- 🎬 **Entrena con 2J.** A new place with 39 complete guided workouts made by 2J: Tabata, HIIT,
  circuits, cardio intervals, mobility, core and strength + cardio, from 5 to 45 minutes.
  - A featured workout up front, then rows for you, your recent ones, collections, favourites and
    no-equipment sessions.
  - Search in plain words ("tabata", "20 min", "sin saltos", "movilidad cadera"), quick chips and
    a Filters sheet by type, duration, level and equipment.
  - Every workout has its own cover, drawn from what it is — no stock photos.
- 📄 **A page per workout.** Duration, level, goal and equipment, "Before you start", and the
  parts in order (warm-up, main work, cool-down) with their timing.
  - It warns when the workout conflicts with a restriction on your plan, or needs equipment the
    gym has marked unavailable.
- ▶️ **Start it in one tap.** It runs in the normal workout with the guided timer. Your program,
  week and routines are not touched, and the finished workout goes into your history saying which
  2J workout it was.
- 💡 **For you.** A short row that only uses what you or your trainer declared (level, goal,
  restrictions) and your own workouts, with the reason shown on each card. Never health data or
  check-ins.
- ❤️ **Favourites** on this device, and "Completed · N times" from your real history.
- 📴 **Offline.** The last catalogue you opened is kept on the device and can still be started.
- 🧑‍🏫 **Trainers** can assign a copy to a member (checked against the member's restrictions) or
  duplicate it into their own routine and edit it in the builder.
- 🗂️ **Admins** curate the catalogue: featured order, badge, active/inactive, content edits and
  collections.
- 🤖 **The AI Coach** receives compatible official routines and prefers 2J's curated sessions.
- 📚 **37 new official master blocks** for these workouts (the block library now has 155 master
  blocks: the previous 118 plus 37). Workouts copy blocks; they never add blocks of their own.
- 🐞 **Fix:** "run (equipment)" and "walking on incline treadmill" are now listed with their real
  equipment, the treadmill — in the builder, in Entrena con 2J and in the equipment filters. Same
  exercises, same history.

### Constructor V2.1 — guided blocks, list view, 2J suggestions and Bunker rest

Not deployed yet. **Protocol revision** (still v1.0, it only widens what was allowed): the new
heuristic **2J-HEU-INTERVAL-ROUNDS** — see [docs/TRAINING_PROTOCOL_2J.md](docs/TRAINING_PROTOCOL_2J.md).
No new evidence; docs/EVIDENCE.md is unchanged.

- ⏱️ **Guided blocks.** Circuits, intervals, HIIT, Tabata and mobility now run with a timer
  inside the normal workout: get ready → work → rest → next → next round → done.
  - Big countdown ring, current exercise with its image, round and progress, what comes next,
    pause, ±10 s, skip, finish block. Sound and vibration switches reuse your workout settings.
  - Survives a refresh, a locked screen or a lost connection: the clock resumes from its end time,
    and bouts that ended in the background are completed in order and flagged in the summary.
  - Logged sets are the normal ones — nothing to learn, and you can still log by hand.
  - The finished workout keeps a short summary per block: type, pace, rounds, bouts done, time,
    and any adjustments or skips. No second-by-second data.
- 🧭 **Guided timing in the builder.** Any block or group of exercises can be run as a circuit,
  HIIT, Tabata (20/10 × 8 to start, every number editable), intervals or mobility, with
  countdown, work, rest, rounds and rest between rounds.
- 📚 **Six official guided blocks** (the library now has 118): a beginner machine circuit, a core
  circuit mixing reps and holds, elliptical intervals, a bike Tabata and two mobility flows.
- 🔲 **Library grid or list.** The block library can switch to a compact list with name, goal,
  level, variant, exercises, duration, equipment and source. Your choice is remembered on this
  device.
- 💡 **2J suggestions.** When a program has a goal and a level, the builder can point out areas
  with little or no direct work (only direct sets are counted) and show compatible blocks. It
  never changes the program on its own and can be hidden.
- 🏋️ **Barbell hip thrust.** It was already in the exercise library under an odd name; it is now
  "hip thrust con barra", recognised by imports, and used by two official glute blocks. Your
  glute bridge history is untouched.
- ⏲️ **Bunker uses the prescribed rest.** The rest after a set is the trainer's rest for that
  exercise (90 s when there is none), and the ring runs against the real length.
- 🏠 **Home is lighter.** Body composition no longer repeats on Home; it lives in Profile →
  Health / Measurements.
- 🐞 **Fix:** opening a program in the builder no longer marks every day as unsaved.

### Constructor V2 and the 2J Training Protocol v1.0

Deployed on 25 Sep 2026 (`d0920b8`). **Methodology change:** from now on, 2J prescribes training under the
**2J Training Protocol v1.0** ([docs/TRAINING_PROTOCOL_2J.md](docs/TRAINING_PROTOCOL_2J.md)).
Its evidence is in [docs/EVIDENCE.md](docs/EVIDENCE.md), with the ACSM 2026 resistance-training
position stand as the backbone.

- 🧱 **Constructor V2 for trainers.** Build a program as Program → Day → Blocks → Exercises.
  - Add a whole block in one tap, then edit every exercise inside the day: replace, remove,
    reorder by dragging, change sets, reps, RPE and rest, make supersets, add notes.
  - The block is copied into the day, so the library never changes and old routines keep
    working untouched.
- 📚 **Official 2J block library.** 112 validated blocks for glutes, quads, hamstrings, chest,
  back, shoulders, arms, calves, core, push, pull, lower body, posterior chain and full body.
  - Goals: hypertrophy, strength, general health, muscular endurance and start/return.
  - The high-use families get real A/B/C variants per level (stable, mixed, unilateral…).
  - Trainers can duplicate a block, save their own, and mark favorites.
- ✅ **Deterministic 2J validator.** Every block, routine and AI plan is checked against the
  protocol and gets one of three results: fits, fits with a stated reason, or does not fit.
  - It checks rep zones by exercise type (hypertrophy is no longer "8–12"), the 2J effort
  scale 4/6/8/10, rest, weekly volume, near-duplicate exercises, supersets, exercise order,
  equipment and declared restrictions.
  - Rule ids 2J-RULE-*, evidence ids 2J-EVD-*.
  - A restriction declared for a member can never be skipped from the builder: remove the
    exercise, or withdraw the restriction first.
  - Any other result that does not fit can only be saved with a conscious override and a written
    reason, which is stored with the plan. The server enforces both.
  - Judgements based only on an exercise's name are shown as "could not be verified", never as a
    failure. The official library uses only curated exercises.
- 🤖 **AI follows the protocol.** The member Coach and the trainer AI receive the relevant rules
  and reuse official blocks before inventing. A plan that fails the protocol is never shown or
  saved.
- ⏱️ **Prescribed rest and planned effort in the workout.** A trainer's rest per exercise drives
  the rest timer, and the planned 2J RPE ("RPE 8·8·10") shows next to the target.
- 🐞 **Fix:** opening the trainer panel from inside the app no longer blanks the screen.

### Health V2, check-in, follow-up and Fitness V1

Deployed on 25 Sep 2026 (`81e60e2`).

- 📈 **Your physical evolution.** Real readings only, each with its source (manual, scan, gym
  staff, Apple Health), ranges from 1 month to all time, and comparisons between two days that
  show numbers without calling them better or worse. BMI is a secondary line.
- 🧍 **Segmental body.** Tap an arm, the trunk or a leg to zoom in on its muscle and fat
  readings. With no reading it stays neutral.
- 🙂 **Check-in before training.** Energy, sleep, fatigue and discomfort in a few taps. You can
  set it to every workout, now and then, or never, and skip it in one tap. It only adds
  advice in words: it never changes your load, sets or routine.
- ❤️ **Fitness V1.** Calories, average/max heart rate and zones on a workout, only from real
  sources: the Apple Health export (including Apple Watch and Zepp), WHOOP (read-only), or a
  Bluetooth heart-rate strap (experimental; Android and computers). Activities are linked only
  when the times clearly match; you can choose, skip or unlink them, and sources are never added
  together.
- 🗂️ **Gym follow-up.** Staff can pick an assessment template (Basic / Intermediate / Pro /
  custom) and a review schedule, and get a summary and alerts built from the data. Check-ins
  are shared only if the member turns it on.
- 🔒 **Privacy.** Health data never reaches the wall, friends, rankings, share cards or the
  Bunker screen.

### Workout V2 and offline training

Training got faster, clearer and works without a connection. Deployed on 24 Sep 2026
(`4fb9369`).

- 🏋️ **Two views of the same workout.** Simple puts one exercise and one set in front of you;
  Detailed shows every set with your previous numbers. Switch at any moment — nothing you
  logged changes.
- 🔢 **The 2J keypad.** Tap weight, reps or RPE and a big keypad opens with the real jumps of
  the gym's dumbbells, plates and machines. Optional auto-complete never ticks a set with data
  missing.
- 🟢 **Plates where you need them.** Barbell sets show what goes on each side and open the
  calculator on the set's weight and bar.
- 📈 **A progression assistant that explains itself.** Before an exercise it may suggest
  keeping the load, adding a rep, adding weight or stepping down — with the reason and its
  confidence. Using it changes only today's sets; your trainer's routine never changes. Every
  prescribed load is one your equipment can actually make.
- ⏱️ **Rest, your way.** Pause/resume, and choose the end alert, sound and vibration.
- 📝 **Notes vs. tips.** Your trainer's note and the exercise's generic tips are shown apart.
- 🧭 **A visual guide** before a new member's first workout, replayable from Settings → Training.
- 📴 **Offline training.** Train, close and reopen the app, finish without internet; the workout
  syncs exactly once when you are back online, with a discreet indicator of the state.

### The AI Coach

2J Fitness Center could always progress a plan. It could never *write* one, and it never looked at the
plan itself — the engine adjusted your weights inside whatever structure you had built, and the
effort ratings you logged were, by the app's own admission, read by nothing.

The Coach is an optional AI that does both jobs the engine deliberately doesn't: it designs
plans, and it changes them when your training says they should change. It runs as a CLI on your
own server, under your own provider account, and it is off until an admin turns it on.

- 🤖 **It builds you a plan.** A six-screen intake — goal, experience, days, session length,
  equipment, limitations, likes and dislikes — produces a complete weekly plan: routines,
  exercise selection, sets × reps, supersets, the week schedule, and a progression policy per
  routine with per-exercise overrides. Every exercise carries a sentence on why it is there.
  Don't like it? Say so in your own words ("swap the squats for split squats, Mondays are
  short") and the whole plan comes back revised.
- 🔍 **It reads what actually happened.** On demand, or weekly, or after every N sessions: sets
  hit and missed against their targets, effort trends, the stalls and deloads the engine fired,
  sessions you keep moving to another day, session length against the time you said you had,
  body weight against your goal, and muscle groups that got nothing. **Your RIR and RPE ratings
  finally have a reader.**
- ✅ **Changes you approve one at a time.** A review comes back as a list of discrete changes,
  each with a before → after and a rationale naming the evidence — "bench came in at RPE ≥ 9.5
  for three sessions and stalled twice; swapping to dumbbell press for four weeks". Tick the
  ones you want. Advice with no plan change attached goes in a separate notes section and
  applies nothing.
- ↩️ **Nothing is one-way.** Accepting snapshots your plan first, so one tap puts it back.
  Reverting a plan never touches a logged workout — the log is what happened.
- 🚦 **It knows when to say nothing.** A review that finds no reason to change anything says so
  and sends no notification. Suggestions you turn down are remembered, so the next review
  doesn't re-propose them without new evidence.
- 🔒 **The engine still owns your weights.** The Coach sets the plan and the policies; the
  deterministic progression engine still computes every session's target and still tells you
  why. Plans are where judgement lives, targets are where the math lives, and the math stays
  auditable and offline.
- 🧾 **A visible paper trail.** Every job, decision and applied change lands in a per-profile
  Coach log that syncs with your data and travels in your JSON backup.
- ⭐ **How did that feel?** An optional one-tap rating on the finish summary — too easy / about
  right / brutal, plus a note. The Coach reads both.

**For whoever runs the instance.** Both provider runtimes — Claude's Agent SDK and a pinned
OpenAI Codex CLI — ship inside the api image, so there is nothing to install and neither path
needs an API key. Enable the Coach, sign in (a `claude setup-token` you paste, or Codex's
ChatGPT device-code flow) and set spending caps entirely from the admin dashboard — no `.env`
editing, no restart. The card shows runtime version, sign-in state, jobs run today and the last
failure; it never shows anybody's intake answers, payloads or proposals. A **Fixture** provider
walks the entire loop with no AI account at all.

**For everyone else.** An instance with the Coach switched off is the app it was before, to the
byte: no new UI, no new requests, no change to the state you sync. Turning it on adds one
dismissible card until a profile consents, and consent is per profile — the admin enabling the
feature does not enable it for you. The consent screen lists exactly which categories of data
leave the server, names the provider, and says whose account pays. The mobile build has no
server and hides it; the demo runs it against a canned local provider so you can try the loop.

Under the hood: the provider runtime runs as an unprivileged user that cannot read `./data`,
with a scrubbed environment and no tools; every answer is validated against a closed list of
change types and the real exercise library before anyone sees it, with one repair round and
then a clean failure. A pasted Claude setup token is encrypted at rest with a key derived from
the instance secret; Codex's ChatGPT credential stays in Codex's own private cache, mounted
separately from app data and never copied into `coach.json`.

Documented in **[docs/AI_COACH.md](docs/AI_COACH.md)**, with setup walkthroughs for
[Claude](Claude-setup-instructions.md) and [ChatGPT/Codex](ChatGPT-setup-instructions.md) and
the design rationale in [ai-enablement/implementation-plan.md](ai-enablement/implementation-plan.md)
(the slide deck that also described it is no longer in the repository).

### The effort ratings, read back as statistics

v1.2.3 let you rate how hard a set was. Nothing then read that rating back — it lived in the set
label and nowhere else. Stats now answers the question the number was recorded for.

- 📊 **An Effort card in Stats** over 30d / 90d / 1Y / all time: average effort, the share of sets
  taken close to failure, and — always alongside them — how much of your training was rated at
  all. Rating is optional and off by default, so a partly rated history is normal; an average
  without its denominator would quietly speak for sets you never rated.
- **Week by week.** The weekly average with that week's set count in the tooltip, because the
  pair is the reading: volume up with effort up is fatigue accumulating, volume up with effort
  flat is the adaptation you were training for. Weeks resting on a single rated set are dropped
  rather than drawn.
- **Where the sets land.** The spread across the scale, not just the middle of it. Half your sets
  at failure and half in warm-up territory average out to a healthy-looking number; this is the
  chart that shows it.
- 🔥 **Hard-sets mode on the muscle map.** The same body diagram, counting only sets taken near
  failure — "where did the stimulus go" rather than "where did the volume go". A muscle can lead
  on set count and still never be trained hard.
- **Effort on the exercise curve.** Each session's dot on the top-set chart fills in as less is
  left in the tank, so the same weight moved with more in reserve stops reading as a flat line.
  Exercises with enough ratings also get an Effort curve of their own.
- **One history, whichever scale you use.** Everything aggregates internally in RIR and converts
  back for display, so a history that mixes your own RIR logs with imported RPE averages as one
  series instead of two half-empty ones. RIR charts count downward on the axis, so harder sets
  sit higher.
- Translated into all 12 UI languages.

### Weekly Volume Zones, and Training Zones for a single set

Two questions the app could never answer on its own: *is this muscle group getting enough work
across the whole week*, and *what percentage of a max should this set actually load*. Both are
now answered from evidence-based landmarks instead of a guess.

- 📊 **Weekly Volume Zones (MV/MEV/MAV/MRV).** Every exercise in the library carries a resolved
  muscle group (12 groups); each logged week is tallied into hard sets per group and read
  against that group's Maintenance / Minimum Effective / Maximum Adaptive / Maximum Recoverable
  landmarks for your training level (beginner/intermediate/advanced). A group under MEV is
  under-recovered for growth, one past MRV is past what you can likely recover from — shown as a
  calibrated bar per muscle group, not a single number.
- 🎚️ **Calibrate it to you.** Level defaults are a starting point, not a verdict — any landmark
  can be overridden per muscle group from Settings, and the app remembers which ones you've
  touched.
- 🎯 **Training Zones (Z1–Z5).** A per-set %1RM / RIR intensity classification (strength, hypertrophy,
  endurance, …) so a working set reads as "what kind of stimulus is this", not just a weight and
  a rep count.
- Both are opt-in and off by default — a profile that never turns them on sees nothing new.

### The Bunker: a gym-floor kiosk, and the panel that runs it

A shared screen mounted on the gym floor for members who'd rather not pull out a phone mid-set,
plus the admin side that makes it safe to leave running unattended.

- 🖥️ **Check in with a 4-digit PIN — `/bunker`.** No phone needed: punch in, land on a
  touch-optimized training panel with a rest timer that stays in sync, and show up on a live,
  collective room dashboard everyone checked in can see. The PIN mints a short-lived, narrowly
  scoped bearer token — never a member's real session — so a kiosk left logged in never exposes
  a full account.
- 🔐 **Room admin, from the kiosk or from `/admin/bunker`.** A trainer's own fixed code unlocks
  room controls in place: force-close a session without losing what was logged, pause or resume
  someone's rest timer, or step in and adjust a live set (Assist/Adjust) — all without breaking
  that member's own Weekly Volume Zone preferences, which stay strictly per-athlete and never
  leak between whoever's checked in.
- ⚙️ **Room settings.** Grid columns (including auto), a rest-end beep with a pulsing highlight,
  an option to hide weights from the public dashboard view, and an auto-lock timer
  (15/30/45/60s) so an idle kiosk screen doesn't sit open.
- 🚪 **A discreet exit.** Triple-tap the kiosk's own logo, enter the admin code, and it's the only
  way back out of kiosk mode — nothing a member can trigger by accident.
- 📋 **Your real routine, not a placeholder.** The kiosk resolves today's actual assigned routine
  or program day — the same resolver Home and the phone logger already use — and builds the
  session with the same progression, superset and set-building logic as a normal workout,
  instead of a second, poorer approximation.
- ✅ **Finishing at the kiosk now matches finishing on the phone.** PRs, estimated-1RM records and
  tracked working weights (`exWeights`) are computed server-side from the exact same logic the
  phone uses, so a workout logged at the Bunker reads identically in your history to one logged
  on your own screen.
- 📲 **Transfer an in-progress phone workout to the Bunker.** Started a session on your phone,
  then walked over to the gym floor? "Transferir al Bunker" hands off that exact same session —
  same sets, same progress — for you to check in and continue. A genuinely different session
  already running for you at the kiosk gets an explicit conflict prompt, never a silent
  overwrite.
- 🔀 **Change exercise mid-session, right from the kiosk** — searches the real gym catalogue and
  keeps every set already logged, including ones marked done, attributed to the new exercise,
  exactly like swapping an exercise on your phone.
- 🧰 **A fixed toolbar anyone training can use, checked in or not** — Entrenamiento, Biblioteca,
  Discos, RM, Temporizador, Calentamiento, always on screen. Nothing outside "Entrenamiento"
  reads or remembers who's using it: the plate calculator and 1RM estimator are the exact ones
  the rest of the app already has, the library is the real gym-wide catalogue, and the timer is
  its own — separate from anyone's personal rest timer — and keeps running while you browse
  another tab.
- ❓ **No routine scheduled for today?** The kiosk now asks what you want to train instead of
  dead-ending on "no routine assigned": any routine already in your profile, or a freestyle
  session where you add exercises as you go and log sets normally. The choice only shapes
  today's session — your actual weekly schedule is never touched.
- QR check-in (a phone-to-kiosk handoff) is deliberately deferred — noted as a follow-up, not a
  cut corner.

### PWA install, bioimpedance reminders, a real Tanita export, and smarter machine scans

- 📲 **A real "Add to home screen" prompt**, instead of relying on the browser's own — hidden
  automatically once installed or on the native build.
- ⏰ **Bioimpedance reminder.** A configurable 15/30-day nudge to log a new body-composition scan,
  shown on Home and fired as a native notification, computed from your own last scan rather than
  a separately tracked date that can drift out of sync.
- 🧾 **Tanita export, done properly.** Measurements reorganized into General / By-limb / Skinfolds
  tabs with a shared %/kg toggle, plus a branded PDF/Excel export in a dark or a light/printable
  theme — built for handing to a trainer or keeping for your own records.
- 🔁 **Machine scans stop duplicating your library.** Scanning a gym machine's photo now matches
  it against the real exercise library first; only a genuine miss creates a custom exercise. One
  member confirming a match teaches a gym-wide machine→exercise alias table, so the next person
  who scans that same machine gets it right immediately.

### The AI Coach reads your zones too

Both the member-facing Coach and the trainer's "Generate with AI" panel now see Weekly Volume
Zones and Training Zones when a profile has them turned on — previously neither did, so an
AI-built or AI-reviewed plan could quietly ignore landmarks the rest of the app was already
enforcing.

- When Weekly Volume Zones are on, the Coach tallies the **plan's** weekly sets per muscle group
  against your real MV/MEV/MAV/MRV landmarks (including any calibration you've done) — pushing a
  group under MEV gets a set added, one already at MRV gets volume cut rather than piled onto
  further, even if it's been trained consistently at that level.
- Training Zones travel the same way, so a proposed or reviewed set reads against the same Z1–Z5
  intensity classification you see everywhere else in the app.
- Off unless you've turned the zone on yourself — a profile with either feature disabled sends
  the Coach exactly what it always sent.

### Social, reorganized: a real chat, merged routines, a trainer bulletin, and private PRs

- 💬 **Muro is now a chatbox.** Members open a topic and comment on each other's — the default tab
  when Social opens. Any trainer or admin can remove any topic or comment, not just their own,
  same as the rest of the gym's moderated spaces; everyone else can only remove their own.
- 🗂️ **Rutinas merges into one tab**, with public member-published routines and trainer-published
  ones shown as two clearly labeled sections instead of two separate tabs.
- 📌 **Entrenadores becomes a bulletin board.** Trainers post news, ideas or tests; posts are
  read-only by default, with a per-post toggle — trainer/admin only, enforced on the server, not
  just hidden in the UI — to open comments on a specific announcement.
- 🔒 **Marcas (PRs) are private by default.** What used to live in Muro — posting a real logged
  set as a public record — moves under Desafíos y Marcas with a visibility toggle. A new Marca
  starts private; sharing it publicly is a deliberate choice, and existing Marcas from before this
  change keep the public visibility they already had, so nothing anyone already shared quietly
  disappears.

## v1.3.0 — 2026-09-21

Superset colors, adaptive print, a smarter CSV importer, room equipment awareness, a second
AI provider for the Coach, trainer-assigned notes with a quiet version trail, and quick
in-session context — plus two real bugs fixed: a training session that wouldn't actually go
away, and the Bunker losing track of you the moment someone else needed the screen.

### Supersets get a color, printing gets a brain

- 🎨 **Superset colors and labels (A1/A2, B1/B2…)**, assigned deterministically by
  first-appearance order — the same group reads as the same color whether you're looking at
  the routine on screen or the printed sheet.
- 🖨️ **Adaptive print density.** Page density now scales to how much is actually on a given
  day: a 2-day routine still fits comfortably on one page, a 5-day plan settles around two,
  without redesigning the sheet itself.
- Substitution picker: uniform row heights, horizontal filter scroll instead of a cramped list.
- CSV import: Gravl format support, and superset grouping on import is more conservative —
  fewer false groupings from an ambiguous export.

### A second, isolated AI: the room's own assistant

- 🤖 **A new `auxiliary_ai` profile (Gemini)**, completely separate from the member-facing
  Coach and the trainer panel's own AI — its own credential, its own log, no shared prompt or
  context with either. It only ever does narrow, mechanical reading: matching an imported
  exercise name to the right one in your library, reading a machine's ID plate, reading a
  bioimpedance report, reading a printed or handwritten routine.
- 📥 **CSV import gained a real review step.** Gym-wide confirmed aliases are tried first,
  then local candidates, then an optional AI suggestion — never applied without your
  confirmation — surfaced on a dedicated "Review matches" screen.
- Antiduplicate detection now fingerprints an imported workout by the exercise's real **name**
  rather than a random id minted per import, so re-importing the same file twice is correctly
  recognized as a duplicate instead of doubling your history.
- 🏋️ **Equipment availability.** Mark a piece of equipment as temporarily out of service and
  every exercise that needs it is skipped the moment a workout starts — independent of, and
  layered on top of, the existing per-exercise admin hide.

### The AI Coach can now run on OpenAI, not just Codex

- A direct OpenAI REST option for the member-facing Coach, next to Claude and Gemini — no
  CLI, no device-code sign-in, no local subprocess, same "paste an API key" flow the Gemini
  option already used. Off by default; an admin opts a gym into it from the Coach panel, with
  its own connection test and configurable model.

### Trainer notes, a quiet version trail, and quick context mid-session

- 📝 **A trainer's note on one specific exercise slot** now actually shows up where it's
  needed: a compact, tap-to-expand line during training, and — space permitting — under the
  exercise name on the printed sheet, without ever pushing the adaptive page-density targets
  out of range.
- 🕓 **Routine/program version history for trainer-assigned plans.** When a trainer
  meaningfully re-saves a routine or program a member is already using, the previous content
  is kept — date and all — queryable from the builder's own "Version history". Traceability,
  not a diff editor: no restore button, and a no-op re-save or a temporary equipment change
  never adds a version.
- ⏱️ **"Show previous sessions"** on an exercise's detail view reveals its last three real
  sessions instead of only the single most recent one — collapsed by default, so the card
  doesn't grow for everyone just because the data is there.
- Routine and program rows in the library and the trainer panel now carry a quick summary —
  exercise and superset counts, scheduled days, and how many of their exercises are currently
  unavailable — without needing to open them.

### Fixes

- **A finished or discarded training session could keep coming back.** `PUT /api/data`'s own
  protection for a session running at the Bunker was unconditionally reinjecting whatever
  `active` the server already had on every sync — which meant neither Discard nor Finish
  could ever actually clear it server-side, silently, for both. A new, narrowly-scoped
  endpoint (id-matched, and refused outright while that session is genuinely live at the
  Bunker right now) is the one authorized way a client can end its own session for real.
- **The Bunker: minimizing to let someone else train no longer strands you.** Every checked-in
  member's card on the room board is now tappable. Tapping your own reopens your exact
  session — mid-set state and all — with no PIN, as long as this same device already checked
  you in earlier this visit; anyone else's card, or your own checked in from a different
  device, still asks for the PIN, exactly as before.

## v1.2.3 — 2026-07-31

How hard a set was, in whichever of the two scales you already think in — and the ratings your
old app recorded come across with the rest of your history. Plus: the phone stops locking itself
mid-workout, the rest timer can hand time back as well as take it, and Settings is grouped by
what each thing actually affects.

### The screen stays on while you train

- ☀️ **Keep screen awake — Settings → *During a workout*, on by default.** Locking, unlocking
  and finding your place again between every set was the single most annoying thing about
  logging on a phone. The screen now stays lit for as long as a workout is running and lets go
  the moment you finish it, so nothing is held while you are not training.
- **It survives a tab switch.** Browsers release the lock whenever the page stops being visible,
  which is exactly what happens when you glance at a message. The lock is taken again each time
  the app comes back, rather than dying the first time you look away.
- **It follows the workout, not the screen you are on.** Checking Stats mid-session keeps the
  screen awake.
- **Where it isn't available, it says so.** iOS grants no wake lock in Low Power Mode, and older
  browsers have no Wake Lock API at all — the first is silent, the second shows the row disabled
  rather than offering a switch that does nothing. Needs HTTPS, like every other modern browser
  capability.

### Rest timer: take 15 seconds off, too

- ⏳ **A −15s button next to +15s.** The timer could only ever be extended or skipped outright;
  now it goes both ways. Taking off more than is left finishes the rest rather than counting
  into the negative — the same thing Skip does.
- **Rearranged so three controls fit.** The clock and the progress bar take the top row and the
  controls sit underneath: −15 and +15 together in number-line order, Skip pushed to the far
  edge so the button that ends the rest is not next to the one you tap to buy more time. On a
  wide screen it stays on one line. Tap targets are bigger than they were.
- **The bar is nearly opaque.** The set rows underneath were reading through it and making the
  clock hard to pick out.

### Settings, grouped by what it affects

- **General** (language, units) · **During a workout** (rest timer, keep screen awake, sounds,
  effort per set) · **Notifications** · **Appearance** (theme, body diagram, accent) · **Data**.
- The old grouping mixed axes: "Units & timer" put a display preference next to two workout
  behaviours, language sat under Appearance, and *Load starter plan* was buried between the
  backup actions and the destructive reset. Data now reads in the order you would use it — fill
  the plan, bring history over from another app, restore a backup, export one, wipe everything.
- Nothing was removed and no setting changed its meaning.

### Effort per set: RIR or RPE (#21)

- 🎯 **A third column on a working set, off by default.** Settings → *Effort per set* switches
  it between **Off**, **RIR** and **RPE**. It only appears on weighted rep sets: a plank or a
  treadmill row has nowhere to put it.
- **Two names for the same judgement.** RIR counts the reps you left in the tank; RPE reads the
  same effort off a 10-point scale, so RPE ≈ 10 − RIR. The setting has an (i) that lays the two
  scales side by side in a conversion table rather than explaining them in a paragraph.
- **Each set keeps the scale it was logged with.** Switching the setting changes what new sets
  ask for and nothing else — history is never silently rewritten, and a set logged as RIR 2
  still reads back as RIR 2 years later.
- **An unrated set stays unrated.** Blank and 0 are different things: RIR 0 says the set went to
  failure. So `−` on an untouched cell leaves it empty, `+` starts at the bottom of the scale
  and walks up in even steps, and stepping back off the bottom clears the cell again — a mistap
  is always undoable.
- **Nothing else reads the value.** Progression rules and estimated 1RM are unaffected; the
  rating is yours to look at, not an input to the maths.
- Upgrading keeps the column you had: a profile still carrying the old `showRir` flag — from
  this device, a sync, or a backup restored later — comes across as RIR.

### Import brings your ratings with it

- 📥 **The RPE Hevy and Strong export is no longer dropped.** An `RPE` column is read into the
  set, as is an `RIR` column if a file has one, and the import summary says how many sets
  arrived with a rating — plus where to switch the column on if it's off.
- A blank cell stays unrated rather than becoming 0. A written-out `0` counts as a rating on the
  RIR scale (a set to failure) but not on RPE, which starts at 1 — apps write 0 there to mean
  "nothing here", and reading it as an effort would stamp one on every unrated set in the file.
- Ratings above the scale are capped instead of thrown away, and junk in the column is ignored
  without losing the set.
- Backups already carried both fields and the setting, since a backup is the whole state — there
  are now tests pinning that, so it can't quietly stop being true.

## v1.2.2 — 2026-07-25

Training that moves on its own: an exercise can now be logged by time instead of reps, the
next weight follows a progression rule you choose rather than a single hard-coded hint, and
every lift carries an estimated 1RM. Plus a standalone mobile app, a shareable plan, and an
importer for your history from other apps.

### Timed sets and a timer for the set itself (#16)

- ⏱️ **Reps or time, per exercise.** Planks, hangs, wall sits, dead hangs and loaded
  carries no longer have to be filed under cardio to be timed. Each exercise in a routine
  picks its own mode, and a timed set can still carry weight for a weighted plank or a
  farmer's walk.
- ▶️ **A work timer, separate from the rest timer.** Start a timed set and it counts the
  hold down, beeping and buzzing at zero exactly as the rest timer does, then checks the
  set off itself. The two timers can never run at once — they mean opposite things.
- Finishing a hold early logs **the time you actually held**, not the target. A 38-second
  hold against a 45-second target is recorded as 38 seconds.
- The mode travels everywhere it should: routine editor, workout, history, exercise
  statistics (timed exercises chart their longest hold), the printable plan and the shared
  plan file.
- Plans made before this release are read exactly as they always were — nothing to migrate.

### Progression rules you can read (#17)

- 📈 **Pick a rule per routine, override it per exercise.** Linear progression, **Greyskull
  LP** (two straight sets plus an AMRAP final set, with double jumps and a 10 % reset),
  double progression through a rep range, or adding time for timed work. Or none at all.
- 🧾 **Every target explains itself.** "Every rep last time — 2.5 kg more." "Missed reps
  3 sessions running — reset to 55 kg and work back up." The rule is visible before you
  train, not after.
- The session opens with the right weights already in the rows, instead of suggesting them
  once you are standing at the bar.
- 🚫 **A bad session can't look like a good one.** Short reps count as a miss even when you
  checked the set off; a set you never checked counts as a miss because you did not do it.
  Nothing advances the load on a session that fell apart.
- Stalls and deloads are worked out from your log every time they are needed. Nothing is
  written back into a finished workout and no counters are stored, so fixing a mistyped set
  immediately produces the right next target.
- Lower-body lifts step up in larger jumps than upper-body ones by default, and any
  exercise can set its own step.
- Bodyweight exercises progress in **reps**, because there is no load to add to a push-up
  and no load to take off it either.

### Estimated 1RM (#18)

- 💪 **An estimated one-rep max for every lift**, in the exercise progress card (with its
  own curve you can switch to) and in the exercise detail sheet.
- It always names the set it came from — "from 90 kg × 5 on 15 Jul" — because an estimate
  off a heavy triple and one off a set of ten are very different claims.
- 🧮 **A calculator** for a set you have not done yet, so the number is reachable before
  there is any history.
- Epley by default, and it **refuses to guess above 12 reps**, where the common formulas
  disagree by double digits.
- A new best estimate is reported at the end of a workout separately from a weight PR —
  same weight for more reps is real progress, but it is not a heavier lift.

### Share a plan

- 📤 **Send someone your plan.** Plan → *Share your plan* writes a small file with your
  routines, the week schedule and any custom exercises they use — and nothing else. No
  workouts, no weigh-ins, no settings.
- Importing **merges**: shared routines arrive as new ones with fresh ids, custom exercises
  are matched by name so they are not duplicated, and your own plan is never overwritten.
  Taking the week schedule with it is optional.
- 🖨️ **A printable plan** (Save as PDF) laid out so a single exercise never breaks across
  a page.

### Fixes

- A shared plan file naming an exercise this build doesn't have can no longer take the app
  down. Unknown ids are dropped on import, anything that slips through renders as a
  placeholder you can delete, and an error boundary around the screens means a bad state is
  recoverable by switching tabs instead of reloading.
- Importing from another app converts weights **per row**, not per file. FitNotes writes the
  unit on each set, so a mixed export used to land 185 lb as 185 kg.
- Numbers follow the UI language instead of a hardcoded locale, which was putting Swiss
  apostrophes ("7'535 kg") in front of everyone. Volume stays in your own unit rather than
  switching to tonnes, which was wrong for pound profiles.
- Taking over a week schedule from a shared plan now really replaces Monday–Sunday instead
  of only the days the shared file happened to fill.
- The body-weight slider's ceiling follows your unit (300 kg / 660 lb).
- "Best: 85 Kg" is capitalised correctly again.

### One codebase, two flavors

2J Fitness Center is also a standalone mobile app — and it ships as a direct APK download, not
through app stores.

- 📱 **Standalone mobile app.** The same frontend now also builds as a native iPhone /
  Android app (Capacitor) — the install-and-done flavor of 2J Fitness Center: no account, no server,
  no sync. Everything stays on the phone.
  - State is mirrored into a file in the app's private storage on every change, so your
    log survives even when the OS evicts WebView storage (iOS does).
  - The workout-day reminder becomes a **native notification** scheduled on the weekdays
    your plan actually has a routine — no push server involved.
  - Backups go out through the OS **share sheet** (Files, AirDrop, mail…).
  - Exercise images/animations load from the same CDN as the live demo.
  - `npm run build:mobile`, then open `android/` in Android Studio or `ios/` in Xcode —
    see **docs/MOBILE.md**. `NOTICE.md` now carries an AGPL §7 app-store exception.
- 🤖 **Android APK, no Play Store.** The official build is a signed, sideloadable APK
  (~4.5 MB), built and distributed deliberately store-free. docs/MOBILE.md covers building
  and signing your own.
- 🍎 **iOS reality check.** Apple permits no installs outside the App Store, so there is no
  iOS download; the docs explain the free options (self-hosted PWA on the home screen, or
  running the native app onto your own iPhone from Xcode).

- 📥 **Import your history from another app.** Settings → Data → *Import from another app*
  reads an export from **FitNotes** (both the Android and the FitNotes 2 iOS format),
  **Strong** and **Hevy**, and pulls body-weight history out of an **Apple Health** export.
  Anything else with a date, an exercise name and weight/reps columns is read too.
  - Every row becomes a set, grouped into workouts by date, so your history arrives with
    its real dates rather than as one lump. Hevy and Strong also carry session length, so
    the activity heatmap fills in properly.
  - Exercise names are matched against the 1,324-exercise library — parenthetical
    qualifiers like "(Barbell)" and shorthand like BB/DB are normalised, and a curated
    table covers the plain names people actually log ("Bench Press", "Squat", "RDL").
    Where a name is genuinely ambiguous it is *not* guessed at: it becomes one of your own
    exercises instead, because filing years of training under the wrong lift is worse than
    an unmatched name you can see and fix.
  - A summary shows what will happen — workouts, sets, how many exercises matched, which
    ones didn't, and whether weights need converting — before anything is written.
  - Importing is idempotent: days you already have data for are left alone, so running it
    twice, or importing from two apps, never duplicates a workout.

## v1.2.1 — 2026-07-23

A muscle map across the app, and a live demo you can try without installing anything.

- 💪 **Muscle map.** Three places now show which muscles your training actually reaches, drawn on a
  front-and-back body diagram shaded like the activity heatmap — more accent means more work.
  - **Stats → Muscle balance** aggregates a week, 30 days, 90 days or everything, lists your
    hardest-worked muscles with their set counts, and names the ones that got *nothing* in that
    period. That last list is the point of the card: the gaps are what you'd otherwise never notice.
    Tap any muscle to read its name and volume.
  - **Routine editor** previews what a session hits as you build it, so a hole in the plan shows up
    before you train around it for a month.
  - **The finish screen** shows what you just trained.
  - Load is counted in *effective sets* — a set counts fully for the exercise's target muscle and
    partially for its supporting ones — not in kilograms, because 100 kg of leg press and 12 kg of
    lateral raise say nothing about which muscle worked harder. Shading is relative within the
    period you're looking at, so the map always reads as a balance rather than an absolute.
  - Settings → Appearance → **Body diagram** switches between a male and female figure.
  - The exercise dataset spells muscles inconsistently ("delts", "deltoids" and "shoulders" are one
    muscle); all 50 spellings it uses are normalised onto the 18 the diagram can draw. Custom
    exercises, which only carry a body part, fall back to it. The geometry is ~90 kB and loads on
    demand, so the initial bundle is unchanged.
- 🐛 **Fixed: finishing a workout from its last exercise could blank the whole app.** The
  per-exercise weight sheet read the running workout without checking it was still there, and
  finishing clears it while that sheet is still on screen.
- ▶️ **Live demo** — a browser-only build (`VITE_DEMO=1`) published to GitHub Pages on every
  push to `main`. It boots
  into guest mode with a seeded example profile (12 weeks of Push/Pull/Legs, weigh-ins, PRs) so
  every screen has something to show, and it never talks to a server. Passkeys, sync and the admin
  dashboard stay exclusive to self-hosted instances, which is where the backend lives.
- 🖼️ Builds can point the exercise media elsewhere via `VITE_IMG_BASE` / `VITE_GIF_BASE` — the demo
  serves the ~140 MB dataset from a CDN instead of shipping it. The default (`img/` and `gif/` next
  to the app) is unchanged.

## v1.2.0 — 2026-07-23

A complete visual redesign. Same app, same data — every screen redrawn.

### A designed interface, not an assembled one

- 🎨 **Rebuilt design system.** One type scale carrying hierarchy through size instead of making
  everything bold, a neutral surface ramp instead of saturated blue-greys, hairline separators
  instead of outlined boxes, and motion that acknowledges a press rather than animating for
  decoration. Light and dark are both first-class, and the eight accent colours now pick their
  label colour by measured contrast — the default green in light mode was failing WCAG AA on
  every primary button before.
- ✏️ **A hand-drawn icon set** (77 icons, single stroke weight, drawn on one 24×24 grid) replaces
  every emoji in the interface. Emoji render differently on each platform, sit on their own
  baseline and can't take a theme colour, which is what made the old UI feel stitched together.
  Icons inherit the surrounding text colour and optical size.
- 🏋️ **Routine icons.** Picking an icon for a routine now offers a grouped set — strength,
  equipment, cardio, recovery — instead of an emoji keyboard. Routines you already made keep
  their look: the old emoji are mapped forward automatically, so nothing to migrate and nothing
  to redo.
- ▶️ **New tab bar** with a raised Start button that turns into a pulsing orange Resume while a
  workout is running.
- 🏠 **Home reads as a plan for today** — week strip, today's session as one tappable row, body
  weight, and your streak.

### Charts

- 📈 **Axis labels, gridlines and the target-weight line are visible again** in dark mode. They
  were painted with colour variables that no longer existed, which silently fell back to black
  on black — and to no stroke at all for the lines.
- 💬 **The hover readout stays on screen.** It used to be positioned with a fixed offset that
  assumed one label width, so the first and last point pushed it under the chart's clip; it's now
  placed from its measured size and kept inside the frame, dropping below the point when the
  point sits high enough that the label would cover the value it reports.
- 🖱️ **It also goes away again** — moving off the chart now clears the readout, crosshair and
  marker, which previously stayed until you hovered somewhere else.

## v1.1.3 — 2026-07-22

Admin dashboard for self-hosters (opt-in — off by default), equipment filtering, and
workout-screen fixes.

### Admin dashboard

- 🛠️ **Admin dashboard** (Settings → Admin dashboard) for whoever runs the instance: a users
  overview with workout counts and last-active times, plus a per-user drill-down into their full
  workout history and body-weight log.
- 🟢 **Live "training now"** — see who's mid-workout in real time, with their current exercise and
  set progress, updated by a lightweight heartbeat while a workout is on screen.
- 🚫 **Disable / enable accounts** — a disabled account is signed out and locked out everywhere
  until you re-enable it.
- 🔑 **Invite-only signup** (optional) — require an invite code to create a profile; generate and
  revoke codes from the dashboard. Existing accounts are unaffected.
- ⚙️ Configured via environment: `ADMIN_UIDS` (comma-separated user ids who are admins) and
  `INVITE_ONLY=1`; both default off, so a fresh instance stays open with no admin. See
  `.env.example`. Admin access is gated by your passkey and enforced server-side.

### Exercises & workout

- 🏋️ **Filter exercises by equipment** (#6). A second filter row under the body parts lets you
  narrow the list to what you actually have — body weight, dumbbell, barbell, cable, band, and so
  on — in both the Exercises library and the exercise picker. The options adapt to what you've
  already selected and are ordered by how many exercises use them, so every combination on screen
  has results behind it and the row stays short. Building a bodyweight-only plan is now two taps
  per body part.
- 🔎 **Minimize the exercise animation during a workout** (#12). A ⤡ Minimize / ⤢ Expand button
  on the animation shrinks it to a thin strip so the set rows sit right under your thumb — no more
  scrolling past a big GIF to tick off a set. Your choice is remembered and applied to every
  exercise and future workout until you change it, so you set it once. Tapping the animation still
  pauses/plays it as before.
- ⏱️ **Fixed: the rest timer froze at 0:01** (#14) instead of counting down to the end. It also
  meant the timer could only be cleared with Skip, and a redundant "rest over" push notification
  could still fire.

## v1.1.2 — 2026-07-22

Custom exercises, full localization, and input fixes.

### Custom exercises (#11)

- ✨ **Create your own exercise** from the exercise picker or the Exercises tab: a name and a
  body part is all it takes. Your search text is pre-filled as the name, so "no match" flows
  straight into "create it".
- 📝 **Optional description** — setup, cues, anything you want to remember. It shows on the
  exercise's detail and config sheets (where a built-in exercise would show its animation),
  and it's searchable, so you can find your own exercises by their cues too.
- 🏋️ Custom exercises behave like built-in ones everywhere — routines, supersets, workout
  logging, weight suggestions, PRs, stats and history. The animation stays blank by design.
- 🏃 Pick the *cardio* body part and it logs time + speed instead of weight × reps, like the
  built-in cardio exercises.
- ✏️ Edit (rename, change body part or description) or delete your custom exercises — from
  their detail sheet in the Exercises tab, or straight from the exercise inside a routine via
  "Edit or delete this exercise". Deleting removes them from your routines; already-logged
  workouts keep their sets and still show the exercise name. (The routine sheet's old "Remove
  exercise" button is now labelled "Remove from routine", so the two are no longer confusable.)

### Localization (#7)

- 🌍 **12 UI languages**: English, Deutsch, Español, Français, Italiano, Português, Polski,
  Türkçe, Русский, 中文, 한국어, हिन्दी. Pick yours under Settings → Appearance → Language;
  the choice syncs with your profile like the theme does.
- 📖 **Localized exercise instructions** for 10 of those languages (all except German and
  Portuguese, which the upstream dataset doesn't cover yet — those fall back to English),
  covering all 1,324 exercises. Body-part filters, equipment and muscle tags are translated
  too; exercise *names* stay English (upstream limitation). Custom exercises are translated too.
- 📅 Dates, weekday and month labels follow the selected language.
- ⚡ Zero cost when unused: the app still ships English-only by default. Each UI language is a
  ~7 kB chunk and each instruction pack ~80–120 kB (gzipped), downloaded only when you switch —
  the initial bundle size is unchanged.
- 🛠️ New `scripts/build-instructions.mjs` regenerates the instruction packs from the upstream
  dataset; translations live in `frontend/src/locales/` (PRs welcome — it's one flat
  English-string → translation map per language).
- Known gaps: push notification texts (sent by the server) and plural forms in some languages
  are approximated; happy to take corrections from native speakers.

### Fixes

- ⌨️ Weight and other numeric fields now accept a comma as decimal separator ("33,5") — iOS
  decimal keyboards in many locales only offer a comma, which previously reset the field to 0.
  Partial input like "33," no longer snaps to 0 while typing. (#13)
- 📱 Fixed the exercise-config sheet (Sets / Reps / Weight, and the cardio variant) overflowing the
  screen edge on narrow phones — the Weight stepper was clipped and could make the whole page pan
  sideways in iOS Safari. Steppers now shrink to fit the viewport. (#10)
- 🛡️ Added a global horizontal-overflow guard so a single too-wide element can no longer knock the
  page layout off-scale.

## v1.1.1 — 2026-07-21

Reliability fixes for the push notifications shipped in v1.1.0, found through live testing:

- 🌍 Workout day reminder now fires by each user's own browser-detected timezone instead of a
  single server-wide one — works correctly regardless of where the server runs, and follows you
  automatically if you travel.
- 💾 Settings changes (like the reminder time) are flushed to the server immediately when the tab
  backgrounds or closes, instead of relying solely on a 1.5s debounce that could get cut short.
- ⏱️ Reminder check tightened from a 60s to a 10s interval, and pushes are now marked
  `urgency: 'high'` — cuts avoidable delay on top of it, though delivery time is ultimately up to
  Apple/Google's push relay.
- 🪵 Push send failures are now logged instead of silently swallowed.

## v1.1.0 — 2026-07-21

- 🐳 Prebuilt Docker images published to `2jfitness-{api,web}` (amd64 + arm64)
  via GitHub Actions, so self-hosting no longer requires building from source. `docker compose pull`
  grabs them; `docker compose up -d --build` still builds locally if you'd rather.
- 🔔 Push notifications: rest-timer-over alert (fires even if the app is closed) and an optional
  daily reminder on days you have a workout planned but haven't logged one yet. Opt in per-profile
  in Settings — requires a signed-in passkey profile. Backend gains one dependency (`web-push`);
  VAPID keys are generated on first run.
- 🐛 Fixed the rest timer stalling when the tab/app is backgrounded — it's now anchored to a real
  timestamp instead of a plain per-second counter, so it stays accurate after you come back.

## v1.0.0 — 2026-07-20

First public release. A complete, self-hostable gym & body-weight tracker.

**Highlights**
- ⚖️ Body-weight tracking with an interactive chart + goal line
- 🏋️ Weekly routine planner over 1,324 exercises with animated demos
- ▶️ Guided workouts: body-weight check-in, pre-filled weights, rest timer, PR detection, per-exercise weight tracking
- 🔗 Supersets and 🏃 cardio (time + speed) logging
- 🗓️ Per-day rescheduling without touching your weekly plan
- 🟩 GitHub-style activity heatmap (by time trained)
- 🔑 Passkey (WebAuthn) login with per-profile data that syncs across devices
- 🎨 Light/dark themes + 8 accent colors, synced to your profile
- 📦 JSON export/import, guest mode, PWA install, no telemetry

**Stack**
- React 19 + Vite (React Router, Zustand)
- Node backend, no framework, single dependency (`@simplewebauthn/server`), JSON-file storage
- nginx + multi-stage Docker so `docker compose up` builds and serves everything

**Notes**
- Exercise media (~140 MB) is fetched from [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) on first run.
- Licensed under GNU AGPL v3.0.
