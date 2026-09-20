# AI_HANDOFF.md — 2J Fitness Center

> Punto de traspaso entre agentes (Claude Code / Codex). Resumen operativo, no sustituye
> inspeccionar el repo — ver "Protocolo de relevo" al final.

## Proyecto
2J Fitness Center — app de gimnasio real. Frontend React 19 + Vite + Zustand
(`frontend/`), backend Node `http`-module sin framework (`api/`), Docker Compose + Caddy
en producción (Contabo VPS, `app.2jfitnesscenter.com`).

## Rama actual
`feat/pwa-tanita-bunker-roadmap`

## Último commit de código relevante
`85b45ad` — "feat: V2 (perfil de IA auxiliar Gemini, importación CSV inteligente,
disponibilidad de equipamiento)"
(anterior: `14afe9d` — "feat: V1 de mejoras (colores de superserie, selector de
sustitución, importación CSV Gravl, impresión adaptativa)")

Ambos commits están incluidos en la referencia local de
`origin/feat/pwa-tanita-bunker-roadmap` (sin ejecutar fetch en este relevo).
El commit documental `docs: add AI agent handoff` incorpora este archivo al repositorio
y queda pendiente de push por indicación del usuario.
**Ninguno de los dos commits de código está desplegado en producción según el relevo
de Claude** (`GET /api/admin/aux-ai` devolvía 404; no comprobado de nuevo por Codex).

## Objetivo/tarea actual
Sin tarea de código abierta ahora mismo. Relevo validado por el usuario. Última petición:
incorporar únicamente este archivo al sistema permanente de relevo entre Claude Code y
Codex mediante un commit local, sin push ni despliegue.

## Estado actual
- Antes del commit documental, el único archivo sin seguimiento era `AI_HANDOFF.md`;
  no había modificaciones en archivos versionados ni cambios preparados. Este commit
  incorpora únicamente el handoff, sin cambios de código.
- Rama, commits V1/V2 y código inspeccionado concuerdan con el relevo. El estado de PR,
  producción y las pruebas siguientes proceden de Claude y no se han vuelto a verificar
  en esta revisión documental.
- No hay PR abierto para esta rama (se intentó crear pero no hay `gh` CLI instalado ni
  sesión de GitHub en el navegador de la sesión — pendiente de que el usuario lo cree
  manualmente o autorice login).
- V1 y V2 completas y verificadas localmente (tests + build + E2E en navegador contra un
  backend de scratch), pero **no desplegadas**.

## Trabajo completado

**V1** (superseries, sustitución, importación CSV V1, impresión adaptativa):
- Colores/identificadores de superserie (A1/A2/B1/B2) deterministas por orden de
  aparición — `frontend/src/lib/superset-colors.js`.
- Selector de sustitución: alturas uniformes, scroll horizontal de filtros.
- Importador CSV: soporte Gravl, agrupación de superserie conservadora.
- Impresión/PDF rediseñada: tabla por día, densidad adaptativa, nombre de archivo
  siempre "Rutina Nombre Apellidos (DD-MM-AAAA)" (igual para rutina suelta que programa).

**V2** (IA auxiliar, importación inteligente, equipamiento):
- Tercer perfil de IA `auxiliary_ai` (siempre Gemini), aislado de `staff_trainer`
  (Claude, panel entrenador) y `user_trainer` (Coach de socios, hoy OpenAI Codex CLI en
  producción). Credencial/prompt/log propios — `api/lib/aux-ai-config.js`.
- Capabilities de `auxiliary_ai`: `exercise_import_matching`, `machine_scan`,
  `measurements_scan`, `routine_scan` (los 3 escáneres migrados desde el Coach de socios
  en el último ajuste de esta sesión).
- Pipeline de importación CSV con revisión: alias gym-wide confirmados por humanos →
  candidatos locales → sugerencia opcional de Gemini (nunca aplicada sin confirmación) →
  pantalla "Revisar equivalencias" — `frontend/src/lib/import-match.js`.
- Antiduplicados real por huella de contenido, **por nombre de ejercicio (no por id)** —
  ver "Decisiones arquitectónicas" abajo, es la causa de un bug ya corregido.
- Disponibilidad de equipamiento a nivel de sala, independiente del bloqueo manual de
  ejercicio existente.

## Trabajo pendiente
- **Crear el PR** (rama lista, sin PR abierto — falta `gh` CLI o login de GitHub).
- **Desplegar V1+V2 a producción** (no desplegado — pendiente de autorización explícita
  del usuario, no hacerlo sin que lo pida).
