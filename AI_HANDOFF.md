# AI_HANDOFF.md — 2J Fitness Center

> Punto de traspaso entre sesiones (Claude Code / Codex). Resumen operativo del estado REAL;
> Git y el código son la fuente de verdad. El detalle histórico de cada sprint (V1–V3, Sync V2,
> Bunker, Health, Constructor, etc.) está en el historial de este archivo:
> `git show 75317b0:AI_HANDOFF.md` y en `CHANGELOG.md`.

## Megasprint 2J — checkpoint autoritativo (2026-10-07)

Este bloque es la referencia vigente para el trabajo posterior a producción 4230b17. Los estados fechados más abajo son historial, no sustituyen este checkpoint.

### Producción y release

- Producción confirmada al inicio: `4230b17f3b4f9703f4706df9df65f36315e21eff`.
- Último commit funcional: `7f9a89e4d0815af34113442d21a9dd03c3931139`. La punta candidata `8458b54` integra además el remoto documental/legal 2J sin cambiar producto. **NOT DEPLOYED**.
- No se ha conectado a producción, creado backup predeploy ni ejecutado un deploy en este trabajo.
- Web Push diagnóstico sigue sin prueba física confirmada y el temporizador real no usa esa cola. Android Rest Alert física y PWA no deben declararse validadas por los tests locales.

### Implementado en el megasprint

- **IA profesional vs personal:** la generación profesional usa su propia ruta y un payload allowlist del plan y briefing del entrenador; no requiere consentimiento de IA personal del socio. El payload profesional excluye identidad, historial, Health, medidas, notas privadas y datos sociales. Las rutas conservan los guards de rol existentes. Limitación real: el modelo actual autoriza por rol y no implementa una relación trainer↔socio; no afirmar aislamiento por asignación individual.
- **Progresión e historial:** campo aditivo `excludeFromProgression` y política común para no usar sesiones excluidas en cargas, tendencias, PR/e1RM, fatiga, cobertura ni evidencia de Coach/IA. Siguen contando como asistencia/duración. Edición de entrenamiento finalizado valida los campos permitidos, conserva el registro existente y no cambia la rutina base. Legacy sin el campo sigue incluido.
- **Seguimiento:** amplía la superficie existente con objetivo actual y nota privada administrativa cifrada en reposo, con historial acotado y guardado explícito. Solo admin puede leer/escribir esa nota; no entra en estado del socio/Sync, proveedor IA o Community. La plantilla/cadencia existente preserva el blob cifrado. No hay scope trainer↔socio; acceso de entrenador a notas queda pendiente de una ACL explícita.
- **Repositorio/tooling:** política Git EOL acotada (fuentes y generados LF, PowerShell CRLF, binarios no normalizados) sin renormalización masiva; `docs/GENERATED_FILES.md` documenta fuentes y checks reproducibles. El deploy-kit está versionado como tooling propuesto, pero no instalado ni verificado en VPS; los scripts que cambian claves, usuarios, sudoers o SSH no se ejecutaron.

### Evidencia local

- Frontend: **1445/1445**, corrido secuencialmente para evitar timeouts ambientales; hubo un primer intento paralelo con fallos solo de timeout.
- API: **450/450**, sin skips al incluir Git Bash/OpenSSL para los tests operativos de backup.
- Web build: OK; español completo en check de locales (4540/4540; otros idiomas conservan la cobertura parcial conocida).
- Generated checks: Coach Library 1324 ejercicios; 198 bloques; 155 rutinas / 15 colecciones; Sync Gym Profiles, Guided Program model, Library overlay, Protocol (9 copias) y Workout Activity coinciden con generadores.
- Deploy-kit: Node 18/18; Docker Ubuntu 24.04 48/48; PowerShell/Bash syntax y diff-check OK. `PrepareOnly` final para `8458b54` pasó: exact delta, API image/imports/health, release protocol, install y rollback simulado, preservación de fixtures de datos y rechazo de artefacto manipulado. No prueba una instalación en VPS.
- Falsos negativos del runner corregidos sin tocar producto: el smoke Community verifica la inicialización real `db.subs = db.subs || []`; Push verifica el acceso protegido `notificationApi().permission`; la simulación Windows convierte las rutas de probes Node con `cygpath -m` y proporciona una clave pública sintética a `/api/push/public-key`. PrepareOnly confirmó `PREPARE_ONLY_OK` y `DEPLOY_SCRIPT_OK` para el target exacto. Tooling-only commits: `9c48b50`, `bdc4bb9`, `2238428`, `eb52fd3`.

### Commits de código

- `937741e` — separación IA entrenador/socio.
- `26529e9` — exclusión de progresión y edición segura del histórico.
- `7f9a89e` — Seguimiento con contexto y notas privadas admin.
- `8458b54` — merge de los cambios legales/documentales presentes en el remoto 2J, sin cambios funcionales upstream.

### Decisiones y límites

- No se cambió Sync V2, autenticación, Bunker, Health, roles, planificador, formato histórico base ni los motores de entrenamiento existentes.
- Las acciones del usuario/entrenador siguen siendo explícitas. Health y datos sociales no se envían a IA.
- Backups off-site de producción: pendientes de destino/passphrase del operador y ensayo real; los tests usan fixtures temporales.
- No reabrir bloques ya cerrados ni implementar roadmap como parte de este checkpoint.

### Próximos pasos

1. Resolver explícitamente el alcance trainer↔socio antes de exponer seguimientos/notas privadas a trainers; por ahora las notas son admin-only.
2. Completar QA física pendiente de Web Push/PWA de descanso, sin conectar el temporizador real hasta que la prueba independiente pase con PWA minimizada y pantalla apagada.
3. Revisar el deploy-kit antes de activar su instalación en servidor; mantener el deploy manual existente y no usarlo sin aprobación del operador.
4. Después, agrupar incidencias de uso normal. Roadmap no comprometido: Bunker evolución, entrenamiento temporizado, UI/UX, Health/progreso visual, Library/análisis, seguridad/passkeys, Sync V3, Social, catálogo y reservas.

---
## Estado actual — producción y alerta Android de descanso (2026-10-07)

