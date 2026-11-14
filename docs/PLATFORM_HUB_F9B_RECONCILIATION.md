# F9b · Conciliación Búnker ↔ Platform nuevo (2J Hub)

**Estado:** rama `agent/codex/F9b-platform-bridge` (base `39a74ea`). Todo **apagado por defecto**. No se tocan passkeys, `RP_ID`, `ORIGIN`, cookies de login, datos existentes, `docker-compose*`, `Caddyfile` ni `deploy-*.ps1`.

**Contrato que manda:** `2JHub/docs/contracts/platform-training-v2.md` (F9a, ya fusionado en Platform) y decisiones H-02, H-71 a H-79 de `2JHub/docs/decisions/HUB_DECISIONS.md`. La preparación anterior de Búnker (`api/platform-sso/`, `api/platform-proof/`) se pensó contra el Platform antiguo (`2j-platform`); este documento dice qué se reutiliza, qué se adapta y qué queda apagado sin tocar.

## 1. Inventario: lo que ya hace Búnker / lo que pide el contrato F9a / decisión

| Tema | Ya en Búnker (39a74ea) | Contrato F9a | Decisión F9b |
|---|---|---|---|
| Canje SSO | `POST /api/internal/platform/v2/sso/redeem` con `{v:2, code, verifier, audience:'2j-training-sso', purpose:'training-session'}`; espera `capabilities` dentro de la respuesta | `POST /api/internal/platform/v2/training-sso/redeem` con `{v:1, code, audience:'2j-training', destination:'bunker', correlationId}`; respuesta `ssoCodeRedemptionResponse` **sin** capacidades y ampliada con `displayName` y `assurance:'platform_sso'` | Cliente nuevo en `api/platform-hub/redeem-client.js` con el contrato F9a (emisor `2j-platform`, audiencia `2j-training`, propósito `training-sso`, destino `bunker`). Respuesta validada estricta (Zod), `correlationId` igual al recibido. El cliente antiguo **no se toca** (sigue sirviendo al flujo PKCE apagado). |
| Entrada del navegador | Variante PKCE: `GET /api/platform/v1/sso/start` (cookie `j2ssob`) → Home → `/sso#code=` → `POST /api/platform/v1/sso/redeem` (JSON, mismo origen) | Home hace **POST de formulario** (`application/x-www-form-urlencoded`, campos `code` y `correlationId`) al receptor, sin PKCE, `referrerpolicy=origin` (F9c punto 0; antes `no-referrer`) | Receptor nuevo `POST /api/platform/v1/sso/receive` (§3). La variante PKCE se queda **apagada y sin cambios**. |
| Capacidades | Cliente V2/V2.1 con caché hasta `expiresAt` (máx. 60 s), *circuit breaker*, reglas cruzadas, degradación segura (`api/platform-sso/capabilities.js`) | `GET /api/internal/platform/v2/persons/{personId}/training-capabilities`, payload V2 exacto | **Se reutiliza tal cual** (misma ruta, misma firma). El receptor exige una respuesta **verificada** (fresca o en caché válida; nunca degradada) antes de crear la sesión. |
| Firma de servicio entrante | `platform-proof/service-auth.js`: solo POST, ±60 s, allowlist de 8 rutas de proofs/enlace | `2J-SERVICE-AUTH-V1`, ±30 s, GET permitido, replay persistido, allowlist exacta, `keyId` dedicado | Verificador **nuevo** `api/platform-hub/service-auth.js` (GET y POST, ±30 s, allowlist exacta propia, claves `PLATFORM_HUB_INBOUND_KEYS`). Pasa los `SERVICE_AUTH_TEST_VECTORS` de `packages/contracts/src/training.ts` (copiados tal cual en el test). El verificador antiguo **no se modifica**. Replay: `store.acceptServiceRequest` (fichero persistido, compartido entre procesos) con ámbito `platform_hub`. |
| Aprovisionamiento | `POST /api/platform/v1/provision` (`PLATFORM_PROVISIONING_ENABLED`): pide `displayName`, `idempotencyKey` UUID; responde `{status:'provisioned', linkState:'pending'}` y exige un `activate` posterior | Misma ruta; `{v:1, personId, idempotencyKey (16–128), correlationId}` → `{v:1, status: created\|already_provisioned, personId, trainingUserId, linkStatus:'active', correlationId}`; sin PII | **Misma ruta, dos implementaciones:** con `PLATFORM_PROVISIONING_ENABLED` **y** `PLATFORM_TRAINING_BRIDGE_ENABLED` responde el handler nuevo (contrato F9a, verificador nuevo); si el puente está apagado responde el handler antiguo exactamente igual que hoy. Reutiliza `generateUsername` y la creación de usuario de `link.js`; el perfil nace con un nombre neutro («Socio 2J») que se sustituye por el `displayName` del primer canje SSO. Nace `enforced` con vínculo `active` (origen `hub_provisioned`). |
| Directorio | No existe | `GET /api/internal/platform/v1/training-users?query=` y `/{trainingUserId}` (propuesto v1) | Implementado (`PLATFORM_DIRECTORY_ENABLED`), firmado con el verificador nuevo, máx. 50 resultados, sin email/teléfono. Apagado → 404 idéntico al de una ruta inexistente. |
| Vínculo | Bilateral: `user.platformLink` con `pending/active/revoked` y `activate` firmado por Platform; unicidad en los dos sentidos; nunca por email | Platform es la autoridad (H-73: lo crea el personal desde Admin). **El contrato F9a no avisa a Búnker** de un vínculo manual ni de una revocación | En el primer canje SSO válido de un usuario **sin vínculo**, Búnker **adopta** el vínculo que firma Platform (origen `platform_admin`), solo si nadie más tiene ese `personId` y el usuario no tiene otro vínculo vivo (unicidad en los dos sentidos). Conflicto → error genérico, sin sesión. **Pregunta 2 para Juanjo.** |
| Sesión SSO | `newSsoSession`: registro revocable `via:'sso'`, 12 h, una viva por persona, `authLevel:'sso'` (nunca staff) | Sesión propia de Búnker; `platform_sso` nunca equivale a passkey | **Se reutiliza** `newSsoSession`; el registro añade `assurance:'platform_sso'`. |
| Reautenticación fuerte | `requireStrongAuth` rechaza `sso`; `requirePasskeySession`; `route-policy` deja fuera de `sso` passkeys, dispositivos, exportar/eliminar, webhooks, Strava/WHOOP y todo lo de staff | Definir y listar | Sin cambios de comportamiento; lista en §4 y test que la recorre con una sesión `sso`. |
| Puertas por capacidad | `platform-sso/route-policy.js` (todas las rutas clasificadas, test que falla con una ruta nueva sin clasificar), `gate()` central, `memberGate` (kiosco), `authorizeStateWrite` (contenido del estado) | Grupos A–F, en el servidor | **Se reutilizan.** Con `PLATFORM_ENFORCEMENT_ENABLED` se añaden: (a) acciones de **staff para un socio** en seguimiento profesional exigen el `professionalFollowUp` **del socio** (guard de rol intacto); (b) **conservar lo entregado por un entrenador** (programas oficiales asignados) en Básico: continuar/activar y cambiar su estado. |
| Modos por usuario | `legacy` (defecto) / `shadow` / `enforced`, transiciones solo por admin (`POST /api/admin/platform-enforcement`), H10 (fallo del puente no afecta a `legacy` ni anónimos) | Igual | Sin cambios. Los usuarios actuales siguen `legacy`; el alta automática nace `enforced`; los vinculados a mano siguen en su modo hasta que un admin los pase a `shadow` y luego `enforced`. |
| «Volver a Home» y aviso | No existe | H-72, H-79.1 | Franja en el frontend web (no Capacitor) solo con `PLATFORM_TRAINING_BRIDGE_ENABLED`: botón «Volver a Home» si la sesión es `sso` (no cierra la sesión) y aviso «cuota pendiente» si `accessState=provisional`. Textos en una única tabla `frontend/src/lib/platform-notices.js`. |

