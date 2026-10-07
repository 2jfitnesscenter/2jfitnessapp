# Generated and mirrored files

Generated text is committed so the frontend and API Docker build contexts stay self-contained. Keep the listed inputs canonical, regenerate with the named script, then run its `--check` command. Do not hand-edit the generated copy. All text outputs use LF; check scripts normalize CRLF only where explicitly stated, while still comparing content and order.

| Output | Generator | Canonical inputs | EOL / reproducibility |
|---|---|---|---|
| `api/coach/library.json` | `scripts/build-coach-library.mjs` | `frontend/src/lib/exercises-data.js`, `frontend/src/lib/library/core.js` and its metadata imports | LF; deterministic; `node scripts/build-coach-library.mjs --check` |
| `api/lib/blocks-official.json` | `scripts/build-official-blocks.mjs` | exercise catalogue, `frontend/src/lib/protocol/`, `scripts/protocol/official-blocks.matrix.mjs` | LF; deterministic; `node scripts/build-official-blocks.mjs --check` |
| `api/lib/guided-official.json` | `scripts/build-official-routines.mjs` | `api/lib/blocks-official.json`, exercise catalogue, protocol runtime, `scripts/protocol/official-routines.matrix.mjs` | LF; deterministic; `node scripts/build-official-routines.mjs --check` |
| `api/lib/gym-profiles.js` | `scripts/sync-gym-profiles.mjs` | `frontend/src/lib/gym-profile-model.js` | LF; CRLF is normalized for check; `node scripts/sync-gym-profiles.mjs --check` |
| `api/lib/guided-program-model.js` | `scripts/sync-guided-program-model.mjs` | `frontend/src/lib/guided-programs.js` | LF; CRLF is normalized for check; `node scripts/sync-guided-program-model.mjs --check` |
| `api/lib/library-overlay.js` | `scripts/sync-library-overlay.mjs` | `frontend/src/lib/library/overlay.js` | LF; CRLF is normalized for check; `node scripts/sync-library-overlay.mjs --check` |
| `api/lib/protocol/*.js` (nine runtime modules) | `scripts/sync-protocol.mjs` | matching `frontend/src/lib/protocol/*.js` files, excluding tests | LF; byte-identical after the generated header; `node scripts/sync-protocol.mjs --check` |
| `api/lib/workout-activity.js` | `scripts/sync-workout-activity.mjs` | `frontend/src/lib/workout-activity.js` | LF; CRLF is normalized for check; `node scripts/sync-workout-activity.mjs --check` |
| `frontend/src/instr/{es,fr,it,tr,ru,zh,hi,pl,ko}.js` | `scripts/build-instructions.mjs` | `hasaneyldrm/exercises-dataset` `data/exercises.json`; pass a saved JSON file as the script argument to avoid fetching a moving `main` branch | LF; deterministic for a fixed input file. The default network source is moving, so use a retained input snapshot when reproducing an older output. |

`frontend/src/lib/exercises-data.js` is a vendored catalogue input, not a generated output of this repository. `frontend/public` images, fonts, and media are binary assets, not generated text. `.gitattributes` pins source/generated text to LF, PowerShell to CRLF, and common binary assets to binary handling. We intentionally do not renormalize the repository wholesale; new edits follow the policy and existing generated checks remain the content authority.
