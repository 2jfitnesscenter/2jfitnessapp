# Búnker ↔ Platform: controles técnicos INT-01–INT-30

Estado de revisión (2026-10-22): 2jfitnessapp `origin/main`=`a7678b864ca404cb38c13706d780e659c47f214a`; 2j-platform `origin/main`=`e4b6218f02d24f9c78d7670252d68474cfea2232`.

## Alcance y procedencia

Esta tabla contiene 30 controles técnicos INT, derivados de los contratos, la preparación SSO/capabilities y casos de prueba verificables. No son las decisiones funcionales D01–D30 del dossier de auditoría global. Ese dossier no se ha localizado; por tanto, aquí no se crea ni se reconstruye su matriz. “Operativo” describe comportamiento demostrado por código; “diseño/test aislado” no acredita integración de producción.

| ID | Control | Evidencia real | Estado |
|---|---|---|---|
| INT-01 | `uid` de Training sigue siendo el principal de sesión | `api/server.js` (`readSession`); `api/test/person-id.test.js`, “personId stays optional metadata…” | Operativo |
| INT-02 | `personId` es metadato opcional y no se infiere | `api/server.js` validación de `db.users[].personId`; `api/test/person-id.test.js` | Operativo |
| INT-03 | Un `personId` por sí solo no inicia sesión | `api/test/person-id.test.js`, comprobación de `/api/me` con el identificador global | Operativo |
| INT-04 | No se vincula por coincidencia de email | `api/test/platform-integration-contract.test.js`, “email coincidence cannot take over…” | Diseño/test aislado |
| INT-05 | Provisionamiento no permite elegir un `trainingUserId` arbitrario | `contracts/platform-training-integration-v1.schema.json` (`provisionRequest`); prueba de esquema estricta | Diseño/test aislado |
| INT-06 | Solicitud de provisionamiento tiene esquema cerrado y versión | Schema `provisionRequest`; prueba “contract schema is strict…” | Diseño/test aislado |
| INT-07 | Reintento con la misma clave conserva el perfil provisionado | Prueba “same idempotency key returns same provision…” | Diseño/test aislado |
| INT-08 | Reutilizar clave idempotente con otra persona da conflicto | Prueba “same idempotency key with a different person…” | Diseño/test aislado |
| INT-09 | Una persona no crea dos perfiles Training en el modelo propuesto | Prueba “personId uniqueness prevents a second Training profile…” | Diseño/test aislado |
| INT-10 | Un Training uid no se reclama para dos personas en el modelo propuesto | Prueba “trainingUserId uniqueness prevents two people claiming…” | Diseño/test aislado |
| INT-11 | Auth de servicio inválida y request replay se rechazan | `api/platform-proof/service-auth.js`; test de referencia “invalid server auth and replayed request id…” | Mixto: auth operativa para proofs; provisionamiento aislado |
| INT-12 | Emitir proof de propiedad exige sesión Training autenticada con passkey | `api/platform-proof/routes.js` (`POST /api/platform/v1/link-proofs`); `api/test/platform-proof.test.js`; referencia de vínculo | Proof operativo, vínculo aislado |
| INT-13 | Proof queda ligado al contexto y a su expiración | `api/platform-proof/routes.js`; pruebas de contexto/TTL en `api/test/platform-proof.test.js` | Proof operativo |
| INT-14 | Un proof no se puede canjear dos veces | `api/platform-proof/store.js` y `routes.js`; pruebas de replay/concurrencia | Proof operativo |
| INT-15 | Exchange usa HMAC de servicio, no cookie de navegador | `api/platform-proof/service-auth.js`; `api/test/platform-proof.test.js`, “browser cookies alone cannot authorize…” | Operativo para proofs |
| INT-16 | Firma de servicio está ligada a método, ruta y cuerpo exactos | `api/platform-proof/service-auth.js`; pruebas de bytes canónicos y ruta exacta | Operativo para proofs |
| INT-17 | Flags de emisión, exchange y reconciliación son independientes y apagados por defecto | `api/platform-proof/routes.js`; prueba “feature flags stay independently off by default…” | Operativo para proofs |
| INT-18 | Se persiste hash cifrado del proof, no el código en claro | `api/platform-proof/store.js`; prueba “stores only encrypted proof hashes” | Operativo para proofs |
| INT-19 | Receipt de reconciliación es durable e inmutable bajo consumo concurrente | `api/platform-proof/store.js`; pruebas de persistencia, concurrencia y fallo de escritura | Operativo para proofs |
| INT-20 | Payload V2 de diez capabilities coincide con el esquema Platform | `contracts/platform-training-capabilities-v2.schema.json`, `platform-training-capabilities-v2.json` y pruebas aisladas de contrato | Referencia de contrato; sin gate runtime |
| INT-21 | Snapshot ausente, inválido, expirado o con link no activo falla cerrado; outage cacheable solo hasta expiresAt | Modelo de referencia en `api/test/platform-integration-contract.test.js`; Platform V2 `generatedAt`/`expiresAt` máximo 60 s; no hay gate runtime | Diseño/test aislado |
| INT-22 | Entitlement no reemplaza rol/permiso del staff | Preparación en `docs/BUNKER_PLATFORM_SSO_ENTITLEMENTS_PREP.md`; prueba “staff exemption applies…” | Diseño/test aislado |
| INT-23 | Rutas de datos propios requieren sesión/ownership Training actual | `api/server.js` (`readSession`) y mapa de rutas de la preparación; todavía no aplican capability | Auth operativo; entitlement pendiente |
| INT-24 | Acceso de socio a Búnker tendría que comprobarse también en API | `api/bunker/routes.js` (`checkin`, `session`, `handoff`, `board`); mapa de rutas en preparación; sin gate de quota | Búnker operativo; gate pendiente |
| INT-25 | Handoff conserva la sesión exacta y no altera otros datos | `api/bunker/routes.js`; `api/test/bunker-handoff.test.js`, “writes S.active exactly…” | Operativo |
| INT-26 | Handoffs paralelos mantienen aislamiento por uid | `api/test/bunker-handoff.test.js`, “multiuser isolation…” | Operativo |
| INT-27 | Token Búnker se rechaza al deshabilitar/eliminar la cuenta | `api/bunker/routes.js`; `api/test/bunker-revocation.test.js` | Operativo |
| INT-28 | Autorización de rol admin es independiente del estado de miembro | `api/test/bunker-revocation.test.js`, “role check is independent…” | Operativo |
| INT-29 | SSO de un uso, con TTL y contexto, se simula en referencia | `api/test/platform-integration-contract.test.js`, pruebas single-use, concurrencia, expiración, emisor/audience/destino | Diseño/test aislado |
| INT-30 | Redimir SSO no equivale a passkey; assurance/strong reauth sigue pendiente | Preparación SSO en `docs/BUNKER_PLATFORM_SSO_ENTITLEMENTS_PREP.md`; no existe endpoint de redención | Pendiente de decisión; SSO apagado |

## Resultado

Los proofs actuales son una capacidad preparatoria separada y default-off. Los contratos de provisionamiento, vínculo activo, entitlements y SSO, así como los tests de `platform-integration-contract.test.js`, son especificación/modelo aislado; no son pruebas de rutas reales ni de atomicidad entre procesos. No se activa SSO, no se migran cuentas y no se aplica una nueva restricción de membresía. Esta tabla solo contiene controles INT-01–INT-30; no sustituye ni reconstruye las decisiones funcionales D01–D30 originales, que se conservan en el dossier compartido. Las dependencias técnicas permanecen en `docs/BUNKER_PLATFORM_SSO_ENTITLEMENTS_PREP.md`.