## 2. Interruptores (todos apagados por defecto)

| Variable | Qué enciende | Depende de |
|---|---|---|
| `PLATFORM_SSO_ENABLED` (ya existía) | Sesiones SSO en general | — |
| `PLATFORM_TRAINING_BRIDGE_ENABLED` | Receptor del formulario (`POST /api/platform/v1/sso/receive`), `GET /api/platform/v1/me/training-level`, `platformBridge` en `/api/config`, aprovisionamiento con el contrato F9a | `PLATFORM_SSO_ENABLED` para el receptor; `PLATFORM_API_BASE_URL`, `PLATFORM_API_KEY_ID`, `PLATFORM_API_KEY_SECRET` (salida: canje y capacidades); `PLATFORM_HOME_URL` |
| `PLATFORM_DIRECTORY_ENABLED` | Directorio de usuarios | `PLATFORM_TRAINING_BRIDGE_ENABLED`, `PLATFORM_HUB_INBOUND_KEYS` |
| `PLATFORM_PROVISIONING_ENABLED` (ya existía) | Aprovisionamiento | Con el puente: contrato F9a y `PLATFORM_HUB_INBOUND_KEYS`. Sin el puente: el de antes |
| `PLATFORM_ENFORCEMENT_ENABLED` | Puertas nuevas de F9b (staff→socio en seguimiento; conservación de programas entregados) | Usuarios en `shadow`/`enforced` |
| `PLATFORM_HOME_URL` (ya existía) | Origen de Home: «Volver a Home» y comprobación de `Origin` del receptor | — |
| `PLATFORM_HUB_INBOUND_KEYS` | Claves **de entrada** `{"keyId":"base64url≥32B"}` que usa Platform para llamar a Búnker (= `TRAINING_OUTBOUND_KEY_ID/KEY` de Platform) | — |
| `PLATFORM_API_KEY_ID` / `PLATFORM_API_KEY_SECRET` (ya existían) | Clave **de salida** de Búnker hacia Platform (debe estar en `TRAINING_SERVICE_KEYS` de Platform) | — |

