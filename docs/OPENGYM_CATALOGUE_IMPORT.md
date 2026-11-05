# Importación del catálogo de openGym — paso 1 (solo datos, sin medios)

Fuente: [DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym) (AGPL-3.0), commit `8fb98b16`.
Generador reproducible: `scripts/import-upstream-catalogue.mjs <checkout de openGym>` (`--check` para verificar).

## Qué se añade

- **4.036 ejercicios nuevos** con id, nombre en inglés, grupo muscular, material, músculo objetivo, músculos secundarios
  e instrucciones en inglés, y nombre en español (traducción de openGym).
- Quedan en `frontend/src/lib/exercises-upstream.js` y `frontend/src/names/es-upstream.js`, con la marca `ext: 1`.
- **Los 1.324 existentes no cambian.** La prueba `exercises-upstream.test.js` compara el texto del fichero base con el de `main`.
- **Sin imágenes ni animaciones:** `img` y `gif` quedan en `null` y la app muestra su miniatura. Las animaciones son el paso 2.
- **El Coach no las recibe.** `api/coach/payload.js` (`librarySlice`) excluye `ext`: sus prompts y propuestas siguen igual.
  Los ids importados sí son válidos si una rutina ya los contiene.

## Qué se retiene (272) — requiere tu decisión

Retenido = existe en openGym, pero no se importa todavía. Lista completa: `docs/OPENGYM_CATALOGUE_HELD.json`.

| Motivo | Nº | Qué hacer |
|---|---|---|
| **Nombre repetido** con un ejercicio nuestro (o su nombre sin «(male)», o un alias) | 90 | Decidir cómo desambiguar (p. ej. sufijo de material) o descartarlos |
| **Material sin equivalente** (`landmine` 32, `suspension trainer` 130, `sandbag` 12, `macebell` 2) | 176 | Decidir si creamos esos tipos de material (cambia los perfiles de gimnasio) |
| **Decisión previa de producto**: máquina de sentadilla de cinturón y péndulo | 2 | Confirmar que sigue vigente |

Equivalencias de material que sí se han aplicado (aditivas, en `frontend/src/lib/protocol/movements.js`):
- `weight plate` → Peso añadido (`weighted`)
- `massage ball` → Rodillo (`roller`)

## Cambios de comportamiento que hay que conocer

- **Búsqueda:** los importados se ordenan **después** de cualquier resultado que ya existía (`library/index.js`, −1000 de
  puntuación). Así «hip thrust» sigue dando primero el 0058. Un término que solo coincide con importados sí los muestra.
- **Calidad de biblioteca:** 195 grupos de «posibles duplicados» y 717 ejercicios importados **sin movimiento canónico**
  (la base no los tiene). Son avisos del informe `docs/EXERCISE_LIBRARY_AUDIT.md`, no errores; la comprobación pasa.
- **Recuento:** biblioteca 5.360 = 1.324 + 4.036. Las cifras de los runners de release se han actualizado a estos
  números (`ops/deploy-kit/windows/templates/release-runner.ps1.in`).

## Lo que NO se ha copiado

- Los 922 ficheros con `variantOf` son variantes de dibujo (figura femenina/masculina), no ejercicios. Llegan con las animaciones.
- Los medios (fotos y animaciones) de openGym: son el paso 2 y tienen su propio alojamiento.

## Cómo se verificó

- `exercises-upstream.test.js`: texto base idéntico a `main`; importados completos, con nombre en español y material canónico;
  reglas de nombres e integridad de la biblioteca sin errores; nada retenido dentro del dataset.
- Tests existentes ajustados para contar los 1.324 originales por separado, **sin relajar sus reglas** (ver el diff de los `*.test.*`).
- Un test de búsqueda y uno de Coach que antes usaban ids inventados (`9999`) pasan ahora `999999`, que no existe.