- **Producción actual reportada por el propietario:** `cca6dc4137afb28e4df823f229e939933efeae78` (release Android Rest Alert). Shared Staff Device permanece desplegado y validado; no reabrirlo.
- **Alerta Capacitor Android:** se conserva en la APK para la release `cca6dc4`. Reutiliza el temporizador JS y una notificación local genérica, sin datos de ejercicio, Health ni cambios de Sync V2. El hallazgo actual se refiere a la mayoría de usuarios que usan la web/PWA, no a borrar ni reemplazar el mecanismo nativo.
- El permiso de notificaciones Android se pide solo tras activar el ajuste; si se deniega, el temporizador sigue funcionando y se muestra cómo habilitarlo en Ajustes Android. `allowWhileIdle` usa la alarma exacta si el sistema la permite y conserva el fallback inexacto del plugin. La PWA aún no está conectada a Web Push: mantiene su comportamiento previo hasta validar físicamente la prueba independiente; Bunker no llama al `startRest` del workout.
- Validación local: focalizados **25/25**, frontend **1417/1417**, API **431/431 sin skips**, build web OK, español **4511/4511**, `git diff --check` OK; Capacitor Android sync, `testDebugUnitTest` (UP-TO-DATE) y `assembleDebug` OK. Shared Staff Device no se tocó. No hubo conexión ni deploy.
- Runner `deploy-cca6dc4.ps1` generado desde `ops/deploy-kit/releases/android-rest-alert.json`; PrepareOnly OK para target `cca6dc4137afb28e4df823f229e939933efeae78`, rollback `831f691ca1b30a9c252bb60e8336d93edf448114`. Incluye simulación install/rollback, rechazo de rollback alterado, SHA-40, Sync V2, preservación de datos y probes Shared Staff exactas. El resumen `SHARED_STAFF_SMOKE` ya imprime los códigos HTTP reales. No se conectó ni desplegó.
- **Web Push para PWA — infraestructura local, no desplegada; prueba física pendiente:** el service worker recibe y deduplica alertas genéricas; la API guarda suscripciones por cuenta/dispositivo y una cola persistente de alertas con recuperación tras reinicio. Ajustes → Entrenamiento ofrece una suscripción explícita y prueba independiente a +5 s. El aviso de descanso real **todavía no está conectado** a esta cola; el flujo web anterior sigue igual. No declarar resuelto hasta que el push de prueba aparezca físicamente en una PWA minimizada/con pantalla apagada. Arquitectura, límites, VAPID y procedimiento: `docs/WEB_PUSH_REST_ALERTS.md`.
- El resto de entregas físicas Android para Capacitor sigue pendiente según `docs/ANDROID_REST_ALERT_QA.md`; la tarea Web Push actual no la toma como prioridad.

## Estado actual — búsqueda tolerante de ejercicios (2026-10-06; NO desplegada)

- Baseline/tag estable y producción de partida: `2j-baseline-2026-10-06` / `16a1bb779140cd28020551bf16c0628f88b46f4f`.
- Se adaptó de openGym v1.3.9 (`e6c920eb0a657e57139798f60da40c934aec9301`) solo el fallback de erratas: búsqueda actual exacta/prefijo/campos conserva prioridad y ranking; fuzzy se ejecuta solo si no hay resultados, sobre nombres ES/EN y alias, nunca sobre equipo/músculos/movimientos. Exige todos los tokens, permite como máximo un token con una edición o inversión adyacente y bloquea tokens fuzzy menores de 5 caracteres. Mantiene Recommended 2J y penalización deprecated-last; no cambia IDs, catálogo, API ni datos.
- Helper y tests: `frontend/src/lib/library/fuzzy.js`, `fuzzy.test.js`; integración en `library/index.js`. También se verifica la búsqueda del Library, ranking exacto existente, alias español/inglés, recomendado/preferido, deprecated-last y determinismo. Constructor, Workout, Exercise Swap y Bunker conservan los consumidores existentes; Bunker no implementa otro buscador.
- Validación local: frontend **1402/1402** (107 archivos), build OK, español **4469/4469**, catálogo OK (1324 ejercicios; 19 sin movimiento son advertencias conocidas de biblioteca master), `git diff --check` OK. Hay warnings de build/Vite ya presentes sobre imports dinámicos y tamaño de chunks; no bloquearon build/tests.
- Commit funcional: `5b659c2dfd9e29f763c8c3a9fb04b16c6b077923`. El cambio y la documentación están en esta rama local; **NOT DEPLOYED / NOT PUSHED**. No integrar Android ni modificar los subsistemas funcionales de 2J.

## 00b. Sprint 3 — Modo Express + reordenación semanal (código; NO desplegado)

- Producción de partida confirmada: `bcb3eae`; Sprint 2 cardio sigue intacto. Commit funcional: `361d3d4`.
- Express (15/25/40 min) genera una copia solo para la sesión: preserva primer ejercicio, anclas/básicos/prioridades, restricciones y dolor declarado; elimina dropsets accesorios, reduce series accesorias, retira accesorios desde el final y solo al final reduce series ancla (nunca elimina el ancla). Superseries solo entre accesorios de repeticiones con material igual, grupos musculares disjuntos, descanso y series compatibles. Calentamiento accesorio puede reducirse al último ramp; no modifica objetivo ni progresión cardio. Si el trabajo protegido supera el tiempo, lo avisa en vez de prometer duración imposible.
- “Recolocar semana” deriva la sesión pendiente más antigua de los últimos 7 días desde `dayPlan`/semana efectiva del programa e historial, y propone el primer hueco vacío en los próximos 7 días sin sesión completada/planificada y con recuperación de grupos grandes. Semana sin hueco: ofrece Express. Un marcador `moved:<fecha>:<routineId>` en el día fuente evita repetir la rutina; el destino conserva el ID normal. Solo se escribe el `dayPlan` existente, no hay planificador/estado paralelo; editar o borrar rutinas limpia vínculos. Sync V2 no se modifica.
- El entrenamiento activo usa la rutina adaptada; el histórico conserva entradas realmente completadas y metadatos aditivos `sessionPlan`/`rescheduledFrom`; la rutina base queda intacta. `api/coach/payload.js` no cuenta el marcador de origen como otra asignación.
- Tests Sprint 3: 22 frontend focalizados y 1 API. Suites al cerrar código: frontend 1394/1394; API 423 pass, 5 skipped en ejecución directa Windows (runner prepara Bash/OpenSSL para eliminar skips); build y locales OK. No hay QA manual de dispositivo/navegador reportada.
- Limitaciones: duración estimada por heurística local, no cronometraje garantizado; reordenación es sugerencia y trabaja con la primera sesión perdida detectada; el miembro confirma cada acción. Estado: pendiente PrepareOnly, no desplegado ni push. No reabrir cardio.

## 000. Readiness + fatiga + autorregulación + descarga propuesta (código; NO desplegado hasta nuevo aviso; producción confirmada = `bcb3eae`)

