// @vitest-environment jsdom
/**
 * Per-browser preference tests: this browser's values win over the Host
 * defaults FIELD BY FIELD, survive a reload (localStorage), stay independent
 * per browser, clamp volumes, and never throw when storage is unavailable.
 *
 * The store is a module-level singleton (one document per browser), so each
 * test re-imports the module to get a fresh instance reading current storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_STORAGE_KEY } from '../src/client/local-store.ts'
import { BEEP_SETTINGS_DEFAULTS, VOLUME_MAX, VOLUME_MIN } from '../src/beep-settings.ts'

/** A fresh module instance (simulates a page load / new browser). */
async function freshStore() {
  vi.resetModules()
  const mod = await import('../src/client/local-store.ts')
  return mod.localBeep
}

/** The Host defaults with one field overridden, for fold tests. */
function hostWith(overrides: Partial<typeof BEEP_SETTINGS_DEFAULTS> = {}) {
  return { ...BEEP_SETTINGS_DEFAULTS, ...overrides }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('localBeep', () => {
  it('follows the Host defaults until this browser chooses', async () => {
    const store = await freshStore()
    expect(store.getSnapshot()).toEqual({})
    const host = hostWith({ enabled: false, masterVolume: 0.7 })
    expect(store.resolve(host)).toEqual({
      enabled: false,
      masterVolume: 0.7,
      tickVolume: host.tickVolume,
      humVolume: host.humVolume,
      chimeVolume: host.chimeVolume,
    })
  })

  it('overrides the Host defaults field by field', async () => {
    const store = await freshStore()
    // Only the master volume is chosen locally.
    store.set('masterVolume', 1.5)
    const host = hostWith({ enabled: false, masterVolume: 0.7, humVolume: 0.2 })
    const resolved = store.resolve(host)
    // The local volume wins…
    expect(resolved.masterVolume).toBe(1.5)
    // …while every other field still follows the Host.
    expect(resolved.enabled).toBe(false)
    expect(resolved.humVolume).toBe(0.2)
  })

  it('keeps the switch independent from the volumes', async () => {
    const store = await freshStore()
    store.set('enabled', true)
    expect(store.resolve(hostWith({ enabled: false })).enabled).toBe(true)
    // A volume write does not disturb the switch choice.
    store.set('tickVolume', 0.5)
    expect(store.resolve(hostWith({ enabled: false })).enabled).toBe(true)
  })

  it('persists every field, so a reload keeps them (the "永久保存" requirement)', async () => {
    const first = await freshStore()
    first.set('enabled', false)
    first.set('humVolume', 0.35)

    const stored = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) ?? '{}')
    expect(stored).toEqual({ enabled: false, humVolume: 0.35 })

    // A brand-new module instance reads the same storage.
    const reloaded = await freshStore()
    expect(reloaded.resolve(hostWith({ enabled: true, humVolume: 1 })).enabled).toBe(false)
    expect(reloaded.resolve(hostWith({ enabled: true, humVolume: 1 })).humVolume).toBe(0.35)
  })

  it('clamps volumes into the accepted range', async () => {
    const store = await freshStore()
    store.set('masterVolume', 99)
    expect(store.getSnapshot().masterVolume).toBe(VOLUME_MAX)
    store.set('chimeVolume', -5)
    expect(store.getSnapshot().chimeVolume).toBe(VOLUME_MIN)
  })

  it('ignores a non-finite volume instead of storing NaN', async () => {
    const store = await freshStore()
    store.set('tickVolume', Number.NaN)
    expect(store.getSnapshot().tickVolume).toBeUndefined()
  })

  it('is independent per browser: separate storage, separate preferences', async () => {
    const desktop = await freshStore()
    desktop.set('enabled', false)
    desktop.set('masterVolume', 2)

    // Another "browser" has its own storage area.
    const phoneStorage = new Map<string, string>()
    vi.spyOn(window.localStorage.__proto__, 'getItem')
      .mockImplementation((key: string) => phoneStorage.get(key) ?? null)
    const phone = await freshStore()
    expect(phone.getSnapshot()).toEqual({})
    // The phone never chose, so it follows the Host defaults even though the
    // desktop is muted and loud.
    expect(phone.resolve(hostWith({ enabled: true, masterVolume: 0.4 })).enabled).toBe(true)
    expect(phone.resolve(hostWith({ enabled: true, masterVolume: 0.4 })).masterVolume).toBe(0.4)
  })

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const store = await freshStore()
    const listener = vi.fn()
    const stop = store.subscribe(listener)

    store.set('enabled', true)
    expect(listener).toHaveBeenCalledTimes(1)

    // A no-op write (same value) does not notify.
    store.set('enabled', true)
    expect(listener).toHaveBeenCalledTimes(1)

    stop()
    store.set('enabled', false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('survives a browser that refuses storage (no throw, session-only)', async () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => { throw new Error('denied') })

    const store = await freshStore()
    expect(() => store.set('enabled', true)).not.toThrow()
    // Still usable in-session, just not durable.
    expect(store.resolve(hostWith({ enabled: false })).enabled).toBe(true)
  })

  it('keeps the well-formed fields of a corrupt stored document', async () => {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      enabled: 'yes',        // wrong type → dropped
      masterVolume: 1.2,     // fine
      humVolume: null,       // wrong type → dropped
    }))
    const store = await freshStore()
    expect(store.getSnapshot()).toEqual({ masterVolume: 1.2 })
    const resolved = store.resolve(hostWith({ enabled: false, humVolume: 0.6 }))
    expect(resolved.enabled).toBe(false)
    expect(resolved.masterVolume).toBe(1.2)
    expect(resolved.humVolume).toBe(0.6)
  })

  it('toggle flips the effective switch, starting from the Host default', async () => {
    const store = await freshStore()
    // Never chosen + Host default on → toggling turns it off.
    store.toggle(hostWith({ enabled: true }))
    expect(store.getSnapshot().enabled).toBe(false)
    store.toggle(hostWith({ enabled: true }))
    expect(store.getSnapshot().enabled).toBe(true)
  })

  it('reset forgets every local choice (back to the Host defaults)', async () => {
    const store = await freshStore()
    store.set('enabled', false)
    store.set('masterVolume', 2)
    store.reset()
    expect(store.getSnapshot()).toEqual({})
    expect(store.resolve(hostWith({ enabled: true, masterVolume: 0.4 })).enabled).toBe(true)
  })
})
