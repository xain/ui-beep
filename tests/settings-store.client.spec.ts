/** Beep settings section store: init shape and the sync mirror action. */
import { describe, expect, it } from 'vitest'
import { createBeepSettingsRowStore } from '../src/client/settings-store.ts'
import { DEFAULT_ENABLED, DEFAULT_MASTER_VOLUME, DEFAULT_VOICE_VOLUME } from '../src/beep-settings.ts'

describe('createBeepSettingsRowStore', () => {
  it('init shape: defaults with ready and writable false', () => {
    const store = createBeepSettingsRowStore().create()
    expect(store.getSnapshot()).toEqual({
      enabled: DEFAULT_ENABLED,
      masterVolume: DEFAULT_MASTER_VOLUME,
      tickVolume: DEFAULT_VOICE_VOLUME,
      humVolume: DEFAULT_VOICE_VOLUME,
      chimeVolume: DEFAULT_VOICE_VOLUME,
      ready: false,
      writable: false,
    })
  })

  it('mirrors the Host section paths but THIS browser\'s switch and volumes', () => {
    const store = createBeepSettingsRowStore().create()
    // The Host section says disabled and quiet, but this browser chose its own
    // values: those win. Custom audio paths stay Host-owned.
    store.actions.sync({
      enabled: false,
      masterVolume: 0.2,
      tickVolume: 0.4,
      humVolume: 0.6,
      chimeVolume: 0.8,
      tickPath: '/music/tick.wav',
    }, true, {
      enabled: true,
      masterVolume: 1.2,
      tickVolume: 0.4,
      humVolume: 0.6,
      chimeVolume: 0.8,
    })
    expect(store.getSnapshot()).toEqual({
      enabled: true,
      masterVolume: 1.2,
      tickVolume: 0.4,
      humVolume: 0.6,
      chimeVolume: 0.8,
      tickPath: '/music/tick.wav',
      ready: true,
      writable: true,
    })
  })

  it('sync marks ready false and preserves the last values while the section is absent', () => {
    const store = createBeepSettingsRowStore().create()
    const local = {
      enabled: false,
      masterVolume: 0.2,
      tickVolume: 0.4,
      humVolume: 0.6,
      chimeVolume: 0.8,
    }
    store.actions.sync({
      enabled: true,
      masterVolume: 1,
      tickVolume: 1,
      humVolume: 1,
      chimeVolume: 1,
    }, true, local)
    // A later unresolved snapshot (form reload) marks the section not-ready
    // without discarding the last accepted values (mirror semantics).
    store.actions.sync(undefined, false, local)
    expect(store.getSnapshot()).toEqual({
      enabled: false,
      masterVolume: 0.2,
      tickVolume: 0.4,
      humVolume: 0.6,
      chimeVolume: 0.8,
      ready: false,
      writable: false,
    })
  })

  it('keeps the per-browser values usable before any Host section resolves', () => {
    const store = createBeepSettingsRowStore().create()
    // No section yet (form still loading) but the local preferences apply.
    store.actions.sync(undefined, false, {
      enabled: true,
      masterVolume: 1.5,
      tickVolume: 0.4,
      humVolume: 0.6,
      chimeVolume: 0.8,
    })
    const snapshot = store.getSnapshot()
    expect(snapshot.enabled).toBe(true)
    expect(snapshot.masterVolume).toBe(1.5)
    expect(snapshot.ready).toBe(false)
  })
})