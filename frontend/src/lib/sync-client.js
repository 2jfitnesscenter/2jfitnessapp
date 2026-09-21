// Persist the immutable wire operation before attempting delivery. No timestamp arbitration.
export class SyncClient {
  constructor({ uid, api, storage, onChange, initial, legacyDirty = false }) {
    this.key = 'gym_sync_v2:' + uid
    this.uid = uid
    this.api = api; this.storage = storage; this.onChange = onChange
    const raw = storage.getItem(this.key)
    // Invalid local journals must not be silently replaced either.
    this.record = raw ? JSON.parse(raw) : { base: null, operations: [], draft: initial, recovery: initial, conflict: legacyDirty ? 'LEGACY_RECOVERY_REQUIRED' : null }
    // Separate immutable operation records also protect against another tab replacing the
    // account journal, and against a crash between journaling intent and updating its view.
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(this.key + ':op:')) continue
      const recovered = JSON.parse(storage.getItem(key))
      if (!this.record.operations.some(op => op.operationId === recovered.operationId)) {
        this.record.operations.push(recovered)
      }
    }
    this.persist()
  }
  persist() { this.storage.setItem(this.key, JSON.stringify(this.record)) }
  publish() {
    this.onChange(this.record.operations.length || this.record.conflict ? this.record.draft : this.record.base?.state,
      this.record.conflict ? 'conflict' : this.record.operations.length ? 'pending' : 'synced')
  }
  enqueue(type, state, extra = {}) {
    const r = this.record
    const base = r.base?.meta
    const revision = base ? base.revision + r.operations.length : null
    const generation = base ? base.generation + r.operations.filter(x => x.type === 'reset' || x.type === 'replace').length : null
    const op = { operationId: crypto.randomUUID(), owner: this.uid, type, revision, generation, ...extra }
    if (state) op.state = JSON.parse(JSON.stringify(state))
    this.storage.setItem(this.key + ':op:' + op.operationId, JSON.stringify(op))
    r.operations.push(op)
    if (state) r.draft = JSON.parse(JSON.stringify(state))
    this.persist(); this.publish()
  }
  sync() {
    if (this.running) return this.running
    this.running = this.run().finally(() => { this.running = null })
    return this.running
  }
  async run() {
    const r = this.record
    try {
      const remote = await this.api('/api/sync?owner=' + encodeURIComponent(this.uid))
      if (!r.base && !r.operations.length && r.recovery) {
        const fields = ['workouts', 'routines', 'programs', 'bodyweight', 'measurements', 'dayPlan']
        if (fields.some(k => Object.keys(r.recovery[k] || {}).length && JSON.stringify(r.recovery[k]) !== JSON.stringify(remote.state[k]))) {
          r.conflict = 'LEGACY_RECOVERY_REQUIRED'
        }
      }
      r.base = remote
      this.persist()
      if (r.conflict) { this.publish(); return }
      while (r.operations.length) {
        const op = r.operations[0]
        // A pre-migration draft has no provable revision. Preserve, never bless it with
        // the fresh revision merely because a GET just succeeded.
        if (op.revision === null) { r.conflict = 'BASE_UNKNOWN'; break }
        try {
          const result = await this.api('/api/sync', { method: 'POST', body: JSON.stringify(op) })
          if (result.acknowledged !== op.operationId) throw Error('Missing sync acknowledgement')
          r.base = result
          r.operations.shift()
          // Save canonical state and the acknowledged queue atomically in one local value.
          this.persist()
          this.storage.removeItem?.(this.key + ':op:' + op.operationId)
        } catch (e) {
          if (e.status === 409) {
            r.conflict = e.data?.code || 'SYNC_CONFLICT'
            if (e.data?.state && e.data?.meta) r.base = e.data
          }
          throw e
        }
      }
      this.persist(); this.publish()
    } catch (e) {
      this.persist(); this.publish()
      // Network failures retain exactly the same operationId, preconditions and payload.
      if (!r.conflict) this.onChange(r.operations.length ? r.draft : r.base?.state, 'offline')
    }
  }
}
