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

  it('sync mirrors a resolved section and the writable flag', () => {
    const store = createBeepSettingsRowStore().create()
    store.actions.sync({
      enabled: false,
      masterVolume: 0.2,
      tickVolume: 0.4,
      humVolume: 0.6,
      chimeVolume: 0.8,
    }, true)
    expect(store.getSnapshot()).toEqual({
      enabled: false,
      masterVolume: 0.2,
      tickVolume: 0.4,
      humVolume: 0.6,
      chimeVolume: 0.8,
      ready: true,
      writable: true,
    })
  })

  it('sync marks ready false and preserves the last values while the section is absent', () => {
    const store = createBeepSettingsRowStore().create()
    store.actions.sync({
      enabled: false,
      masterVolume: 0.2,
      tickVolume: 0.4,
      humVolume: 0.6,
      chimeVolume: 0.8,
    }, true)
    // A later unresolved snapshot (scope reload) marks the section not-ready
    // without discarding the last accepted values (mirror semantics).
    store.actions.sync(undefined, false)
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
})