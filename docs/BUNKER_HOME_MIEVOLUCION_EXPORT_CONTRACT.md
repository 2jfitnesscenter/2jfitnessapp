# Contrato propuesto: Búnker → Home «Mi evolución»

**Estado:** endpoint de lectura preparado en la rama A67 `codex/a67-bunker-evolution-export`; no está conectado a Platform/Home ni activado. La ruta requiere `PLATFORM_TRAINING_EVOLUTION_ENABLED=true` y permanece apagada por defecto. No añade migraciones ni cambia los datos de usuario.

## Decisiones de producto de origen

- **D10 — Mediciones de Búnker:** «A: historial único en Home; Búnker integrado sin borrar originales hasta verificar.»
- **D43 — Dispositivos y apps de salud:** «B: Búnker = rendimiento deportivo; Platform = mediciones y salud (mostradas en Home).»

La propuesta mantiene Búnker como origen de los datos que ya guarda y Home como vista agregada. No convierte una copia de Home en sustituto de los stores de Búnker ni unifica aquí los datos de Health Connect/HealthKit.

## Datos que puede proyectar el primer contrato

El exportador de Búnker solo leería el estado del `trainingUserId` autenticado y vinculado, sin aceptar un UID arbitrario del cliente.

1. **Mediciones:** `S.bodyweight[]` (fecha `d`, valor `w` y unidad `S.unit`, sin conversión) y `S.measurements[key][]` (fecha `d`, valor `v`; unidad tomada del catálogo canónico `frontend/src/lib/measurements.js`). Las claves se limitan a las definidas por `MEASUREMENTS`; no se inferirán valores ni unidades.
2. **Historial deportivo:** entrenamientos finalizados ya presentes en `S.workouts[]`, preservando la fecha y los resultados necesarios para mostrar la evolución deportiva. El consumidor tratará cada sesión como dato de origen Búnker y no la convertirá en una sesión de Home.

Quedan fuera de este contrato inicial: passkeys, sesiones, email/nombre, fotos de seguimiento, notas/texto libre, chat/Social, credenciales, datos administrativos de staff, Health nativo sin una decisión específica y datos de otros usuarios. Las medidas o el historial corruptos/incompletos se reportan como error de exportación; no se completan ni reparan al exportar.

## Transporte y forma lógica

La forma de respuesta sigue siendo el contrato lógico `2j-home-evolution-export/v1`. El endpoint Búnker preparado es `POST /api/platform/v1/training-evolution`, exclusivamente servicio-a-servicio: usa `2J-SERVICE-AUTH-V1`, ruta fija y firma del cuerpo. El verbo POST transporta una lectura paginable; no existe escritura de vuelta desde Platform/Home sobre el estado Training.

Antes de invocarlo, Platform debe resolver la sesión Home, autorizar `training.read`, evaluar la capability `workoutHistory` (incluido el baseline autónomo gratuito), comprobar consentimiento vigente con propósito `home_evolution` y firmar una decisión fresca. El cuerpo firmado incluye esos resultados; Búnker los valida estrictamente y acepta las decisiones únicamente porque proceden de una clave de servicio autorizada. Búnker vuelve a comprobar el vínculo activo único `personId`↔`trainingUserId`, cuenta no deshabilitada y ausencia de suspensión administrativa. No se acepta una identidad de cliente sin esa vinculación. Si Platform aún no genera este envelope o no aplica sus comprobaciones en servidor, la integración no está lista y el endpoint permanece cerrado.

El envelope v1 exige `permission=training.read`, `capability=workoutHistory`, permiso/capability concedidos, `accessState=baseline|entitled` y un consentimiento `home_evolution` concedido, versionado y comprobado dentro de la ventana de frescura de 60 segundos. No se interpreta ausencia de membresía como suspensión; el baseline gratuito es válido. El permiso y consentimiento no se sustituyen por el rol del usuario.

El contrato disponible en `main` no define una cuota numérica de lecturas o registros por usuario. Por ello, el endpoint exige la decisión firmada de `workoutHistory` (incluido el baseline gratuito) y limita cada página a 100 registros; este límite de transporte no se presenta como cuota comercial. Si Platform incorpora una cuota numérica, deberá incluirse en el contrato firmado antes de aplicarla aquí.

```json
{
  "schema": "2j-home-evolution-export/v1",
  "source": "bunker",
  "personId": "<identidad Platform ya vinculada>",
  "trainingUserId": "<uid Búnker ya existente>",
  "exportedAt": "<ISO-8601 UTC>",
  "measurements": {
    "bodyweight": [{ "date": "YYYY-MM-DD", "value": 0, "unit": "kg" }],
    "series": {
      "waist": [{ "date": "YYYY-MM-DD", "value": 0, "unit": "cm" }]
    }
  },
  "workouts": []
}
```

La unidad del ejemplo es ilustrativa: la respuesta conserva el valor original y devuelve `kg` o `lb` según `S.unit`, sin conversión. La respuesta contiene `nextCursor` y un `snapshotId` HMAC opaco; las páginas se rechazan si cambian los datos de origen. Cada petición se firma con un UUID distinto y entra en la protección anti-replay existente. Todas las respuestas llevan `Cache-Control: no-store`. Errores de fuente corrupta, firma, cursor o autorización son fail-closed.

`personId` y `trainingUserId` son identificadores distintos y ambos deben coincidir con un vínculo activo verificado. No se enlaza por email, nombre ni otra PII durante una lectura. Si el contrato de Platform vigente define envelope, prueba o nombres de campos distintos, ese contrato prevalece y esta forma se adapta antes de programar.

Las fechas y valores se exportan como se registraron, junto con la unidad canónica; las representaciones derivadas (porcentaje/kg alternativo, tendencias, mejores marcas agregadas) se calculan en la vista consumidora y nunca sustituyen la lectura original. La paginación, si hace falta, debe tener cursor estable y un marcador de snapshot común; no se mezclan páginas de revisiones distintas del estado.

## Verificación y no pérdida

La primera importación es una proyección de solo lectura y conserva los originales en `data/state-<uid>.json`. No se borran, compactan, reescriben ni migran datos de Búnker como parte de exportar o verificar.

Antes de declarar una identidad verificada, comparar por identidad y serie: cantidad de registros, rango de fechas, claves/unidades, valores y duplicados; comprobar también que el conjunto de sesiones finalizadas conserva fecha e identidad de origen. Guardar en Home el estado de verificación, el watermark/snapshot y los totales del lote. Una discrepancia detiene la marca de verificado y deja disponible la fuente Búnker. Una segunda lectura idéntica debe ser idempotente.

La retención de originales en Búnker continúa incluso después de verificar la vista de Home. Cualquier borrado futuro requiere decisión separada, copia recuperable, prueba de restauración y autorización explícita; no forma parte de D10/D43 ni de este contrato.

## Dependencias y límites

- Requiere el vínculo de identidad aprobado y vigente; no crea usuarios ni modifica UID, passkeys o historial.
- El endpoint está implementado en la rama, pero Platform todavía debe integrar el envelope firmado y Home debe consumirlo a través de Platform. No hay ruta browser directa.
- El consentimiento requerido por el envelope está preparado; falta que Platform lo evalúe contra su fuente canónica antes de llamar. Hasta entonces no hay export runtime.
- La integración y el endpoint exponen datos personales: requieren revisión independiente de nivel 2 antes de merge.
- No se ha hecho prueba con datos reales ni se ha cambiado ningún store. Los contratos existentes de Sync V2 y el historial Búnker permanecen intactos.

