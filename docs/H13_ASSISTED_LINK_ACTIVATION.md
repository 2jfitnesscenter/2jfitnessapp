# H13 — Activación asistida de vínculos Búnker↔Platform (DISEÑO + CONTRATO, sin implementar)

Estado: **decisiones del propietario adoptadas (sección 10). Diseño cerrado; sin código. No fusionar.** Rama `agent/claude/2J-H13-ASSISTED-LINK` sobre #57.

## 1. Problema
Hoy Búnker solo acepta activar un vínculo (`POST /api/internal/platform/v1/link/activate`) si tiene **evidencia propia**: `origin:'proof'` (un *recibo* de que el dueño de la cuenta Búnker demostró control con su passkey) u `origin:'provisioned'` (cuenta creada por Platform). Una cuenta histórica cuyo dueño no puede hacer la prueba (perdió el dispositivo, no usa Home) queda sin vincular. Platform ya tiene la cola de revisión manual (#81) que decide *quién es la persona*, pero **Búnker no puede aceptar esa decisión como evidencia**: es el hueco que cubre H13.

## 2. Principio
La activación asistida es una **tercera forma de evidencia propia de Búnker**, emitida solo por una acción explícita de **owner/administrador de Búnker**, nunca inferida (ni nombre, ni e-mail, ni teléfono), con **doble control** (Platform decide la persona, Búnker decide la cuenta) y **auditoría append-only**.

## 3. Quién puede
| Rol | ¿Puede emitir? |
|---|---|
| Owner (UIDs de `ADMIN_UIDS`) y administradores (`admin:true`) | **Sí**, solo con sesión **fuerte**: passkey con verificación de usuario reciente (step-up), **nunca** sesión PIN/kiosco ni sesión SSO de Platform (esas son de nivel socio) |
| Entrenadores, recepción, cualquier rol de personal no administrador | **No** (403 siempre, aunque tengan la cuenta asignada) |
| El propio socio | No por esta vía (usa la prueba normal) |
| Platform | No puede emitirla; solo la consume |
Quien emite **no puede** emitirla sobre su propia cuenta ni sobre la de otro administrador.

## 4. Flujo (doble control)
1. Platform (#81): un administrador de Platform **aprueba** en la cola «la persona P corresponde a la cuenta Búnker U» (queda en el registro de Platform). Platform no activa todavía.
2. Un administrador de Búnker, en el panel de Búnker, abre «Vincular cuenta con 2J (asistido)», ve P (id opaco + nombre mostrado, nada más) y U, indica un **motivo** (lista cerrada + texto corto) y confirma con step-up de passkey.
3. Búnker crea un **recibo asistido** (§5), de un solo uso y con caducidad corta, y lo registra en el ledger append-only (§6).
4. Platform ejecuta su activación normal (`link/activate`) con `origin:'admin_assisted'` y `receiptId`. Búnker solo acepta si existe un recibo asistido **vigente, no usado, exactamente para (personId, trainingUserId)** y **la aprobación de Platform es posterior o igual** (Platform envía `reviewId`). Cualquier discrepancia → `409 proof_required`.
5. Al activarse, el recibo queda consumido (no reutilizable) y se registra `platform_link_activated` con `origin:'admin_assisted'`.

Si falta cualquiera de los dos lados, **no hay vínculo**: ni Platform sola ni un administrador de Búnker solo pueden vincular a una persona.

## 5. Contrato Búnker (propuesto; todo desactivado por defecto)
**Config**: `PLATFORM_ASSISTED_LINK_ENABLED=false` por defecto; sin ella ambas rutas devuelven 404.

**Acción de administrador (UI de Búnker)** `POST /api/admin/platform-link/assist`
```json
{ "v":1, "personId":"<uuid>", "trainingUserId":"<id>", "reasonCode":"lost_device|no_home_access|support_request|other", "note":"<=80 chars, sin datos de salud" }
```
Respuestas: `201 {receiptId, expiresAt}`; `403` (no admin / sesión no fuerte / cuenta propia o de otro admin); `409` (la persona o la cuenta ya tiene vínculo `pending|active`, o ya hay un recibo asistido vigente); `404` (desactivado).

**Recibo asistido** (se guarda en el store cifrado de `platform-proof` junto a los recibos actuales, tipo distinto):
`{ receiptVersion:2, kind:'admin_assisted', receiptId, personId, trainingUserId, issuedBy:<adminUid>, reasonCode, issuedAt, expiresAt (≤ 24 h), consumedAt:null }`. Validación estricta de claves (como `RECEIPT_KEYS`). Un recibo caducado o consumido nunca activa.

**Activación** (cambio mínimo a `link/activate`): `origin` admite `'admin_assisted'` además de `proof|provisioned`; exige `receiptId` y `reviewId` (UUID de la aprobación de Platform). Misma autenticación **2J-SERVICE-AUTH-V1**, mismas reglas de un vínculo por persona y por cuenta, mismos ids de petición de un solo uso. `user.platformLink.origin = 'admin_assisted'`, se guardan `receiptId`, `reviewId`, `issuedBy`.

**Cuenta bloqueada o deshabilitada**: no se puede emitir recibo para una cuenta `disabled`. Una cuenta con suspensión de Platform sigue suspendida tras vincular (la señal manda).

**Revocación**: igual que hoy (`link/revoke`); el recibo consumido no se rehabilita.

## 6. Auditoría append-only
El registro de seguridad actual (`lib/security-audit.js`) es **una lista acotada (3000)** dentro de `db.json`: no sirve (se sobrescribe y se puede recortar). H13 requiere un **ledger propio**:
- Fichero de solo añadir (`platform-link-ledger.jsonl`, `chmod 600`), una línea por evento, **encadenada por hash** (`prev` = SHA-256 de la línea anterior) y firmada con HMAC con una clave de servicio aparte (separación de claves, ver `KEY_SEPARATION.md`).
- Eventos: `assist_issued`, `assist_denied` (con causa), `assist_consumed`, `assist_expired`, `link_activated`, `link_revoked`.
- Campos permitidos: `eventId`, `at`, `actorId`, `personId`, `trainingUserId`, `receiptId`, `reviewId`, `reasonCode`, `result`. **Nunca** notas libres con datos personales, tokens, IP ni user-agent.
- No existe ninguna ruta ni función para editar o borrar; el arranque verifica la cadena y, si se rompe, **desactiva la emisión** y marca el fallo en el healthcheck. Copia incluida en el backup diario.
- Un test comprueba que cada ruta admin nueva esté clasificada en `admin-audit.js` (existe ya el test que obliga a ello).

## 7. Amenazas consideradas
| Riesgo | Control |
|---|---|
| Entrenador/recepción abusa | Excluidos por rol; test explícito por rol |
| Administrador malicioso o con cuenta robada | Step-up de passkey, doble control con Platform, un solo uso, caducidad, ledger encadenado, límite de N recibos/día |
| Vincular a la persona equivocada | Platform decide la persona (cola #81); Búnker decide la cuenta; los dos deben coincidir en (P, U) |
| Reutilizar/robar un recibo | Un solo uso, ligado a (P, U), solo vale para llamadas firmadas por Platform |
| Carrera con una prueba normal | Conflicto 409; un vínculo por persona y por cuenta |
| Ledger manipulado | Cadena de hash + HMAC, verificación al arrancar |

## 8. Pruebas exigidas antes de proponer el código
Rol por rol (owner, admin, entrenador, recepción, socio, PIN/kiosco, SSO) · sesión sin step-up · cuenta propia/de otro admin · recibo caducado/usado/de otra pareja · `reviewId` ausente · doble emisión · cuenta deshabilitada · ledger: cadena rota, truncado, intento de edición · desactivado por defecto (404) · corpus de contrato 2J-SERVICE-AUTH-V1 con `origin:'admin_assisted'`.

## 9. Parte de Platform (resumen; aparte)
La cola #81 ya guarda la decisión; faltaría: exponer `reviewId` estable al aprobar y enviarlo en `link/activate`; no activar sin recibo del lado Búnker (reintento con espera si Búnker responde `proof_required`); el rol de Platform «administrador» (hoy sin login de personal real, ver staging) es requisito previo para producción.

## 10. Decisiones del propietario (adoptadas)
1. **Doble control** Platform + Búnker: sí.
2. **Caducidad del recibo:** 24 h.
3. **Límite:** 20 activaciones asistidas por administrador y día.
4. **Motivos:** lista cerrada de §5 (`lost_device`, `no_home_access`, `support_request`, `other`).
5. **Administrador de Búnker:** `ADMIN_UIDS` (owner) y `admin:true`, ambos con step-up de passkey.
