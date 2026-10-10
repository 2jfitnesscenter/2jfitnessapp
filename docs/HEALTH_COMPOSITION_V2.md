# Salud / Composición V2 — objetivos

No rehace peso, bioimpedancia, escáner, SegmentExplorer, WHOOP, Strava ni Health Connect. Añade **objetivos opcionales** sobre las tres métricas que la app ya mide.

- **Peso**: el objetivo es el `S.targetW` existente (no hay un segundo sistema).
- **Grasa corporal** y **masa muscular**: `S.compGoals = { bodyFat?: { target, at }, muscleMass?: { target, at } }` (límites 3–50 % y 10–80 kg; lo demás se ignora).
- Lógica pura y derivada en `frontend/src/lib/composition-goals.js` (no guarda conclusiones); pantalla `components/CompositionGoals.jsx` dentro de Salud, solo si el socio usa peso o bioimpedancia, y **no** en Inicio.

## Qué se muestra

Por métrica con lecturas o con objetivo: valor actual y fecha, tendencia de 90 días (solo con ≥ 2 lecturas separadas ≥ 14 días; si no, «aún no hay suficientes mediciones», sin tendencia inventada), objetivo, lo que falta, barra de progreso y un **estado en palabras** (alcanzado, avanzando, alejándote, estable, pocos datos, sin medición). El color nunca es la única señal. Umbrales de «estable» y «alcanzado» (0,3–0,5) son tolerancias de visualización, no umbrales clínicos.

## Rangos: solo con base documentable

- **Peso → IMC, bandas OMS** (adultos): < 18,5 · 18,5–24,9 · 25–29,9 · ≥ 30. La pantalla avisa de que el IMC no distingue músculo de grasa.
- **Grasa corporal → bandas ACE** (American Council on Exercise, referencia general para adultos, por sexo): esencial, deportistas, forma física, promedio, por encima del promedio. Es una referencia descriptiva, no un diagnóstico.
- **Masa muscular → ningún rango** (no hay referencia ampliamente aceptada para una báscula de gimnasio): solo tendencia y objetivo.
- Los rangos exigen **fecha de nacimiento** (≥ 18 años) y, para grasa, el sexo declarado; sin ellos la pantalla lo pide en vez de adivinar. Menores: sin rangos.

## Privacidad

Los objetivos viven en el estado propio del socio (opaco para Sync V2). No entran en ficha/fila del Coach, hechos de la IA profesional, payload de la IA del Coach ni compartidos sociales; `api/test/health-goals-privacy.test.js` lo comprueba y falla si un módulo del servidor empieza a leer `compGoals`.

## Pruebas

`lib/composition-goals.test.js` (objetivos, estado/tendencia, rangos, vacíos), `views/composition-goals-ui.test.jsx` (pantalla), `api/test/health-goals-privacy.test.js`.
