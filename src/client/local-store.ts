/**
 * The beep preferences owned by the browser that plays the sound.
 *
 * Per-device by decision: the tone comes out of THIS browser, so this browser
 * decides whether it plays and how loudly. Values live in `localStorage`, never
 * in the DSH profile — muting a phone leaves the desktop chiming, and a slider
 * move applies immediately instead of waiting for a Host round trip (that round
 * trip is exactly what made these controls unreliable on a phone: the write is
 * rejected when its optimistic `revision` is stale, and the old code swallowed
 * the failure).
 *
 * The Settings page and the composer speaker button both read and write this one
 * store, so the two surfaces can never disagree.
 *
 * The Host Config's `enabled` and per-voice volumes survive as the initial
 * defaults for a browser that has never chosen — which is what makes "defaults
 * from the profile, each device decides from there" work.
 *
 * Custom audio **file paths stay on the Host**: the files live on the machine
 * running the harness, so they are not a per-device concern.
 *
 * @module ui-beep/client/local-store
 */

import { VOLUME_MAX, VOLUME_MIN, type BeepSettings } from '../beep-settings.ts'

/** The preferences this browser owns. */
export interface LocalBeepSettings {
  /** Whether any beep plays in this browser. */
  enabled: boolean
  /** Master gain 0…2 in this browser. */
  masterVolume: number
  /** Streaming-output tick gain 0…2 in this browser. */
  tickVolume: number
  /** Working heartbeat hum gain 0…2 in this browser. */
  humVolume: number
  /** Awaiting-input / work-finished chime gain 0…2 in this browser. */
  chimeVolume: number
}

/** localStorage key holding this browser's preference document. */
export const LOCAL_STORAGE_KEY = 'dsh-client-ui-beep:local'

/** The volume fields, in a stable order for parsing and iteration. */
export const VOLUME_FIELDS = ['masterVolume', 'tickVolume', 'humVolume', 'chimeVolume'] as const

/** A stored document: only the fields this browser has actually chosen. */
type StoredPatch = Partial<LocalBeepSettings>

/** Clamp one volume into the accepted range; a non-number is dropped. */
function clampVolume(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, value))
}

/**
 * Read the stored patch, field by field: a corrupt or partial document keeps
 * whatever fields are still well-formed.
 * @returns this browser's choices, empty when it has never chosen (or the
 * browser refuses storage).
 */
function load(): StoredPatch {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return {}
    const record = parsed as Record<string, unknown>
    const patch: StoredPatch = {}
    if (typeof record.enabled === 'boolean') patch.enabled = record.enabled
    for (const field of VOLUME_FIELDS) {
      const value = clampVolume(record[field])
      if (value !== undefined) patch[field] = value
    }
    return patch
  } catch {
    return {}
  }
}

/** Persist the patch; a browser that refuses storage only loses it on reload. */
function save(patch: StoredPatch): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(patch))
  } catch {
    // Preference only; never worth surfacing.
  }
}

/**
 * One per-browser preference document with a stable snapshot reference, so the
 * Settings page and the composer button subscribe through `useSyncExternalStore`.
 */
class LocalBeepStore {
  private snapshot: StoredPatch = load()
  private readonly listeners = new Set<() => void>()

  /**
   * @returns this browser's stored patch (possibly empty). The value is stable
   * until the next change.
   */
  getSnapshot = (): StoredPatch => this.snapshot

  /**
   * Observe patch replacements.
   * @param listener - invoked after each change.
   * @returns the disposer removing this listener.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Fold this browser's choices over the Host defaults, field by field.
   * @param host - the resolved Host Config (profile values + schema defaults).
   * @returns the preferences this browser should actually use.
   */
  resolve(host: BeepSettings): LocalBeepSettings {
    return {
      enabled: this.snapshot.enabled ?? host.enabled,
      masterVolume: this.snapshot.masterVolume ?? host.masterVolume,
      tickVolume: this.snapshot.tickVolume ?? host.tickVolume,
      humVolume: this.snapshot.humVolume ?? host.humVolume,
      chimeVolume: this.snapshot.chimeVolume ?? host.chimeVolume,
    }
  }

  /**
   * Store one field, persist it, and notify.
   * @param field - which preference to write.
   * @param value - the new value (volumes are clamped into 0…2).
   */
  set<K extends keyof LocalBeepSettings>(field: K, value: LocalBeepSettings[K]): void {
    const normalized = (field === 'enabled'
      ? value
      : clampVolume(value)) as LocalBeepSettings[K] | undefined
    if (normalized === undefined || this.snapshot[field] === normalized) return
    const next: StoredPatch = { ...this.snapshot, [field]: normalized }
    this.snapshot = next
    save(next)
    for (const listener of this.listeners) listener()
  }

  /**
   * Flip the switch — what both UI surfaces do.
   * @param host - the Host Config, used for the default until this browser chooses.
   */
  toggle(host: BeepSettings): void {
    this.set('enabled', !this.resolve(host).enabled)
  }

  /** Forget every local choice (back to the Host defaults). */
  reset(): void {
    if (Object.keys(this.snapshot).length === 0) return
    this.snapshot = {}
    save({})
    for (const listener of this.listeners) listener()
  }
}

/** The one per-browser preference document. */
export const localBeep = new LocalBeepStore()
