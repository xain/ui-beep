/**
 * Beep preferences: the plugin's own Host `Config` schema, surfaced to the
 * browser through the settings form seam.
 *
 * DSH 0.1.7 replaced the `settingsScope` service (and the `settings.yaml`
 * document it read) with profile-backed configuration forms: a plugin's
 * settings ARE its cordis `Config`. Every field is declared `.volatile()` so a
 * change written from the Settings page is adopted live, without restarting
 * the plugin. The Host half receives the validated `Config` in `apply`, and
 * the browser half reads/writes the same entry through
 * `ctx.configForms.get(BEEP_SETTINGS_NAMESPACE)`.
 *
 * Volume is deliberately unbounded upward: the plugin does not cap loudness at
 * 1.0 (Web Audio's nominal full scale). Defaults stay conservative so a
 * first-time user is not startled; anyone who opens the Settings page can
 * raise any slider — including past 100% — and decide for themselves how loud
 * the beeps should be. Values above 1.0 amplify the tone peaks beyond full
 * scale and may clip; that trade-off is the user's.
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the ui-beep plugin. */
export const BEEP_SETTINGS_NAMESPACE = 'ui-beep'

/** One playable beep voice — shared by the audio engine and the host routes. */
export type BeepVoice = 'tick' | 'hum' | 'chime'

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

/** Field carrying the custom audio path for the streaming tick. */
export const TICK_PATH_FIELD = 'tickPath'

/** Field carrying the custom audio path for the working hum. */
export const HUM_PATH_FIELD = 'humPath'

/** Field carrying the custom audio path for the awaiting-input chime. */
export const CHIME_PATH_FIELD = 'chimePath'

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

/**
 * Durable beep values shared by the Host Config schema and the browser form.
 * The `*Path` fields are optional absolute filesystem paths to a user-supplied
 * audio file for that voice; an absent or unreadable path falls back to the
 * built-in synthesized tone.
 */
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
  /** Custom audio file path for the streaming tick; undefined = built-in tone. */
  tickPath?: string
  /** Custom audio file path for the working hum; undefined = built-in tone. */
  humPath?: string
  /** Custom audio file path for the awaiting-input chime; undefined = built-in tone. */
  chimePath?: string
}

/**
 * The Host plugin's live configuration schema — every field `.volatile()` so a
 * Settings-page write is adopted without restarting the plugin. The field names
 * are also the browser form's entry fields (`configForms.get`), so a value
 * written from either side is the same document entry.
 */
export const Config = z.object({
  [ENABLED_FIELD]: z.boolean().default(DEFAULT_ENABLED).volatile(),
  [MASTER_VOLUME_FIELD]: z.number().min(VOLUME_MIN).max(VOLUME_MAX).default(DEFAULT_MASTER_VOLUME).volatile(),
  [TICK_VOLUME_FIELD]: z.number().min(VOLUME_MIN).max(VOLUME_MAX).default(DEFAULT_VOICE_VOLUME).volatile(),
  [HUM_VOLUME_FIELD]: z.number().min(VOLUME_MIN).max(VOLUME_MAX).default(DEFAULT_VOICE_VOLUME).volatile(),
  [CHIME_VOLUME_FIELD]: z.number().min(VOLUME_MIN).max(VOLUME_MAX).default(DEFAULT_VOICE_VOLUME).volatile(),
  [TICK_PATH_FIELD]: z.string().required(false).volatile(),
  [HUM_PATH_FIELD]: z.string().required(false).volatile(),
  [CHIME_PATH_FIELD]: z.string().required(false).volatile(),
})

/**
 * The Host `Config` value type: schemastery hands every `.volatile()` field to
 * `apply` as a live reference rather than a plain value.
 */
export interface BeepConfig {
  /** Whether any beep plays at all. */
  enabled: Volatile<boolean>
  /** Master gain 0…2 applied to every voice. */
  masterVolume: Volatile<number>
  /** Streaming-output tick gain 0…2. */
  tickVolume: Volatile<number>
  /** Working heartbeat hum gain 0…2. */
  humVolume: Volatile<number>
  /** Awaiting-input chime gain 0…2. */
  chimeVolume: Volatile<number>
  /** Custom audio path for the streaming tick; undefined = built-in tone. */
  tickPath: Volatile<string | undefined>
  /** Custom audio path for the working hum; undefined = built-in tone. */
  humPath: Volatile<string | undefined>
  /** Custom audio path for the awaiting-input chime; undefined = built-in tone. */
  chimePath: Volatile<string | undefined>
}

/** The Host Config field carrying one voice's custom audio path. */
export function voicePathField(voice: BeepVoice): string {
  switch (voice) {
    case 'tick': return TICK_PATH_FIELD
    case 'hum': return HUM_PATH_FIELD
    case 'chime': return CHIME_PATH_FIELD
  }
}