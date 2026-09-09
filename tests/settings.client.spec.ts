/**
 * Beep settings model tests: the durable section schema, its defaults, and
 * the row-config composition base mapping.
 */
import { describe, expect, it } from 'vitest'
import {
  BeepSettingsSchema, beepSettingsBase,
  BEEP_SETTINGS_NAMESPACE, DEFAULT_ENABLED, DEFAULT_MASTER_VOLUME, DEFAULT_VOICE_VOLUME,
} from '../src/beep-settings.ts'

describe('beep settings section', () => {
  it('uses the ui-beep namespace', () => {
    expect(BEEP_SETTINGS_NAMESPACE).toBe('ui-beep')
  })

  it('defaults every field when the section is empty', () => {
    const section = BeepSettingsSchema()
    expect(section.enabled).toBe(DEFAULT_ENABLED)
    expect(section.masterVolume).toBe(DEFAULT_MASTER_VOLUME)
    expect(section.tickVolume).toBe(DEFAULT_VOICE_VOLUME)
    expect(section.humVolume).toBe(DEFAULT_VOICE_VOLUME)
    expect(section.chimeVolume).toBe(DEFAULT_VOICE_VOLUME)
  })

  it('rejects volumes outside 0…2', () => {
    expect(() => BeepSettingsSchema({ masterVolume: 2.5 })).toThrow(/<= 2/)
    expect(() => BeepSettingsSchema({ tickVolume: -0.2 })).toThrow(/>?= 0/)
  })

  it('accepts a boundary-value section up to the 2.0 ceiling', () => {
    const section = BeepSettingsSchema({
      enabled: false,
      masterVolume: 2,
      tickVolume: 0,
      humVolume: 0.7,
      chimeVolume: 1.5,
    })
    expect(section.enabled).toBe(false)
    expect(section.masterVolume).toBe(2)
    expect(section.tickVolume).toBe(0)
    expect(section.humVolume).toBe(0.7)
    expect(section.chimeVolume).toBe(1.5)
  })

  it('maps the row config onto the composition base', () => {
    const base = beepSettingsBase({ volume: 0.3, enabled: false })
    expect(base).toEqual({
      enabled: false,
      masterVolume: 0.3,
      tickVolume: DEFAULT_VOICE_VOLUME,
      humVolume: DEFAULT_VOICE_VOLUME,
      chimeVolume: DEFAULT_VOICE_VOLUME,
    })
  })

  it('leaves the base undefined without a row config', () => {
    expect(beepSettingsBase(undefined)).toBeUndefined()
    expect(beepSettingsBase({})).toEqual({
      enabled: DEFAULT_ENABLED,
      masterVolume: DEFAULT_MASTER_VOLUME,
      tickVolume: DEFAULT_VOICE_VOLUME,
      humVolume: DEFAULT_VOICE_VOLUME,
      chimeVolume: DEFAULT_VOICE_VOLUME,
    })
  })
})