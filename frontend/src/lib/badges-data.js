// The badge catalogue — what exists to unlock, not who has unlocked it (that's S.badges,
// see lib/badges.js's evaluateBadges). No TypeScript in this project (plain .js/.jsx
// throughout, no tsconfig) — the shapes below are documented the same way every other
// lib/*.js module in this codebase documents its data (a JSDoc comment), not a .ts file.
//
// Badge shape:
//   id            — string, stable forever (used as the S.badges key — never rename)
//   category      — one of BADGE_CATEGORIES
//   title         — short name shown on the cell and in the unlock celebration
//   description   — the achievement/condition, spelled out ("Completa 10 entrenamientos")
//   icon          — a components/Icon.jsx name — this app draws every icon from that SVG
//                    registry rather than shipping a raster image per icon (the one
//                    exception, lib/rank.js's rank emblems, are a gym-specific illustrated
//                    "skin" per tier; badges read as a lighter, more numerous achievement
//                    system closer to FinishSummary's PR rows, so they follow that pattern
//                    instead of asking for 30+ new pieces of custom art)
//   conditionType — 'total_workouts' | 'weekly_streak' | 'total_volume_kg' | 'strength_score'
//                   | 'first_action' | 'specific_exercise_count'
//   threshold     — number for every numeric conditionType; for 'first_action' a string key
//                   into MILESTONE_CHECKS (lib/badges.js)
//   metric        — 'specific_exercise_count' only: 'distinct' (N different exercises ever
//                   logged) or 'repeat' (the same exercise logged in N different sessions) —
//                   two genuinely different conditions the brief asked to fit under one
//                   conditionType, so this is the discriminator between them
//
// UserBadge (S.badges[badgeId]):
//   badgeId       — string, matches a Badge.id
//   unlockedAt    — ISO timestamp string, or null while still locked
//   progress      — 0..1, how close to unlocking (for a progress bar) — always 1 once unlocked

export const BADGE_CATEGORIES = ['workouts', 'milestones', 'calendar', 'streaks', 'volume', 'strength', 'exercises', 'app']

// Only the six groups the brief actually specified have badges below — 'calendar' and 'app'
// stay valid categories (so the type/UI don't need to change to add to them later) but start
// empty rather than inventing conditions nobody asked for.
export const CATEGORY_LABEL = {
  workouts: 'Workouts', milestones: 'Milestones', calendar: 'Calendar', streaks: 'Streaks',
  volume: 'Volume', strength: 'Strength', exercises: 'Exercises', app: 'App',
}
export const CATEGORY_ICON = {
  workouts: 'dumbbell', milestones: 'sparkles', calendar: 'calendar', streaks: 'flame',
  volume: 'barbell', strength: 'shield', exercises: 'exercises', app: 'star',
}

