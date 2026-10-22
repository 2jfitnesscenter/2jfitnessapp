# Búnker: preparación del consumidor `2J-CAPABILITIES-V2`

Estado: consumidor server-side preparado, probado y **desactivado por defecto**. No se importa desde `api/server.js`, no registra rutas, no aplica gates y no cambia login, reservas, sesiones, passkeys, RP ID ni datos de Training.

## Contrato y confianza

La fuente canónica revisada es `2jfitnesscenter/2j-platform`, `main` en `ee6af1da29ccb2f3c3d57920bdccee2a05bf66b8`. El JSON Schema versionado aquí coincide estructuralmente con `contracts/2J-capabilities-v2.schema.json` de ese commit. El endpoint canónico es `GET /api/internal/platform/v2/persons/{personId}/training-capabilities`.

La respuesta V2 no contiene claims `issuer` o `audience`; añadirlos sería incompatible. El consumidor confía en el origen HTTPS de Platform que recibe desde configuración server-side y no sigue redirecciones. La autenticación `2J-SERVICE-AUTH-V1` firma el método GET, la ruta exacta con `personId`, el key ID, timestamp UTC, UUID de petición y digest del cuerpo vacío. El key ID se selecciona de la configuración existente `PLATFORM_SERVICE_AUTH_KEYS` mediante `PLATFORM_CAPABILITIES_SERVICE_KEY_ID`; el consumidor no escribe ni cambia secretos. En cada petición real se genera un UUID nuevo, y las llamadas concurrentes de la misma identidad comparten una sola petición.

La bandera `PLATFORM_CAPABILITIES_V2_CONSUMER_ENABLED` acepta `true` o `1`; sin ella el consumidor devuelve `disabled` sin red. La fábrica exige configuración HTTPS válida si se activa. Esta bandera no activa enforcement porque todavía no hay consumidor conectado al runtime.

## Validación y resultados

Se rechazan campos desconocidos, versión/esquema incorrectos, persona o `trainingUserId` que no coincidan, timestamps futuros/caducados, TTL superior a 60 segundos y estados contradictorios de vínculo o suspensión. Los snapshots `not_linked` y `revoked` son estados explícitos; no equivalen a baseline ni suspensión. Según el resolver canónico, un vínculo ausente/revocado tiene precedencia sobre la suspensión: `suspensionStatus=suspended` puede acompañar a un `reasonCode` de vínculo sin que se reclasifique como suspensión efectiva. Un `FREE_BASELINE` válido se devuelve como `baseline`; conserva las capacidades personales y no concede `routineCreation` comercial. La suspensión administrativa efectiva requiere `reasonCode=ADMIN_SUSPENDED`, `accessState=suspended` y todas las capacidades desactivadas.

La caché es solo en memoria, se limita a `min(expiresAt, recepción + 60 s)` y queda separada por `personId` y `trainingUserId`. Ante indisponibilidad de red o HTTP 5xx se puede devolver el snapshot almacenado mientras siga vigente; vencido, se devuelve `unavailable`. Respuesta inválida, HTTP 4xx, identidad incorrecta o firma rechazada fallan cerrados y no usan caché. Las revocaciones recibidas limpian las entradas cacheadas de esa persona. No se persisten snapshots ni se modifican rutinas, workouts o historial.

## Límite de esta preparación

No hay llamada real a Platform, credencial de servicio nueva, migración, SSO, vinculación automática ni enforcement. Queda pendiente una revisión independiente y, más adelante, conectar el consumidor en un cambio separado con configuración aprobada y pruebas de integración. La clase de sesión Training sigue siendo la fuente de autenticación: Platform `personId` y `trainingUserId` permanecen separados, y `platform_sso` no se trata como passkey.