- **Autorregulación RPE/RIR** (`lib/autoreg.js`, capa pequeña en `progression.js` → `regulate`, no segundo motor): una sola escala (RPE = 10 − RIR; RPE mayor / RIR menor = más duro). `easy`: últimas 3 sesiones completas, cada una con ≥2 series valoradas a RPE ≤ 7 → un paso real más sobre el planeado (≤ +15 % sobre la última carga; solo linear/double que ya subían). `grind`: últimas 2 completas a RPE ≥ 9 (RIR ≤ 1) → mantener carga. Nunca por una serie o sesión; con `why`/`auto` ('faster'|'slower'); `S.autoreg=false` lo apaga. Las sesiones de descarga se excluyen del progreso (`target.deload`).
- **Fatiga / readiness** (`lib/fatigue.js`, copia byte a byte en `api/lib/fatigue.js`, test `api/test/fatigue.test.js`): fatiga = puntos de señales independientes en 28 días (effort_up, hard, misses, incomplete vía `routine-review.plateau`; check-ins, sueño `S.sleep`, recuperación y volumen si se aportan). high = ≥ 6 puntos de ≥ 2 familias; elevated = ≥ 3. Readiness (score 0–100 = 75 ± sueño/recuperación/check-in/headroom − fatiga de entrenamiento) → push / maintain / adjust / recover; null si no hay dato real; funciona sin wearable.
- **Descarga:** solo se PROPONE con fatiga alta (`deloadProposal`); el miembro la acepta (`applyDeload` → `S.deload` {from, until=+7d, volumeCut .35, loadCut .075, rir 3}) o mantiene el plan (`S.deloadDismissed`, 14 días sin propuesta). Se aplica al construir la sesión (`progression.js withDeload`, sobre el plan base intacto) y caduca sola; reversible con `cancelDeload`. UI: `ReadinessCard/ReadinessSection` en Home y Seguimiento (gate `recovery`). Staff: alerta `fatigue_high` en «Requiere atención» (próximos) vía `followUpSummary`; el staff no aplica descargas.

## 00. Estado 2026-10-06 (rama `feat/v2.0.1-visual-v2`) — PRODUCCIÓN = `bcb3eae` (confirmada por el propietario; antes: `9ff9088` → `5ff0ef5`)

- **Desplegado desde Sprint 3 hasta hoy:** Sprint 3 (`83292cf`: chat AES-GCM, `SECRET_FILE` SIN activar, exportar/borrar cuenta, CSP), Health Native Onboarding V1 (`b62a6e6`+`3ac9caa`; vive en el APK, **APK release pendiente**), sprint premium (Biblioteca/Rutinas/Programas, Seguimiento V3, «Requiere atención» solo admin, privacidad en Amigos, chat), portadas propias con encuadre 2:1 (`image` + `/api/media/upload`; `coverFromBody` en `member-routine/member-program`), vista Cuadrícula/Filas (`lib/view-pref.js`, solo localStorage), Ajustes V3 (9 grupos), acceso del entrenador al panel (`/trainer`), fix iOS (campos ≥ 16 px: Safari ya no hace zoom al enfocar).
- **Seguimiento V4 — revisión de rutina (código; NO desplegado hasta nuevo aviso):** `lib/routine-review.js` (motor determinista; copia byte a byte en `api/lib/routine-review.js`, test `routine-review.test.js`). Ciclo derivado, sin migración: inicio = primer entreno de la rutina, o el último «Rutina revisada» (`S.routineReviews[id].reviewedAt`), o la última edición de staff (`routineVersions`). Revisión en semana 5; semana 4 si hay estancamiento claro; mínimo 3 sesiones; nunca edita la rutina. Reglas (ver cabecera del módulo): ejercicio estancado (≥4 exposiciones, las últimas 3 no superan ≥2 % e1RM/reps), fallos repetidos, esfuerzo RPE/RIR +1 a carga similar (±5 %), ≥2 de las últimas 3 sesiones «duras» (`set.feel`), ≥2 recortadas (<70 % de series previstas); claro = ≥2 estancados (≥ mitad) o 1 + otra señal. Miembro: `RoutineReviewCard` en Seguimiento y Home, solo aviso + «Ver rutina» (NO puede cerrar la revisión). Fechas manuales de staff (aditivas en `S.routineReviews[id]`: `startOverride`, `dueOverride`, `manualBy`; `setCycleDates`; null/'' = volver a automático; «Rutina revisada» las borra): en el Seguimiento de staff (`AdminFollowUp` → `RoutineCycles`) vía `POST /api/admin/user/routine-cycle`; `GET /api/admin/user/followup` devuelve `routineCycles`. RPE/RIR se normalizan (RPE = 10 − RIR; RIR menor = más duro). Staff: alerta `routine_review` en `followUpSummary` → «Requiere atención» (próximos; urgente si lleva ≥14 días vencida) + botón «Rutina revisada» → `POST /api/admin/user/routine-reviewed` (solo admin; escribe solo `S.routineReviews`, borra las fechas manuales). No hay asignación entrenador↔socio (sigue siendo solo admin). Sin notificación push: el aviso es dentro de la app.
- **Permisos de la revisión:** el ENTRENADOR (`requireTrainer`, admin incluido) puede leer/editar el ciclo (`GET /api/trainer/routine-cycles`, `POST /api/admin/user/routine-cycle`) y marcar «Rutina revisada» (`routine-reviewed`) desde el panel de entrenador (`TrainerClientPlan` → `RoutineCycles`); «Requiere atención» y `GET /api/admin/user/followup` siguen solo admin; el miembro no puede. **Roles:** `POST /api/admin/user/role` (solo admin; member/trainer/admin sobre los flags `u.admin`/`u.trainer` del roster; 409 `last_admin` si no quedaría ningún admin habilitado, 409 `admin_by_config` para admins de `ADMIN_UIDS`); selector con confirmación en Admin → usuario.
- **Runner de deploy:** derivar del último validado (`deploy-<short>.ps1` → `convert-runner.mjs` → `.2j`); `PrepareOnly` necesita `bash`+`openssl` de Git en el PATH (el runner ya los antepone) y API N/N con `skipped 0`. Deploy real solo con la frase exacta y ejecutado por el propietario.

## Sprint 2 — Cardio inteligente + tests útiles (código local; NO desplegado; producción confirmada = `bcb3eae`)

