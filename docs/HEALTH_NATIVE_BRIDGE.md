# Health native bridge — design only, not implemented

Status: **design**. Nothing in this document is built. No Capacitor, no native project, no store
listing. It needs an explicit go-ahead from the owner (see “Decisions needed” at the end).

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
