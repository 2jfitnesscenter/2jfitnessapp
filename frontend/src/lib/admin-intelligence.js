// Admin already has workout-history access through GET /api/admin/user. Trainers do not.
import { intelligenceRecommendations } from './intelligence.js'

const VISIBLE = new Set(['RETURN_AFTER_GAP', 'PR_RECENT', 'PLATEAU', 'LOAD_TOO_HIGH'])

export function adminIntelligenceFor(detail, now = Date.now()) {
  if (!detail?.user || !Array.isArray(detail.workouts)) return []
  const S = {
    workouts: [...detail.workouts].reverse(), // admin API returns newest first
    routines: [], programs: [], unit: detail.unit || 'kg', dayPlan: {},
  }
  return intelligenceRecommendations(S, { now, max: 12 }).filter(r => VISIBLE.has(r.type)).slice(0, 3)
}
