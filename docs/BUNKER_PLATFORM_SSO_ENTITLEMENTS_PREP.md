# Búnker ↔ Platform: preparación de identidad, SSO y capabilities

**Estado: preparación local; no activa integración.** Búnker/Training auditado en `a7678b864ca404cb38c13706d780e659c47f214a`; Platform V2 verificado en `2j-platform` `origin/main` `e4b6218f02d24f9c78d7670252d68474cfea2232` (contrato introducido por merge `94d40806ba402a05f29652f7211c0eccabd326ef`, PR #59). Este documento y los contratos asociados no registran rutas en Training, no cambian sesiones, no migran cuentas y no aplican derechos en producción.

## Límites de identidad

- Platform es autoridad de `personId`, membresía, cuota, derechos y fecha efectiva de bloqueo.
- Training conserva `uid`/`trainingUserId`, passkeys, sesiones, rutinas, programas, entrenamientos, progresión e historial. `personId` no sustituye `uid`, no inicia sesión y no autoriza por sí mismo.
- La base ya acepta `db.users[].personId` como metadato opcional; no autogenera ni infiere el valor. El login actual y las passkeys siguen ligados a Training.
- No cambiar `ORIGIN`, `RP_ID`, credenciales WebAuthn, cookies ni rutas de login actuales.

## Mapa de rutas y servicios

La tabla agrupa los handlers actuales por capability futura. Los nombres son rutas/módulos encontrados en este snapshot; el gate indicado es diseño para una futura implementación y **no existe aún**. Cada gate operativo debe comprobarse en el API para que llamar directamente a la ruta no lo eluda. La autenticación/ownership actual sigue siendo necesaria además de la capability.

| Grupo | Rutas/servicios actuales y ubicación | Auth/ownership actual observado | Capability futura y punto de gate | Riesgo si solo se oculta en UI |
|---|---|---|---|---|
| A · Entrenamiento propio | `GET /api/data`, `PUT /api/data`, `POST /api/workouts/delete` (`api/server.js`); `POST /api/active/activity`, `/api/active/clear`, `POST /api/bunker/handoff`, `GET /api/bunker/pin`, `POST /api/bunker/pin/reset` (`api/bunker/routes.js`) | Cookie `gymsid` resuelta por `readSession`; estado propio ligado al `uid`. Handoff/clear/PIN son operaciones explícitas de Bunker/sesión | V2 distingue `autonomousTraining`, `personalRoutineCreation`, `personalRoutineManagement`, `workoutRecording` y `workoutHistory`. El acceso de la persona objetivo se resolvería en API tras auth/ownership; hoy no hay gate de capabilities | Un cliente puede invocar `PUT /api/data`, delete o handoff directamente y seguir escribiendo/entrenando |
| B · Búnker/Kiosco | `POST /api/bunker/checkin`, `/api/bunker/admin-checkin`; `GET /api/bunker/session`, `/api/bunker/admin/session`, `/api/bunker/board`, `/api/bunker/settings`, `/api/bunker/admin/sessions`, `/api/bunker/admin/members`; `POST /api/bunker/verify-launch`, `/api/bunker/active`, `/api/bunker/rest`, `/api/bunker/finish`, `/api/active/finish-inactive`, `/api/bunker/admin/close`, `/pause`, `/edit-set`, `/pin-reset`, `/room-key/reset`, `/settings` (`api/bunker/routes.js`) | Check-in con PIN/room key; admin-checkin con rol/código staff; token firmado propio de Bunker para sesión activa; rutas de administración usan el guard/credencial correspondiente (varios handlers `guardAdmin`); panel de sala y settings tienen controles distintos | `autonomousTraining` de la **persona socia** sería el prerequisite de acceso; capabilities del staff no sustituyen sus roles. Suspensión administrativa bloquea operación, sin borrar link ni datos. El gate aún no existe en runtime | Los endpoints de check-in y sesión son invocables aparte de la pantalla; ocultar QR/botón no bloquea sesión nueva ni operaciones existentes |
| C · Guided / Entrena con 2J | `api/lib/guided-routes.js`, `guided-store.js`; `GET /api/guided`, `GET /api/guided/history`, `POST /api/guided/{save,duplicate,active,status,delete,curate,restore,reorder,program/curate,program/save,program/duplicate,program/delete,collection,collection/delete}` | Sesión Training; operaciones de catálogo con guards staff/admin según handler; estado personal separado por `uid` | `guidedTraining` en lectura/activación/uso comercial; crear/gestionar rutinas propias se autoriza por separado con `personalRoutineCreation`/`personalRoutineManagement`. Publicar/curar catálogo conserva su ACL actual | Las rutas API permiten acceso aunque la tarjeta de Train2J no se pinte |
| C · Premium / Oposiciones | `api/lib/premium-routes.js`, `premium-store.js`, `api/lib/opposition-routes.js`; `GET /api/premium`, `/program`, `/history`; `POST /api/premium/{started,save,duplicate,status,feature,reorder,promote,delete,restore}`; `GET/POST /api/opposition*` | Sesión del usuario para su estado; rutas de catálogo/administración tienen guards staff/admin; switch `premium` es condición adicional existente | `premiumPrograms` para acceso Premium del socio, manteniendo el switch del gimnasio y auth/ownership actuales | Llamadas directas pueden leer/alterar `S.premium` o `S.opposition` sin pasar por UI |
| D · Coach / IA del socio | `api/coach/routes.js`: `GET /api/coach/{disclosure,status}`, `POST /api/coach/{plan,review,intelligence/explain,pending/resolve,forget}`; `api/lib/scan-routes.js`: `POST /api/scan/{start,cancel}`, `GET /api/scan/status`; `api/coach` services | Sesión Training; consentimiento específico para usos externos donde aplica; validación y protocolo existentes | `aiCoach` en backend antes de trabajos, lectura de estado de jobs y uso de IA del socio. Consentimiento/protocolo siguen siendo gates independientes | Peticiones directas evitan el bloqueo visual; consentimiento y capability no se sustituyen entre sí |
| D · IA de entrenador | `api/coach/trainer-routes.js` (`/api/trainer/ai/*`) | `requireTrainer`, membership access y reglas del entrenador; configuración de proveedor va por rutas admin separadas | No es `aiCoach` del socio ni depende del derecho personal del trainer. Es función staff. Si la operación se ejecuta para un socio, evaluar la capability V2 de esa persona sin quitar el guard de rol | Ocultar el botón al trainer no impide invocar la ruta. No mezclar esta IA con Coach del socio |
| E · Seguimiento profesional | `GET /api/followup`, `GET /api/followup/records`, `/questionnaires`, `/photo`; `POST /api/followup/questionnaire/submit`, `/photo`; `/api/trainer/followup/{overview,member,records}` y `POST /api/trainer/followup/{start,goal,note,note/delete,decision,flag,analyze}`; `/api/admin/user/followup*`, `/measurements`, `/review`, routine cycles/reviews. Implementación en `api/lib/followup-v2-routes.js`, `coach-followup-routes.js`, `followup-v2.js`, `api/server.js` | Socio autenticado para su propia información; `requireTrainer`/`requireAdmin` y `memberFor` para acciones profesionales sobre socio; consentimiento y controles de fotos existentes | `professionalFollowUp` del socio objetivo en endpoints profesionales. El rol de entrenador/admin sigue comprobándose por separado; no consultar el derecho propio del staff | El API expone lecturas y escrituras aunque el panel o sección se oculte |
| F · Staff | `/api/trainer/members`, assign/member routine/program, versions y `api/bunker/routes.js` admin/kiosk handlers; catálogo/config admin | `requireTrainer`, `requireAdmin`, `guardAdmin`, tokens/kiosk y `memberFor` según operación | Las funciones propias del staff no dependen de las capabilities de su propia cuenta. Cuando una acción se hace para un socio, aplicar la capability de ese socio correspondiente; preservar roles, permisos, auditoría y admin-only | Los guards de rol siguen siendo obligatorios; entitlement no convierte trainer en admin ni autoriza otros socios |

`GET /api/bunker/board`, `/api/bunker/settings` y `/api/bunker/verify-launch` son superficies de kiosco/room, no el login de socio. Antes de modificar su acceso hay que conservar sus credenciales y revisar su mínimo de información; no meterlos en un gate de cuenta global por coincidencia de prefijo.

### Contrato de capabilities Platform V2

`contracts/platform-training-capabilities-v2.schema.json` replica el esquema de `2j-platform/contracts/2J-capabilities-v2.schema.json`; `contracts/platform-training-capabilities-v2.json` contiene la matriz de perfiles de referencia para esta preparación. El payload es `2J-CAPABILITIES-V2`, `version: 2`, ligado a `personId` y a `trainingSubject`. No es el contrato SSO, que sigue siendo diseño separado y sin activar.

| Estado V2 | Autónomo | Rutinas personales crear/gestionar | `routineCreation` comercial | Workouts/historial | Guided/Premium | IA/seguimiento profesional |
|---|---:|---:|---:|---:|---:|---:|
| Baseline libre, sin membresía | sí | sí | no | sí | no | no |
| Derechos comerciales `autonomous` activos o provisionales | sí | sí | sí | sí | sí | no |
| Derecho Fuerza `full` activo o provisional | sí | sí | sí | sí | sí | sí |
| Derecho comercial impagado o finalizado, vínculo activo sin suspensión | sí (vuelve al baseline) | sí | no | sí | no | no |
| Suspensión administrativa | no | no (acceso operativo suspendido) | no | no (acceso operativo suspendido; datos retenidos) | no | no |

`personalRoutineCreation` y `personalRoutineManagement` son capacidades distintas de `routineCreation`. No se debe poner la creación/gestión de una rutina propia detrás del derecho comercial `routineCreation`. El nivel `baseline` es diferente de `autonomous`: este último describe el nivel comercial activo y añade `routineCreation`, `guidedTraining` y `premiumPrograms`; el baseline libre no los concede.

Los estados provisionales conservan el nivel comercial emitido (`full` o `autonomous`) con `accessState=provisional` y el `reasonCode` correspondiente. La fixture contractual de Platform incluye ambos casos, junto con derecho impagado/finalizado que vuelve al baseline.

Solo una persona Platform activa con vínculo Training activo recibe capabilities operativas. V2 admite una persona sin facet de cliente (por ejemplo, persona externa legítimamente registrada) y no requiere membresía actual para el baseline. El payload de capabilities no prueba cómo fue autorizada el alta: no crea invitaciones, no implementa Home ni abre autorregistro público.

Platform V2 distingue `trainingSubject.linkStatus=not_linked` de `revoked`; ambos bloquean capabilities, pero no son suspensión administrativa. El wire contract no tiene estado `pending`: un vínculo inexistente, aún no resuelto o en conflicto no puede conceder baseline hasta que Platform emita `active`; `revoked` se conserva como estado separado. `accessState=suspended`, `suspensionStatus=suspended` y `reasonCode=ADMIN_SUSPENDED` representan una suspensión administrativa, independiente de membresía, pago, fin contractual y vínculo. Una suspensión no revoca el Training link ni elimina identidad, rutinas, medidas o historial. Al levantarla se recalculan los derechos comerciales vigentes o vuelve el baseline.

El contrato V2 NO incluye `revision`, `issuedAt`, `operationalStatus`, `issuer` ni `audience` dentro del payload. No inventar ni exigir una revisión monótona. La respuesta incluye `generatedAt` y `expiresAt`, con máximo técnico de 60 segundos y recorte hasta la siguiente transición comercial conocida en horario `Atlantic/Canary`. Se solicita por `GET /api/internal/platform/v2/persons/{personId}/training-capabilities`, autenticado mediante `2J-SERVICE-AUTH-V1`, y el endpoint devuelve `Cache-Control: no-store`. No aceptar versiones/campos incompatibles ni respuesta inválida; fallar cerrado. Una indisponibilidad autenticada solo permite reutilizar una respuesta cacheada hasta su `expiresAt`; después se bloquea.

Platform conserva la autoridad de derechos comerciales y cálculo 098E; Training no recalcula pagos ni vencimientos. Una membresía ausente, terminada o impagada no es suspensión: el vínculo activo no suspendido vuelve al baseline libre. El día 10 completo sigue vigente hasta 23:59:59.999 `Atlantic/Canary`; el bloqueo comercial derivado por Platform empieza el día 11 a las 00:00 local.

### Decisiones funcionales aprobadas D276–D282

El dossier aprobado para PR #59 contiene estas decisiones en su idioma original. Se preserva aquí su texto literal; debajo se separa el estado verificable de Platform y del consumidor Búnker.

**D276** — “Búnker can be used for autonomous training even without an active membership.” Un usuario autorizado, registrado y no suspendido conserva entrenamiento autónomo, creación/gestión de rutinas personales, registro de workouts, consulta del historial y sus datos. Platform lo representa con `capabilityLevel=baseline`; la persona debe tener Training link activo.

**D277** — “Previously delivered professional routines remain usable after leaving the gym.” Al terminar derechos profesionales/comerciales, las rutinas ya entregadas siguen disponibles y utilizables, pueden copiarse/modificarse como personales y el historial permanece; solo cesan servicios profesionales nuevos que requieran derechos activos. Platform no almacena rutinas: la retención y copia corresponden al consumidor Búnker y siguen pendientes de prueba E2E.

**D278** — “External users who have never been 2J clients may register only through a valid invitation.” La invitación no está representada como prueba en el payload de capabilities V2 y el flujo de alta sigue pendiente.

**D279** — “Invitations may be generated only by: Administrators; Trainers explicitly granted the specific permission. Do not grant invitation capability to all Trainers by default.” La generación de invitaciones no se implementa aquí; el permiso explícito por Trainer depende de 2J-098C.

**D280** — “Invited-user registration happens through Home using unified identity.” El registro unificado desde Home sigue pendiente E2E; estos contratos no habilitan registro público.

**D281** — “If an external Training user later becomes a 2J client, authorized staff performs the client enrollment while preserving: canonical person identity; Training identity/link; routines; workout history; other retained data.” Platform mantiene persona y facetas separadas; falta verificar el flujo de inscripción extremo a extremo y la conservación de datos Training.

**D282** — “Administrators and Trainers explicitly granted the appropriate permission may suspend Búnker access for misuse.” La suspensión es independiente de membresía, pagos, vínculo y fin de contrato; exige motivo, autorización de servidor y auditoría, conserva identidad/rutinas/medidas/historial, se puede levantar y recalcula capabilities actuales. Platform implementa el ciclo Admin-only con `training.suspension.manage`; la concesión granular a Trainers espera 2J-098C.

## Aprovisionamiento servidor-servidor

Contrato candidato descrito en `contracts/platform-training-integration-v1.schema.json` (`provisionRequest`/`provisionResponse`); endpoint aún no existe.

1. Home crea identidad; Platform genera un `personId` estable.
2. Platform llama a un endpoint privado de Training autenticado entre servidores. La solicitud estricta lleva `personId`, `idempotencyKey`, `correlationId` y versión; no usa email/nombre/teléfono como clave ni permite elegir un `trainingUserId` arbitrario.
3. Training crea el perfil mínimo mediante su servicio de creación actual, conserva/genera su propio `trainingUserId` y devuelve el vínculo estable. Platform lo persiste.
4. Un retry con la misma clave y mismo cuerpo devuelve el mismo resultado. Misma clave con cuerpo diferente, `personId` ya asociado a otro Training ID, `trainingUserId` ya reclamado o conflicto de store => conflicto genérico, auditado y fail-closed. Nunca crear segundo perfil tras respuesta perdida.
5. Solo se guardan claves/hash de idempotencia y auditoría mínima necesaria; no copiar secretos de Platform ni PII innecesaria a logs.

La solicitud no define aún qué campos visibles mínimos requiere el perfil actual (p. ej. nombre mostrado). Resolverlo con Platform antes de codificar el provisionado, sin usar coincidencia de email para enlazar cuentas.

## Vinculación de cuentas ya existentes

- Estados del vínculo: `unlinked`, `pending`, `active`, `revoked`, `conflict`; solo `active` sirve para SSO/capabilities.
- El usuario demuestra propiedad **dentro de Training** mediante la sesión actual con nivel passkey y un challenge de Platform con `transactionId`, `personId`, `audience`, `purpose`, digest de challenge y caducidad corta. Training emite una prueba aleatoria opaca y guarda solo su hash; el canje autenticado por servicio produce una constancia verificable.
- Existe ya preparación de proofs apagada por defecto: `POST /api/platform/v1/link-proofs` requiere `readSession` con `authLevel === 'passkey'`; `/exchange` y `/reconcile` usan `2J-SERVICE-AUTH-V1`, store cifrado, audiencia/purpose fijos, TTL corto y replay protection. Reutilizar este flujo/almacenamiento; no cambiar RP ID. La constancia actual **no es por sí sola un vínculo activo con exclusión mutua/revocación**.
- El futuro vínculo activo debe tener unicidad transaccional en ambos sentidos: un `trainingUserId` activo por `personId`, y un `personId` activo por Training user. El registro opcional `db.users[].personId` no constituye el índice/lock de vínculo completo. Conflicto o store no disponible => no vincular.
- Prohibido auto-link por email, nombre, teléfono, username, historial, IP o dispositivo. Coincidencia solo puede guiar al usuario a iniciar prueba explícita, nunca ser prueba.
- En auditoría guardar actor/servicio, tipo de acción, IDs opacos, resultado y `correlationId`; no guardar proof code, passkey material ni perfil completo.

## SSO Home/Platform → Búnker (diseño; apagado)

1. Platform autenticado genera un code aleatorio de al menos 256 bits, TTL máximo propuesto de 60 s, de un uso, ligado a issuer fijo `2j-platform`, audience fija `2j-training`, purpose `training-sso`, `personId`, destino `bunker` y `correlationId`. Platform conserva solo hash y consume atómicamente.
2. El navegador envía el code a una página/receptor de Búnker mediante POST HTTPS en el cuerpo, nunca en URL, query, fragmento, logs ni referrer. Respuesta `Cache-Control: no-store`; no credenciales de sesión dentro del code.
3. Búnker canjea el code servidor-servidor con Platform. Platform verifica emisor, audience, destino, TTL, un solo uso y firma/request auth; devuelve identidad/vínculo. Por separado, el servidor Training obtiene la respuesta actual de capabilities V2 mediante el endpoint HMAC Platform; no se inventa ni se incrusta un snapshot V1 en la respuesta SSO. Falta, conflicto, revocación, payload inválido o snapshot vencido => fail-closed.
4. Tras éxito, Training crea una sesión Training normal con sus propios cookies/claims/rotación/revocación. No comparte cookies entre dominios ni acepta que el code sea una sesión. Passkeys y login actual permanecen válidos y sin cambios.
5. El canje y el consumo son atómicos ante dos requests concurrentes: máximo una redención y una sesión; el replay obtiene error genérico. Caducado, consumido, audience/issuer/destino incorrectos, code modificado, personId desconocido, vínculo ausente/revocado o cuenta borrada/deshabilitada nunca crean sesión.

No implementar ahora. `platform_sso` MUST NEVER tratarse como autenticación passkey: el modelo de sesión actual acepta `passkey` o PIN y un SSO no puede falsear una verificación WebAuthn ni satisfacer strong reauth. Definir la clase/assurance del claim SSO y operaciones que exigen reautenticación, sin debilitar las actuales.

## Autenticación entre servidores

No confundir el verificador ya existente de Training para sus rutas de proofs (`api/platform-proof/service-auth.js`) con el cliente/verificador servidor-servidor que requerirá consumir capabilities. El protocolo contractual Platform `2J-SERVICE-AUTH-V1` firma key ID, timestamp, UUID request ID, método, ruta canónica y hash SHA-256 de body con HMAC-SHA256, comparación constante y protección anti-replay; el endpoint V2 verifica frescura de ±30 s y replay persistido. El verificador de proofs Training tiene sus propios límites actuales (±60 s y replay de 2 min) y no debe modificarse ni asumirse idéntico. La respuesta V2 usa `no-store`; su vigencia es máximo 60 s, recortada a transición conocida. `requestId` anti-replay no reemplaza idempotency.

Para rutas nuevas se requiere allowlist exacta + switch default-off + esquema estricto, clave/`keyId` rotatoria dedicada por propósito cuando se configuren, protección contra replay compartida entre procesos y red interna/TLS. No reutilizar cookie, token de usuario o passkey; ningún secreto entra en frontend. La implementación de hoy solo permite tres rutas específicas de proof/summary: provisionamiento/SSO no están permitidos por la allowlist ni implementados.

## Dependencias reales de integración pendientes

- Consumidor backend Training del endpoint V2: servicio de salida, configuración segura de clave, binding de persona/link, política de caché hasta `expiresAt`, y gates por endpoint; hoy solo existe referencia de test, sin runtime.
- Provisionamiento y vínculo activo con unicidad/revocación en ambos lados; no auto-link por PII.
- Invitaciones D278/D279 y registro unificado de Home D280, incluida autorización explícita para invitadores.
- Redención SSO, sesión Training propia y decisión de assurance/strong-reauth; nunca equiparar `platform_sso` a passkey.
- Inscripción posterior a cliente D281 conservando `personId`, Training link y todos los datos.
- Consumer Búnker de D277 que mantenga rutinas profesionales ya entregadas y permita continuarlas/copiar/editar como personales; requiere E2E porque Platform no aloja rutinas.
- Concesión granular de `training.suspension.manage` / permiso de invitación a Trainers solo con 2J-098C; el rol Trainer actual no los obtiene por defecto.

Los nombres/campos V2, el endpoint, auth de servicio, TTL de 60 s, recorte a transición y autoridad comercial 098E ya están implementados en Platform y no son dependencias pendientes.

## Preparación de pruebas

`api/test/platform-integration-contract.test.js` es un modelo de referencia **solo de test** para cerrar las transiciones propuestas sin registrar rutas ni mutar stores reales. Sus simulaciones comprueban provisioning (idempotencia, respuesta perdida, conflictos, no takeover por email, auth y replay), ownership link (prueba válida/incorrecta/replay/expirada y unicidad), SSO (single-use, carrera concurrente, TTL/contexto/issuer/audience, tamper, link ausente/revocado, sesión Training propia sin alterar passkeys) y matriz/gate backend (incluido bypass UI). No sustituye tests de conformidad contra Platform ni pruebas de la futura implementación real.

Antes de activar una sola ruta, portar esos casos al store/rutas reales, añadir contract test cruzado con Platform, pruebas de concurrency multi-proceso, revocación y sesión/strong-reauth, y comprobar que fallos conservan todos los datos existentes.

## Estado

- **Hecho en este snapshot:** campo `personId` opcional no autoritativo; proofs Platform existentes default-off y autenticación `2J-SERVICE-AUTH-V1`; sesiones/passkeys Training actuales.
- **Preparado aquí:** mapa por capability, referencia del JSON Schema V2 real y matriz V2; contrato de provisionamiento/link/SSO de diseño; límites de auth; trazabilidad INT; modelo de test aislado. `api/test/platform-integration-contract.test.js` sigue siendo modelo de referencia y no consumidor runtime.
- **Implementado en Platform, no conectado aquí:** endpoint interno de lectura V2 y lifecycle de suspensión. El endpoint acepta persona activa y facet de cliente opcional, exige vínculo activo para baseline, usa auth de servicio, `no-store` y TTL hasta 60 s.
- **Pendiente de integración E2E:** invitación/Home (D278–D280), conservación de rutinas entregadas en consumidor Búnker (D277), enrolamiento que preserve persona/link/datos (D281), consumidor Training/Búnker real de capabilities y comprobación server-side, SSO y assurance de sesión. La autorización explícita de suspensión/invitación a Trainer depende de 2J-098C.
- **No pendiente de decisión:** nombres/campos/TTL del contrato de capabilities V2, free baseline, separación de derechos comerciales y suspensión administrativa; están definidos por Platform.

Nada en esta preparación cambia RP ID, usuarios, rutas existentes, login, producción, ni el enforcement de entitlements.
