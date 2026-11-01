# AI reliability — one tap, the retries are ours

The person asks once. Retrying, waiting, repairing an answer, double-checking a reading or switching
to a second model happens behind that one action, inside a fixed budget. A provider word
("503", "overloaded", "rate limit", "timeout") reaches a person only through a plain sentence
after the budget is spent or the failure cannot be fixed by trying again.

## The flows and where they run

| Flow (metrics name) | Frontend | Endpoint | Runs as | Provider |
|---|---|---|---|---|
| `member_routine` — Coach plan | `views/Coach.jsx` | `POST /api/coach/…` | job in `coach/jobs.js`, persisted in `data/coach/<uid>.json` | the Coach provider (Claude, Codex, Gemini, OpenAI) |
| `coach_review` — Coach review | `views/Coach.jsx` | same, or the weekly cadence | same | same |
| `trainer_routine` — "Generate with AI" | `views/trainer/TrainerAIGenerate.jsx` | `POST /api/trainer/ai/generate` | job in `coach/trainer-jobs.js`, persisted in `data/trainer-ai-jobs.json` | Claude (always) |
| `measurement_scan` — bioimpedance report | `components/ScanUpload.jsx` → `lib/media.js` | `POST /api/scan/start` + `GET /api/scan/status` | short in-memory job (`lib/scan-jobs.js`) | Gemini (aux profile) |
| `routine_scan` — photographed routine | same | same | same | Gemini (aux profile) |
| `machine_scan` — machine photo | same | same | same | Gemini (aux profile) |

`POST /api/measurements/scan`, `/api/routines/scan` and `/api/exercises/scan-machine` remain for app
versions that are still installed. They run the same engine inside nginx's 60 s (`scan_sync` policy).

Other Gemini uses (import-name matching, the Coach follow-up/explanation calls) keep their own small,
single-purpose retry logic and are not part of this layer.

## One gateway

`api/coach/ai-run.js` is the only place that calls a provider on behalf of these flows.

* **Classification** — retryable: 408/429/5xx/529, overloaded, rate limit, connection reset / DNS, timeout,
  empty answer, interrupted stream. Not retryable on the same candidate: 401/403 and credentials, a missing
  runtime, a refused request (other 4xx). A configured fallback is still tried for credential / runtime / 404
  problems, since it may use another model.
* **Backoff** — exponential per policy (`POLICIES`), ±25 % jitter, a provider `Retry-After` is honoured (capped at 15 s).
* **Budget** — one `makeBudget()` per user-visible request, shared by generation, repairs, extra reads and fallbacks:
  a maximum number of provider calls and a maximum wall clock. When there is no time left for a wait plus a worthwhile
  call, it stops instead of starting one that cannot finish.

| Policy | per-candidate attempts | calls in the whole request | wall clock |
|---|---|---|---|
| `member_routine` | 4 | 8 | 9 min |
| `trainer_routine` | 5 | 8 | 12 min |
| `coach_review` | 4 | 6 | 8 min |
| `scan` (jobs) | 4 | 6 | 100 s |
| `scan_sync` (legacy endpoints) | 3 | 4 | 48 s |

A normal request is ONE call: the numbers are ceilings for a bad day.

* **Fallback** — `fallbackModel` (a second model of the SAME provider) in `coach.json`, `trainer-ai.json` and `aux-ai.json`.
  Empty by default. Switching to a different *provider* is not offered: every flow stores a single credential, and no provider
  is added that has no credentials configured here. Vision exists only in the Gemini adapter; the Coach prompts need structured
  JSON, which every adapter returns as text that `extractJSON` + the validators check.
* **Cancellation** — an `AbortSignal` in the budget: discarding a trainer draft, cancelling a scan job, or a closed connection on
  the legacy endpoints stops the retries at the next opportunity.

## Routines (member Coach, trainer)

`api/coach/ai-generate.js` — generate → parse → validate → 2J protocol gate → repair (up to 2 rounds, only while the budget lasts).
A provider failure is never mistaken for an answer and an unusable answer is never reported as a provider failure.
Error classes the person can see: `unavailable` (still busy after the whole budget), `timeout`, `auth`, `missing`, `provider`,
`unusable`, `restart`. While it runs the job has a `phase`: `queued → generating → retrying | fallback → validating → repairing`.

Jobs and restarts: member jobs keep the *request* (not the answer) in their record and are started again once after a restart;
trainer jobs live in `data/trainer-ai-jobs.json` (atomic, 0600): a restart starts them again once, a finished draft is kept for a
day, the brief is dropped as soon as the job ends. A second interruption ends honestly as `restart`.

## Vision scans

`api/lib/ai-vision.js` runs every read (retry + fallback + JSON parsing + a re-ask on bad JSON); each scan owns only its prompt and
what "trustworthy" means.

* **Measurements** (`lib/measurements-consensus.js`, deterministic): a read is accepted alone only if every value is in range, the
  core fields exist, the model says it is sure and the physical cross-checks hold (fat + muscle + bone ≤ body weight, muscle < weight,
  water % plausible, segments ≈ total). Otherwise a second read; fields that disagree get a third; each field takes the majority
  (62.1 vs 62.0 agree, 17.3 vs 37.3 never do). No majority → `null` and the field is named in `review`. If the provider will not give
  a second opinion, only fields that no failed check involves are returned. Never more than three reads.
* **Routines** (`lib/routine-validate.js`): one transcription; deterministic checks name the doubtful rows (missing/garbled name,
  impossible numbers, one name resembling nothing in `coach/library.json`). Only those rows are re-read, located by position, in a single
  extra call. If that fails the first transcription is kept.
* **Machines**: library-matched, confident first read → done; otherwise a second read; two different exercises → a third. Never more than three.

The photo exists only in the memory of the running request/job and is dropped when it ends; nothing about it is written to disk or logged.
The per-file consent (`external-ai-scan-v1`) is still validated by the server before anything is read or sent (`lib/scan-routes.js`).
A scan that ends without a result gives its daily slot back.

## Metrics (numbers only)

`api/lib/ai-metrics.js` → `data/ai-metrics.json`, shown to admins at `GET /api/admin/ai-metrics`. Per flow: requests, `first_try_success`,
`retry_success`, `repair_success`, `fallback_success`, `final_failure`, calls, 429 / 503 / other 5xx, timeouts, bad JSON, validation
failures, second/third reads, cancelled, average attempts and latency. No prompt, photo, answer, member id or credential is ever recorded.

## Benchmark with real, anonymised samples (not in git)

```
GEMINI_API_KEY=... node api/scripts/ai-scan-benchmark.mjs benchmarks/ai-scans --runs 3
```

Put pairs in `benchmarks/ai-scans/` (git-ignored): `measurements-01.jpg` + `measurements-01.expected.json`
(`{"weight":82.4,"bodyFat":17.3,…}`), `routine-02.jpg` + `routine-02.expected.json` (`{"days":[{"exercises":[{"nameEn":"…","sets":3,"reps":10}]}]}`),
`machine-03.jpg` + `machine-03.expected.json` (`{"nameEn":"leg press"}`). Only photos you may use (the member's permission, identifying details cropped).
It prints, per sample, how many of the runs were exact, the average time, and calls per request. The key stays in the process; nothing is saved.
