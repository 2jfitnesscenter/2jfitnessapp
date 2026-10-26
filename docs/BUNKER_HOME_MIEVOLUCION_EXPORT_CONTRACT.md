# Contrato propuesto: Búnker → Home «Mi evolución»

**Estado:** propuesta de lectura e integración; no implementada ni activada. No añade endpoints, migraciones ni escrituras.

## Decisiones de producto de origen

- **D10 — Mediciones de Búnker:** «A: historial único en Home; Búnker integrado sin borrar originales hasta verificar.»
- **D43 — Dispositivos y apps de salud:** «B: Búnker = rendimiento deportivo; Platform = mediciones y salud (mostradas en Home).»

La propuesta mantiene Búnker como origen de los datos que ya guarda y Home como vista agregada. No convierte una copia de Home en sustituto de los stores de Búnker ni unifica aquí los datos de Health Connect/HealthKit.

## Datos que puede proyectar el primer contrato

El exportador de Búnker solo leería el estado del `trainingUserId` autenticado y vinculado, sin aceptar un UID arbitrario del cliente.

1. **Mediciones:** `S.bodyweight[]` (fecha `d`, peso `w` en kg y metadatos no identificativos permitidos) y `S.measurements[key][]` (fecha `d`, valor `v`; unidad tomada del catálogo canónico `frontend/src/lib/measurements.js`). Las claves se limitan a las definidas por `MEASUREMENTS`; no se inferirán valores ni unidades.
2. **Historial deportivo:** entrenamientos finalizados ya presentes en `S.workouts[]`, preservando la fecha y los resultados necesarios para mostrar la evolución deportiva. El consumidor tratará cada sesión como dato de origen Búnker y no la convertirá en una sesión de Home.

Quedan fuera de este contrato inicial: passkeys, sesiones, email/nombre, fotos de seguimiento, notas/texto libre, chat/Social, credenciales, datos administrativos de staff, Health nativo sin una decisión específica y datos de otros usuarios. Las medidas o el historial corruptos/incompletos se reportan como error de exportación; no se completan ni reparan al exportar.

## Transporte y forma lógica

La siguiente forma es un **contrato lógico propuesto**, no una API desplegada. La ruta, autenticación servicio-a-servicio y vinculación deben ajustarse al contrato canónico de Platform antes de implementar. El transporte será lectura autenticada; no habrá `POST`, `PUT` ni `DELETE` de retorno desde Home.

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

`personId` y `trainingUserId` son identificadores distintos y ambos deben coincidir con un vínculo activo verificado. No se enlaza por email, nombre ni otra PII durante una lectura. Si el contrato de Platform vigente define envelope, prueba o nombres de campos distintos, ese contrato prevalece y esta forma se adapta antes de programar.

Las fechas y valores se exportan como se registraron, junto con la unidad canónica; las representaciones derivadas (porcentaje/kg alternativo, tendencias, mejores marcas agregadas) se calculan en la vista consumidora y nunca sustituyen la lectura original. La paginación, si hace falta, debe tener cursor estable y un marcador de snapshot común; no se mezclan páginas de revisiones distintas del estado.

## Verificación y no pérdida

La primera importación es una proyección de solo lectura y conserva los originales en `data/state-<uid>.json`. No se borran, compactan, reescriben ni migran datos de Búnker como parte de exportar o verificar.

Antes de declarar una identidad verificada, comparar por identidad y serie: cantidad de registros, rango de fechas, claves/unidades, valores y duplicados; comprobar también que el conjunto de sesiones finalizadas conserva fecha e identidad de origen. Guardar en Home el estado de verificación, el watermark/snapshot y los totales del lote. Una discrepancia detiene la marca de verificado y deja disponible la fuente Búnker. Una segunda lectura idéntica debe ser idempotente.

La retención de originales en Búnker continúa incluso después de verificar la vista de Home. Cualquier borrado futuro requiere decisión separada, copia recuperable, prueba de restauración y autorización explícita; no forma parte de D10/D43 ni de este contrato.

## Dependencias y límites

- Requiere el vínculo de identidad aprobado y vigente; no crea usuarios ni modifica UID, passkeys o historial.
- Requiere que Platform confirme el mecanismo de servicio-a-servicio y que Home consuma solo snapshots autorizados.
- Requiere una política de consentimiento/visibilidad para datos personales antes de exponer medidas en Home; hasta entonces no hay export runtime.
- No se ha hecho prueba con datos reales ni se ha cambiado ningún store. Los contratos existentes de Sync V2 y el historial Búnker permanecen intactos.