Con todo apagado: ninguna ruta, respuesta ni comportamiento existente cambia (test `platform-hub-regression.test.js`).

## 3. Receptor del formulario

`POST /api/platform/v1/sso/receive` — responde siempre con redirección `303` (nunca JSON con datos), `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; no registra el cuerpo; límite 2 KB; solo `application/x-www-form-urlencoded` con exactamente `code` y `correlationId`.

Comprobación de procedencia (sin CORS) — **endurecida en F9c punto 0 (H-80):**
- Home envía el formulario con `referrerpolicy="origin"` (solo el origen, nunca la ruta; el código sigue solo en el cuerpo), así que el navegador manda siempre su `Origin` exacto.
- `Origin` debe ser **exactamente** el origen de `PLATFORM_HOME_URL`. `Origin: null`, ausente o cualquier otro (también del mismo sitio, o `cross-site` con *Fetch Metadata* válido) → rechazo genérico (`/sso#error=denied`), auditado como `platform_hub_sso_refused` con motivo `origin_rejected`, **antes** de canjear nada.
- Se retira el respaldo por *Fetch Metadata* (`Sec-Fetch-Site/Mode/Dest`) de este receptor: no distingue Home de otra web y dejaba abierto el *login CSRF* (R1).
- Hasta F9c, los eventos `platform_hub_sso_refused`, `platform_hub_service_refused`, `platform_hub_provision_conflict` y `platform_link_adopted` se emitían pero **no estaban en la lista blanca** de `api/lib/security-audit.js` y se descartaban sin registrarse; F9c punto 0 los añade (con su etiqueta en inglés y español).

Orden: canje servidor a servidor → `correlationId`, emisor, audiencia, `linkStatus:'active'`, `assurance` → usuario de Búnker existe, activo, no es admin de `ADMIN_UIDS` → vínculo (existente o adopción con unicidad) → **capacidades verificadas** por `GET …/training-capabilities`, pedidas de nuevo en cada entrada (se descarta la caché de esa persona; bloqueado → no) → solo entonces `newSsoSession`. Cualquier fallo: redirección a `/sso#error=denied` (o `unavailable` si Platform no responde), sin sesión, auditado (`platform_hub_sso_refused` con motivo técnico), datos intactos. Si el navegador ya tiene una sesión **de otra cuenta**, no se sustituye (`/sso#error=switch`). Si tiene una sesión passkey de la **misma** cuenta, se conserva (más fuerte).

## 4. Operaciones que exigen reautenticación fuerte (passkey) y nunca acepta `platform_sso`

