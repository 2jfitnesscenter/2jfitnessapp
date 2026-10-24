# H13 — Activación asistida de vínculos Búnker↔Platform (DISEÑO + CONTRATO, sin fusionar)

Estado: **decisiones del propietario adoptadas (§10), revisión 2 (permiso específico, solicitud+aprobación, step-up también para ascender a admin).** Rama `agent/claude/2J-H13-ASSISTED-LINK` sobre #57. Se implementará detrás de un flag, **desactivado por defecto**, y **no se fusiona** sin orden del propietario. La implementación espera además al resultado de la consulta de solo lectura de administradores en producción.

## 1. Problema
Hoy Búnker solo acepta activar un vínculo (`POST /api/internal/platform/v1/link/activate`) con **evidencia propia**: `origin:'proof'` (recibo de que el dueño de la cuenta demostró control con su passkey) u `origin:'provisioned'`. Una cuenta histórica cuyo dueño no puede hacer la prueba (perdió el dispositivo, no usa Home) queda sin vincular. La cola de revisión de Platform (#81) decide *quién es la persona*, pero Búnker no puede aceptarla como evidencia: eso cubre H13.

## 2. Principio
La activación asistida es una **tercera forma de evidencia propia de Búnker**: la emite una persona con un **permiso específico** (no el flag general de administrador), con **step-up de passkey en cada emisión**, doble control con Platform y **auditoría append-only**. Nunca se infiere (ni nombre, ni e-mail, ni teléfono).

## 3. Quién puede (permiso específico)
Se crea el permiso **`platform_link_issue`** («emitir vínculos asistidos de Búnker»).
| Quién | Puede |
|---|---|
| **Juanjo Pérez (propietario)** y **Pedro Guerra (gerente de la empresa)** — solo estos dos, concedido de forma explícita | **Emitir** (aprobar) recibos asistidos |
| Cualquier otro personal (administradores `admin:true`, entrenadores, recepción) | **Solicitar** una activación asistida; **no** pueden emitirla. Ser admin general **no** concede el permiso |
| El propio socio, Platform | No emiten (Platform solo consume el recibo) |

- **Dónde se concede:** únicamente por configuración del servidor, `PLATFORM_LINK_ISSUERS=<uid1>,<uid2>` (igual que `ADMIN_UIDS`): **ninguna ruta de la API puede conceder, ampliar ni quitar el permiso**, así que nadie puede dárselo a sí mismo ni un admin comprometido puede ampliarlo. Cambiar la lista exige acceso al servidor y queda en el registro de despliegue.
- **Pedro debe tener su propia passkey registrada** en Búnker antes de poder emitir (sin passkey → 403 `passkey_required`). No se comparten credenciales ni sesiones.
- Quien emite **no puede** emitir para su propia cuenta ni para la del otro emisor (la aprueba el otro titular o se rechaza).
- **Step-up en cada emisión:** verificación de usuario con passkey en el momento (no vale una sesión ya iniciada, ni PIN/kiosco, ni sesión SSO de Platform). Un step-up vale para **una** emisión.
- **Límite:** 20 emisiones por emisor y día (contadas en el ledger).

## 4. Flujo (solicitud → aprobación → activación)
1. **Platform (#81):** un administrador de Platform aprueba «la persona P corresponde a la cuenta Búnker U» (queda en su registro, con `reviewId`). Platform no activa todavía.
2. **Solicitud (Búnker, cualquier personal):** `POST /api/admin/platform-link/assist-requests` crea una solicitud `{requestId, personId, trainingUserId, reasonCode, note≤80, requestedBy}`. Solo registra la petición; no emite nada.
3. **Aprobación = emisión (Búnker, solo titular del permiso):** el titular ve la solicitud (id opaco de P y la cuenta U; nada más), confirma con **step-up de passkey** y Búnker crea el **recibo asistido** (§5), de un solo uso y 24 h de vigencia. Un titular puede también emitir directamente sin solicitud previa. La solicitud queda `approved` o `rejected` (con motivo).
4. **Activación:** Platform ejecuta su `link/activate` normal con `origin:'admin_assisted'`, `receiptId` y `reviewId`. Búnker solo acepta si existe un recibo **vigente, no consumido, exactamente para (personId, trainingUserId)** y llega el `reviewId` de la aprobación de Platform. Cualquier discrepancia → `409 proof_required`.
5. El recibo queda consumido (no reutilizable) y se registra `platform_link_activated` con `origin:'admin_assisted'`.

Sin los dos lados (Platform y Búnker) no hay vínculo.

## 5. Contrato Búnker (todo desactivado por defecto)
**Flag:** `PLATFORM_ASSISTED_LINK_ENABLED=false`; apagado, todas las rutas devuelven 404 y `link/activate` rechaza `origin:'admin_assisted'`.

**Solicitud** `POST /api/admin/platform-link/assist-requests` (personal autenticado, no socios): `{ "v":1, "personId":"<uuid>", "trainingUserId":"<id>", "reasonCode":"lost_device|no_home_access|support_request|other", "note":"<=80" }` → `201 {requestId}`; `409` si P o U ya tienen vínculo `pending|active` o hay una solicitud abierta.

**Aprobación/emisión** `POST /api/admin/platform-link/assist-requests/:id/approve` (o `/issue` directo con el mismo cuerpo): solo `PLATFORM_LINK_ISSUERS` + step-up. `201 {receiptId, expiresAt}`; `403 {code}`: `not_issuer`, `step_up_required`, `passkey_required`, `own_account`; `429` límite diario; `409` conflictos; `404` desactivado. Rechazo: `.../reject`.

**Ascender a administrador** (`POST /api/admin/user/role` con `role:'admin'`, y la ruta obsoleta `/trainer` cuando devuelva admin): exige **step-up de passkey del administrador que lo hace** (nuevo `403 step_up_required`). Degradar no lo exige. Queda en el log de seguridad.

**Recibo asistido** (en el store cifrado de `platform-proof`): `{ receiptVersion:2, kind:'admin_assisted', receiptId, personId, trainingUserId, issuedBy, requestId?, reasonCode, issuedAt, expiresAt (≤24 h), consumedAt:null }`, claves estrictas.

**`link/activate`:** `origin` admite `'admin_assisted'`; exige `receiptId` y `reviewId`; misma autenticación 2J-SERVICE-AUTH-V1, un vínculo por persona y por cuenta, ids de petición de un solo uso. Cuenta `disabled` → no se emite.

**Revocación:** igual que hoy; el recibo consumido no se rehabilita.

## 6. Auditoría append-only
`lib/security-audit.js` es una lista acotada (3000 eventos) en `db.json`: no sirve. Se crea un **ledger propio**:
- Fichero de solo añadir (`platform-link-ledger.jsonl`, `chmod 600`), una línea por evento, **encadenada por hash** (`prev` = SHA-256 de la línea anterior) y firmada con HMAC con una clave de servicio aparte (`KEY_SEPARATION.md`).
- Eventos: `assist_requested`, `assist_approved`, `assist_rejected`, `assist_denied` (con causa), `assist_consumed`, `assist_expired`, `link_activated`, `link_revoked`, `admin_promoted` (con el step-up).
- Campos: `eventId`, `at`, `actorId`, `personId`, `trainingUserId`, `receiptId`, `requestId`, `reviewId`, `reasonCode`, `result`. **Nunca** notas libres con datos personales, tokens, IP ni user-agent.
- Sin rutas ni funciones para editar o borrar. El arranque verifica la cadena; si se rompe, **se desactiva la emisión** y falla el healthcheck. Incluido en el backup diario.

## 7. Amenazas
| Riesgo | Control |
|---|---|
| Un admin general o entrenador/recepción abusa | No tienen el permiso; solo solicitan |
| Cuenta de un titular robada | Step-up de passkey en cada emisión, 20/día, doble control con Platform, un solo uso, 24 h, ledger |
| Alguien se concede el permiso | Solo por configuración del servidor; ninguna ruta lo modifica |
| Un admin se ascendió a sí mismo o a un cómplice | Ascender a admin exige step-up y queda en el ledger |
| Vincular a la persona equivocada | Platform decide P (cola #81), Búnker decide U; deben coincidir en (P, U) y en `reviewId` |
| Reutilizar/robar un recibo | Un solo uso, ligado a (P, U), solo vale con llamada firmada por Platform |
| Pedro sin passkey o compartida | Se exige passkey propia; sin ella no emite |
| Ledger manipulado | Cadena de hash + HMAC, verificación al arrancar |

## 8. Pruebas exigidas antes de dar por buena la implementación
Por rol: propietario, Pedro, admin general (solicita, no emite), entrenador, recepción, socio, PIN/kiosco, SSO · permiso inexistente aunque `admin:true` · sin passkey · sin step-up / step-up reutilizado · emisión sobre cuenta propia o del otro titular · tope 20/día (el 21º → 429) · recibo caducado/usado/de otra pareja · `reviewId` ausente · doble solicitud · cuenta deshabilitada · ascender a admin sin step-up (403) y con step-up (200, en el ledger) · ledger: cadena rota, truncado, intento de edición → emisión desactivada · flag apagado (404 y `origin` rechazado) · corpus 2J-SERVICE-AUTH-V1 con `origin:'admin_assisted'`.

## 9. Parte de Platform (tarea pequeña aparte)
Exponer `reviewId` estable al aprobar en #81 y enviarlo en `link/activate`; reintentar con espera si Búnker responde `proof_required`; no activar sin recibo de Búnker. Requisito previo para producción: autenticación real de personal en Platform.

## 10. Decisiones del propietario (adoptadas)
1. Doble control Platform + Búnker.
2. Recibo válido 24 h.
3. 20 emisiones por emisor y día.
4. Motivos: `lost_device`, `no_home_access`, `support_request`, `other`.
5. **Revisión 2:** el permiso `platform_link_issue` es específico (no el flag admin) y lo tienen solo Juanjo Pérez (propietario) y Pedro Guerra (gerente), con passkey propia; el resto solicita y uno de los dos aprueba; step-up en cada emisión; ascender a admin exige step-up.

## 11. Implementación (rama `agent/claude/2J-H13-ASSISTED-LINK`, apilada sobre #57; no fusionada)
- **Valores de producción confirmados por el propietario (A29):** `ADMIN_UIDS` = Juanjo Pérez; el único usuario con `admin:true` es Pedro Guerra (gerente); ambos titulares de `platform_link_issue`.
- **Flags y variables (todo apagado por defecto):** `PLATFORM_ASSISTED_LINK_ENABLED`, `PLATFORM_LINK_ISSUERS` (ids separados por comas), `PLATFORM_LINK_LEDGER_KEY` (≥32 bytes en hex, clave aparte), `ADMIN_PROMOTION_STEP_UP` (exige step-up para ascender a administrador; opcional hasta que se active en cada despliegue). Sin clave de ledger válida la emisión devuelve 503 y la activación asistida se rechaza.
- **Código:** `api/platform-sso/assisted-link.js` (permiso, solicitudes, recibos, límites), `api/lib/append-ledger.js` (ledger encadenado con HMAC; sin API para editar ni borrar), `link.js` (`origin:'admin_assisted'` + `reviewId`), `server.js` (step-up de un solo uso para `platform-link-issue` y `admin-promote`).
- **Decisión sobre el almacén (A29, revisión de Búnker): se queda `db.json` (`db.platformAssist`), NO el store cifrado de `platform-proof`.** Motivos: (1) un recibo no autoriza nada por sí solo: solo se consume con la llamada firmada de Platform (2J-SERVICE-AUTH-V1) con el `reviewId`, así que leer `db.json` no permite activar un vínculo; (2) lo que guarda son pares (persona, cuenta) y ids, lo mismo que `platformLink` ya contiene en `db.json`: el cifrado no añadiría confidencialidad real; (3) lo que protege las decisiones es el ledger (integridad, encadenado con HMAC, con el último eslabón también en `db.json`, de modo que un ledger truncado deja de coincidir); (4) mantener un solo almacén evita dos fuentes de verdad. **Riesgo aceptado:** quien lea el disco ve esos ids y los motivos; no ve claves ni tokens. La nota libre de una solicitud se guarda en `db.json` solo mientras está abierta: **no se devuelve nunca a quien emite (la lista trae solo identificadores y el código de motivo) y se borra al decidirla**. Revisable si se quiere cifrado en reposo para todo `db.json`.
- **Paso de ascenso a admin (A29):** el step-up para ascender a administrador queda **siempre activo cuando `PLATFORM_ASSISTED_LINK_ENABLED` está encendido**; `ADMIN_PROMOTION_STEP_UP` solo lo activa por separado si H13 está apagado.
- **Pruebas:** `test/assisted-link.test.js` (12, módulo: permiso, step-up gastado, 20/día, caducidad 24 h, un solo uso, conflictos, ledger editado/cortado/truncado, solo campos escalares, entrada estricta) y `test/assisted-link-http.test.js` (5, servidor real: flag apagado → 404/423, titulares, step-up por propósito y persona, activación firmada por Platform con `reviewId`, ascenso a admin con step-up). Suite completa de la API: 919/919.
- **Pendiente:** parte de Platform (enviar `reviewId` al activar), UI de Búnker, pruebas con la clave real de producción, y revisión independiente antes de proponer el merge.
