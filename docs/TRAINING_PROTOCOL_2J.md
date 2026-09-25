# 2J Training Protocol v1.0

La especificación metodológica de 2J Fitness Center: cómo se prescribe el entrenamiento en la app, ya lo haga un entrenador, la biblioteca oficial o una IA.

Tres fuentes, que no deben divergir:

| Documento | Para qué |
|---|---|
| Este documento | El *qué* y el *por qué*, para personas |
| [EVIDENCE.md](EVIDENCE.md) | La bibliografía, un registro por ID `2J-EVD-*` |
| `frontend/src/lib/protocol/rules.js` | Los números con los que corre el producto (copia idéntica en `api/lib/protocol/`) |

`frontend/src/lib/protocol/protocol-docs.test.js` falla si un ID de regla o de evidencia del código no aparece aquí o en EVIDENCE.md.

- **Versión:** 1.0 (2026-09). Los bloques y las rutinas creadas desde bloques guardan la versión con la que se hicieron (`protocolVersion` / `v`). Si el protocolo cambia (1.1, 2.0), **no se reescribe nada automáticamente**: las rutinas históricas quedan como estaban y la biblioteca oficial se regenera de forma explícita.

## Evidencia frente a heurística

Cada regla se marca como una de dos cosas:

- **Regla basada en evidencia (`evidence`):** su contenido lo sostiene la literatura citada.
- **Heurística práctica 2J (`heuristic`):** una decisión de producto, informada por la evidencia pero **no** hallazgo de ella. Ejemplos:
  - "4–7 ejercicios por bloque" es preferencia de producto.
  - "Aislamiento preferente 10–20" es una zona práctica dentro de una evidencia más amplia; no es una frontera fisiológica.

No se presenta una heurística como ciencia. Fuera de la zona preferente sigue habiendo hipertrofia; lo que cambia es que 2J pide una razón.

## Jerarquía de autoridad (2J-RULE-AUTHORITY)

1. Restricciones explícitas del entrenador o del usuario.
2. Seguridad y permisos.
3. Protocolo 2J.
4. Programa ya existente.
5. Biblioteca oficial de bloques.
6. Decisión generativa de la IA.

La IA ocupa la última capa: es una herramienta dentro del protocolo, no la autoridad metodológica. El flujo nunca es "solicitud → IA → guardar", sino:

> solicitud → contexto real → Protocolo 2J → selección (bloques oficiales primero) o generación → validación determinista → entrenador → guardar

## Escala de esfuerzo RPE 2J (2J-RULE-RPE-SCALE, 2J-RULE-RPE10)

| RPE 2J | Significado |
|---|---|
| 4 | Cómodo de terminar |
| 6 | Cuesta un poco, pero se termina limpio |
| 8 | Esfuerzo alto |
| 10 | Máximo, sin repetición adicional correcta |

- **Se mantiene esta escala**; no se sustituye por el RPE convencional 1–10. La prescripción visible es siempre 4/6/8/10. No se asume "RPE 8 = 2 RIR".
- **4:** calentamiento, aprendizaje, recuperación y series de aproximación.
- **6:** esfuerzo moderado, primeras series, iniciados y volumen controlado.
- **8:** el grueso del trabajo productivo.
- **10:** uso selectivo, nunca por defecto. Sobre todo en series finales cuando el ejercicio, el perfil y el contexto son adecuados. El validador aplica estas reglas:
  - Todas las series a 10 → FAIL.
  - Más de un tercio de las series a 10 → PASS_WITH_REASON.
  - 10 en potencia → FAIL.
  - 10 en peso libre técnico pesado → pide razón.
  - 10 en un compuesto técnico para iniciados → FAIL.
- Evidencia: 2J-EVD-EFF-001 y 2J-EVD-RPE-001.

## Niveles

El nivel **no** depende solo de los meses entrenando. Se usa el nivel que define el entrenador o el usuario; la app **no** recalifica automáticamente por el peso levantado.

