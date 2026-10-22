# Búnker ↔ Platform: preparación de identidad, SSO y capabilities

**Estado: preparación local; no activa integración.** Snapshot auditado: `a7678b864ca404cb38c13706d780e659c47f214a` (`origin/main`, 2026-10-21). Este documento y los contratos asociados no registran rutas, no cambian sesiones, no migran cuentas y no aplican derechos en producción.

## Límites de identidad

- Platform es autoridad de `personId`, membresía, cuota, derechos y fecha efectiva de bloqueo.
- Training conserva `uid`/`trainingUserId`, passkeys, sesiones, rutinas, programas, entrenamientos, progresión e historial. `personId` no sustituye `uid`, no inicia sesión y no autoriza por sí mismo.
- La base ya acepta `db.users[].personId` como metadato opcional; no autogenera ni infiere el valor. El login actual y las passkeys siguen ligados a Training.
- No cambiar `ORIGIN`, `RP_ID`, credenciales WebAuthn, cookies ni rutas de login actuales.

## Mapa de rutas y servicios

La tabla agrupa los handlers actuales por capability futura. Los nombres son rutas/módulos encontrados en este snapshot; el gate indicado es diseño para una futura implementación y **no existe aún**. Cada gate operativo debe comprobarse en el API para que llamar directamente a la ruta no lo eluda. La autenticación/ownership actual sigue siendo necesaria además de la capability.

| Grupo | Rutas/servicios actuales y ubicación | Auth/ownership actual observado | Capability futura y punto de gate | Riesgo si solo se oculta en UI |
|---|---|---|---|---|
| A · Entrenamiento propio | `GET /api/data`, `PUT /api/data`, `POST /api/workouts/delete` (`api/server.js`); `POST /api/active/activity`, `/api/active/clear`, `POST /api/bunker/handoff`, `GET /api/bunker/pin`, `POST /api/bunker/pin/reset` (`api/bunker/routes.js`) | Cookie `gymsid` resuelta por `readSession`; estado propio ligado al `uid`. Handoff/clear/PIN son operaciones explícitas de Bunker/sesión | `training.access` como prerequisite; `training.self_routines` para crear/editar/eliminar rutinas propias. Gate en API después de resolver la sesión y usuario objetivo | Un cliente puede invocar `PUT /api/data`, delete o handoff directamente y seguir escribiendo/entrenando |
| B · Búnker/Kiosco | `POST /api/bunker/checkin`, `/api/bunker/admin-checkin`; `GET /api/bunker/session`, `/api/bunker/admin/session`, `/api/bunker/board`, `/api/bunker/settings`, `/api/bunker/admin/sessions`, `/api/bunker/admin/members`; `POST /api/bunker/verify-launch`, `/api/bunker/active`, `/api/bunker/rest`, `/api/bunker/finish`, `/api/active/finish-inactive`, `/api/bunker/admin/close`, `/pause`, `/edit-set`, `/pin-reset`, `/room-key/reset`, `/settings` (`api/bunker/routes.js`) | Check-in con PIN/room key; admin-checkin con rol/código staff; token firmado propio de Bunker para sesión activa; rutas de administración usan el guard/credencial correspondiente (varios handlers `guardAdmin`); panel de sala y settings tienen controles distintos | `training.access` del **socio** antes de emitir/activar una sesión de socio. Lecturas/mutaciones de la sesión del socio vuelven a comprobarlo. UI pública de sala no equivale a acceso a datos de miembro. Staff usa rol actual, no su cuota | Los endpoints de check-in y sesión son invocables aparte de la pantalla; ocultar QR/botón no bloquea sesión nueva ni operaciones existentes |
| C · Guided / Entrena con 2J | `api/lib/guided-routes.js`, `guided-store.js`; `GET /api/guided`, `GET /api/guided/history`, `POST /api/guided/{save,duplicate,active,status,delete,curate,restore,reorder,program/curate,program/save,program/duplicate,program/delete,collection,collection/delete}` | Sesión Training; operaciones de catálogo con guards staff/admin según handler; estado personal separado por `uid` | `training.guided_2j` en lectura/activación/duplicación/uso de contenido oficial para miembro; publicar/curar catálogo conserva su ACL admin/staff actual | Las rutas API permiten acceso aunque la tarjeta de Train2J no se pinte |
| C · Premium / Oposiciones | `api/lib/premium-routes.js`, `premium-store.js`, `api/lib/opposition-routes.js`; `GET /api/premium`, `/program`, `/history`; `POST /api/premium/{started,save,duplicate,status,feature,reorder,promote,delete,restore}`; `GET/POST /api/opposition*` | Sesión del usuario para su estado; rutas de catálogo/administración tienen guards staff/admin; switch `premium` es condición adicional existente | `training.premium` para el socio sobre contenido/estado Premium y Oposiciones que reutiliza ese motor. Mantener también el switch del gimnasio y auth/ownership existentes | Llamadas directas pueden leer/alterar `S.premium` o `S.opposition` sin pasar por UI |
| D · Coach / IA del socio | `api/coach/routes.js`: `GET /api/coach/{disclosure,status}`, `POST /api/coach/{plan,review,intelligence/explain,pending/resolve,forget}`; `api/lib/scan-routes.js`: `POST /api/scan/{start,cancel}`, `GET /api/scan/status`; `api/coach` services | Sesión Training; consentimiento específico para usos externos donde aplica; validación y protocolo existentes | `training.ai` en backend antes de trabajos, lectura de estado de jobs y uso de IA del socio. Consentimiento/protocolo siguen siendo gates independientes | Peticiones directas evitan el bloqueo visual; consentimiento y capability no se sustituyen entre sí |
| D · IA de entrenador | `api/coach/trainer-routes.js` (`/api/trainer/ai/*`) | `requireTrainer`, membership access y reglas del entrenador; configuración de proveedor va por rutas admin separadas | No es `training.ai` del socio ni depende de la cuota personal del trainer. Es función staff. Si la operación se ejecuta para un socio, decidir/validar la capability objetivo sin quitar el guard de rol | Ocultar el botón al trainer no impide invocar la ruta. No mezclar esta IA con Coach del socio |
| E · Seguimiento profesional | `GET /api/followup`, `GET /api/followup/records`, `/questionnaires`, `/photo`; `POST /api/followup/questionnaire/submit`, `/photo`; `/api/trainer/followup/{overview,member,records}` y `POST /api/trainer/followup/{start,goal,note,note/delete,decision,flag,analyze}`; `/api/admin/user/followup*`, `/measurements`, `/review`, routine cycles/reviews. Implementación en `api/lib/followup-v2-routes.js`, `coach-followup-routes.js`, `followup-v2.js`, `api/server.js` | Socio autenticado para su propia información; `requireTrainer`/`requireAdmin` y `memberFor` para acciones profesionales sobre socio; consentimiento y controles de fotos existentes | `training.professional_followup` del socio objetivo en endpoints profesionales. El rol de entrenador/admin sigue comprobándose por separado; no consultar la cuota propia del staff | El API expone lecturas y escrituras aunque el panel o sección se oculte |
| F · Staff | `/api/trainer/members`, assign/member routine/program, versions y `api/bunker/routes.js` admin/kiosk handlers; catálogo/config admin | `requireTrainer`, `requireAdmin`, `guardAdmin`, tokens/kiosk y `memberFor` según operación | Las funciones propias del staff no dependen de las capabilities de su propia cuenta. Cuando una acción se hace para un socio, aplicar la capability de ese socio correspondiente; preservar roles, permisos, auditoría y admin-only | Los guards de rol siguen siendo obligatorios; entitlement no convierte trainer en admin ni autoriza otros socios |