- `progression.js` amplía el motor actual con una política cardio determinista, activa por defecto y apagable por ejercicio. No hereda por error la regla `linear` de fuerza de la rutina. Las sesiones guardan su objetivo efectivo en el `target` ya existente de cada entrada; no cambian la rutina y los históricos antiguos siguen usando el objetivo de fallback.
- Regla: sesión completa según el número de series y todos sus objetivos → +1 min hasta 30 min (o el objetivo existente si ya supera 30); luego +0,5 km/h manteniendo el tiempo. Un incumplimiento aislado mantiene; dos seguidos reducen solo la dimensión incumplida (ritmo −0,5 km/h o tiempo −1 min, mínimo 5). Los motivos aparecen en el entrenamiento. El campo cardio existente solo guarda `min` + `speed`: no existe resistencia/nivel independiente.
- Progreso: resumen VAM y ergómetro por modalidad (último, mejor, fecha, cambio vs test anterior y objetivo de repetición +0,1 km/h o +1 %); recordatorio no bloqueante tras 8 semanas. VAM muestra cuatro bandas orientativas solo si `durationSec` está a ±15 s de 6 min; durante cardio en cinta se muestra la banda que corresponde al ritmo de la sesión. Bici/SkiErg muestran el test coincidente como referencia, nunca como prescripción. Las bandas son guía de carrera, no umbrales medidos ni una prescripción; no se reescribe un plan automáticamente. La semántica y límites están en `docs/EVIDENCE.md`.
- 1RM y formatos históricos intactos. Sin cambios en API, Sync V2, auth, Bunker ni Health.
- Validación local: frontend 1372/1372; API 422 passed, 5 skipped, 0 failed; build y `check-locales` correctos, español 4441/4441; `git diff --check` correcto. Sin deploy ni push.

## 0. 2J Fitness 2.0.1 — EXPERIENCE V2 (visual). Fases 1–4 implementadas Y DESPLEGADAS (checkpoint 2026-10-03)

| Fase | Estado | Producción |
|---|---|---|
| 1 Visual V2 | DONE | desplegada (`4c78ecb`, 2026-10-03) |
| 2 Health V2 | DONE | desplegada (`4c78ecb`) |
| 3 Social V2 | DONE | desplegada (`eee3bc2`, 2026-10-03) |
| 4 Seguimiento V2 | DONE | desplegada (`eee3bc2`) |

- **Rama `feat/v2.0.1-visual-v2`.** **Producción = `ffbfc09848d9a1410812e3b0bf2856dd459b3438`** (Experience V2 + Sprint 1 WOW: Training V3, Post-entreno V3, Home Alive; desplegado el 2026-10-04 con el canal `2j-prod`; rollback
  `8afe645`; backup previo `/root/backups/2jfitness-predeploy-e41f4f9-2026-10-04_165332.tar.gz`). `eee3bc2` también deja de versionar el runner generado.
  **Todo deploy nuevo requiere la frase exacta «Autorizo deploy».** Para el deploy usar el kit ya validado (`ops/deploy-kit` en
  `ops/deploy-automation`, canal `2j-prod`); no rediseñarlo. Al preparar el release: el delta de producción→HEAD es solo `frontend/src`
  + docs; el runner se deriva del de `4c78ecb` (ver su guard «producción es ancestro del target»).
### Sprint 3 — Health Native + privacidad + cifrado + hardening (2026-10-04; rama `feat/v2.0.1-visual-v2`; NO desplegado, producción `ffbfc09`)
- **Cierre Sprint 3 (decisiones aprobadas):** (1) **Chat cifrado** `chat.json` AES-GCM: lectura dual, migración atómica verificada al arrancar, modo solo-lectura si la clave falla (nunca pisa el fichero), rollback `api/scripts/decrypt-chat.mjs`. (2) **Clave separable:** `SECRET_FILE` (`lib/secret.js`, único lector), copia no destructiva desde `data/secret`, `scripts/separate-secret.sh`/`secret-export.sh`, mount `./secrets`; `docs/KEY_SEPARATION.md`. **Activación = paso de ops tras el deploy** (aún no activada). (3) **Trainer AI exige el consentimiento IA del socio** (`S.coach.consent`; 403 `consent`, no se envía nada). (4) **Exportar / borrar cuenta:** `GET /api/me/export`, `POST /api/me/delete(/options)` con passkey fresca + usuario escrito, solo socios (staff debe perder el rol), borrado en todos los almacenes, test que escanea todo `./data`; `docs/ACCOUNT_ERASURE.md`. (5) WebAuthn `preferred` y PIN Bunker 4 dígitos se mantienen (riesgo distribuido documentado en `docs/DATA_MAP.md`). (6) Backups externos: mecanismo listo, **esperando destino + passphrase** (nunca en git). (7) Android: keystore pendiente del propietario; checklist S25 en `docs/ANDROID_RELEASE.md`. (8) Smoke tests CSP: `docs/SMOKE_TESTS.md`. iOS sigue `READY_FOR_DEVICE_VALIDATION`.
- **Backups (revisión 2026-10-06):** scripts existentes; sin destino off-site ni passphrase aportados/configurados, no hay copia externa de producción confirmada ni cron verificado. La suite aislada `api/test/backup-offsite.test.js` pasó 4/4 con fixtures sintéticos: cifrado, checksum, restore a destino temporal, rechazo de passphrase incorrecta/corrupción y precondiciones. No se accedió ni modificó `data/` live. Falta ensayo de restore de una copia real y validación de JSON recuperado; la prueba actual usa un estado sintético opaco y `restore-backup.sh` solo valida checksum (si existe), gzip y presencia de `data/`.
- **BASELINE DE PRODUCCIÓN — INCONSISTENCIA ABIERTA (no resuelta aquí):** esta documentación dice producción = `ffbfc09`; el último deploy confirmado externamente es `d39ba0319387cc7c98722a4d9c24d26585f2bdf0`. Antes de cualquier deploy el runner debe leer PREDEPLOY_PRODUCTION del servidor y usarlo como única fuente de verdad (no los documentos).
- **Android release:** firma por `frontend/android/keystore.properties` (git-ignored) o `2J_KEYSTORE_*`; sin keystore compila sin firmar (`assembleRelease` + tests JVM OK). `allowBackup=false`. `scripts/android-release-hashes.mjs <SHA256> --apply` añade la huella a `assetlinks.json` y el hash a `webauthn-origins.js`. Guía exacta: `docs/ANDROID_RELEASE.md`. **BLOQUEADO por el propietario:** crear el keystore (comandos en la guía); validar login/Health en el APK release (10 min).
- **iOS/HealthKit:** `READY_FOR_DEVICE_VALIDATION` (`docs/IOS_HEALTHKIT.md`): el commit `1b29741` aplica limpio sobre HEAD (solo 8 ficheros nativos; JS ya idéntico), faltan Mac/Xcode/iPhone, Associated Domains + AASA para passkeys y revisión del pbxproj. No integrado.
- **Datos y privacidad:** `docs/DATA_MAP.md` (matriz por categoría). **Fix:** las notas privadas de sesión ya no viajan al proveedor de IA (`coach/payload.js`); test de privacidad (salud, WHOOP, composición, ids, notas, chat, social). Trainer AI no exige consentimiento del socio (diseño previo; decisión abierta).
- **Cifrado:** verificado: estado de usuario y credenciales en AES-GCM; `chat.json`, `db.json`, social y bunker en claro; la clave vive junto a los datos y dentro de los backups. Propuesta (no ejecutada): `docs/ENCRYPTION_PROPOSAL.md` (cifrar chat con lectura dual).
- **Auth/Bunker:** sesión HMAC HttpOnly+Secure+SameSite=Lax, 90 d, revocable (`sv`); rate-limit de auth y de PIN del Bunker (IP + credencial, bloqueo exponencial, tests existentes) CONFIRMADOS, sin cambios. Pendiente de decisión: `userVerification: 'preferred'` (WebAuthn) y PIN de 4 dígitos.
- **Headers:** `web/nginx.conf` añade CSP aplicada (script/default solo 'self'; Google Fonts como único externo; sin eval/inline script), Permissions-Policy y se mantiene HSTS/nosniff/Referrer/X-Frame. Probada con un servidor local con las mismas cabeceras en 13 rutas autenticadas: 0 violaciones. **Requiere reconstruir la imagen `web`** (el deploy normal ya lo hace).
- **Accesibilidad:** `user-scalable=no` eliminado; Toast con `role=status aria-live` (anuncia «descanso terminado»; el temporizador ya vibra/suena). **PWA:** caches del SW acotadas (assets 160, media 400); SW existente cubre shell/offline, sin Workbox. **Media:** 1324 GIF = 126 MB (media 95 KB, máx 233 KB), stills 12 MB; GIF solo bajo demanda, miniaturas lazy → sin cambio; conversión masiva = sprint aparte.
- **Backups:** `backup-data.sh` empaqueta todo `./data` (estados de usuario con Sync V2/Health/Gym Profiles, `guided.json`, stores Social/chat/notificaciones/Bunker, VAPID y uploads); los estados guardados desde el cifrado se protegen con AES-GCM, con compatibilidad para estados legacy en JSON. El tarball local queda sin cifrar, retención 14 días. `backup-offsite.sh` cifra con AES-256-CBC/PBKDF2 600k + salt, verifica descifrado/gzip, SHA-256 y transferencia; retiene 30 copias en destinos path/SSH (la ruta rclone no aplica esa poda); conserva 14 días locales cifrados. La cadencia prevista es cron diario 03:17 y guardia de disco 03:00, pero no está configurada/verificada. La passphrase debe estar en fichero 0600 fuera de `data/` y guardada aparte; nunca en Git/chat/logs. `.env` y `secrets/secret` quedan fuera: con `SECRET_FILE` separado, custodiar también el secreto de descifrado fuera del backup; por defecto `data/secret` sí queda dentro del tar y protegido por el cifrado off-site. Restore solo a directorio vacío/aislado; ver guía `docs/BACKUPS.md`. Pendiente operador: destino remoto y passphrase por canal seguro; luego activar cron, verificar `last-offsite.json`, restaurar copia real en temporal y validar JSON/estado con la API antes de declarar backups operativos.
- **Sync V2:** receipts acotados a 1000 (sin cambiar qué se aplica; un reintento antiguo da SYNC_CONFLICT, no doble aplicación). Tombstones/journal siguen sin poda (documentado).
- **Runner de deploy:** la excepción de código de salida ya estaba corregida en `ops/deploy-automation` (820b752); los dos últimos deploys terminaron limpios. Sin cambios.
- **Tests:** frontend, API, build, check-locales, diff-check al cierre (ver informe).

