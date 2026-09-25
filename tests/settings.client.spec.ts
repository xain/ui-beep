/**
 * Beep settings model tests: the Host `Config` schema (the DSH 0.1.7 settings
 * form seam), its defaults, and the live (`.volatile()`) field references.
 */
import { describe, expect, it } from 'vitest'
import {
  Config,
  BEEP_SETTINGS_NAMESPACE, DEFAULT_ENABLED, DEFAULT_MASTER_VOLUME, DEFAULT_VOICE_VOLUME,
} from '../src/beep-settings.ts'

/** Unwrap the Volatile references a validated Config hands out. */
function plain(config: ReturnType<typeof Config>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, (value as { get(): unknown }).get()]),
  )
}

describe('beep settings Config', () => {
  it('uses the ui-beep entry id as its namespace', () => {
    // The browser form reads the same entry: `configForms.get('ui-beep')`.
    expect(BEEP_SETTINGS_NAMESPACE).toBe('ui-beep')
  })

  it('defaults every field when no value is supplied', () => {
    const section = plain(Config())
    expect(section.enabled).toBe(DEFAULT_ENABLED)
    expect(section.masterVolume).toBe(DEFAULT_MASTER_VOLUME)
    expect(section.tickVolume).toBe(DEFAULT_VOICE_VOLUME)
    expect(section.humVolume).toBe(DEFAULT_VOICE_VOLUME)
    expect(section.chimeVolume).toBe(DEFAULT_VOICE_VOLUME)
    expect(section.tickPath).toBeUndefined()
    expect(section.humPath).toBeUndefined()
    expect(section.chimePath).toBeUndefined()
  })

  it('accepts custom audio path fields', () => {
    const section = plain(Config({
      tickPath: '/music/tick.wav',
      humPath: '/music/hum.mp3',
    }))
    expect(section.tickPath).toBe('/music/tick.wav')
    expect(section.humPath).toBe('/music/hum.mp3')
    expect(section.chimePath).toBeUndefined()
  })

  it('rejects volumes outside 0…2', () => {
    expect(() => Config({ masterVolume: 2.5 })).toThrow(/<= 2/)
    expect(() => Config({ tickVolume: -0.2 })).toThrow(/>?= 0/)
  })

  it('accepts a boundary-value config up to the 2.0 ceiling', () => {
    const section = plain(Config({
      enabled: false,
      masterVolume: 2,
      tickVolume: 0,
      humVolume: 0.7,
      chimeVolume: 1.5,
    }))
    expect(section.enabled).toBe(false)
    expect(section.masterVolume).toBe(2)
    expect(section.tickVolume).toBe(0)
    expect(section.humVolume).toBe(0.7)
    expect(section.chimeVolume).toBe(1.5)
  })

  it('hands out live (volatile) field references, not plain values', () => {
    // `.volatile()` is what lets a Settings-page write be adopted without
    // restarting the plugin: the Host half keeps reading the same reference.
    const config = Config()
    expect(config.masterVolume.get()).toBe(DEFAULT_MASTER_VOLUME)
    // Every field is a Volatile reference (a reader), not a snapshot value.
    expect(typeof config.masterVolume.get).toBe('function')
    expect(typeof config.humPath.get).toBe('function')
  })
})
