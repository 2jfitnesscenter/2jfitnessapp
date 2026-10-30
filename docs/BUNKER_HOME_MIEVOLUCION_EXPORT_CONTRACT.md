# Búnker → Home «Mi evolución»: exportación de entrenamientos

**Estado:** implementado en la rama de la PR #77, solo lectura y apagado por defecto. Alineado con el contrato canónico integrado por Platform en `2J-home-evolution-member-v1.schema.json` y `2J-platform-home-evolution-v1.md` (Platform main `fe899e900e66598779136fea351d488e8937db39`). No está desplegado ni conectado a Home.

## Alcance y datos

El endpoint expone únicamente historial de entrenamientos finalizados de `S.workouts`, con fecha, identificadores canónicos de ejercicio, resultados permitidos por el esquema y duración cuando consta. No exporta peso corporal, medidas, Health, notas, fotos, nombres libres, programas, datos de perfil ni sesiones activas. Las medidas y el peso originales permanecen en sus stores Búnker; no se borran, compactan ni migran.

La respuesta sigue estrictamente `2j-home-evolution-export/v1`: `schema`, `source`, `personId`, `trainingUserId`, `exportedAt`, `snapshotId`, `nextCursor` y `workouts`. El cursor pagina una instantánea estable; si cambia el historial entre páginas, la continuación falla cerrada. Cada página admite entre 1 y 100 sesiones y se responde con `Cache-Control: no-store`.

## Llamada y autorización

Platform llama exclusivamente a `POST /api/platform/v1/training-evolution`, autenticado con el envelope existente `2J-SERVICE-AUTH-V1` (método/ruta/cuerpo firmados, timestamp fresco, UUID anti-replay y clave de servicio autorizada). El body firmado requiere `v=1`, las identidades separadas `personId` y `trainingUserId`, `cursor` explícito nullable, `limit` explícito y autorización estricta: `training.read`, capability `workoutHistory`, ambas concedidas, `accessState="entitled"` y consentimiento actual concedido con propósito firmado `home_evolution`. Decisiones con timestamps de más de 60 segundos se rechazan.

Búnker además valida que existe exactamente un vínculo activo para el par de identidades, que la cuenta no está deshabilitada y que no hay suspensión administrativa. Los datos de membresía no se infieren en Búnker: Platform debe emitir la decisión de acceso elegible. La ausencia de entitlement no se interpreta aquí como suspensión.

La ruta requiere `PLATFORM_TRAINING_EVOLUTION_ENABLED=true`; por defecto permanece desactivada y no introduce una ruta pública de usuario. Las respuestas no se almacenan en caché. El registro de auditoría interno contiene el propósito `home_evolution`, sin identidad ni contenido del entrenamiento.

## Límites de integración y preservación

El contrato de Platform controla los permisos, consentimiento, elegibilidad y cuotas antes de invocar Búnker. Home consume el resultado a través de Platform; no existe acceso directo desde navegador a este endpoint. Platform elimina los identificadores de servicio antes de entregar el modelo de miembro a Home.

La implementación no escribe en los datos Training, no modifica UID ni passkeys y no realiza enlazado de cuentas. No prueba una conexión live con Platform y no habilita enforcement en rutas de entrenamiento. La integración real requiere configuración de servicio y activación separada autorizada.