Cambiar/añadir/borrar passkeys (`/api/me/passkeys*`), enlaces de dispositivo por QR (`/api/link/*`), ver sesiones de otros dispositivos y cerrar todas (`POST /api/logout/all`, `POST /api/me/sessions/revoke`), exportar y eliminar la cuenta (`GET /api/me/export`, `POST /api/me/delete*`), olvidar el Coach (`POST /api/coach/forget`), step-up (`/api/me/step-up`), webhooks, Strava y WHOOP, y **toda** la administración y funciones de staff (`/api/admin/*`, `/api/trainer/*`, `/api/bunker/admin*`, `/api/shared-*`, catálogos). Una sesión `sso` nunca lleva `admin`/`trainer`, aunque la cuenta lo sea. (Ya era así en `route-policy.js` y `requireStrongAuth`; F9b lo fija con un test.)

## 5. Niveles (H-74, H-78, H-79)

Búnker no calcula nada: aplica lo que Platform devuelve.
- **Básico** (`baseline`): entrenar por libre, registrar, historial, crear y gestionar sus rutinas; **conserva** las rutinas y programas que le dio un entrenador (leer, continuar, copiar y editar como personales). Sin Entrena con 2J, premium, Coach IA ni seguimiento profesional.
- **Autónomo**: + Entrena con 2J y premium. **Completo**: + Coach IA y seguimiento.
- **Cuota pendiente en plazo** (`provisional`): nivel pleno + aviso «cuota pendiente», sin bloquear.
- **Suspendido** (`blocked`/`ADMIN_SUSPENDED`): sin acceso; datos intactos.

## 6. Riesgos y preguntas (no decididas aquí)

- **R1 · Login CSRF del POST sin vínculo al navegador — CERRADO en F9c punto 0 (H-80).** Con `referrerpolicy=no-referrer` el navegador enviaba `Origin: null` y Búnker solo podía mirar `Sec-Fetch-Site`, que no distingue Home de otra web del mismo sitio. Ahora Home usa `referrerpolicy=origin` y el receptor exige el `Origin` exacto de `PLATFORM_HOME_URL` (§3). **La integración no se activa antes de este cambio** en los dos lados.
- **R2 · Vínculo manual que Búnker no conoce.** El contrato no avisa a Búnker de un vínculo creado en Admin ni de su revocación. F9b lo adopta en el primer canje firmado. → **Pregunta 2.** Si Platform revoca y luego vincula esa misma persona a **otro** usuario de Búnker, el primero conserva `personId` y el segundo da conflicto hasta que un admin de Búnker limpie el vínculo (F9d).
- **R3 · Programas oficiales entregados por un entrenador** se reconocen por estar ya en el estado del socio con `source:'guided-v2'` y un id creado en el servidor (no `g2jp-`). Los que el propio socio empezó con Autónomo no se pueden continuar en Básico.
- **R4** · `accessState=ended` para un vínculo inactivo (elección de F9a): aceptado sin cambios.

## 7. Pruebas

- `api/test/platform-hub-unit.test.js`: vectores `SERVICE_AUTH_TEST_VECTORS` copiados tal cual; verificador (±30 s exactos, allowlist, clave desconocida, query y cuerpo firmados); índice de vínculo; conservación de programas entregados (y que con el interruptor apagado es exactamente lo de antes).
- `api/test/platform-hub.test.js` (Platform falso que sigue el contrato F9a + servidor real de Búnker): flujo alta → formulario → canje → capacidades → sesión; idempotencia del alta; firma, replay, ±30 s y fuera de esquema; procedencia del formulario (F9c: origen correcto, otro origen, otro origen del mismo sitio, `null`, ausente, `cross-site` con Fetch Metadata válido pero origen ajeno, y que cada rechazo queda auditado); código usado/alterado/caducado; `correlationId`/emisor/audiencia/`assurance` incorrectos; usuario desconocido, persona de otro usuario, vínculo en conflicto, admin de entorno; suspendido/revocado/incoherente/Platform caído; dos canjes a la vez → una sesión; adopción de un usuario histórico (sigue `legacy`); sesión de otra cuenta no se sustituye; `platform_sso` frente a 17 operaciones de reautenticación/staff; puertas A–F por llamada directa; cuota pendiente; staff sin usar su propio derecho y acción para un socio; **regresión con todo apagado** (404 idénticos, `/api/config` sin cambios, alta antigua igual).
- `frontend/src/lib/platform-notices.test.js`: la franja no aparece con el puente apagado; «Volver a Home» solo en sesión SSO; tabla única de avisos con su texto en español.
- **Contrato cruzado con el Platform real** (2JHub `main` con F9a, Postgres de pruebas, servidor de Búnker real): alta automática real → formulario → canje → capacidades → sesión; código reutilizado rechazado; directorio real desde Admin → vínculo → entrada con adopción; suspensión en Platform → no se emite código. Prueba temporal fuera de los dos repos (descrita en el HANDOFF de 2JHub).
- Regresión: `cd api && npm test` → todo verde salvo `test/security-ops.test.js`, que ya fallaba en `39a74ea` en este PC (Windows: «isolated API did not report its bound port within 30000ms»), sin relación con F9b.

