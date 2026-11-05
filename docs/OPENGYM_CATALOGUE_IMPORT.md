# Importación del catálogo de openGym — paso 1 (datos + imágenes fijas)

Fuente: [DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym) (AGPL-3.0), commit `8fb98b16861a2728652302a7e6e30c50548493a0`.
Generador reproducible: `scripts/import-upstream-catalogue.mjs <checkout de openGym>` (`--check` para verificar).
Imágenes fijas: `scripts/fetch-opengym-media.sh` las descarga a `media/img/opengym/` (ver «Alojamiento»).

## Decisiones del propietario (2026-11)

- **Repetidos:** si el nombre de un ejercicio importado repite el de uno que ya tenemos (en inglés, en español, en su
  forma sin «(male)/(female)», o un alias), **no se importa**. Quedan 94 en la lista retenida.
- **No repetidos:** se importan, incluidos los de material que no teníamos (landmine, suspension trainer, sandbag,
  macebell) y las máquinas de sentadilla de cinturón y de péndulo.
- **Alojamiento:** las imágenes se sirven desde nuestro propio servidor, no desde openGym.

## Qué se añade

- **4.214 ejercicios nuevos** con id, nombre en inglés, grupo muscular, material, músculo objetivo, músculos
  secundarios, instrucciones en inglés y nombre en español.
- Quedan en `frontend/src/lib/exercises-upstream.js` y `frontend/src/names/es-upstream.js`, con la marca `ext: 1`.
- **Los 1.324 existentes no cambian.** `exercises-upstream.test.js` compara el texto del fichero base con el de `main`.
- **Imagen fija:** cada importado apunta a `opengym/<id>.webp`. Las animaciones (clips) no se importan todavía.
- **Material nuevo:** `landmine`, `suspension`, `sandbag`, `macebell` en `protocol/movements.js`. Solo se añaden; los
  perfiles de gimnasio ganan opciones, no cambian las existentes.
- **Equivalencias aditivas:** `weight plate` → Peso añadido; `massage ball` → Rodillo.

## Qué se retiene (94)

Retenido = existe en openGym, pero repite un nombre nuestro. Lista: `docs/OPENGYM_CATALOGUE_HELD.json`.

## Cambios de comportamiento que hay que conocer

- **Coach:** no recibe los importados (`librarySlice` excluye `ext`). Sus prompts y propuestas siguen igual.
- **Búsqueda:** los importados van **después** de cualquier resultado que ya existía (−1000 de puntuación en
  `library/index.js`). «hip thrust» sigue dando primero el 0058.
- **Escáner e importación:** `import-csv.js`, `import-match.js` y `api/lib/exercise-name-match.js` no eligen importados
  automáticamente; el socio sí puede elegirlos a mano en la biblioteca.
- **Calidad:** 201 grupos de «posibles duplicados» y ejercicios importados sin «movimiento canónico» (la base no los
  tiene). Son avisos de `docs/EXERCISE_LIBRARY_AUDIT.md`, no errores.
- **Recuento:** biblioteca 5.538 = 1.324 + 4.214. Las cifras de los runners de release están actualizadas.

## Alojamiento

- `scripts/fetch-opengym-media.sh` descarga las 6.554 imágenes del commit fijado (unos 48 MB) en `media/img/opengym/`.
  `media/img/` no se versiona; como `scripts/fetch-media.sh`, se ejecuta en el servidor.
- nginx sirve `/img/` con `try_files`, así que la subcarpeta funciona sin cambios.
- **Pendiente de despliegue:** copiar las imágenes al servidor es un despliegue. No se ha hecho.

## Cómo se verificó

- Frontend: `exercises-upstream.test.js`; tests de biblioteca, estudio, protocolo y Premium ajustados para contar los
  1.324 originales por separado, sin relajar sus reglas.
- API: `library-*`, `payload`, `gym-profiles`, `protocol-sync`.
- Pruebas que usaban ids inventados (`9999`) pasan ahora `999999`, que no existe.