### Sprint 2 WOW — Progreso V3 · Mi 2J V2 · 2J Story (2026-10-04; DESPLEGADO en `d39ba03`; historial de versiones en `ffbfc09` (producción actual), rollback `d39ba03`)
- **Rama `feat/v2.0.1-visual-v2`.** Solo frontend, sin tocar Sync V2, Auth, Health, Social backend, Bunker, Workout, API, programas ni persistencia. Sin preferencias, insignias ni niveles nuevos.
- **Progreso V3:** portada `ProgressCover` al inicio de Progreso (Semana/Mes, entrenamientos en grande, minutos, volumen con % solo si hay periodo anterior real, PRs y racha en oro, músculos top, avance, peso solo con `uxOn('bodyweight')` y dos pesajes dentro del periodo). Periodo sin entrenos → portada calmada sin botón de Story. Orden acordado intacto (Composición → Peso; Zonas → Timeline). Zonas con barra hacia MRV (`v3-zone`, cálculo intacto); timeline con cabeceras de mes y racha como hito. Lógica pura en `lib/progress-v3.js` (`periodRange`, `periodSummary`).
- **Mi 2J V2:** `AthleteHero` (pasaporte: avatar, nombre, miembro desde, rango global o fila de bloqueo, entrenos / ejercicios con récord / logros), acciones «Crear mi 2J Story» y «Compartir racha», récords con evolución («antes X»), logros en grupos Recientes / Especiales (último de cada categoría) / Casi lo tienes, Explorar al final. Cada bloque sin datos desaparece; el miembro nuevo ve identidad + invitación. `Carnet` se conserva en Perfil.
- **2J Story:** `lib/story.js` (`buildStory`), `StoryCard` (9:16, paleta fija, sin blur) y `StorySheet` (semana/mes, vista previa, compartir/guardar con el motor de imagen existente `capturePng/sharePng/downloadPng`; no hay segundo motor). Elige lo que existe (≤4 stats). **Privacidad:** por defecto nunca peso, composición, Health, recuperación, WHOOP, restricciones, notas ni IDs; el peso solo con el interruptor «Incluir mi cambio de peso» (OFF por defecto, visible solo si admin+usuario lo permiten y hay dos pesajes). Ninguno de los tres módulos importa Health.
- **Tests:** `views/s2.test.jsx` (16: periodos/comparaciones, peso, periodo vacío, orden y OFF de Progreso, Story nuevo/avanzado, privacidad por código, pasaporte, CSS) + `adaptive.test.jsx` y `Mi2J.test.jsx` actualizados al nuevo diseño. Frontend 1230/1230, API 378/378, build OK, `check-locales` es 4221/4221.
- **QA:** revisado 375 px en preview (sin desbordes; corregido el selector Semana/Mes ilegible en tema claro). **Límites:** la Story se renderiza como imagen en el cliente (no hay enlace público); iconos de rango/logro dependen de las imágenes ya existentes; los 10 packs retrasados solo llevan las cadenas principales.
- **Sprint 2.1 (Ajustes premium + QA visual):** cristal líquido SIEMPRE activo (`LIQUID_GLASS` en `lib/format.js`; se ignoran `S.glass/glassOpacity/glassBlur` guardados, sin borrarlos; sin interruptor ni sliders). Color de acento = una fila con el color actual + `AccentSheet` (misma persistencia `S.accent`, cierra al elegir). Avanzado (datos, copias, reset) tras UNA entrada colapsable; títulos duplicados eliminados. QA: comparación «como a como» mientras el periodo está en curso (no 4 días vs un mes entero), marca de agua del pasaporte, botones primarios en glass legibles, vista previa de la Story escalada para verse entera, mes con mayúscula inicial. Tests `views/settings21.test.jsx`.
- **Deploy:** hecho con «Autorizo deploy» (DEPLOY_OK, health 200, sin rollback). Todo deploy nuevo requiere la frase exacta.