## 8. Qué queda para F9c / F9d

F9c: ajustes de Búnker en Ajustes de Home (H-76). F9d: importar passkeys a Platform y retirar el login de Búnker (H-02) con staging y vuelta atrás; limpiar vínculos adoptados obsoletos; decidir el destino del flujo PKCE y del canje antiguo.

## 9. F9c · Ajustes desde 2J Home y fin de vínculo (rama `agent/codex/F9c-hub-settings`)

Interruptor nuevo `PLATFORM_HUB_SETTINGS_ENABLED` (requiere `PLATFORM_TRAINING_BRIDGE_ENABLED`). Apagado: no hay rutas, ni fichero de cola, ni temporizadores, y el formulario sigue aceptando exactamente dos campos. Contrato: `2JHub/docs/contracts/platform-training-v2.md` §7.

**Inventario de Ajustes (H-76) y decisión:**

| Ajuste de Búnker | Dónde se guarda | ¿Desde Home? |
|---|---|---|
| Color de acento (`S.accent`, 11 colores) | estado sincronizado | **Sí** |
| Tema (`S.theme`: system/dark/light) | estado sincronizado | **Sí** (`appearance`) |
| Tamaño de texto (`S.textScale`: 0.9/1/1.15/1.3) | estado sincronizado | **Sí** (parte de «apariencia») |
| Avisos sociales (solicitudes, mensajes, compartido, retos, logros) | `notifications.json` | **Sí** |
| Push social del dispositivo (`push`) | `notifications.json` + suscripción del dispositivo | No: exige permiso en ese dispositivo |
| Privacidad social (perfil, actividad, récords, logros, rutinas, entrenos, retos) | `notifications.json` | **Sí** |
| Idioma, diagrama corporal (lo recibe el Coach), orden de Inicio/Progreso | estado sincronizado | No (no los pide H-76) |
| Entrenamiento y Salud (guía, esfuerzo, Apple Health, Health Connect, WHOOP, Strava), avisos de descanso | estado / proveedores | No: se quedan en Búnker (H-76) |
| Passkeys, dispositivos, webhooks, PIN, exportar y eliminar | cuenta | No: exigen passkey; Home lleva a Ajustes → Datos (`next=account`) |

**Cómo se aplica:** `api/platform-hub/settings.js`. Las listas de valores son las de Ajustes (`notifications/store.js` exporta ahora `PRIVACY_CHOICES`, `PRIVACY_FLAGS`, `PREFERENCE_KEYS` y sus `setPrivacy`/`setPreferences` las usan; acento/tema/tamaño tienen un test de deriva contra `frontend/src/lib/format.js` y `Settings.jsx`). Acento/tema/tamaño se escriben con `readState`/`writeState` en una lectura-escritura síncrona: sube la revisión del sync y un dispositivo con cambios viejos recibe `SYNC_CONFLICT` (nunca se deshace en silencio). Solo usuarios vinculados y activos, nunca staff ni `ADMIN_UIDS`. Evento `platform_hub_settings_changed` (cuántos campos y qué grupos, sin valores).

**Fin de vínculo:** `POST /api/me/delete` llama a `platformHub.erasure.before(user)` antes y a `.after()` solo si la eliminación terminó bien; `after` borra los registros del puente que nombran la cuenta (así una nueva alta para esa persona crea un perfil nuevo) y encola el aviso firmado (`api/platform-hub/link-end.js`). Entregas: `200` fuera de la cola (`platform_hub_link_end_sent`), `400/409` descartado (`platform_hub_link_end_dropped`), lo demás reintenta con espera creciente (30 s → 6 h, máx. 30 días).

**Riesgos / preguntas:** un perfil creado por alta automática **no tiene passkey**, así que hoy no puede exportar ni eliminar su cuenta en Búnker (F9d); si en una pantalla de conflicto de sync se elige «Conservar lo mío», ese dispositivo puede volver a poner su acento/tema anterior (elección explícita).

