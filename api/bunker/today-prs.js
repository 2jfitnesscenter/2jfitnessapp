// The Bunker Live strip is a projection of the existing Social Wall and the workout's own
// persisted `prs` list. It never creates a second record feed: a lift appears only when the
// member explicitly published that mark as public AND the finished workout already classified
// the exercise as a PR through the normal finish flow.

export function gymTodayISO(now = new Date(), timeZone = process.env.GYM_TIME_ZONE || 'Atlantic/Canary') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function previousBestWeight(workouts, workout, exId) {
  const targetTime = Number(workout.start) || 0
  let best = 0
  for (const candidate of workouts) {
    if (candidate === workout) continue
    const candidateTime = Number(candidate.start) || 0
    if (candidate.d > workout.d || (candidate.d === workout.d && candidateTime >= targetTime)) continue
    const entry = (candidate.entries || []).find(e => e.id === exId)
    for (const set of entry?.sets || []) if (set.done && Number(set.w) > best) best = Number(set.w)
    if (Number(entry?.topW) > best) best = Number(entry.topW)
  }
  return best
}

function matchesPost(set, post) {
  if (!set?.done) return false
  if (post.mode === 'cardio') return Number(set.min) === Number(post.value?.min) && Number(set.speed) === Number(post.value?.speed)
  if (post.mode === 'time') return Number(set.sec) === Number(post.value?.sec) && Number(set.w || 0) === Number(post.value?.w || 0)
  return Number(set.w) === Number(post.value?.w) && Number(set.r) === Number(post.value?.r)
}

export function publicTodayPrs({ wall = [], readState, today = gymTodayISO() }) {
  const result = []
  const states = new Map()
  for (const post of wall) {
    if (!post?.public || post.sourceDate !== today) continue
    if (!states.has(post.authorId)) states.set(post.authorId, readState(post.authorId))
    const S = states.get(post.authorId)
    const workouts = Array.isArray(S?.workouts) ? S.workouts : []
    const workout = [...workouts].reverse().find(w =>
      w.d === today && (w.prs || []).includes(post.exId) &&
      (w.entries || []).find(entry => entry.id === post.exId)?.sets?.some(set => matchesPost(set, post))
    )
    if (!workout) continue
    const previous = post.mode === 'reps' ? previousBestWeight(workouts, workout, post.exId) : 0
    const weight = Number(post.value?.w) || 0
    result.push({
      id: post.id,
      authorName: post.authorName,
      exId: post.exId,
      exName: post.exName,
      mode: post.mode,
      value: post.value,
      sourceDate: post.sourceDate,
      delta: previous > 0 && weight > previous ? Math.round((weight - previous) * 10) / 10 : null,
      createdAt: post.createdAt,
    })
  }
  return result
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, 8)
}