export const BADGES = [
  // ---------- workouts: total finished sessions ----------
  { id: 'workouts_1', category: 'workouts', title: 'First step', description: 'Complete your first workout.', icon: 'dumbbell', conditionType: 'total_workouts', threshold: 1 },
  { id: 'workouts_5', category: 'workouts', title: 'Finding a rhythm', description: 'Complete 5 workouts.', icon: 'dumbbell', conditionType: 'total_workouts', threshold: 5 },
  { id: 'workouts_10', category: 'workouts', title: 'Consistency', description: 'Complete 10 workouts.', icon: 'dumbbell', conditionType: 'total_workouts', threshold: 10 },
  { id: 'workouts_50', category: 'workouts', title: 'Habit forged', description: 'Complete 50 workouts.', icon: 'dumbbell', conditionType: 'total_workouts', threshold: 50 },
  { id: 'workouts_100', category: 'workouts', title: 'Centurion', description: 'Complete 100 workouts.', icon: 'dumbbell', conditionType: 'total_workouts', threshold: 100 },
  { id: 'workouts_200', category: 'workouts', title: 'Veteran', description: 'Complete 200 workouts.', icon: 'dumbbell', conditionType: 'total_workouts', threshold: 200 },

  // ---------- milestones: a specific first, not a count ----------
  { id: 'milestone_superset', category: 'milestones', title: 'Double duty', description: 'Complete your first superset.', icon: 'link', conditionType: 'first_action', threshold: 'first_superset' },
  { id: 'milestone_dropset', category: 'milestones', title: 'No mercy', description: 'Complete your first drop set.', icon: 'arrowDown', conditionType: 'first_action', threshold: 'first_dropset' },
  { id: 'milestone_cardio', category: 'milestones', title: 'Heart rate up', description: 'Log your first cardio session.', icon: 'figureRun', conditionType: 'first_action', threshold: 'first_cardio' },
  { id: 'milestone_failure', category: 'milestones', title: 'To the limit', description: 'Log your first set taken to failure (RIR 0 / RPE 10).', icon: 'flame', conditionType: 'first_action', threshold: 'first_failure_set' },
  { id: 'milestone_fullbody', category: 'milestones', title: 'Full body', description: 'Complete a workout that trains every major muscle group.', icon: 'figureStrength', conditionType: 'first_action', threshold: 'first_full_body' },

  // ---------- streaks: consecutive weeks with at least one workout ----------
  { id: 'streak_1', category: 'streaks', title: 'Off the ground', description: 'Train in 1 week.', icon: 'flame', conditionType: 'weekly_streak', threshold: 1 },
  { id: 'streak_5', category: 'streaks', title: 'Real streak', description: 'Train 5 weeks in a row.', icon: 'flame', conditionType: 'weekly_streak', threshold: 5 },
  { id: 'streak_10', category: 'streaks', title: 'Unstoppable', description: 'Train 10 weeks in a row.', icon: 'flame', conditionType: 'weekly_streak', threshold: 10 },
  { id: 'streak_20', category: 'streaks', title: 'Ironclad', description: 'Train 20 weeks in a row.', icon: 'flame', conditionType: 'weekly_streak', threshold: 20 },
  { id: 'streak_35', category: 'streaks', title: 'Unbreakable', description: 'Train 35 weeks in a row.', icon: 'flame', conditionType: 'weekly_streak', threshold: 35 },
  { id: 'streak_50', category: 'streaks', title: 'Gym legend', description: 'Train 50 weeks in a row.', icon: 'flame', conditionType: 'weekly_streak', threshold: 50 },

  // ---------- volume: accumulated kg lifted, ever ----------
  { id: 'volume_5000', category: 'volume', title: 'First tonnes', description: 'Lift 5,000 kg in total.', icon: 'barbell', conditionType: 'total_volume_kg', threshold: 5000 },
  { id: 'volume_10000', category: 'volume', title: '10 tonnes', description: 'Lift 10,000 kg in total.', icon: 'barbell', conditionType: 'total_volume_kg', threshold: 10000 },
  { id: 'volume_50000', category: 'volume', title: '50 tonnes', description: 'Lift 50,000 kg in total.', icon: 'barbell', conditionType: 'total_volume_kg', threshold: 50000 },
  { id: 'volume_100000', category: 'volume', title: '100 tonnes', description: 'Lift 100,000 kg in total.', icon: 'barbell', conditionType: 'total_volume_kg', threshold: 100000 },
  { id: 'volume_250000', category: 'volume', title: 'Quarter million', description: 'Lift 250,000 kg in total.', icon: 'barbell', conditionType: 'total_volume_kg', threshold: 250000 },
  { id: 'volume_1000000', category: 'volume', title: 'A million kilos', description: 'Lift 1,000,000 kg in total.', icon: 'barbell', conditionType: 'total_volume_kg', threshold: 1000000 },

  // ---------- exercises: breadth (distinct exercises) and depth (repeats of one) ----------
  { id: 'exercises_distinct_10', category: 'exercises', title: 'Explorer', description: 'Log 10 different exercises.', icon: 'exercises', conditionType: 'specific_exercise_count', metric: 'distinct', threshold: 10 },
  { id: 'exercises_distinct_25', category: 'exercises', title: 'Curious', description: 'Log 25 different exercises.', icon: 'exercises', conditionType: 'specific_exercise_count', metric: 'distinct', threshold: 25 },
  { id: 'exercises_distinct_50', category: 'exercises', title: 'Encyclopedic', description: 'Log 50 different exercises.', icon: 'exercises', conditionType: 'specific_exercise_count', metric: 'distinct', threshold: 50 },
  { id: 'exercises_distinct_100', category: 'exercises', title: 'Catalogue master', description: 'Log 100 different exercises.', icon: 'exercises', conditionType: 'specific_exercise_count', metric: 'distinct', threshold: 100 },
  { id: 'exercises_repeat_10', category: 'exercises', title: 'Getting the hang of it', description: 'Train the same exercise across 10 different sessions.', icon: 'reset', conditionType: 'specific_exercise_count', metric: 'repeat', threshold: 10 },
  { id: 'exercises_repeat_25', category: 'exercises', title: 'Old friends', description: 'Train the same exercise across 25 different sessions.', icon: 'reset', conditionType: 'specific_exercise_count', metric: 'repeat', threshold: 25 },
  { id: 'exercises_repeat_50', category: 'exercises', title: 'Inseparable', description: 'Train the same exercise across 50 different sessions.', icon: 'reset', conditionType: 'specific_exercise_count', metric: 'repeat', threshold: 50 },

  // ---------- strength: the global strength score (lib/badges.js's strengthScore) ----------
  { id: 'strength_100', category: 'strength', title: 'Solid base', description: 'Reach a strength score of 100.', icon: 'shield', conditionType: 'strength_score', threshold: 100 },
  { id: 'strength_150', category: 'strength', title: 'On the rise', description: 'Reach a strength score of 150.', icon: 'shield', conditionType: 'strength_score', threshold: 150 },
  { id: 'strength_200', category: 'strength', title: 'Notable strength', description: 'Reach a strength score of 200.', icon: 'shield', conditionType: 'strength_score', threshold: 200 },
  { id: 'strength_250', category: 'strength', title: 'Elite', description: 'Reach a strength score of 250.', icon: 'shield', conditionType: 'strength_score', threshold: 250 },
]

export const BADGE_BY_ID = Object.fromEntries(BADGES.map(b => [b.id, b]))
export const BADGES_BY_CATEGORY = Object.fromEntries(BADGE_CATEGORIES.map(c => [c, BADGES.filter(b => b.category === c)]))

// The celebration modal's accent — gold/cyan/emerald, reusing the app's own existing semantic
// tokens (var(--yellow)/var(--teal)/var(--green), the same three effortColor already uses for
// "intensity") rather than introducing new hex literals that would fight a member's chosen
// accent color. Derived from catalogue position, not stored per badge: the single highest
// threshold in a numbered ladder (workouts_200, volume_1000000…) reads as the prestige "gold"
// one, everything else alternates cyan/emerald for variety. A milestone has no ladder to be
// "highest" in, so it just cycles the same way.
const ACCENT_CYCLE = ['cyan', 'emerald']
export const ACCENT_COLOR_VAR = { gold: 'var(--yellow)', cyan: 'var(--teal)', emerald: 'var(--green)' }
export function badgeAccent(b) {
  const list = BADGES_BY_CATEGORY[b.category] || []
  const idx = list.indexOf(b)
  if (list.length > 1 && idx === list.length - 1) return 'gold'
  return ACCENT_CYCLE[Math.max(0, idx) % ACCENT_CYCLE.length]
}
