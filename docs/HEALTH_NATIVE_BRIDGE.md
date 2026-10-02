# Health native bridge

Status: **web phase implemented; Android bridge compiled locally, not yet run on a device.** `frontend/src/lib/health-bridge.js` detects
`window.TwoJNative.health` (or a Capacitor plugin `TwoJHealth`), asks for read access only on an explicit tap,
reads per-workout aggregates, re-validates/whitelists them and attaches them through the existing mappers and
`matchAll`/`attachFitness` (no endpoint, no new queue, consent kept on the device, off by default). Without a
shell nothing is rendered. The native Android/iOS plugins that implement the contract below are the next phase and
still need the owner’s go-ahead (see “Decisions needed”). Optional calorie/heart-rate fields are retained only when
their corresponding OS grants were returned; consent without workout access cannot read. Results outside the requested
date window are rejected, and a revocation during an in-flight read discards its result. The UI also discards results if
the signed-in account changes before attachment.

### Android phase (Health Connect, read-only) — plugin compiled locally, NOT yet run on a device

Architecture: reuse the existing Capacitor Android project (`frontend/android`) with a **local Capacitor plugin** `TwoJHealth`
(Kotlin, `com.twojfitnesscenter.app.health`), registered in `MainActivity`. No second shell. Methods: `isAvailable`, `requestPermissions`,
`readWorkouts({start,end}) → { sessions }` (the web adapter in `health-bridge.js` unwraps it). Permissions: only `READ_EXERCISE` (required),
`READ_ACTIVE_CALORIES_BURNED` and `READ_HEART_RATE` (optional); no write permission exists; aggregates per data origin, never raw samples;
window clamped to 90 days / 500 sessions; permissions re-read on every read (revoked → `permission_denied`). Pure contract logic lives in
`HealthContract.kt` (7 JVM tests in `HealthContractTest.kt`, passing). Windows build verified with `testDebugUnitTest` and `assembleDebug`;
the Health Connect 1.1.0 dependency required AGP 8.10.1 and compile SDK 36. `minSdk` raised 23 → 26 (Health Connect, java.time). **Open decision:** the current
Capacitor build is the standalone offline store app (no backend, no passkeys); the gym app (passkeys, Sync V2) needs a shell mode that loads the
PWA by URL — the plugin works in both, but passkeys inside that WebView must be verified on a device. Before release, verify the Health Connect
permission-rationale screen and decide whether the UI's 90-day maximum should request historical-read permission or remain effectively limited by Health Connect's default history access.

### V2 — read + write + daily activity (Android validated on a real device; iOS pending Mac/Xcode)

Shared contract (`frontend/src/lib/health-bridge.js`; Android Kotlin and iOS Swift differ only underneath): `requestPermissions` (read: workouts, activeCalories, heartRate, steps), `readWorkouts`, `readActivity({start,end})` (the store’s own de-duplicated steps + ACTIVE kcal), `requestWritePermissions` (separate consent, `writeWorkouts` only) and `writeWorkout({id,version,start,end,type,title,estimatedActiveKcal?})`. Energy (`lib/energy.js`): one number per workout by priority — 1 measured by a wearable and attached to the workout, 2 the store aggregate over its interval, 3 a labelled 2J estimate (MET/heart-rate, range, needs weight and duration); never summed, active energy only. Export: the session under the id `2j:<workout id>` (Health Connect upserts by clientRecordId, HealthKit by sync identifier + a lookup first); calories and distance are never written, a 2J estimate only as a labelled note; a failed export is queued and retried and never touches the workout. Read-back: sessions with `2j:` ids or this app as origin are dropped, so 2J’s own workouts are not counted twice. iOS cannot report whether a READ was allowed (HealthKit privacy): a refused type returns no data.

**Energy reconciliation (policy: never duplicate calories; completing a workout with an estimate comes second).** Priority: measured wearable > aggregated Health > 2J estimate. The workout is exported at once, never with kcal. `lib/energy-reconcile.js` checks (`readEnergy`) the store's OFFICIAL AGGREGATE of active energy for the interval (individual records are never summed; Health's own source de-duplication applies). ANY external energy > 0 → 2J writes nothing and shows that value locally as "aggregated"; coverage is not a criterion. Android only: if read AND write permissions exist and, after a 15-minute grace, the aggregate is really 0, 2J writes ONE active-calories sample labelled as its estimate (client id `2j:<id>:kcal-est`, permission `writeActiveCalories`), re-checking the aggregate immediately before writing (`external_available` otherwise). If an external source appears later, 2J deletes ONLY that sample (store-enforced ownership). iOS: HealthKit cannot tell "no data" from "read not allowed", so an empty read is never proof of absence: iOS NEVER writes calories (`emptyConfirmed:false`); the workout is exported without kcal and 2J's estimate stays visible inside 2J as ESTIMATED, and a later external aggregate is still picked up. State lives in `w.fitness` (`energyKind`) plus the device-local transitional queue `health_energy_v1:<uid>` (7-day watch window); no new sync/backend. Failures never block finishing a workout. Status: Android is validated on a Galaxy S25 Ultra (zero aggregate → single estimate; external aggregate → `external_available`; idempotent; delete removes only 2J's own sample; other apps' data untouched). Health Connect's aggregate does not count 2J's sample until 2J is in the user's source priority. iOS code exists in the working tree but is uncompiled, not committed, and needs a Mac/Xcode, a physical iPhone and HealthKit signing. Limits: runs only while the app is open (an Android estimate may stay if never reopened); the aggregate follows the user's source priority in Health; export ≤30 days, read ≤90.

