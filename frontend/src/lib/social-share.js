// The card renderer accepts only this allow-list. Names, dates and metrics are supplied by the
// specific share action; health or profile objects can never be spread into a render payload.
const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max)
export function socialCardPayload(kind, value = {}) {
  const types = new Set(['routine', 'program', 'record', 'challenge'])
  if (!types.has(kind)) throw new Error('Unsupported social share type')
  return Object.freeze({
    kind,
    title: clean(value.title, 80),
    subtitle: clean(value.subtitle, 100),
    metric: clean(value.metric, 80),
    date: clean(value.date, 40)
  })
}
