# Registro de evidencia — 2J Training Protocol

Registro bibliográfico y de trazabilidad del [Protocolo 2J](TRAINING_PROTOCOL_2J.md).

- **Qué es:** cada decisión fisiológica o programática que se convierte en comportamiento de producto tiene aquí un registro con su ID. El código (`frontend/src/lib/protocol/rules.js`) cita esos mismos IDs, y un test (`protocol-docs.test.js`) falla si un ID del código no aparece en este documento.
- **Regla de oro:** no se atribuye a una fuente una conclusión más fuerte que la que soporta. Cuando la evidencia es insuficiente, se dice, y la regla 2J pasa a ser una **heurística práctica**, no un hallazgo.
- **Verificación:** todas las referencias se han comprobado el 2026-09-25 contra la lista de referencias del position stand del ACSM 2026 (texto completo) o contra la página del editor o PubMed. Ninguna se ha citado de memoria sin comprobar.

Formato de cada registro: **ID · Tema · Regla 2J · Fuentes · Población/contexto · Confianza · Última revisión · Notas/limitaciones.**

Confianza: *alta* (consenso o position stand más revisiones consistentes) · *moderada* (revisiones con heterogeneidad o evidencia indirecta) · *baja* (evidencia insuficiente; la regla es sobre todo práctica).

---

## Inteligencia 2J V2 — umbrales de producto, no evidencia clínica

Las señales `PROGRESSION_READY` (dos exposiciones que alcanzan el techo de repeticiones sin
feedback negativo ni esfuerzo alto), `LOAD_TOO_HIGH` (dos exposiciones fallidas), `PLATEAU`
(tres exposiciones con la misma mejor carga y repeticiones) y `RETURN_AFTER_GAP` (14 días) son
**heurísticas conservadoras de interfaz**, no umbrales clínicos validados. Se limitan a sugerir
una revisión; no diagnostican, no prescriben una carga universal y nunca modifican una sesión,
rutina o programa. La disponibilidad del material y las restricciones explícitas mandan. La
ventana para mostrar patrones de ejercicio caduca a los diez días. No cambia el Protocolo 2J v1.0.

## Cardio — progresión y referencias de ritmo (heurística de producto)

