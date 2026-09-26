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
      if (!this.record.operations.some(op => op.operationId === recovered.operationId) &&
          !this.record.superseded?.includes(recovered.operationId)) {
        this.record.operations.push(recovered)
      }
    }
    this.persist()
  }
  persist() { this.storage.setItem(this.key, JSON.stringify(this.record)) }
  publish() {
    this.onChange(this.record.operations.length || this.record.conflict ? this.record.draft : this.record.base?.state,
      this.record.conflict ? 'conflict' : this.record.operations.length ? 'pending' : 'synced',
      this.conflictView())
  }
  conflictView() {
    const r = this.record
    if (!r.conflict) return null
    return {
      code: r.conflict,
      local: structuredClone(r.draft || r.recovery || {}),
      server: structuredClone(r.base?.state || {}),
      meta: structuredClone(r.base?.meta || {}),
      pending: r.operations.map(({ operationId, type, revision, generation, kind, id }) =>
        ({ operationId, type, revision, generation, kind, id })),
    }
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
  archiveConflict(remote) {
    const r = this.record
    const id = crypto.randomUUID()
    const snapshot = {
      id, createdAt: new Date().toISOString(), code: r.conflict,
      local: structuredClone(r.draft || r.recovery || {}),
      server: structuredClone(remote?.state || r.base?.state || {}),
      serverMeta: structuredClone(remote?.meta || r.base?.meta || {}),
      operations: structuredClone(r.operations),
    }
    this.storage.setItem(this.key + ':recovery:' + id, JSON.stringify(snapshot))
    r.lastRecovery = id
    return snapshot
  }
  supersede(operations) {
    const ids = operations.map(op => op.operationId)
    this.record.superseded = [...new Set([...(this.record.superseded || []), ...ids])].slice(-100)
    for (const id of ids) this.storage.removeItem?.(this.key + ':op:' + id)
  }
  async resolveConflict(choice) {
    const r = this.record
    if (!r.conflict) return
    if (choice !== 'local' && choice !== 'server') throw Error('Invalid conflict resolution')

    // Re-read immediately before resolving. The conflict screen can remain open while a
    // second device changes the account; neither button is allowed to bless an old GET.
    const remote = await this.api('/api/sync?owner=' + encodeURIComponent(this.uid))
    const oldOperations = structuredClone(r.operations)
    const recovery = this.archiveConflict(remote)

    if (choice === 'server') {
      r.base = remote
      r.operations = []
      r.draft = structuredClone(remote.state)
      r.recovery = recovery.local
      r.conflict = null
      this.supersede(oldOperations)
      this.persist(); this.publish()
      return
    }

    // "Keep mine" is an explicit, guarded save, not a replace/reset. It therefore keeps the
    // server generation, receipts and tombstones. Server-only entities are unioned by mutate(),
    // while tombstoned ids are removed here so an old phone cannot resurrect them. Explicit
    // deletes already present in the journal remain explicit in the compacted operation.
    const local = structuredClone(recovery.local)
    const tombstones = remote.meta?.tombstones || {}
    const deletes = {}
    for (const kind of ['workouts', 'routines', 'programs']) {
      const dead = new Set(tombstones[kind] || [])
      local[kind] = (local[kind] || []).filter(item => !dead.has(item.id))
      deletes[kind] = [...new Set(oldOperations.flatMap(op => op.deletes?.[kind] ||
        (op.type === 'delete' && op.kind === kind ? [op.id] : [])))]
    }
    const op = {
      operationId: crypto.randomUUID(), owner: this.uid, type: 'save',
      revision: remote.meta.revision, generation: remote.meta.generation,
      state: local, deletes,
    }
    this.storage.setItem(this.key + ':op:' + op.operationId, JSON.stringify(op))
    r.base = remote
    r.operations = [op]
    r.draft = local
    r.recovery = recovery.local
    r.conflict = null
    this.supersede(oldOperations)
    this.persist(); this.publish()
    await this.sync()
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