## Why a native layer is needed at all

| Source | What a PWA can do today | What needs native |
|---|---|---|
| **Health Connect** (Android) | Nothing. It is an Android Jetpack SDK (`androidx.health.connect`), with no web or PWA API. | Everything: read permission, reading records |
| **HealthKit / Apple Health** (iOS) | Only the manual `export.xml` import (already built: `parseAppleHealth` → `appleWorkouts`) | Automatic reading |
| **Zepp / Amazfit** | Nothing direct. Zepp has no usable public cloud API; private APIs and reverse engineering are ruled out. | Nothing Zepp-specific: Zepp **writes** to Health Connect (Android) and Apple Health (iOS), so the two bridges above cover it |
| **WHOOP** | Already built (server OAuth, `read:workout`, tokens encrypted) | — |
| **Bluetooth HR strap** | Built (Web Bluetooth, experimental) on Android Chrome and desktop | iOS Safari has no Web Bluetooth: needs native on iPhone |

So the smallest native layer that matters: **one Android shell reading Health Connect** and
**one iOS shell reading HealthKit**. Both reuse the same web app.

## Architecture: thin shell, same web app

```
┌──────────── native shell (Android / iOS) ────────────┐
│  WebView → https://<the same 2J PWA>                  │
│  Health plugin (read-only):                           │
│    isAvailable() · requestPermissions() · readWorkouts│
│  No 2J logic, no storage of health data, no network   │
└──────────────────────────┬───────────────────────────┘
                           │ JS bridge (window.TwoJNative)
┌──────────────────────────▼───────────────────────────┐
│  Web app (unchanged code paths)                       │
│  mapHealthConnectSession / mapHealthKitWorkout        │  ← frontend/src/lib/fitness.js
│  → matchAll → attachFitness (w.fitness)               │  ← already tested
│  → normal Sync V2 journal (no second queue)           │
└───────────────────────────────────────────────────────┘
```

The shell is a feature detector: `window.TwoJNative?.health` exists → Settings → Fitness
integrations shows “Health Connect” / “Apple Health (automatic)”. If it doesn't exist (a normal
browser, the installed PWA), the screen stays exactly as it is today. No fake buttons.

### JS ↔ native interface (the contract the web app already has mappers for)

```ts
interface TwoJHealth {
  isAvailable(): Promise<{ available: boolean, reason?: 'not_installed' | 'unsupported' }>
  requestPermissions(): Promise<{ granted: string[] }>          // read-only, see below
  readWorkouts(q: { start: string, end: string }): Promise<Session[]>
}
// Android: Session = ExerciseSessionRecord + aggregates the shell computed for its window
{ startTime, endTime, exerciseType, metadata: { id, dataOrigin: { packageName } },
  aggregates: { activeCaloriesKcal?, totalCaloriesKcal?, hrAvg?, hrMax? } }
// iOS: Session = HKWorkout + statistics
{ uuid, startDate, endDate, workoutActivityType, sourceRevision: { source: { name, bundleIdentifier } },
  activeEnergyKcal?, hrAvg?, hrMax? }
```

Those are the exact inputs of `mapHealthConnectSession` and `mapHealthKitWorkout`
(`frontend/src/lib/fitness.js`), which already have fixture tests. Aggregates are computed on
the device. The raw heart-rate stream never crosses the bridge.

### Permissions (read-only, minimum)

- Android Health Connect: `READ_EXERCISE`, `READ_ACTIVE_CALORIES_BURNED`, `READ_HEART_RATE`
  (optional later: `READ_WEIGHT`, `READ_BODY_FAT`). **No write permissions.**
- iOS HealthKit: read `HKWorkoutType`, `activeEnergyBurned`, `heartRate`. No share/write.
- Both platforms require a privacy policy that states what is read and why. Health Connect
  also requires the Play Console health-apps declaration form.

### Data exchanged, auth and sync

- Only per-workout aggregates. They go into `w.fitness` on the member's device and travel inside
  the member's normal encrypted state (Sync V2). No new endpoint and no server-side token: the
  health store's permission belongs to the device.
- Session auth stays exactly as today: passkeys in the WebView. Associated domains / Digital
  Asset Links are needed so passkeys work inside the shell.
- Idempotency is already solved: `attachFitness` dedupes by `source + externalId`, and matching
  never links on a guess (ambiguous items go to the manual chooser).

### Distribution and maintenance

- Android: Play Store (internal testing track first). Health Connect is built into Android 14+.
  Older devices need the Health Connect app.
- iOS: App Store. Apple reviews apps that are just a website wrapper strictly (guideline 4.2):
  the HealthKit feature is the native value, and the store listing must say so.
- Maintenance: two small native projects, OS/SDK updates about once a year, store policy
  reviews, and signing keys. Estimate: a few days per platform to build, then light upkeep.

### Impact on the PWA

None, if the shell is only a feature detector. The installed PWA, offline mode, Sync V2 and the
Service Worker keep working as they do now. The only shared code is the already-tested mappers.

## Decisions needed (owner)

1. Authorize an Android shell (Health Connect). Recommended first: it covers Zepp/Amazfit,
   Samsung, Google/Fitbit and Garmin, since all of them write to Health Connect.
2. Authorize an iOS shell (HealthKit), or keep the manual export on iPhone for now.
3. Accept store accounts, the privacy policy and the Health Connect declaration.
4. Shell technology: Capacitor (fastest, reuses the web app) vs. a hand-written WebView shell.
   Capacitor was **not** added without authorization.
