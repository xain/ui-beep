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
import type { LocalBeepSettings } from './local-store.ts'

/** Store state mirrored from the beep settings scope. */
export interface BeepSettingsRowState {
  /**
   * Whether any beep plays **in this browser**. Per-device: it comes from the
   * browser-local preference document (localStorage), falling back to the Host
   * Config value until this browser chooses — never written back to the Host.
   */
  enabled: boolean
  /** Master gain 0…2 in this browser (per-device, like `enabled`). */
  masterVolume: number
  /** Streaming-output tick gain 0…2 in this browser. */
  tickVolume: number
  /** Working heartbeat hum gain 0…2 in this browser. */
  humVolume: number
  /** Awaiting-input chime gain 0…2 in this browser. */
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
  /**
   * Mirror one resolved form snapshot.
   * @param local - this browser's effective preferences (local, not the Host values).
   */
  sync: (
    draft: BeepSettingsRowState,
    section: BeepSettings | undefined,
    writable: boolean,
    local: LocalBeepSettings,
  ) => void
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
      sync: (draft, section, writable, local) => {
        draft.ready = section !== undefined
        draft.writable = writable
        // The switch and the volumes are per-browser, so they stand even
        // before (or without) a resolved Host section.
        draft.enabled = local.enabled
        draft.masterVolume = local.masterVolume
        draft.tickVolume = local.tickVolume
        draft.humVolume = local.humVolume
        draft.chimeVolume = local.chimeVolume
        if (section === undefined) return
        // Custom audio paths stay Host-owned.
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