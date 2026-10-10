# Entrenamientos Premium V1

«Premium» es el **nombre de un catálogo** de métodos estructurados (ciclos, fases, seguimiento), no un muro de pago: no hay pagos, suscripciones ni niveles de acceso. Rama `codex/premium-programs-v1`, base `172a89c` (origin/main tras el PR #17). Candidato; **no desplegado**.

## Arquitectura

| Pieza | Dónde | Notas |
|---|---|---|
| Modelo puro (definición, validación, estado, posición, 5/3/1, resumen) | `frontend/src/lib/premium-model.js` → copia byte a byte `api/lib/premium-model.js` (`scripts/sync-premium-model.mjs`) | Mismo patrón que `workout-activity.js` / `guided-program-model.js`. Se comprueba en CI con `--check`. |
| Semilla oficial versionada | `scripts/premium/official-programs.mjs` → `api/lib/premium-official.json` (`scripts/build-premium-programs.mjs`) | Ids estables, validada contra la biblioteca real de ejercicios, sin duplicados, **no se genera en runtime**. CI: `--check`. |
| Catálogo (store + rutas) | `api/lib/premium-store.js`, `api/lib/premium-routes.js` | Overlay `DATA/premium.json` sobre la semilla (como Entrena con 2J): una resiembra nunca pisa lo que edita el admin. |
| Estado del socio | `S.premium = { v, active, history }` (`frontend/src/lib/premium.js`) | Sync V2 trata `S` como opaco → viaja entre dispositivos sin tocar la API. |
| Sesión → entrenamiento | `lib/premium-session.js` + `startPremiumSession()` en `sheets.jsx` | Reutiliza `buildRoutineEntries`, `warmupSets`, el Workout V2 y el finalizado normal (`w.premium` = origen). Nada de lógica por nombre de programa. |
| Contexto Coach / IA | `api/lib/premium-context.js` (`premiumOf`, `premiumFacts`) | Un solo resumen, sin duplicar datos; `api/lib/coach-followup.js` y `api/coach/payload.js` lo consumen. |
| UI socio | `views/Premium.jsx` (`/premium`, `/premium/p/:slug`, `/premium/active`), `components/PremiumHomeCard.jsx` | |
| UI staff | `views/PremiumManage.jsx` (`/premium/manage`, `/premium/manage/edit/:id`) | Administración → Entrenamientos Premium y panel de entrenador. |
| Interruptor global | feature `premium` (`FEATURE_KEYS` en `api/lib/features-store.js` y `frontend/src/lib/features.js`; idénticos por test) | Ausente = ON. |

El motor es **genérico y dirigido por datos**: un programa es `programDefinition` (`lifts`, `weeks[].sessions[].blocks[]`, `progression.cycleEnd`). Un bloque es `sets` con `pct` del Training Max (cargas decididas por el método), `scheme` (series/reps; la carga la decide el motor de progresión existente) o `conditioning`. 5/3/1 es un programa más del motor, no un ajuste suelto.

## Estados y editorial

`status`: `draft` (privado), `published` (visible), `hidden` (no se ofrece a nuevos), `archived` (retirado). `featured` es un booleano aparte y `badge` ∈ `new|featured|recommended`: **merchandising** (destacar, etiqueta, orden) que **no cambia contenido ni crea versión**. Nada se decide por nombre: «NUEVO: Juggernaut ya disponible» es marcar `badge: new` + `featured`, sin desplegar.

## ACL

| Acción | Socio | Entrenador | Admin |
|---|---|---|---|
| Ver publicados | sí | sí | sí |
| Ver borradores/ocultos/archivados | no | solo los suyos | todos |
| Crear / editar / duplicar | no | **solo propios (personales)**; duplica cualquiera visible | catálogo y oficiales |
| Publicar / ocultar / archivar el catálogo | no | **no** (403) — puede archivar/ocultar los suyos | sí |
| Destacar, orden, badge | no | no | sí |
| Promover un personal al catálogo | no | no | sí (queda en borrador) |
| Borrar | no | solo propio, nunca publicado y sin uso | solo custom nunca publicado y sin uso; oficiales y usados → **archivar** |
| Versiones / restaurar | no | no | sí |

Un programa personal ajeno es invisible (404, no 403). El entrenador puede **probar** el suyo activándolo en su propio perfil. Los campos de sistema (`status`, `scope`, `version`, `createdBy`, `featured`) nunca se leen de la entrada.

## Activación, versiones e historial

Activar valida compatibilidad (equipamiento del gimnasio activo: nunca oculta un programa, avisa y deja elegir alternativa), explica qué cambia, **fija una copia (`snapshot`) de la definición y la versión** en el estado del socio y empieza el seguimiento. No toca entrenamientos, PRs ni rutinas guardadas. Si ya había un programa activo, se cierra en `history` (motivo `switched`) tras confirmación explícita: **cambiar conserva el historial** y los entrenamientos pasados. Editar el catálogo sube `version` y guarda la anterior (hasta 10), pero el programa de quien ya lo sigue **no cambia** (snapshot).

Estados del socio: activo, pausado (el tiempo en pausa no cuenta para la adherencia), saltar sesión, cambiar Training Max (queda como adaptación), siguiente ciclo (propuesta que el socio confirma o edita), finalizar, cambiar. Todo es función pura sobre el estado.

## 5/3/1

Training Max separado de 1RM/e1RM. Semanas: S1 65/75/85 %×5 (última AMRAP), S2 70/80/90 %×3+, S3 75/85/95 %×5/3/1+, S4 40/50/60 %×5 (descarga). Porcentajes sobre el TM, redondeo a 2,5 kg / 5 lb. Al terminar el ciclo se **propone** +2,5 kg (superior) / +5 kg (inferior) y el socio confirma, ajusta o mantiene. El historial es inmutable: la posición se deduce de los entrenamientos con `w.premium`, nunca se reescribe.

## Fail-safe: interruptor `premium` OFF y programa oculto

- **OFF global**: el socio recibe `403 feature_off` en el catálogo; la app muestra «no disponible ahora mismo» y **bloquea activaciones nuevas**. Un programa **ya en marcha** sigue funcionando entero (ver, entrenar, pausar, finalizar, ajustes): vive en su propio estado y no depende del catálogo ni del flag. Staff conserva el acceso para preparar contenido.
- **Programa oculto/archivado**: deja de ofrecerse a nuevos socios; quien ya lo sigue no se ve afectado (snapshot).
- Sin red: el catálogo se muestra desde la copia del dispositivo; el programa activo no la necesita.

## Coach e IA

El socio activo aparece en la fila del seguimiento y en su ficha como «5/3/1 · Ciclo 3 · Semana 2/4» (versión, fase, adherencia, últimas AMRAP, Training Max, incidencias) con el aviso de que cambiar series/porcentajes/cargas puede afectar al método. La IA del Coach recibe `premiumProgram` (programa, versión, fase, ciclo, semana, TM, adherencia; sin nombre ni JSON de entrenos) y una regla en `common.md`: respetar el método, no proponer cambiar series principales ni cargas sin motivo explícito, y no bloquear al entrenador. La IA profesional recibe `premiumProgram` en sus hechos.

## Catálogo inicial (12) y fundamento

Ver `scripts/premium/official-programs.mjs` (descripciones propias, atribución, `evidenceSummary` sin afirmaciones de superioridad).

| Programa | Tipo | Nota |
|---|---|---|
| 5/3/1 | A establecido | Revisión legal |
| Texas Method | A establecido | Revisión legal |
| Juggernaut Method | B principios | Porcentajes propios; revisión legal del nombre |
| GZCL | B principios | Revisión legal del nombre |
| PHUL | A establecido | Revisión legal |
| PHAT | A establecido | Revisión legal |
| DUP | B principios | |
| Upper/Lower Powerbuilding | B principios | |
| Full Body Hypertrophy | B principios | |
| 2J Recomposition | C propio | |
| Concurrent Strength + Cardio | B principios | |
| Full Body Conditioning | C propio | |

Los de tipo A llevan `legal.status: "review"`: descripción neutra («inspirado en», nunca «oficial»), sin tablas ni textos de libros o plantillas de pago. **Decisión del propietario antes de producción**: mantener el nombre comercial o renombrar.

## Portadas

Cada programa tiene `coverImage`, `coverImageAlt`, `coverImageSource`, `coverImageLicense`, `coverImageAttribution`, `coverFocalPoint`. Estrategia **local**: las 12 imágenes iniciales se descargan de Wikimedia Commons (`scripts/premium/fetch-covers.mjs`, solo licencias dominio público / CC0 / CC BY, sin NC/ND) y se sirven desde `frontend/public/premium/covers/`; `scripts/premium/covers.json` conserva autor, licencia y página de origen y la ficha del programa muestra el crédito. Admin/entrenador pueden subir una foto (sistema de medios existente, `media:<id>`), poner una URL https, editar el ALT y el punto focal, con previsualización; sin portada o con portada rota → ilustración Premium (nunca imagen rota). La portada es cosmética: no crea versión.

| Programa | Archivo Commons (autor · licencia) |
|---|---|
| 5/3/1 | Deadlift grip.JPG (U.S. Air Force · dominio público) |
| Texas Method | Camp Pendleton powerlifting squat 110701-M-GN937-167 (Cpl. Kenneth Jasik · dominio público) |
| Juggernaut | Seaman performs a deadlift… (U.S. Navy · dominio público) |
| GZCL | Woman doing squat workout in gym with barbell (Nenad Stojkovic · CC BY 2.0) |
| PHUL | Strong woman performs shoulder press… (Shixart1985 · CC BY 2.0) |
| PHAT | Woman standing in front of a dumbbell rack doing bicep curls (Shixart1985 · CC BY 2.0) |
| DUP | USMC-110816-F-2786W-005 (Cpl. Courtney C. White · dominio público) |
| Upper/Lower Powerbuilding | Attractive sporty woman doing overhead press… (Nenad Stojkovic · CC BY 2.0) |
| Full Body Hypertrophy | Woman in a gym sitting on the floor and doing dumbbell curls (Shixart1985 · CC BY 2.0) |
| 2J Recomposition | Strong woman using cable machine… (Shixart1985 · CC BY 2.0) |
| Concurrent Strength + Cardio | Young blonde woman running on a treadmill in the gym closeup (Shixart1985 · CC BY 2.0) |
| Full Body Conditioning | Scott Webb 2015-06-17 (Unsplash).jpg (Scott Webb · CC0) |

Pendiente de sustituir por fotografía propia del gimnasio cuando exista (varias son genéricas: la de Concurrent solo muestra cardio; Texas/Juggernaut/DUP proceden de fotos de servicios militares de EE. UU., dominio público pero con uniformes).

## Pruebas

`frontend/src/lib/premium-model.test.js`, `premium.test.js`, `premium-session.test.js`, `home-blocks.test.js`, `views/home-premium.test.jsx`, `views/premium-coach-ui.test.jsx`; `api/test/premium-catalog.test.js` (CRUD, ACL, estados, destacar/orden, promover, borrado seguro, versiones, interruptor, portadas) y `premium-coach.test.js` (Coach/IA).