- **Iniciado:** consolida técnica, regularidad, selección de cargas y percepción del esfuerzo.
- **Intermedio:** domina los movimientos habituales, progresa de forma organizada y tolera más volumen.
- **Avanzado:** alta competencia técnica, conoce su esfuerzo y necesita más especificidad para progresar.

## Clases de ejercicio

Las decide `lib/protocol/classify.js`: exactas para el catálogo curado (`catalog.js`) y con una heurística legible para el resto de la biblioteca.

| Clase | Ejemplos |
|---|---|
| Compuesto libre / técnico | Sentadilla, press banca y peso muerto con barra, puente de glúteo con barra |
| Compuesto estable / máquina | Prensa, hack, jalón, remo en polea o máquina, press en máquina/smith |
| Secundario | Press con mancuernas, zancadas, dominadas, fondos, extensión lumbar |
| Aislamiento | Curls, extensiones, elevaciones, aperturas, curl femoral, gemelo, abducción |

"Metabólico" es un **rol** que puede tomar un ejercicio (un finalizador de repeticiones altas elegido a propósito), no una clase.

## Objetivos

### Hipertrofia (2J-RULE-REPS-HYP) — heurística sobre 2J-EVD-HYP-LOAD-001

No se codifica "hipertrofia = 8–12".

| Clase | Preferente | Permitido |
|---|---|---|
| Compuesto libre / técnico | 5–10 | 4–15 |
| Compuesto estable / máquina | 6–12 | 5–20 |
| Secundario | 8–15 | 6–20 |
| Aislamiento | 10–20 | 8–30 |
| Trabajo metabólico seleccionado | 15–25 | 12–30 |

- Series por ejercicio: preferente 2–4, permitido 1–6.

**Volumen (2J-RULE-VOLUME, 2J-EVD-VOL-001):** se evalúa en el programa semanal. Un bloque aislado no necesita todo el volumen del músculo.

- Series directas por músculo y semana: iniciado ~6–10, intermedio ~8–14 y avanzado ~10–18.
- Son envolventes prácticas, no leyes. Por encima de la envolvente → PASS_WITH_REASON (por ejemplo, una fase de especialización). Por encima del doble → FAIL. Por debajo → nota.
- Solo se cuentan **series directas** por grupo principal. No hay motor de volumen indirecto en V1 y no se inventa precisión.
- No se confunden series, tonelaje, volumen hipertrófico y carga interna: el protocolo usa series productivas.

### Fuerza máxima (2J-RULE-REPS-STR) — 2J-EVD-STR-LOAD-001, 2J-EVD-ORD-001

- **Reps:** principal 2–6 (permitido 1–8), secundarios 4–8 (3–10) y accesorios 6–12 (5–15).
- **Carga:** alta cuando proceda, frecuentemente ≥80 % 1RM.
- **Descanso del principal:** 2–5 min. Un descanso de 30 s en fuerza pesada → FAIL.
- **RPE:** predominante 6–8; el 10 es ocasional.
- **Orden:** movimiento prioritario → secundarios → accesorios. Si el principal no está entre los dos primeros → razón.
- No se convierten todos los ejercicios en trabajo pesado de pocas repeticiones.

### Fuerza general / salud (2J-RULE-REPS-GEN) — 2J-EVD-GEN-001, 2J-EVD-FREQ-001

- Objetivo: fuerza, mantener o aumentar la masa muscular, capacidad funcional, adherencia y sostenibilidad.
- 5–8 ejercicios por sesión cuando tenga sentido y 2–4 series principales.
- 6–15 repeticiones predominantes; aislamientos 10–20.
- RPE 6–8; el 10 es poco necesario. Frecuencia típica: 2–3 sesiones por semana.
- "Salud" **no** significa entrenamiento inútilmente ligero: más de la mitad de las series a RPE 4 → razón.

### Resistencia muscular (2J-RULE-REPS-END) — 2J-EVD-END-001 (confianza baja)

