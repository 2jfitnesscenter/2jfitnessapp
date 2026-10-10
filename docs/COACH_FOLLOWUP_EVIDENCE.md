# Evidence policy for Seguimiento PRO V3

How rules are justified, and how far each one claims to go. **Nothing in the app presents a threshold as a scientific cut-off.** The triage orders a list for a
human; the trainer decides.

## Hierarchy of sources

1. Official clinical / exercise guidelines.
2. Position stands and consensus statements.
3. Systematic reviews and meta-analyses.
4. Primary peer-reviewed studies.
5. **Internal heuristics**, always labelled as such.

Acceptable authorities depending on the topic: ACSM, WHO, NSCA, NICE, IOC, official national guidelines, peer-reviewed literature. **Not** acceptable as a scientific
authority: blogs, influencers, marketing material, supplement or app vendors. No scientific claim is hard-coded in the product without a reference here.

## What the sources are used for (and not)

| Source | Used to support | Not used for |
|---|---|---|
| WHO (2020), *Guidelines on physical activity and sedentary behaviour* | regular training (including muscle-strengthening on ≥ 2 days a week for adults) is a meaningful outcome, so **attendance/adherence is worth tracking** | any numeric threshold of the triage |
| ACSM (2009), *Progression models in resistance training for healthy adults*, Med Sci Sports Exerc 41(3):687–708 | training must be individualised and progressive; a **lack of progression is a reason to review the programme**, not a fault of the member | the 2 % / 4-exposure plateau rule (internal) |
| Zourdos et al. (2016), *Novel resistance-training-specific RPE scale measuring repetitions in reserve*, J Strength Cond Res 30(1):267–275 | RPE and RIR as one scale (RPE = 10 − RIR) for effort signals | readiness or fatigue cut-offs |
| Schoenfeld, Ogborn, Krieger (2017), *Dose-response relationship between weekly resistance training volume and increases in muscle mass*, J Sports Sci 35(11):1073–1082 | weekly volume is a relevant context for hypertrophy goals | prescribing a volume |

These references support **general principles only**. They are cited so the reasoning is auditable; they must be re-verified before being quoted outside the app.

## Rule register (tier 5 — internal heuristics)

Every rule lives in `api/lib/coach-followup.js` (`T`, `SIGNAL_TEXT`) or in the engines it reuses. Each has a test.

| Rule | Value | Why it exists | What it is **not** |
|---|---|---|---|
| Absence | 14 days → review, 28 → priority | a long gap is the simplest, most objective reason to get in touch | a judgement about commitment |
| Adherence | < 50 % of planned strength sessions in 28 days → review, < 25 % → priority; needs ≥ 14 days of history, a weekly plan and ≥ 3 planned sessions | order the list by how far the plan is from what happens | a score of the member; cardio/mobility/circuits are never counted as strength |
| Trend | last 14 days vs previous 14, ±15 points | show direction without noise | a prediction |
| Partial session | < 70 % of planned working sets | separate "came" from "did the session" | a failure |
| Plateau / review / fatigue | reused from Routine Review and `fatigue.js` (see their headers) | a pattern across several sessions, never one bad day | a cause: it says *where to look* |
| Check-in signals | high fatigue ≥ 3 times, or the same discomfort zone ≥ 3 times, in 14 days — **only if the member shares them** | ask the member, adapt the plan | a diagnosis: no medical conclusion is ever drawn |
| Body weight vs goal | ≥ 3 readings over ≥ 21 days, not moving towards the target, **fat-loss goal only** | prompt a conversation about context | evidence about performance or body composition |
| Target date | within 14 days | remind the trainer a deadline is near | |
| Review overdue | ≥ 14 days → priority | a review left unattended | |

Changing a threshold requires: a new row here, the new value in `T`, and an updated test.

## Wording rules (UI and AI)

* "Conviene revisar", "hay varias señales de fatiga; revisa recuperación y carga" — never "alerta grave", "sobreentrenado", "lesión", "enfermedad".
* The AI is given facts only, must label every statement **hecho / inferencia / sugerencia**, may not claim causality, may not give medical advice, and its answer is
  refused by the server if it contains medical wording or tries to return something applicable.
* Hypotheses are never presented as facts; suggestions are never presented as decisions. The trainer decides and the decision is logged.