La progresión cardio del sprint (sumar 1 min por sesión completada hasta 30 min, después
sumar 0,5 km/h; dos incumplimientos consecutivos reducen solo una variable) es una regla
conservadora de producto, no un umbral validado. Se aplica únicamente a las sesiones que usan
el registro existente `min` + `speed`; no altera rutinas ni sesiones ya finalizadas. Las cuatro
bandas VAM (60–70 %, 70–80 %, 80–90 %, 90–100 %) son referencias orientativas de velocidad y
ritmo para carrera, no zonas ventilatorias individuales. La literatura muestra que los cortes
dependen del protocolo y la población; un estudio de velocidad máxima de carrera halló
asociaciones con umbrales en porcentajes concretos, pero no valida estas cuatro bandas para
todo usuario ni convierte un test de campo en una medición de laboratorio
([PubMed 24790484](https://pubmed.ncbi.nlm.nih.gov/24790484/)). Solo se muestran si el test VAM
registrado duró aproximadamente seis minutos. El objetivo de +0,1 km/h o +1 % para repetir
VAM/ergómetro es una meta de seguimiento, nunca una prescripción de entrenamiento.

---

## Fuente troncal

**[ACSM-2026]** Currier BS, D'Souza AC, Fiatarone Singh MA, Lowisz CV, Rawson ES, Schoenfeld BJ, Smith-Ryan AE, Steen JP, Thomas GA, Triplett NT, Washington TA, Werner TJ, Phillips SM. *American College of Sports Medicine Position Stand. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews.* Med Sci Sports Exerc. 2026;58(4):851–872. doi:10.1249/MSS.0000000000003897. Es una revisión de revisiones: 137 revisiones sistemáticas y más de 30.000 participantes. Sustituye al position stand del ACSM de 2009 (*Progression models in resistance training for healthy adults*).

Lo que dice y usamos (literal o casi):

- **Fuerza:** mejora más con cargas altas (≥80 % 1RM), ROM completo, 2–3 series por ejercicio y sesión, colocando el ejercicio al principio de la sesión y entrenando ≥2 sesiones por semana.
- **Hipertrofia:** mejora más con volúmenes altos (≥10 series por grupo muscular y semana) y con sobrecarga excéntrica. No se vio afectada por la frecuencia (a volumen igualado), la carga (30–100 % 1RM), el fallo, el tiempo bajo tensión, la periodización ni el orden de los ejercicios. Para el descanso entre series, el ROM, máquina frente a peso libre y otras variables, los datos fueron **insuficientes**.
- **Potencia:** mejora con cargas moderadas (30–70 % 1RM), volumen bajo-moderado (repeticiones × series < 24), halterofilia y "power RT" (concéntrica rápida).
- **Esfuerzo:** se puede lograr un esfuerzo suficiente cerca del fallo o con un objetivo de 2–3 repeticiones en reserva.
- **Recomendación principal:** entrenar con esfuerzo alto al menos dos veces por semana, implicando todos los grandes grupos musculares.
- **Seguridad:** el entrenamiento de fuerza es seguro para adultos sanos de todas las edades.

---

## 2J-EVD-GEN-001 — El entrenamiento de fuerza funciona con muchas cargas y métodos

- **Regla 2J:** base del protocolo. Cualquier entrenamiento de fuerza bien hecho mejora fuerza, masa muscular y función. Importan la constancia, el esfuerzo suficiente y cubrir los grandes grupos ≥2 veces por semana. Un objetivo de "salud" o "pérdida de grasa" no justifica un entrenamiento inútilmente ligero.
- **Fuentes:** [ACSM-2026].
- **Población:** adultos sanos de todas las edades.
- **Confianza:** alta.
- **Última revisión:** 2026-09.
- **Notas:** no dice nada sobre patologías concretas, embarazo ni rehabilitación, y el protocolo tampoco.

## 2J-EVD-HYP-LOAD-001 — Carga y rango de repeticiones para hipertrofia

- **Regla 2J:** la hipertrofia no se limita a 8–12 repeticiones. 2J usa zonas **preferentes** por tipo de ejercicio (por ejemplo, aislamiento 10–20) dentro de rangos **permitidos** más amplios (aislamiento 8–30). Las zonas preferentes son una decisión práctica: comodidad, técnica, tiempo y seguridad, no un límite fisiológico.
- **Fuentes:**
  - [ACSM-2026]: la hipertrofia no se vio afectada por la carga entre 30 y 100 % 1RM.
  - Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW. *Strength and hypertrophy adaptations between low- vs. high-load resistance training: a systematic review and meta-analysis.* J Strength Cond Res. 2017;31(12):3508–3523.
  - Lopez P, Radaelli R, Taaffe DR, et al. *Resistance training load effects on muscle hypertrophy and strength gain: systematic review and network meta-analysis.* Med Sci Sports Exerc. 2021;53(6):1206–1216.
  - Refalo MC, Hamilton DL, Paval DR, Gallagher IJ, Feros SA, Fyfe JJ. *Influence of resistance training load on measures of skeletal muscle hypertrophy and improvements in maximal strength and neuromuscular task performance: a systematic review and meta-analysis.* J Sports Sci. 2021;39(15):1723–1745.
  - Schoenfeld BJ, Grgic J, Van Every DW, Plotkin DL. *Loading recommendations for muscle strength, hypertrophy, and local endurance: a re-examination of the repetition continuum.* Sports (Basel). 2021;9(2):32.
- **Población:** adultos sanos, entrenados y no entrenados.
- **Confianza:** alta.
- **Última revisión:** 2026-09.
- **Notas:** con cargas muy ligeras la hipertrofia depende de acercarse al fallo (véase 2J-EVD-EFF-001). Por eso los rangos altos (20–30) se reservan para aislamiento y trabajo metabólico, donde es seguro y práctico, y no para compuestos técnicos.

## 2J-EVD-STR-LOAD-001 — Cargas altas para fuerza máxima

- **Regla 2J:** en bloques de fuerza máxima, el movimiento principal va a 2–6 repeticiones con carga alta (a menudo ≥80 % 1RM cuando la métrica aplica), los secundarios a 4–8 y los accesorios a 6–12. El principal va temprano en la sesión.
- **Fuentes:**
  - [ACSM-2026]: cargas ≥80 % 1RM, 2–3 series y el ejercicio al principio de la sesión.
  - Lopez et al. 2021 (arriba).
  - Currier BS, McLeod JC, Banfield L, et al. *Resistance training prescription for muscle strength and hypertrophy in healthy adults: a systematic review and Bayesian network meta-analysis.* Br J Sports Med. 2023;57(18):1211–1220.
- **Población:** adultos sanos.
- **Confianza:** alta.
- **Última revisión:** 2026-09.
- **Notas:** la fuerza es específica de la tarea. 2J no convierte todos los ejercicios de una rutina de fuerza en trabajo muy pesado de pocas repeticiones; solo el principal.

## 2J-EVD-VOL-001 — Volumen semanal e hipertrofia

- **Regla 2J:** el volumen se evalúa en el **programa semanal**, no en un bloque aislado. Envolventes prácticas de series directas por músculo y semana: iniciado ~6–10, intermedio ~8–14 y avanzado ~10–18. **Son heurística 2J**, no límites. Superarlas se puede hacer con motivo; muy por encima (más del doble) se trata como error de programación.
- **Fuentes:**
  - [ACSM-2026]: hipertrofia mayor con ≥10 series por grupo muscular y semana (dosis-respuesta).
  - Schoenfeld BJ, Ogborn D, Krieger JW. *Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis.* J Sports Sci. 2017;35(11):1073–1082.
  - Pelland JC, Remmert JF, Robinson ZP, Hinson SR, Zourdos MC. *The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains.* Sports Med. 2026;56:481–505 (online, diciembre de 2025).
- **Población:** adultos sanos. Los datos de volumen alto proceden sobre todo de personas entrenadas.
- **Confianza:** moderada. La forma de la curva por encima de ~10–20 series es incierta y hay rendimientos decrecientes.
- **Última revisión:** 2026-09.
- **Notas:** Pelland et al. puntúan las series indirectas como fraccionales (0,5). **2J V1 solo cuenta series directas por grupo principal** y no aplica equivalencias indirectas: sería falsa precisión sin un modelo validado para nuestro catálogo. Las envolventes por nivel son decisión de producto.

## 2J-EVD-FREQ-001 — Frecuencia

- **Regla 2J:** cada grupo grande al menos 2 veces por semana cuando el programa lo permita. A volumen igualado, la frecuencia es sobre todo una herramienta para repartir volumen.
- **Fuentes:**
  - [ACSM-2026]: ≥2 sesiones por semana para fuerza; la hipertrofia no se vio afectada por la frecuencia a volumen igualado.
  - Grgic J, Schoenfeld BJ, Davies TB, Lazinica B, Krieger JW, Pedisic Z. *Effect of resistance training frequency on gains in muscular strength: a systematic review and meta-analysis.* Sports Med. 2018;48(5):1207–1220.
  - Pelland et al. 2026 (arriba).
- **Población:** adultos sanos.
- **Confianza:** moderada.
- **Última revisión:** 2026-09.

## 2J-EVD-EFF-001 — Proximidad al fallo

- **Regla 2J:** el grueso del trabajo productivo va a RPE 2J 8. El 10 (sin repetición adicional correcta) es **selectivo**: nunca todas las series, nunca en potencia y con prudencia en peso libre técnico pesado. Con cargas ligeras hay que acercarse más al límite para que el estímulo cuente.
- **Fuentes:**
  - [ACSM-2026]: esfuerzo suficiente cerca del fallo o con 2–3 RIR; el entrenamiento hasta la fatiga momentánea no tuvo un efecto consistente.
  - Refalo MC, Helms ER, Trexler ET, Hamilton DL, Fyfe JJ. *Influence of resistance training proximity-to-failure on skeletal muscle hypertrophy: a systematic review with meta-analysis.* Sports Med. 2023;53(3):649–665.
  - Robinson ZP, Pelland JC, Remmert JF, et al. *Exploring the dose-response relationship between estimated resistance training proximity to failure, strength gain, and muscle hypertrophy: a series of meta-regressions.* Sports Med. 2024;54(9):2209–2231.
- **Población:** adultos sanos.
- **Confianza:** moderada.
- **Última revisión:** 2026-09.
- **Notas:** la proximidad al fallo es difícil de estimar con precisión, sobre todo en iniciados. Por eso la escala 2J es descriptiva (véase 2J-EVD-RPE-001).

## 2J-EVD-RPE-001 — Escalas de esfuerzo

- **Regla 2J:** la escala que ve el usuario es **RPE 2J 4/6/8/10**:
  - 4 = cómodo de terminar.
  - 6 = cuesta un poco.
  - 8 = esfuerzo alto.
  - 10 = máximo, sin repetición adicional correcta.

  **No se convierte a RIR** en la prescripción visible: "RPE 8" en 2J significa "esfuerzo alto", no "exactamente 2 RIR".
- **Fuentes:**
  - Helms ER, Cronin J, Storey A, Zourdos MC. *Application of the repetitions in reserve-based rating of perceived exertion scale for resistance training.* Strength Cond J. 2016;38(4):42–49.
  - [ACSM-2026]: el esfuerzo puede medirse con varias escalas.
- **Población:** adultos que entrenan fuerza.
- **Confianza:** moderada para el concepto de autorregular por esfuerzo percibido.
- **Última revisión:** 2026-09.
- **Notas:** la escala de 4 anclas es una **simplificación 2J** para socios de gimnasio. Ya existía en la hoja imprimible de rutinas. Que un socio cuente con precisión las repeticiones en reserva no está garantizado, y 2J no finge esa precisión.

## 2J-EVD-REST-001 — Descanso entre series

- **Regla 2J:** el descanso depende de la demanda:
  - Fuerza pesada: 2–5 min.
  - Compuesto de hipertrofia: 2–3 min.
  - Máquina o secundario: 90–150 s.
  - Aislamiento: 60–120 s.
  - Potencia: 2–4 min o más.
  - Circuito o resistencia: 30–90 s.

  Estos valores son **heurística 2J**.
- **Fuentes:**
  - Grgic J, Schoenfeld BJ, Skrepnik M, Davies TB, Mikulic P. *Effects of rest interval duration in resistance training on measures of muscular strength: a systematic review.* Sports Med. 2018;48(1):137–151.
  - Grgic J, Lazinica B, Mikulic P, Krieger JW, Schoenfeld BJ. *The effects of short versus long inter-set rest intervals in resistance training on measures of muscle hypertrophy: a systematic review.* Eur J Sport Sci. 2017;17(8):983–993.
  - [ACSM-2026]: datos insuficientes sobre el descanso entre series para hipertrofia; sin diferencia clara entre menos y más de 1 minuto.
- **Población:** adultos sanos.
- **Confianza:** baja para hipertrofia; moderada para "descansos largos favorecen la fuerza".
- **Última revisión:** 2026-09.
- **Notas:** el validador solo marca como error (FAIL) un descanso fuera de rango en fuerza pesada o potencia, donde un descanso muy corto cambia el objetivo. En el resto informa.

## 2J-EVD-ORD-001 — Orden de los ejercicios

- **Regla 2J:** lo prioritario va con el usuario relativamente fresco: el movimiento de fuerza objetivo al principio. En hipertrofia, el músculo prioritario puede adelantarse.
- **Fuentes:**
  - Nunes JP, Grgic J, Cunha PM, et al. *What influence does resistance exercise order have on muscular strength gains and muscle hypertrophy? A systematic review and meta-analysis.* Eur J Sport Sci. 2021;21(2):149–157.
  - [ACSM-2026]: la fuerza mejora con el ejercicio al principio de la sesión; la hipertrofia no se vio afectada por el orden.
- **Población:** adultos sanos.
- **Confianza:** moderada.
- **Última revisión:** 2026-09.
- **Notas:** en hipertrofia, poner un aislamiento antes de su compuesto es una **nota**, no un error.

## 2J-EVD-ROM-001 — Rango de movimiento

- **Regla 2J:** por defecto, ROM completo que el usuario controle. Los parciales son válidos con una razón; no son la regla general.
- **Fuentes:**
  - Pallarés JG, Hernández-Belmonte A, Martínez-Cava A, Vetrovsky T, Steffl M, Courel-Ibáñez J. *Effects of range of motion on resistance training adaptations: a systematic review and meta-analysis.* Scand J Med Sci Sports. 2021;31(10):1866–1881.
  - [ACSM-2026]: la fuerza mejora con ROM completo; datos insuficientes para hipertrofia.
- **Población:** adultos sanos.
- **Confianza:** moderada.
- **Última revisión:** 2026-09.
- **Notas:** 2J no genera recomendaciones médicas sobre ROM. Una restricción explícita del tipo "no flexión de rodilla >90°" se respeta tal cual (2J-RULE-RESTRICTIONS).

## 2J-EVD-SS-001 — Superseries

- **Regla 2J:** las superseries son una herramienta de eficiencia. Se priorizan pares agonista/antagonista, tren superior/inferior o músculos poco interferentes. Dos compuestos pesados del mismo músculo se permiten, pero piden una razón.
- **Fuentes:** Zhang X, Weakley J, Li H, Li Z, García-Ramos A. *Superset Versus Traditional Resistance Training Prescriptions: A Systematic Review and Meta-analysis Exploring Acute and Chronic Effects on Mechanical, Metabolic, and Perceptual Variables.* Sports Med. 2025;55(4):953–975. doi:10.1007/s40279-025-02176-8. Sus hallazgos:
  - Las superseries reducen el tiempo de sesión sin comprometer el volumen ni las adaptaciones crónicas de fuerza e hipertrofia.
  - Las de agonista/antagonista mantienen mejor el volumen.
  - Aumentan la carga interna y la percepción de esfuerzo.
- **Población:** adultos entrenados y no entrenados.
- **Confianza:** moderada.
- **Última revisión:** 2026-09.

## 2J-EVD-POW-001 — Potencia

- **Regla 2J:** potencia a ~30–70 % 1RM cuando la métrica aplique, 2–6 repeticiones con intención máxima de velocidad concéntrica, volumen bajo-moderado y descanso suficiente. **Nunca RPE 10**: la serie se corta antes de que la fatiga vuelva lento el movimiento. No se genera potencia automáticamente para cualquier perfil.
- **Fuentes:** [ACSM-2026]: cargas del 30–70 % 1RM, volumen repeticiones × series < 24, halterofilia y concéntrica rápida.
- **Población:** adultos sanos, incluidos mayores. La potencia mejoró la función física.
- **Confianza:** moderada.
- **Última revisión:** 2026-09.

## 2J-EVD-OLD-001 — Adultos mayores

- **Regla 2J:** en mayores sanos se entrena fuerza, masa muscular, función, estabilidad y, cuando proceda, potencia, con progresión gradual. No se asume "poco peso y muchas repeticiones". Las restricciones médicas declaradas mandan, y el protocolo general no prescribe para patologías.
- **Fuentes:**
  - Fragala MS, Cadore EL, Dorgo S, Izquierdo M, Kraemer WJ, Peterson MD, Ryan ED. *Resistance Training for Older Adults: Position Statement From the National Strength and Conditioning Association.* J Strength Cond Res. 2019;33(8):2019–2052. doi:10.1519/JSC.0000000000003230.
  - [ACSM-2026]: el entrenamiento de fuerza es seguro para todas las edades; sin aumento de eventos adversos graves en más de 38.000 participantes, más de 11.000 de ellos mayores.
- **Población:** mayores de 65 años (NSCA) y adultos de todas las edades (ACSM).
- **Confianza:** alta.
- **Última revisión:** 2026-09.
- **Notas:** fragilidad, sarcopenia diagnosticada y otras condiciones clínicas quedan fuera del protocolo general.

## 2J-EVD-END-001 — Resistencia muscular local

- **Regla 2J:** 12–25 repeticiones, 2–4 series, descansos de 30–90 s, RPE 6–8 y ejercicios técnicamente sostenibles. **Es sobre todo heurística 2J.**
- **Fuentes:**
  - [ACSM-2026]: el entrenamiento de fuerza mejora la resistencia muscular frente a no entrenar, pero los datos fueron **insuficientes** para saber si la carga o el volumen la modifican.
  - Schoenfeld et al. 2021 (continuo de repeticiones, arriba).
- **Población:** adultos sanos.
- **Confianza:** baja.
- **Última revisión:** 2026-09.
- **Notas:** esta regla es la más expuesta a cambiar en una revisión del protocolo.