**Pruebas:** `api/test/platform-hub-settings.test.js` (servidor real + Platform falso: lectura/escritura con los almacenes reales, revisión del sync, lista blanca y valores fuera de rango, idempotencia, staff/no vinculado, firma/replay/±30 s/cuerpo alterado/método, `next`, eliminación real con passkey → aviso encolado, y con el interruptor apagado igual que F9b), `api/test/platform-hub-link-end.test.js` (cola: reintentos, mismo `eventId`, reinicio, descarte, nunca lanza) y `frontend/src/lib/platform-hub-settings.test.js` (deriva de listas). Prueba cruzada con el Platform real descrita en el HANDOFF de 2JHub.


## 10. F9d · Passkeys para 2J Hub y apagado del login de socios (rama `agent/codex/F9d-login-retire`)

**Contrato:** 2JHub `docs/contracts/platform-training-v2.md` §8. Dos interruptores nuevos, **apagados**, ambos además de `PLATFORM_TRAINING_BRIDGE_ENABLED`:

| Interruptor | Qué enciende |
|---|---|
| `PLATFORM_HUB_CREDENTIALS_ENABLED` | `GET /api/internal/platform/v1/training-users/{id}/credentials?personId=` firmado (verificador de F9b, ±30 s, replay, allowlist exacta). Solo socios vivos con vínculo `active` con **esa** persona; personal, `ADMIN_UIDS`, sin vínculo o desactivados → 404. Devuelve solo `credentialId`, `publicKey` (COSE), `counter`, `transports` conocidos, `createdAt` y `label`; nunca el id de usuario, el `userHandle`, PIN ni sesiones. Evento `platform_hub_credentials_read` (solo el número). |
| `PLATFORM_LOGIN_RETIRED` | Solo con `PLATFORM_SSO_ENABLED` y `PLATFORM_HOME_URL` (si no, inerte: nadie se queda fuera). Para socios con vínculo activo, `POST /api/login/verify` (después de verificar la aserción) y `POST /api/link/claim` responden `403 {code:'login_retired', homeUrl}` sin cookie; la web muestra «Entra desde 2J Home» con un enlace a Home. Evento `platform_login_retired_refused` (`kind: passkey|qr`). |

**Qué no cambia:** personal (entrenador/admin) y `ADMIN_UIDS` (F9e), socios sin vínculo (por defecto nada), PIN de sala y sesiones de dispositivo compartido, recuperación de cuenta (`/api/recover/*`), step-up, registro de perfiles nuevos y servicios internos. `RP_ID`, `ORIGIN` y cookies, igual. Las passkeys de Búnker **no se borran nunca en F9d**. Las sesiones passkey ya abiertas no se cierran.

**Exportar / eliminar (F9c):** una sesión `platform_sso` sigue sin satisfacer la passkey (§4) y la puerta SSO tampoco deja empezar el login por passkey desde esa sesión. Con `PLATFORM_LOGIN_RETIRED` encendido, un socio cuyo navegador solo tiene sesión SSO no llega a exportar ni a eliminar su cuenta (ni a gestionar passkeys o dispositivos); en un navegador con una sesión passkey de antes del cambio, sí (eliminar sigue pidiendo la passkey de Búnker). **Pendiente de Juanjo**; no se ha cambiado ninguna regla de F9b.

**Vuelta atrás:** apagar `PLATFORM_LOGIN_RETIRED` (y reiniciar) devuelve el login de hoy al instante; no hay migración ni datos tocados. Apagar `PLATFORM_HUB_CREDENTIALS_ENABLED` hace que la ruta vuelva a 404.

**Pruebas:** `api/test/platform-hub-login-retire.test.js` (servidor real + Platform falso: solo públicas y de esa persona, 404 para el resto, 400 por consulta, firma/replay/±30 s/otra persona firmada; socio vinculado → `login_retired` sin cookie y entra por SSO; sin vínculo, staff y `ADMIN_UIDS` siguen; QR también; todo apagado = F9c; sin SSO inerte; ida y vuelta con los mismos datos; exportar/eliminar con SSO y con sesión anterior) y `frontend/src/lib/login-retired.test.jsx`. Prueba cruzada con el Platform real en el HANDOFF de 2JHub.

## 11. F9d-2 · Exportar y eliminar con la passkey de 2J Hub (rama `agent/codex/F9d2-stepup-receiver`)

