/**
 * Beep preferences stored in the Host user-settings document.
 *
 * The namespace folds three layers the same way every other settings section
 * does: schema defaults → the cordis row `config:` (registered as the
 * composition base by the Host half) → the user layer written from the
 * Settings page. The browser scope reads the resolved section and drives the
 * audio engine live, so a slider move applies immediately.
 *
 * Volume is deliberately unbounded upward: the plugin no longer caps the
 * loudness at 1.0 (Web Audio's nominal full scale). The defaults are kept
 * conservative so a first-time user is not startled; anyone who opens the
 * Settings page can raise any slider — including past 100% — and decide for
 * themselves how loud the beeps should be. Values above 1.0 amplify the tone
 * peaks beyond full scale and may clip; that trade-off is the user's.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the ui-beep plugin. */
export const BEEP_SETTINGS_NAMESPACE = 'ui-beep'

/** Field carrying whether any beep plays. */
export const ENABLED_FIELD = 'enabled'

/** Field carrying the master gain applied to every voice. */
export const MASTER_VOLUME_FIELD = 'masterVolume'

/** Field carrying the streaming-output tick gain. */
export const TICK_VOLUME_FIELD = 'tickVolume'

/** Field carrying the working heartbeat hum gain. */
export const HUM_VOLUME_FIELD = 'humVolume'

/** Field carrying the awaiting-input chime gain. */
export const CHIME_VOLUME_FIELD = 'chimeVolume'

/** Smallest accepted volume (silent). */
export const VOLUME_MIN = 0

/**
 * Largest accepted volume. 1.0 is Web Audio's nominal full scale; values
 * above it amplify the tone peaks and may clip — deliberately allowed so the
 * user, not the plugin, decides the ceiling.
 */
export const VOLUME_MAX = 2

/** Beeps play when the document has no override. */
export const DEFAULT_ENABLED = true

/** Master gain when the document has no override — conservative by design. */
export const DEFAULT_MASTER_VOLUME = 0.4

/** Per-voice gains default to full: the baked per-voice peaks stay untouched. */
export const DEFAULT_VOICE_VOLUME = 1

/** Durable beep section shared by the Host schema and the browser scope. */
export interface BeepSettings {
  /** Whether any beep plays at all. */
  enabled: boolean
  /** Master gain 0…2 applied to every voice. */
  masterVolume: number
  /** Streaming-output tick gain 0…2. */
  tickVolume: number
  /** Working heartbeat hum gain 0…2. */
  humVolume: number
  /** Awaiting-input chime gain 0…2. */
  chimeVolume: number
}

/** Durable beep schema; also the wire envelope the browser scope validates against. */
export const BeepSettingsSchema: z<BeepSettings> = z.object({
  [ENABLED_FIELD]: z.boolean().default(DEFAULT_ENABLED),
  [MASTER_VOLUME_FIELD]: z.number().min(VOLUME_MIN).max(VOLUME_MAX).default(DEFAULT_MASTER_VOLUME),
  [TICK_VOLUME_FIELD]: z.number().min(VOLUME_MIN).max(VOLUME_MAX).default(DEFAULT_VOICE_VOLUME),
  [HUM_VOLUME_FIELD]: z.number().min(VOLUME_MIN).max(VOLUME_MAX).default(DEFAULT_VOICE_VOLUME),
  [CHIME_VOLUME_FIELD]: z.number().min(VOLUME_MIN).max(VOLUME_MAX).default(DEFAULT_VOICE_VOLUME),
})

/**
 * The row-config contribution to the composition base. `volume` maps to the
 * master gain and `enabled` to the enable switch; the per-voice gains have no
 * row-config counterpart and stay schema defaults until the user overrides.
 * @param config - the cordis row config, when one is present.
 * @returns the base layer, or undefined to leave schema defaults standing.
 */
export function beepSettingsBase(config: { volume?: number; enabled?: boolean } | undefined): BeepSettings | undefined {
  if (config === undefined) return undefined
  return {
    enabled: config.enabled ?? DEFAULT_ENABLED,
    masterVolume: config.volume ?? DEFAULT_MASTER_VOLUME,
    tickVolume: DEFAULT_VOICE_VOLUME,
    humVolume: DEFAULT_VOICE_VOLUME,
    chimeVolume: DEFAULT_VOICE_VOLUME,
  }
}