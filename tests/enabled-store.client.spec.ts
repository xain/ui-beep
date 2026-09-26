// @vitest-environment jsdom
/**
 * Per-browser beep switch tests: the local value wins over the Host default,
 * survives a reload (localStorage), stays independent per browser, and never
 * throws when storage is unavailable.
 *
 * The store is a module-level singleton (one switch per browser), so each test
 * re-imports the module to get a fresh instance reading current storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENABLED_STORAGE_KEY } from '../src/client/enabled-store.ts'

/** A fresh module instance (simulates a page load / new browser). */
async function freshStore() {
  vi.resetModules()
  const mod = await import('../src/client/enabled-store.ts')
  return mod.localEnabled
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('localEnabled', () => {
  it('falls back to the Host default until this browser chooses', async () => {
    const store = await freshStore()
    expect(store.getSnapshot()).toBeUndefined()
    expect(store.resolve(true)).toBe(true)
    expect(store.resolve(false)).toBe(false)
  })

  it('lets this browser override the Host default once it chooses', async () => {
    const store = await freshStore()
    store.set(true)
    expect(store.getSnapshot()).toBe(true)
    // The Host default no longer matters here.
    expect(store.resolve(false)).toBe(true)

    store.set(false)
    expect(store.resolve(true)).toBe(false)
  })

  it('persists the choice, so a reload keeps it (the "永久保存" requirement)', async () => {
    const first = await freshStore()
    first.set(false)
    expect(window.localStorage.getItem(ENABLED_STORAGE_KEY)).toBe('false')

    // A brand-new module instance reads the same storage.
    const reloaded = await freshStore()
    expect(reloaded.getSnapshot()).toBe(false)
    expect(reloaded.resolve(true)).toBe(false)
  })

  it('is independent per browser: separate storage, separate switch', async () => {
    const desktop = await freshStore()
    desktop.set(false)

    // Another "browser" has its own storage area.
    const phoneStorage = new Map<string, string>()
    vi.spyOn(window.localStorage.__proto__, 'getItem')
      .mockImplementation((key: string) => phoneStorage.get(key) ?? null)
    const phone = await freshStore()
    expect(phone.getSnapshot()).toBeUndefined()
    // The phone never chose, so it follows the Host default (on) even though
    // the desktop is muted.
    expect(phone.resolve(true)).toBe(true)
  })

  it('notifies subscribers on change and stops after unsubscribe', async () => {
    const store = await freshStore()
    const listener = vi.fn()
    const stop = store.subscribe(listener)

    store.set(true)
    expect(listener).toHaveBeenCalledTimes(1)

    // A no-op write (same value) does not notify.
    store.set(true)
    expect(listener).toHaveBeenCalledTimes(1)

    stop()
    store.set(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('toggle flips the effective value, starting from the Host default', async () => {
    const store = await freshStore()
    // Never chosen + Host default on → toggling turns it off.
    store.toggle(true)
    expect(store.getSnapshot()).toBe(false)
    store.toggle(true)
    expect(store.getSnapshot()).toBe(true)
  })

  it('survives a browser that refuses storage (no throw, session-only)', async () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => { throw new Error('denied') })

    const store = await freshStore()
    expect(() => store.set(true)).not.toThrow()
    // Still usable in-session, just not durable.
    expect(store.resolve(false)).toBe(true)
  })

  it('ignores a corrupt stored value and falls back to the Host default', async () => {
    window.localStorage.setItem(ENABLED_STORAGE_KEY, 'yes-please')
    const store = await freshStore()
    expect(store.getSnapshot()).toBeUndefined()
    expect(store.resolve(true)).toBe(true)
  })
})
