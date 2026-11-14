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
