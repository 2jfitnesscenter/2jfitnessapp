import { expect, test } from 'vitest'
import { syncBadge } from './sync-indicator.js'

test('offline whenever the browser is offline or the last sync could not reach the server', () => {
  expect(syncBadge({ online: false, status: 'synced' })).toBe('offline')
  expect(syncBadge({ online: false, status: 'idle' })).toBe('offline')   // app reopened with no connection
  expect(syncBadge({ online: true, status: 'offline' })).toBe('offline')
})

test('normal online saves never show anything', () => {
  for (const status of ['idle', 'pending', 'synced']) expect(syncBadge({ online: true, status })).toBeNull()
})

test('after being offline: syncing while reconnecting or draining, then all synced', () => {
  expect(syncBadge({ online: true, status: 'offline', reconnecting: true, recovering: true })).toBe('syncing')
  expect(syncBadge({ online: true, status: 'pending', recovering: true })).toBe('syncing')
  expect(syncBadge({ online: true, status: 'synced', recovering: true })).toBe('synced')
})

test('a conflict is left to the conflict dialog', () => {
  expect(syncBadge({ online: false, status: 'conflict', recovering: true })).toBeNull()
})