### Sprint 1 WOW — Entrenamiento V3 · Post-entreno V3 · Home Alive (2026-10-04; DESPLEGADO en `e41f4f9`)
- **Rama `feat/v2.0.1-visual-v2`** sobre producción `8afe645`. Solo frontend; motores (series, RPE, Series Feedback, Progressive Overload, supersets, descanso, guardado) intactos.
- **Adaptativo, nunca con huecos:** admin OFF → `uxOn` (sin cambios); preferencias de usuario (`S.workoutView`, `showExerciseImages`, RPE/feedback/overload existentes) → cada pieza nueva solo se renderiza si hay dato y está activa
  (sin imágenes no hay caja ni miniatura de «Después»; sin esfuerzo/feedback no hay bloque). Simple y Detallado siguen siendo dos presentaciones distintas de la misma sesión.
- **Entrenamiento V3:** `WorkoutProgress` (anillo de series + «Ejercicio x / y» + un punto por ejercicio, el superset es UN punto; los puntos saltan de ejercicio con el mismo `cur`), `NextUp` («Después: …» + miniatura solo con imágenes),
  Simple con imagen editorial más contenida (32 vh) y panel de serie actual grande (KG/REPS 38 px, CTA 56 px), Detallado con tarjeta de series suave, **superset agrupado** (raíl del color del grupo + conector en cadena),
  Series Feedback como 4 fichas táctiles con subrayado semántico, recomendación de progresión como tarjeta calmada, **RPE/RIR con valores rápidos** (6–10 / 4–0) sobre el slider (misma escala), descanso con **anillo + «Siguiente: serie 3 de 4 · ejercicio»** (glass, ±15 / pausa / saltar iguales).
  La fila del lugar y la sugerencia 2J contextual pasan debajo del progreso (la sesión va primero). Lógica nueva solo de lectura en `lib/training-v3.js`.
- **Post-entreno V3:** héroe a pantalla completa (oro SOLO con récord/logro mayor), duración / series / volumen grandes, chips de PR · racha · kcal con fuente · FC; tarjeta de PR, logros, mapa corporal y semana debajo; tarjeta de compartir con PR en oro.
- **Home Alive** (`lib/home-alive.js` + `HomeHero`): sesión en curso → progreso real de series; recién terminada → recap (series, volumen); **récord de las últimas 36 h** → banda dorada breve; día de descanso → «Próxima sesión · martes · Push» (de tu plan); programa activo ya como pastilla; seguimiento y 2J Intelligence siguen con sus condiciones.
- **Componentes nuevos:** WorkoutProgress, NextUp (+ `v3-training.css`, `lib/training-v3.js`, `lib/home-alive.js`); reutilizados: Ring/ProgressBar/Pill/Stat/CountUp (v2.jsx), AchievementCard, BodyMapPanel, EnergyBadge, tokens `--v2-*`.
- **Tests:** frontend 1214/1214 (+20 en `views/v3.test.jsx`), API 378/378, build y check-locales OK; 8 cadenas nuevas traducidas a los 10 packs retrasados. **QA:** 360 / 375 / tablet (DOM) en oscuro y claro.
- **Limitaciones:** capturas con imágenes de ejercicio rotas (sin red) → el recorte real de GIF/imagen no se pudo ver; el Detallado con RPE real y el flujo completo con backend solo con datos simulados; la miniatura de «Después» omite superset.
- **Siguiente:** Sprint 2 (Progreso V3, Mi 2J V2, 2J Story). **Todo deploy nuevo requiere «Autorizo deploy».**

- **Identidad V2 (no cambiar):** grafito oscuro; acento = `--acc` del socio (verde por defecto); oro SOLO para récords, logros e hitos
  (`--v2-gold`; en tarjetas social: record/achievement/streak); glass solo en sheets, `.center`, tabbar y composer del chat; movimiento
  150–250 ms, una vez, apagado con `prefers-reduced-motion`; targets ≥ 40 px; sin porcentajes ni scores inventados; `≈` solo en estimaciones.
- **Capa de diseño:** `src/v2.css` (tokens `--v2-*`), `src/v2-screens.css` (Home, post-entreno, Health, timeline, nav, glass), `src/v2-social.css`
  (Social + Seguimiento), `components/v2.jsx` (Surface, Pill, ProgressBar, Ring con modo estado, Sparkline, Skeleton, ListSkeleton, EmptyState,
  Stat, CountUp), `lib/motion.js`. Orden de import en `main.jsx`: index → v2 → v2-screens → v2-social.

### Fase 1 — Visual V2
- `HomeHero` (sesión de hoy + CTA + semana + anillos), `BodyMapPanel`, `PostWorkoutSummary` (presentación pura tras guardar), `AchievementCard`
  (PR/logro/insignia, paleta fija exportable), `ExerciseMeta`, `ProgressTimeline`, nav con cápsula, glass selectivo, microanimaciones.
- Preferencias: `activity` y `timeline` (admin `features.json` → `S.ux` → datos; admin OFF prevalece). `FEATURE_KEYS` = **15**, idénticas en
  `frontend/src/lib/features.js` y `api/lib/features-store.js` (test). Un runner/imagen que compruebe el nº de claves debe esperar 15.

### Fase 2 — Health V2 (solo presentación; privado)
- `lib/health-v2.js` (energía measured/aggregate/estimated, `healthState`, bloques, `muscleDetail`, `healthMoments`), `HealthOverview` (4 tiles + línea
  de estado), `EnergyBadge`, `IndicatorDetail`, `MuscleDetailCard`. Composición tiene UNA entrada (tile V2; los tiles Peso/Grasa/Músculo antiguos
  solo salen si el V2 está oculto por gates). Anillos sin % cuando no hay denominador real (Actividad siempre estado; Entreno sin plan).
- Política de kcal intacta: measured wearable > agregado oficial > estimación 2J; nunca se suman fuentes; proveedor solo si está guardado.
- Privacidad: ningún módulo Health importa social/share ni hace red; los componentes aceptan props planas para que Social comparta SOLO lo elegido.