- 12–25 repeticiones, 2–4 series y 30–90 s de descanso.
- RPE 6–8 predominante; el 10 es ocasional.
- Ejercicios técnicamente sostenibles. Puede formar parte de circuitos o acondicionamiento.

### Potencia (2J-RULE-POWER) — 2J-EVD-POW-001

- ~30–70 % 1RM cuando la métrica sea aplicable, 2–6 repeticiones, 2–5 series e intención concéntrica de máxima velocidad.
- Descanso suficiente para mantener el rendimiento.
- **Nunca RPE 10**, y más de 6 repeticiones en el trabajo principal → FAIL.
- No se genera potencia automáticamente para cualquier perfil. La serie termina antes de que la fatiga vuelva lento el movimiento.

### Iniciación / retorno tras pausa (2J-RULE-BEGINNER)

- Orden de prioridades: tolerancia → técnica → regularidad → progresión.
- Menos ejercicios y menos series, RPE predominante 4–6 con algo de 8.
- Ejercicios estables y controlables, e incremento gradual.
- No se devuelve a nadie automáticamente al volumen previo tras meses parado.

### Adulto mayor (2J-RULE-OLDER) — 2J-EVD-OLD-001

- No se codifica "adulto mayor = poco peso + muchas repeticiones".
- Prioridades: fuerza, masa muscular, función, estabilidad, progresión gradual, potencia cuando sea apropiado y equilibrio cuando encaje.
- Sin prescripciones para patologías específicas. Las restricciones médicas declaradas tienen prioridad.

### Pérdida de grasa (2J-RULE-FATLOSS)

- No se generan "circuitos de 20 reps" solo porque el objetivo sea perder grasa.
- El entrenamiento de fuerza conserva su función (fuerza, masa muscular, capacidad física). Puede complementarse con cardio, circuitos, densidad o superseries si procede.
- No se promete una pérdida de grasa concreta derivada de una rutina.
- En la app, "pérdida de grasa" se mapea al objetivo **general**; nunca es un "grupo muscular".

## Descansos (2J-RULE-REST) — heurística, 2J-EVD-REST-001

| Demanda | Preferente | Permitido |
|---|---|---|
| Fuerza pesada | 2–5 min | 1,5–7 min |
| Compuesto de hipertrofia | 2–3 min | 1–5 min |
| Máquina / secundario | 90–150 s | 45–240 s |
| Aislamiento | 60–120 s | 30–180 s |
| Potencia | 2–4 min o más | 1,5–6 min |
| Circuito / resistencia | 30–90 s | 15–150 s |

- En una superseries hay una transición corta A1→A2 y el descanso va **después del par**, según su demanda.
- El descanso prescrito se guarda por ejercicio (`rest`). El temporizador del entreno lo usa cuando existe; si no, usa el ajuste general del socio.

## Superseries (2J-RULE-SUPERSET) — 2J-EVD-SS-001

- Se priorizan para eficiencia: agonista/antagonista, tren superior/inferior, músculos poco interferentes y accesorios compatibles. Ejemplos: press + remo, bíceps + tríceps, elevación lateral + gemelo.
- Más prudencia con dos compuestos pesados del mismo músculo → razón. Emparejar un ejercicio consigo mismo → FAIL.
- No se prohíben: se usan con criterio.

## Rango de movimiento (2J-RULE-ROM) — 2J-EVD-ROM-001

ROM completo que el usuario ejecute de forma controlada. Los parciales son válidos con una razón. Sin recomendaciones médicas.

## Orden de los ejercicios (2J-RULE-ORDER) — 2J-EVD-ORD-001

- Lo prioritario va cuando el usuario está fresco.
- **Fuerza:** el movimiento objetivo va temprano.
- **Hipertrofia:** el músculo prioritario puede adelantarse; un aislamiento antes de su compuesto es solo una nota.
- **General:** normalmente, lo técnico antes que el aislamiento.

## Selección de ejercicios y redundancia (2J-RULE-REDUNDANCY) — heurística

Se evita la redundancia innecesaria.