`GET /api/bunker/board`, `/api/bunker/settings` y `/api/bunker/verify-launch` son superficies de kiosco/room, no el login de socio. Antes de modificar su acceso hay que conservar sus credenciales y revisar su mínimo de información; no meterlos en un gate de cuenta global por coincidencia de prefijo.

### Modelo de capabilities aprobado

El archivo `contracts/platform-training-entitlements-v1.json` conserva literalmente la matriz aprobada. `training.access=false` hace falsas las otras cinco capabilities. El snapshot fechado y versionado viaja desde Platform; Training valida identidad vinculada, estado, revisión, timestamps y expiración y falla cerrado ante snapshot ausente, inválido, expirado, revocado o contradictorio. Platform decide la caducidad/frescura permitida y emite la nueva revisión; Training no calcula cuotas ni pagos.

| Perfil emitido por Platform | access | self_routines | guided_2j | premium | ai | professional_followup |
|---|---:|---:|---:|---:|---:|---:|
| Fuerza vigente | sí | sí | sí | sí | sí | sí |
| Otra cuota vigente | sí | sí | sí | sí | no | no |
| Sin cuota vigente | no | no | no | no | no | no |

En sin cuota, se preservan identidad y datos. El acceso mínimo de pago/contacto vive en Home/Platform, no en rutas de entrenamiento. El día 10 completo se considera vigente hasta 23:59:59.999 Atlantic/Canary; Platform emite bloqueo desde el día 11 00:00 local si el pago sigue impagado. Training nunca vuelve a calcular esa frontera.

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
3. Búnker canjea el code servidor-servidor con Platform. Platform verifica emisor, audience, destino, TTL, un solo uso y firma/request auth; devuelve `personId` y estado del vínculo. Training resuelve el vínculo activo, cuenta existente/no deshabilitada y snapshot vigente; cualquier falta/conflicto/revocación => fail-closed.
4. Tras éxito, Training crea una sesión Training normal con sus propios cookies/claims/rotación/revocación. No comparte cookies entre dominios ni acepta que el code sea una sesión. Passkeys y login actual permanecen válidos y sin cambios.
5. El canje y el consumo son atómicos ante dos requests concurrentes: máximo una redención y una sesión; el replay obtiene error genérico. Caducado, consumido, audience/issuer/destino incorrectos, code modificado, personId desconocido, vínculo ausente/revocado o cuenta borrada/deshabilitada nunca crean sesión.

