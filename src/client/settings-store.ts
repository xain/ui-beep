/**
 * UI Beep settings section store: a mirror of the durable settings scope
 * snapshot. The plugin's apply-world change listener is the only writer; the
 * section component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import {
  DEFAULT_ENABLED, DEFAULT_MASTER_VOLUME, DEFAULT_VOICE_VOLUME,
  type BeepSettings,
} from '../beep-settings.ts'

/** Store state mirrored from the beep settings scope. */
export interface BeepSettingsRowState {
  /** Whether any beep plays at all. */
  enabled: boolean
  /** Master gain 0…2. */
  masterVolume: number
  /** Streaming-output tick gain 0…2. */
  tickVolume: number
  /** Working heartbeat hum gain 0…2. */
  humVolume: number
  /** Awaiting-input chime gain 0…2. */
  chimeVolume: number
  /** Custom audio path for the streaming tick; undefined = built-in tone. */
  tickPath?: string
  /** Custom audio path for the working hum; undefined = built-in tone. */
  humPath?: string
  /** Custom audio path for the awaiting-input chime; undefined = built-in tone. */
  chimePath?: string
  /** Whether the section is ready (a resolved scope value stands). */
  ready: boolean
  /** Whether the Host document accepts writes; memory mode never does. */
  writable: boolean
}

/** Declared action shape giving the exported factory a stable return type. */
type BeepSettingsRowActions = {
  sync: (draft: BeepSettingsRowState, section: BeepSettings | undefined, writable: boolean) => void
}

/** Default row state shown before the scope resolves (or when it never does). */
function initialRowState(): BeepSettingsRowState {
  return {
    enabled: DEFAULT_ENABLED,
    masterVolume: DEFAULT_MASTER_VOLUME,
    tickVolume: DEFAULT_VOICE_VOLUME,
    humVolume: DEFAULT_VOICE_VOLUME,
    chimeVolume: DEFAULT_VOICE_VOLUME,
    ready: false,
    writable: false,
  }
}

/**
 * Declares the UI Beep settings section state and write surface.
 * @returns the store handle.
 */
export function createBeepSettingsRowStore(): EngineStoreHandle<BeepSettingsRowState, BeepSettingsRowActions> {
  return defineStore({
    init: initialRowState,
    actions: {
      sync: (draft, section, writable) => {
        draft.ready = section !== undefined
        draft.writable = writable
        if (section === undefined) return
        draft.enabled = section.enabled
        draft.masterVolume = section.masterVolume
        draft.tickVolume = section.tickVolume
        draft.humVolume = section.humVolume
        draft.chimeVolume = section.chimeVolume
        if (section.tickPath === undefined) delete draft.tickPath
        else draft.tickPath = section.tickPath
        if (section.humPath === undefined) delete draft.humPath
        else draft.humPath = section.humPath
        if (section.chimePath === undefined) delete draft.chimePath
        else draft.chimePath = section.chimePath
      },
    },
  })
}