- **Ejemplo malo:** hip thrust, puente de glúteo, hip thrust en smith, hip thrust en máquina y frog pump no son cinco estímulos distintos solo por tener nombres distintos.
- **Cómo se detecta:** cada ejercicio tiene *patrón* (extensión de cadera en puente, bisagra, sentadilla, zancada, abducción…), *variante* (ángulo, agarre o posición que sí cambian el estímulo: plano/inclinado, predicador/inclinado/martillo…) y *lateralidad*. El implemento **no** cuenta: un curl con barra y uno en polea hechos igual son el mismo curl.
  - Mismo patrón + variante + lateralidad dos veces en un bloque → razón.
  - Tres del mismo patrón → razón.
  - Cuatro o más → FAIL.
- Un glúteo bien cubierto combina, según el objetivo del bloque, extensión de cadera, bisagra, un componente unilateral o dominante de rodilla y abducción.
- No es una "IA biomecánica" ni afirma que exista un "ejercicio perfecto". Son reglas explicables.
- **Hueco conocido del catálogo:** la biblioteca de ejercicios no tiene hip thrust con barra (solo con banda). Los bloques oficiales usan el puente de glúteo con barra (1409) en lugar de inventar un registro casi duplicado. Si 2J lo necesita, se añade como ejercicio propio desde administración.

## Progresión (2J-RULE-PROGRESSION)

- No hay un motor nuevo: la biblioteca **prescribe** y Progressive Overload V1 **recomienda** la evolución según el rendimiento real.
- Patrón práctico de doble progresión, por ejemplo con 3×(8–10): progresar dentro del rango → alcanzar la parte alta con el esfuerzo apropiado → subir a la siguiente carga realizable → volver a la parte baja.
- Los incrementos son los reales del equipamiento del gimnasio (`lib/equipment.js`).
- Los bloques escriben `targetRepsMin/Max`, `reps` (el techo), `repsMin` y `prog: 'double'`, que es el formato que ya entienden `progression.js` y `overload.js`.

## Dolor, limitaciones y restricciones (2J-RULE-RESTRICTIONS)

- **No se diagnostica.** Las restricciones explícitas del entrenador o del usuario tienen prioridad sobre todo.
- **Restricciones que la V1 sabe aplicar:** sin saltos, sin flexión profunda de rodilla, sin trabajo por encima de la cabeza, sin carga axial en columna y sin ejercicios en el suelo. Solo se aplican si están declaradas.
- **Ejercicio del catálogo curado que incumple una restricción declarada:** FAIL. **No admite override desde el constructor** ni desde la API: hay que quitar el ejercicio o retirar antes la restricción del socio.
- **Ejercicio fuera del catálogo curado:** solo se conoce por su nombre, así que no se puede verificar. Se muestra "no verificable" (`restriction_unverified`) para que el entrenador lo revise, nunca como un FAIL basado en una suposición. A una IA no se le acepta: con restricciones declaradas, debe usar un ejercicio verificable.
- **Límites:** el marcado de cada ejercicio curado es una decisión 2J revisada, no un dato biomecánico medido. No se construyen reglas médicas universales a partir de ellas.
- **Texto libre** (por ejemplo, "hernia declarada"): llega a la IA como contexto y el entrenador decide.
- **Check-in con molestia:** genera un aviso para revisar. **Nunca** elimina ni cambia ejercicios automáticamente.

## Bloques (2J-RULE-BLOCK-SIZE, 2J-RULE-DURATION)

- **Estructura:** Programa → Día → Bloques → Ejercicios.
- **Qué es un bloque:** una plantilla reutilizable y versionada de pocos ejercicios prescritos. Tipos: fuerza, superserie, circuito, cardio, intervalos, HIIT y movilidad.
  - Fuerza, superserie y cardio se construyen y entrenan hoy.
  - Circuito, intervalos, HIIT y movilidad existen en el modelo, pero todavía no tienen ejecutor guiado.