- Migración de `user_trainer` a ChatGPT/OpenAI API real (hoy sigue con Codex CLI vía
  device-login, sin cambios — explícitamente pospuesto por el usuario, "posteriormente lo
  cambiaremos").
- El usuario aún no ha configurado una API key real de Gemini en `auxiliary_ai` en
  producción (ni puede, porque V2 no está desplegado) — pendiente de que él la añada
  desde el panel admin una vez desplegado.

## Archivos principales modificados/creados (V1+V2, ambos ya commiteados)

Backend:
- `api/server.js` — rutas nuevas (equipamiento, aliases de importación, aux-ai, import-match)
- `api/lib/aux-ai-config.js`, `api/lib/aux-ai-routes.js`, `api/lib/import-exercise-match.js` (nuevos)
- `api/lib/machine-scan.js`, `measurements-scan.js`, `routine-scan.js` (migrados a auxAI)

Frontend:
- `frontend/src/lib/import-csv.js` — `workoutFingerprint()`, `mergeImport()` actualizado
- `frontend/src/lib/import-match.js` (nuevo) — pipeline de resolución de importación
- `frontend/src/lib/exercises.js` — `isUnavailable`/`isEquipmentUnavailable`
- `frontend/src/lib/alternatives.js`, `progression.js`, `views/RoutineEdit.jsx` — usan `isUnavailable`
- `frontend/src/sheets.jsx` — `ImportSummary` + nueva `ImportMatchReview`
- `frontend/src/views/AdminAuxAI.jsx` (nuevo), `views/Admin.jsx` — UI equipamiento + IA auxiliar
- `frontend/src/lib/plan-share.js`, `lib/superset-colors.js` — V1 impresión/superseries
- `frontend/src/locales/es.js` — claves nuevas V1+V2

## Tests y resultado (última ejecución comunicada por Claude)
- Frontend: `npx vitest run` → **538/538 OK**
- Backend: `node --test` → **123/123 OK**
- Build producción: `npx vite build` → OK (aviso preexistente de chunk >1500kB, no relacionado)
- E2E manual en navegador (backend de scratch, cuenta admin real): importación de los 3
  CSV reales, revisión de equivalencias, antiduplicados, disponibilidad de equipamiento,
  aislamiento entre los 3 perfiles de IA — todo verificado con pasos reproducibles en el
  historial de la sesión (no hay script de E2E automatizado, fue manual con el navegador
  integrado).

## Decisiones arquitectónicas importantes para continuar

1. **Huella antiduplicados por NOMBRE de ejercicio, no por id.** Un ejercicio no
   reconocido en un CSV recibe un id aleatorio nuevo (`'im'+uid()`) en cada parseo, así
   que una huella basada en id nunca coincide entre dos importaciones del mismo archivo.
   `workoutFingerprint(w, customExList)` resuelve el nombre real vía `EXIDX` o la lista de
   `customEx` pasada. **Si tocas esto, hazlo con mucho cuidado — ya se rompió una vez en
   pruebas E2E y se corrigió.**
2. **`auxiliary_ai` es 100% stateless** — una llamada = una respuesta, sin memoria entre
   llamadas, sin compartir prompt/contexto con `staff_trainer` ni `user_trainer`. No
   añadir estado compartido entre perfiles.
3. **Una sugerencia de Gemini nunca se aplica sola.** Solo se persiste como alias/id real
   cuando el usuario confirma explícitamente en "Revisar equivalencias" (o ya había un
   alias confirmado antes). Si tocas `import-match.js`, no rompas esa garantía.
4. **`GET /api/config` es público** (sin sesión) y expone `coach.provider`/`providerLabel`
   solo cuando el Coach está `enabled && connected` — útil para diagnosticar sin login,
   pero no expone nada de `auxiliary_ai` a propósito (se comprueba vía `/api/admin/aux-ai`,
   que requiere sesión admin).
5. Los 3 escáneres (`machine-scan`, `measurements-scan`, `routine-scan`) comparten el
   adaptador Gemini (`api/coach/adapters/gemini.js`) con `exercise_import_matching`, pero
   cada uno mantiene su propio prompt/schema — no fusionar los prompts.

## Problemas conocidos
- No hay PR abierto (falta `gh` CLI / sesión GitHub en este entorno).
- V1+V2 sin desplegar a producción — producción sigue en el estado anterior (Bunker V3.3).
- No se ha probado `auxiliary_ai` contra una API key real de Gemini (solo mocks en tests
  + una prueba de conexión real que falló por clave inválida a propósito).
- String preexistente sin traducir en Admin.jsx (tarjeta "Room admin", línea ~553) — no
  introducido por V1/V2, no tocado.

## Siguiente acción recomendada
1. Confirmar con el usuario si quiere desplegar V1+V2 a producción ahora.
2. Si despliega: verificar `/api/health` y luego que el usuario configure la API key de
   Gemini en el panel "IA auxiliar" y pruebe los 3 escáneres reales.
3. Crear el PR (`gh pr create` o vía navegador autenticado) — comando ya preparado en el
   historial de la sesión.

---

## Protocolo de relevo

- Git y el código actual son la fuente de verdad.
- `AI_HANDOFF.md` es un resumen operativo, no sustituye inspeccionar el repositorio.
- Antes de continuar, comprobar rama, `git status`, últimos commits y diff.
- No rehacer trabajo marcado como completado sin demostrar un problema.
- Antes de entregar, ejecutar los tests relevantes.
- Al terminar una sesión de trabajo, actualizar `AI_HANDOFF.md`.
- Si hay cambios sin commit, indicarlos explícitamente.
- Si una decisión puede causar pérdida de datos, cambio de arquitectura, auth, sync o
  seguridad, detenerse y preguntar.
- Claude y Codex no deben editar simultáneamente el mismo working tree.
