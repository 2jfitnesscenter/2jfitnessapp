// A short, in-app version history — condensed from CHANGELOG.md (the full, prose version kept
// in the repo for GitHub) down to one line per change, no explanations. Item strings go through
// t() wherever they're rendered, same as every other UI string, so translators can pick them up;
// a version's own `date` is a plain ISO string formatted with the viewer's locale at render time.
//
// The 'dev' entry has no version number on purpose: it's everything shipped on top of v1.2.3
// that hasn't been tagged as a release yet, listed so "what changed recently" has an honest
// answer even before that's a formal version — update it as things land, and fold it into a new
// numbered entry (with today's date) once a release is actually cut.
export const CHANGELOG = [
  {
    version: null, date: null,
    items: [
      'Smarter "Replace exercise": ranked alternatives instead of a flat list, with equipment filters',
      'Training zones: %1RM/RPE-based intensity zones, shown per set and as a weekly/monthly volume chart',
      'An interactive barbell plate calculator — 9 bar types, edit the target weight, apply it to a set',
      'Muscle recovery: size-aware recovery windows and effort-weighted fatigue, with a time-to-ready estimate',
      '3D badge artwork and a 2J master crest on the Badges screen',
      'Program day cards show each day’s full exercise breakdown, not just the routine name',
      'A badges/achievement system, with a festive unlock celebration',
      'Segmented body-fat and muscle-mass tracking (per limb/trunk), with a %/kg toggle',
      'Strength rank system, with a per-lift, per-muscle-group and overall rank',
      'A staff badge on trainer/admin profiles and their posts',
      'Stretching: an auto-planned or self-picked stretch-only session',
      'Social: trainer-created challenges and private (optionally published) exercise goals',
      'A desktop panel for trainers to build client routines, with optional AI-generated plans',
      'Per-exercise and full-plan PDF export',
      'Profile photo upload',
      'Liquid-glass appearance option, with adjustable opacity and blur',
      'Self-service "lost passkey" recovery, admin-assisted',
      'First + last name required when creating a profile',
      'Health data (workout history, body weight, measurements) encrypted at rest',
      'A batch of smaller fixes across warm-up sets, layout on iOS and accessibility text sizes'
    ]
  },
  {
    version: 'v1.3.0', date: '2026-09-21',
    items: [
      'Superset colors and labels (A1/A2, B1/B2…), consistent on screen and in print',
      'Adaptive print density — a 2-day routine fits one page, a 5-day plan around two',
      'CSV import: Gravl format support, more conservative superset grouping',
      'A separate, isolated AI profile for machine/report/routine scanning and CSV matching',
      'CSV import: a review screen for exercise matches, with optional AI suggestions',
      'Equipment availability — mark gear temporarily out of service, matching exercises are skipped when a workout starts',
      'AI Coach: a direct OpenAI option, alongside Claude and Gemini',
      'Trainer notes on a routine exercise, shown during training and in print',
      'Routine/program version history for trainer-assigned plans',
      '"Show previous sessions" — an exercise’s last three real sessions, on demand',
      'Routine/program rows show a quick summary — exercises, supersets, days, unavailable count',
      'Fixed: a finished or discarded training session could keep reappearing',
      'Fixed: minimizing at the Bunker to let someone else train could strand your own session'
    ]
  },
  {
    version: 'v1.2.3', date: '2026-07-31',
    items: [
      'Keep the screen awake during a workout',
      'Rest timer: a −15s button, redesigned layout',
      'Settings reorganized by what each setting actually affects',
      'Effort per set (RIR or RPE), optional',
      'Effort ratings now come through when importing from another app'
    ]
  },
  {
    version: 'v1.2.2', date: '2026-07-25',
    items: [
      'Timed sets (planks, holds) as an alternative to reps',
      'A progression rule per routine — linear, Greyskull LP, double progression, or none',
      'An estimated one-rep max for every exercise',
      'Share or print a plan',
      'A standalone mobile app (Android APK)',
      'Import history from FitNotes, Strong, Hevy or Apple Health',
      'Fixed: a shared plan naming an unknown exercise could take the app down',
      'Fixed: unit conversion on import applied per file instead of per row'
    ]
  },
  {
    version: 'v1.2.1', date: '2026-07-23',
    items: [
      'A muscle map (front/back body diagram) in Stats, the routine editor and the finish screen',
      'A browser-only live demo, no install needed',
      'Fixed: finishing a workout from its last exercise could blank the app'
    ]
  },
  {
    version: 'v1.2.0', date: '2026-07-23',
    items: [
      'A full visual redesign — new design system, hand-drawn icon set, new tab bar',
      'Home rebuilt around today’s plan',
      'Chart fixes: dark-mode visibility, hover tooltip positioning'
    ]
  },
  {
    version: 'v1.1.3', date: '2026-07-22',
    items: [
      'Admin dashboard (opt-in): user overview, live "training now", disable accounts, invite-only signup',
      'Filter exercises by equipment',
      'Minimize the exercise animation during a workout',
      'Fixed: the rest timer could freeze at 0:01'
    ]
  },
  {
    version: 'v1.1.2', date: '2026-07-22',
    items: [
      'Custom exercises — create, edit and delete your own',
      '12 UI languages, with translated exercise instructions',
      'Fixed: decimal comma input, and the exercise-config sheet overflowing on narrow phones'
    ]
  },
  {
    version: 'v1.1.1', date: '2026-07-21',
    items: [
      'Reliability fixes for push notifications: correct timezone, faster delivery, save-on-background'
    ]
  },
  {
    version: 'v1.1.0', date: '2026-07-21',
    items: [
      'Prebuilt Docker images',
      'Push notifications: rest-timer-over alert and a daily workout reminder',
      'Fixed: the rest timer stalling when the app was backgrounded'
    ]
  },
  {
    version: 'v1.0.0', date: '2026-07-20',
    items: [
      'First release: body-weight tracking, routine planner, guided workouts',
      'Supersets and cardio logging',
      'Passkey login with per-profile data synced across devices',
      'Light/dark themes with 8 accent colors',
      'JSON export/import, guest mode, installable PWA'
    ]
  }
]