- **Tamaño:** 4–7 ejercicios en bloques musculares estándar, como preferencia de producto. Los de fuerza, potencia y core pueden tener menos. Nunca se rellena por llegar a un número.
- **Duración:** estimación redondeada a 5 min, mostrada como "~N min". Se calcula con series, repeticiones aproximadas (~3 s cada una), descanso y transiciones (~60 s entre ejercicios y ~15 s entre partes de una superseries).
- **Bloque ≠ rutina viva:** insertar un bloque **copia** sus ejercicios en el día como instancia editable. Cambiar, quitar o reordenar esos ejercicios no toca el bloque maestro, y borrar o desactivar un maestro no rompe ninguna rutina.

## Validador determinista

`validateAgainst2JProtocol()` en `lib/protocol/validator.js`, con la misma copia en el servidor. Valida bloques, rutinas y programas.

**Resultados:**

- **PASS:** nada que decir.
- **PASS_WITH_REASON:** permitido, pero es una elección deliberada fuera de lo preferente. Se guarda o muestra con su razón: la escrita, o una razón por defecto honesta.
- **FAIL:** incompatible con el objetivo, el nivel o las restricciones.

**Qué revisa:** objetivo, nivel, restricciones, número de ejercicios, repeticiones, series, RPE, volumen, descanso, equipamiento, IDs, duplicados, redundancia, superseries, orden, duración estimada y versión del protocolo. Cada incidencia lleva la regla y la evidencia que la sostienen.

**Certeza.** Clase, patrón y marcas de restricción solo son fiables en el catálogo curado (`catalog.js`). Para el resto de la biblioteca de ejercicios hay una inferencia legible por nombre y equipamiento que nunca se presenta como certeza:

- Un juicio que dependa de ella y fuera a dar FAIL queda como **no verificable** (`unverified`): se muestra y no bloquea.
- Si fuera a pedir motivo, queda como nota.
- Los datos de la propia biblioteca de ejercicios (ID, equipamiento, grupo) y la escala 2J sí cuentan siempre.
- Los 112 bloques oficiales solo usan ejercicios curados; el build falla si no es así o si queda algo no verificable.

**Qué se hace con cada resultado:**

- **Bloques oficiales:** un FAIL no se publica.
- **Bloques personales:** un FAIL no se guarda.
- **Rutinas de un entrenador** (Constructor V2, aplicado también por la API cuando el guardado lleva contexto del protocolo):
  - Restricción declarada incumplida: **no se guarda**, sin override.
  - FAIL metodológico: solo con un **override consciente**. El entrenador ve cada causa, escribe un motivo (mínimo 8 caracteres) y confirma que asume la responsabilidad. Se guarda en `meta.override` como `{reason, codes, at}`. Nunca ocurre en silencio.
  - No verificable o nota: se muestra y no bloquea.
- **Resultado de una IA:** un FAIL nunca se guarda ni se aplica. Hay una ronda de reparación y, si sigue fallando, se aborta. Con restricciones declaradas, un ejercicio no verificable también va a reparación (véase abajo).

## IA

Cualquier flujo que genere o modifique entrenamiento recibe la versión del protocolo, las reglas relevantes en forma compacta (nunca estos documentos completos), el contexto del usuario, el equipamiento, las restricciones y los bloques oficiales compatibles.

- **Primero reutiliza curación 2J:** puede componer días con bloques oficiales. Si la biblioteca no cubre el caso, genera bajo el protocolo.
- **Su salida pasa por el validador:** si da FAIL, hay una ronda de reparación con los fallos concretos. Si vuelve a dar FAIL, el trabajo falla y no se guarda nada.
- **Nunca muta en silencio:** rutinas, programas, asignaciones y entrenos activos solo cambian por acción explícita.
- **Explicabilidad:** cada `why` separa la "regla 2J" de la "preferencia del entrenador/usuario" y no inventa referencias.

## Evidencia en la interfaz

La bibliografía vive en estos documentos. La app de entrenamiento sigue limpia: no se ven citas junto a las series.