**Decisión (2JHub H-83):** el login vive en Platform; la passkey para **exportar** y **eliminar** la cuenta de Búnker se comprueba **en Platform** y Búnker confía en ese resultado. Contrato: 2JHub `docs/contracts/platform-training-v2.md` §9.

| Interruptor | Qué enciende |
|---|---|
| `PLATFORM_HUB_STEPUP_ENABLED` | Solo con `PLATFORM_TRAINING_BRIDGE_ENABLED` y `PLATFORM_SSO_ENABLED`. Ruta `POST /api/platform/v1/stepup/receive` (si no, no existe → 404), `stepUp` en `GET /api/platform/v1/me/training-level` (si no, el campo no aparece) y la excepción cerrada de abajo. |

**Receptor** (`api/platform-hub/stepup.js`, mismo endurecimiento que el SSO): `Origin` exacto de `PLATFORM_HOME_URL`, `application/x-www-form-urlencoded`, ≤ 2 KB, `no-store`, el cuerpo nunca se registra, limitador de intentos del SSO. Dos formas cerradas: `stepupCode` + `stepupCorrelationId` (exige una sesión **ya abierta de esa misma cuenta**; sin sesión u otra cuenta → rechazo) o esas dos + `code` + `correlationId` (código SSO de F9b: se aplican **todas** sus comprobaciones —vínculo, capacidades verificadas, nunca sustituir la sesión de otra cuenta— y solo se escribe si el step-up también es válido). El código de step-up se canjea firmado (`POST /api/internal/platform/v2/training-stepup/redeem`, `api/platform-hub/stepup-client.js`, esquema estricto); la respuesta debe traer `assurance: platform_passkey`, propósito de la lista cerrada, el mismo `correlationId` y **la misma persona y usuario de Búnker** que la sesión. Personal y `ADMIN_UIDS` → rechazo. Todo fallo: `/sso#error=…`, sin sesión nueva ni autorización, evento `platform_hub_stepup_refused` (motivo técnico).

**Autorización:** en memoria, ligada al **cookie exacto** de esa sesión (hash), a la cuenta y a un propósito; 5 min; **un solo uso** (se gasta al descargar o al borrar); un reinicio la pierde (falla cerrado). Evento `platform_hub_stepup_granted` / `_used`.

**Excepción cerrada** (lo único que cambia): con una autorización viva de su propósito, una sesión `sso` puede llamar a `GET /api/me/export` (una descarga) y `POST /api/me/delete` con `{confirm: <usuario>, platformStepUp: true}` (sin aserción de Búnker; el nombre de usuario escrito sigue haciendo falta; uno erróneo no gasta la autorización). La decide `platform-hub/stepup.js` (`STEPUP_ROUTES`) y la aplican el distribuidor (`requireStrongAuth`) y la puerta SSO (`gate(…, {stepUp})`). Las otras 17 operaciones de §4 siguen respondiendo `passkey_required` con o sin autorización (test). Una sesión passkey de Búnker funciona exactamente igual que antes.

**Web:** Ajustes → Datos muestra «Confirmado con tu passkey de 2J…» en la fila de la operación autorizada; la hoja de eliminar no pide la passkey de Búnker si la autorización es de `delete`. Nuevas cadenas en `es.js`.

**Con esto encendido** deja de existir el hueco de §10 (socio con solo sesión SSO sin poder exportar/eliminar), condición para encender `PLATFORM_LOGIN_RETIRED`.

**Vuelta atrás:** apagar `PLATFORM_HUB_STEPUP_ENABLED` (y reiniciar): la ruta desaparece, las autorizaciones vivas se pierden y exportar/eliminar vuelven a F9d. Sin datos ni migraciones.

**Pruebas:** `api/test/platform-hub-stepup.test.js` (servidor real + Platform falso: exportar una vez; perfil sin passkey elimina su cuenta y se encola el fin de vínculo; Origin/tipo/campos; sin sesión, otra cuenta, otra persona; código usado, repetido y a la vez; respuestas fuera de contrato; personal y `ADMIN_UIDS`; caducidad a los 5 min y reinicio; las 17 operaciones siguen cerradas con la autorización; `platform_sso` solo no vale; apagado = F9d) y `frontend/src/lib/platform-stepup.test.jsx`. Prueba cruzada con el Platform real en el HANDOFF de 2JHub.