### Fase 3 — Social V2 (las pantallas existentes, sin funciones nuevas ni backend)
- `Social.jsx` (`.v2-social`: cabecera en cápsula, tiles de acceso, pestañas en una fila desplazable, Marcas en oro, Desafíos en acento), `Friends.jsx`
  (solicitudes destacadas con Aceptar/Rechazar, buscador, vacíos con `EmptyState`), `Chat.jsx` (avatares, no leído = punto de acento + fecha),
  `ChatThread.jsx` (burbujas `.chat-msg`, separadores de día, composer glass anclado), `SocialMoments.jsx` (chip de tipo por momento: oro para
  record/achievement/streak, acento para el resto), `CommunityShareCard` repintada con la paleta V2 (solo CSS). Skeletons (`ListSkeleton`) en lugar de «Loading…».
- Reutilizado: onboarding Community existente (sin cambios), `StaffBadge`, `InternalShareActions`, tarjetas de share existentes. Permisos y protocolo intactos.

### Fase 4 — Seguimiento V2 (el sistema existente: `api/lib/followup.js`, `GET /api/followup`, `AdminFollowUp`)
- Socio: `FollowUpCard` (`lib/followup-view.js`: `useFollowUp`, `followUpView`) en Health y Progreso (completa) y en Home (compacta, solo si la revisión
  está a ≤ 7 días o vencida): próxima revisión, última, plantilla, peso desde la última revisión (solo con lectura base y posterior) y CTA «Añadir una medición».
- Staff: `AdminFollowUp` con `Surface`/`Pill`/`Stat`, alertas factuales, mediciones con delta neutro; `alertText` sigue exportado (test Health).
- Sin scores, riesgo ni readiness. Sin API nueva. Estados offline: la tarjeta no aparece.

- **Tests (cierre):** frontend 1194/1194 (v2 26, health-v2 24, social-v2 11), API 378/378, build y `check-locales` OK (es completo), `git diff --check` limpio.
- **QA:** 360 / 375 / tablet 768 / desktop, oscuro y claro (DOM + capturas). 360: la cabecera de Comunidad cabía mal → botones 36 px bajo 380 px.
- **i18n:** español completo; 39 cadenas clave de Experience V2 traducidas a de/fr/hi/it/ko/pl/pt/ru/tr/zh; el resto cae al inglés (`t()` nunca devuelve undefined).
- **Limitaciones:** las pantallas Social con datos reales solo se vieron con respuestas simuladas (sin backend en el preview); Workout no recibe tarjeta de
  seguimiento (no hay dato útil ahí); las cadenas largas nuevas de Health/Social siguen solo en español + inglés; tooling de deploy no tocado.
- **NO tocar:** Sync V2, Auth, bridge Health Android/iOS, política de kcal, `doFinishWorkout`, backends Social/Chat/Followup, permisos, contratos de datos.
- **Hecho para Codex:** traducir el resto de claves nuevas a los 10 packs; test de contraste de `--v2-*` en claro/oscuro; revisión Android del glass.

## 1. Estado actual (checkpoint 2026-10-01)

- **Ajuste UX + Admin IA (rama `feat/ux-ai-admin`, sobre `feat/adaptive-ux`; SIN desplegar):** Perfil: «Prioridades de entrenamiento» es una fila compacta que abre `/profile/priorities` (`views/TrainingPriorities.jsx`, mismos selectores y mismo guardado). Ajustes: Cuenta primero. Admin → «Inteligencia artificial» (`/admin/ai`, `views/AdminAI.jsx`): las 3 IA existentes (Coach, IA del panel de entrenador, IA auxiliar) con estado y «Configurar» que abre sus paneles actuales. Diagnóstico IA: el Coach funciona de extremo a extremo (proveedor fixture) y el runtime de Claude da razones exactas; no hay bug de código — un fallo con proveedor real es de credencial (reconectar desde la nueva pantalla). Tests: API `ai-admin.test.js` (7), frontend `ux-ai.test.jsx` (8).
- **Adaptive UX + Funciones de la app + personalización (rama `feat/adaptive-ux`, sobre `feat/news-avisos`; SIN desplegar):** admin ∩ socio ∩ datos. Servidor: `api/lib/features-store.js` + `features-routes.js`, `DATA/features.json` (13 módulos; ausente = todo ON; `GET /api/features` autenticado, `POST /api/admin/features` solo admin). Cliente: `lib/features.js` (`uxOn(S,key)` = admin permite ∧ socio no lo ocultó; `S.ux` null = sin personalizar = todo ON; `helps` solo del socio), estado `features` en el store (caché offline `gym_features_v1`). `views/ExperienceSetup.jsx` (onboarding de perfiles nuevos tras el wizard físico vía `S.uxSetup`, y `/settings/experience`), `views/AdminFeatures.jsx` (`/admin/features`), invitación discreta en Home para perfiles existentes. Home simplificado; recuperación/mapa/peso/pasos-meta/Whoop/aviso bioimpedancia pasan a Progreso (`components/ProgressModules.jsx`) con profundidad por datos; Perfil y Ajustes reagrupados. Gates: `effortOf`, `coachAvailable`, `workoutPrefs.progression`, IntelligenceToday, rutas con `<Feat>`, TabBar, watchers. Tests: API `features.test.js` (6), frontend `features.test.js` + `adaptive.test.jsx` (28). Ver CHANGELOG.
- **Noticias / Avisos 2J en Inicio (rama `feat/news-avisos`, sobre el release `1a403fe`; SIN desplegar):** contenido oficial server-side en `DATA/news.json` (`api/lib/news-store.js` + `news-routes.js`), separado de Sync V2. `GET /api/news` (socios autenticados, solo vigentes: activas y dentro de publishAt/expiresAt, por `order`); `GET /api/admin/news` y `POST /api/admin/news/{save,active,reorder,delete}` solo admin (trainer rechazado con 403). Texto plano con **negrita**, saltos de línea y enlaces https (parser en `lib/news.js`, se pinta como nodos React, nunca HTML); imagen opcional con el almacén privado existente (`/api/social/media`). Home: `components/NewsBlock.jsx` (nada si no hay vigentes, tarjeta compacta o carrusel con snap + indicador, copia offline por usuario). Admin → «Noticias / Avisos» (`views/AdminNews.jsx`, `/admin/news`). Tests: API `news.test.js` (10), frontend `news.test.js` + `NewsBlock.test.jsx` (13). El runner de despliegue habrá que regenerarlo (nuevo `news.json` en `data/` solo se crea al guardar la primera noticia). CHANGELOG actualizado (v1.4.0 candidata).
- **Sprint 5 Android + web (release preparado, validado; el despliegue final lo ejecuta el usuario):** producción de partida `4622505dd70d6e1c6ade43e54d03f6c5b622ab50` (b4e7baa + assetlinks.json con `get_login_creds`/`handle_all_urls` + Caddyfile con `Host app.2jfitnesscenter.com.` + `expectedOrigin` Android en el API). El release añade Health Native Bridge V2 (web + Android), reconciliación de energía, shell remoto Android con passkeys y el fix de idioma. **iOS/HealthKit queda FUERA** (rama `wip/ios-healthkit-v2`, pendiente de Mac/Xcode, iPhone y firma HealthKit). Detalle en §13c.

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

