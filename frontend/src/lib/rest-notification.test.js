import { describe, expect, it, vi } from 'vitest'
import { createRestNotificationController, REST_NOTIFICATION_ID } from './rest-notification.js'

const pluginWith = extra => ({
  checkPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
  requestPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
  schedule: vi.fn().mockResolvedValue({ notifications: [{ id: REST_NOTIFICATION_ID }] }),
  cancel: vi.fn().mockResolvedValue(undefined),
  ...extra,
})

describe('Android rest notification adapter', () => {
  it('schedules exactly one private, allow-while-idle alert at the timer end', async () => {
    const plugin = pluginWith()
    const ctl = createRestNotificationController({ plugin, isAndroid: () => true, translate: key => key })
    const endAt = Date.now() + 90_000
    expect(await ctl.schedule(endAt)).toBe(true)
    expect(plugin.schedule).toHaveBeenCalledWith({ notifications: [{
      id: REST_NOTIFICATION_ID, title: 'Rest finished', body: 'Next set', autoCancel: true,
      schedule: { at: new Date(endAt), allowWhileIdle: true },
    }] })
  })

  it('cancels and reprograms the single notification when the end time changes', async () => {
    const plugin = pluginWith()
    const ctl = createRestNotificationController({ plugin, isAndroid: () => true })
    await ctl.schedule(Date.now() + 60_000)
    await ctl.schedule(Date.now() + 120_000)
    expect(plugin.cancel).toHaveBeenCalledTimes(2)
    expect(plugin.schedule).toHaveBeenCalledTimes(2)
    expect(plugin.schedule.mock.calls[1][0].notifications).toHaveLength(1)
  })

  it('does not schedule when notifications are denied and keeps permission requests explicit', async () => {
    const plugin = pluginWith({
      checkPermissions: vi.fn().mockResolvedValue({ display: 'denied' }),
      requestPermissions: vi.fn().mockResolvedValue({ display: 'denied' }),
    })
    const ctl = createRestNotificationController({ plugin, isAndroid: () => true })
    expect(await ctl.schedule(Date.now() + 60_000)).toBe(false)
    expect(plugin.schedule).not.toHaveBeenCalled()
    expect(plugin.requestPermissions).not.toHaveBeenCalled()
    expect(await ctl.requestPermission()).toBe(false)
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1)
  })

  it('is a no-op on PWA and non-Android platforms', async () => {
    const plugin = pluginWith()
    const ctl = createRestNotificationController({ plugin, isAndroid: () => false })
    expect(await ctl.schedule(Date.now() + 60_000)).toBe(false)
    expect(await ctl.cancel()).toBe(false)
    expect(await ctl.requestPermission()).toBe(true)
    expect(plugin.schedule).not.toHaveBeenCalled()
    expect(plugin.cancel).not.toHaveBeenCalled()
  })

  it('serializes replacement and cancellation so a stale async schedule cannot win', async () => {
    let release
    const plugin = pluginWith({ schedule: vi.fn(() => new Promise(resolve => { release = resolve })) })
    const ctl = createRestNotificationController({ plugin, isAndroid: () => true })
    const scheduled = ctl.schedule(Date.now() + 60_000)
    const cancelled = ctl.cancel()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect(plugin.cancel).toHaveBeenCalledTimes(1)
    release({ notifications: [{ id: REST_NOTIFICATION_ID }] })
    await scheduled
    await cancelled
    expect(plugin.cancel).toHaveBeenCalledTimes(2)
  })
})