No implementar ahora. El contrato precisa una decisión antes de la sesión real: el modelo de sesión actual acepta `passkey` o PIN y no debe falsear un SSO como una autenticación por passkey. Definir la clase/assurance del nuevo claim SSO y qué operaciones de strong reauth exige, sin debilitar las actuales.

## Autenticación entre servidores

Reutilizar el receptor `api/platform-proof/service-auth.js` y protocolo `2J-SERVICE-AUTH-V1` ya existente: `POST` a ruta allowlisted exacta; key ID; timestamp UTC; request ID UUID único; HMAC-SHA256 sobre versión, key ID, timestamp, request ID, método, ruta exacta y SHA-256 de los bytes originales del body; comparación timing-safe; frescura actual de ±60 s y replay persistido de 2 min. El body autenticado debe contener idempotency key/contexto; `requestId` anti-replay no reemplaza idempotency.

Para rutas nuevas se requiere allowlist exacta + switch default-off + esquema estricto, clave/`keyId` rotatoria dedicada por propósito cuando se configuren, protección contra replay compartida entre procesos y red interna/TLS. No reutilizar cookie, token de usuario o passkey; ningún secreto entra en frontend. La implementación de hoy solo permite tres rutas específicas de proof/summary: provisionamiento/SSO no están permitidos por la allowlist ni implementados.

## Dependencias que debe entregar Platform

- `personId` estable, no reciclable, y estado explícito del vínculo activo/revocado.
- Emisor de capabilities con matriz aprobada, `revision` monótona, `issuedAt`, `expiresAt`, estado operativo y `reasonCode` estable; renovación/revocación y plazo de frescura acordado.
- Semántica de bloqueo/revocación y canal de entrega (push interno o consulta autenticada) con garantía de consistencia y `correlationId`.
- Endpoint de provisionamiento interno e idempotente; política de key rotation y reintentos.
- Canje SSO atómico de un solo uso: issuer/audience/destination/purpose, expiración, errores genéricos y contrato de respuesta firmado/autenticado.
- Eventos/consulta de baja, unlink, cuenta borrada/disabled y reconciliación para reparar fallos sin matching por PII.
- Platform define la ventana de frescura del snapshot y aplica exclusivamente la regla de impago: último día 10 hasta 23:59:59.999 Atlantic/Canary; bloqueo día 11 a 00:00 si no hay pago confirmado.

## Preparación de pruebas

`api/test/platform-integration-contract.test.js` es un modelo de referencia **solo de test** para cerrar las transiciones propuestas sin registrar rutas ni mutar stores reales. Sus simulaciones comprueban provisioning (idempotencia, respuesta perdida, conflictos, no takeover por email, auth y replay), ownership link (prueba válida/incorrecta/replay/expirada y unicidad), SSO (single-use, carrera concurrente, TTL/contexto/issuer/audience, tamper, link ausente/revocado, sesión Training propia sin alterar passkeys) y matriz/gate backend (incluido bypass UI). No sustituye tests de conformidad contra Platform ni pruebas de la futura implementación real.

Antes de activar una sola ruta, portar esos casos al store/rutas reales, añadir contract test cruzado con Platform, pruebas de concurrency multi-proceso, revocación y sesión/strong-reauth, y comprobar que fallos conservan todos los datos existentes.

## Estado

- **Hecho en este snapshot:** campo `personId` opcional no autoritativo; proofs Platform existentes default-off y autenticación `2J-SERVICE-AUTH-V1`; sesiones/passkeys Training actuales.
- **Preparado aquí:** mapa por capability, matriz aprobada, JSON Schemas, contrato de provisionamiento/link/SSO, límites de auth, matriz de dependencias Platform y modelo de test aislado.
- **Pendiente:** endpoint de provisionamiento; vínculo activo con unicidad/revocación; snapshot consumible; checks backend para capabilities; emisión/canje SSO; clase de assurance de sesión SSO; coordinación/contrato del repo Platform.
- **Bloqueado por decisiones/dependencias:** perfil mínimo requerido al provisionar; freshness/revocación máxima del snapshot; assurance/strong-reauth de SSO; endpoints y emisión de capabilities del Platform real.

Nada en esta preparación cambia RP ID, usuarios, rutas existentes, login, producción, ni el enforcement de entitlements.