## 13c. Sprint 5 — Health Native Bridge, fase 1 (web; sin shell nativo)

`lib/health-bridge.js` + sección en `views/HealthIntegrations.jsx` (solo si existe `window.TwoJNative.health` o plugin Capacitor
`TwoJHealth`; si no, la pantalla no cambia). Contrato: `isAvailable / requestPermissions / readWorkouts({start,end})` de solo
lectura, agregados por entreno (nunca muestras de pulso). Privado por defecto: consentimiento local por dispositivo
(`health_bridge_v1:<uid>`), se pide permiso solo con un toque y la lectura exige consentimiento; ventana 30 d (máx 90),
máx 500 sesiones, sesiones saneadas/whitelisted (id obligatorio, duración ≤24 h, rango solicitado y rangos de kcal/FC).
Solo se adjuntan kcal/FC si el permiso opcional correspondiente fue concedido; una concesión sin `workouts` no habilita
la lectura. Consentimiento revocado mientras una lectura nativa está pendiente descarta su respuesta; cambio de cuenta
durante lectura/selección ambigua no adjunta datos a otra cuenta. `mapHealthConnectSession/mapHealthKitWorkout`,
`matchAll` conservador (ambiguos al selector manual) y `attachFitness` existente → `w.fitness` viaja por Sync V2 sin
cambios. Sin endpoints ni cambios de API/auth. Tests: `health-bridge.test.js` (19) + 1 en `Health.test.jsx`; frontend
1029/1029. **Fase Android (compilada localmente; sin prueba en teléfono):** plugin Capacitor local `TwoJHealth` (Kotlin, `frontend/android/.../health`), Health Connect solo lectura (READ_EXERCISE obligatorio; kcal y FC opcionales), `HealthContract.kt` (7 tests JVM verdes), adaptador JS en `health-bridge.js`; `minSdk` 26, compile SDK 36/AGP 8.10.1. `testDebugUnitTest` y `assembleDebug` pasan. **Decisión abierta:** el Capacitor actual es la app standalone sin backend/passkeys; para la app del gimnasio hace falta modo shell por URL y verificar passkeys en WebView. **Pendiente:** prueba en teléfono, resolver justificación/política de privacidad Health Connect y el alcance real de historial 30/90 días, iOS (HealthKit) y los plugins nativos Kotlin (Health
Connect) y Swift (HealthKit) en `frontend/android|ios`, permisos/privacy policy, declaración de Play Console y prueba en
dispositivo; ver `docs/HEALTH_NATIVE_BRIDGE.md`.

**Health Native Bridge V2 (Android + web listos para producción; iOS NO incluido):** lectura + escritura + actividad diaria con contrato común Android/iOS (`readActivity`, `requestWritePermissions`, `writeWorkout`); energía por prioridad medido > agregado > estimación 2J etiquetada (`lib/energy.js`, nunca se suma ni se escribe como medida); export idempotente por id `2j:<id>` y descarte de lo propio al releer; el fallo de export nunca afecta al entreno. Android compilado, con tests JVM y validado en hardware real (Galaxy S25 Ultra). iOS (`ios/App/App/Health`, `MainViewController`, entitlements, Info.plist, pbxproj editado a mano, `AppTests`) queda SIN commit y sin compilar: pendiente de Mac/Xcode, iPhone físico y firma HealthKit.
**Reconciliación de energía (Android validado en hardware real, desplegable):** prioridad = NO duplicar kcal. Se usa el AGREGADO oficial de energía activa del intervalo (nunca suma de registros, sin umbral de cobertura): cualquier energía externa > 0 → 2J no escribe y la muestra localmente como agregada. Android: con permiso de lectura y escritura y agregado realmente 0 tras ~15 min, escribe UNA estimación etiquetada `2j:<id>:kcal-est` (doble guardia justo antes) y la borra solo si luego aparece fuente externa. iOS: una lectura vacía es ambigua (HealthKit), así que NUNCA escribe kcal; el entreno se exporta sin kcal y la estimación se ve en 2J como ESTIMATED. Código: `lib/energy-reconcile.js` (cola local transitoria `health_energy_v1:<uid>`), plugins `readEnergy`/`writeEstimatedEnergy`/`deleteEstimatedEnergy` (esta pareja solo Android). Validación real en S25 Ultra: agregado 0 → escribe una sola muestra `2j:<id>:kcal-est`; agregado > 0 (WHOOP) → `external_available`; idempotente; `deleteEstimatedEnergy` borra solo lo propio; datos externos intactos. Nota: el agregado de Health Connect no cuenta la muestra de 2J mientras 2J no esté en la prioridad de fuentes del usuario (la guardia la excluye igualmente, sin riesgo de duplicado). Quedan fuera de alcance el borrado de sesiones 2J desde la app y todo iOS (la parte iOS de esta política —no escribir kcal— está escrita pero sin compilar ni commitear). Detalle en docs/HEALTH_NATIVE_BRIDGE.md.
**Shell remoto Android + passkeys (validado en S25 Ultra):** `frontend/capacitor.remote.config.json` (server.url = https://app.2jfitnesscenter.com, allowNavigation solo ese host) se copia a `android/app/src/main/assets/capacitor.config.json` antes de compilar el APK; la config standalone no cambia. `MainActivity` activa WebAuthn en el WebView (`WEB_AUTHENTICATION_SUPPORT_FOR_APP`, androidx.webkit 1.12.1). Requisitos de producción ya desplegados: `/.well-known/assetlinks.json` (get_login_creds + handle_all_urls, huella del certificado DEBUG), `Caddyfile` que atiende `Host: app.2jfitnesscenter.com.` (Google DAL lo usa con punto final) y `api/lib/webauthn-origins.js` (origin `android:apk-key-hash:<hash>` exacto, además del web; sin comodines; `ANDROID_APK_KEY_HASHES` para añadir el hash de release). Probado: login con passkey existente, sesión real, datos Sync V2 y TwoJHealth disponible. PENDIENTE antes de distribuir: keystore de release, su huella en assetlinks.json y su hash en `webauthn-origins.js`; el APK sideload actual es de depuración. Sync V2 y auth del servidor no cambian salvo la lista de orígenes.

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
