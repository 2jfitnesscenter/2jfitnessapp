# iOS / HealthKit — status: READY_FOR_DEVICE_VALIDATION (not compiled, not integrated)

Prototype: branch `wip/ios-healthkit-v2`, commit `1b29741` ("HealthKit bridge, uncompiled"). Reviewed in Sprint 3 against HEAD; **nothing was merged** because it cannot be
compiled or run without a Mac, Xcode and a physical iPhone, and a signed HealthKit entitlement.

## What the prototype contains (8 native files, 440 lines, no JS changes)
`ios/App/App/Health/HealthContract.swift` + `TwoJHealthPlugin.swift` (Capacitor plugin `TwoJHealth`, same contract as Android: `isAvailable`, `requestPermissions`,
`requestWritePermissions`, `readWorkouts`, `readActivity`, `writeWorkout`, `readEnergy`), `MainViewController.swift` (plugin registration), `App.entitlements`
(`com.apple.developer.healthkit`), `Info.plist` (`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`), `AppTests/HealthContractTests.swift`, `project.pbxproj` (edited by hand).

## Review against HEAD
- The JS side of the prototype (`health-bridge.js`, `energy*.js`, `fitness.js`, UI) is already identical in HEAD (Android Health V2). The iOS commit is *only* native files and
  `git apply --check` of `git diff 1b29741^ 1b29741` on HEAD is clean → integration = one cherry-pick, no conflicts today.
- Privacy contract is the Android one: read-only access to workouts, active energy, heart rate and steps (aggregates per workout, never raw heart-rate streams); the only write
  is the finished workout (type, start, end) after an explicit toggle. **iOS never writes calories** (an empty read is ambiguous in HealthKit, so the estimate stays inside 2J,
  labelled ESTIMATED). Usage strings say nothing is read until turned on and nothing is shared.
- Gaps found (must be solved on a Mac, not guessed):
  1. `pbxproj` was hand-edited: Xcode may rewrite or reject it; the Health folder, entitlements and `AppTests` target must be confirmed in the project navigator.
  2. Passkeys inside the iOS shell need **Associated Domains** `webcredentials:app.2jfitnesscenter.com` in the entitlements **and** an `apple-app-site-association` file served at
     `/.well-known/` (not present). Without it the remote-shell login cannot use passkeys. The server needs the iOS origin handling checked in `api/lib/webauthn-origins.js`
     (iOS signs with the https origin, so this may need nothing, but it must be verified on device).
  3. `capacitor.config` for iOS must point to the remote URL like Android does (`capacitor.remote.config.json`); only the Android assets copy step is documented.
  4. HealthKit entitlement requires a paid Apple Developer team or a free Apple ID limited to 7-day signing; HealthKit also cannot run in the simulator for real data.
  5. Apple review (if ever distributed through TestFlight/App Store) needs a privacy policy URL and justification for each read type; sideload alternatives are limited (see `docs/MOBILE.md`).

## Device-validation checklist (≈30 min once a Mac + iPhone exist)
1. `git cherry-pick 1b29741` on a branch from HEAD; `cd frontend && npm run build:mobile && npx cap open ios`.
2. Set the signing team; confirm the HealthKit capability and Associated Domains are present; build and run `AppTests` (`HealthContractTests`).
3. On the iPhone: connect (permission sheet lists only workouts, active energy, heart rate, steps); finish a workout → appears in Apple Health once; finish it again → no duplicate;
   revoke in Settings → Health → next read returns `permission_denied` and the UI returns to the connect state; confirm no kcal sample is ever written by 2J.
4. Passkey login inside the shell (after the AASA + entitlement are in place).
5. Only then merge, update `AI_HANDOFF.md`, and decide on distribution.
