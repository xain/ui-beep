/**
 * The beep on/off switch, owned by the browser that plays the sound.
 *
 * This is a per-device switch by decision: the tone comes out of THIS browser,
 * so this browser decides whether it plays. The value lives in `localStorage`,
 * never in the DSH profile, which means a phone can be muted while the desktop
 * keeps chiming — and a click takes effect immediately, with no round trip to
 * the Host (a phone whose config write never landed is exactly why this exists).
 *
 * The Settings page switch and the composer speaker button both read and write
 * this one store, so the two surfaces can never disagree.
 *
 * The Host Config's `enabled` field survives as the initial default for a
 * browser that has never chosen — which is also what makes "default on, each
 * device decides from there" work.
 *
 * @module ui-beep/client/enabled-store
 */

/** localStorage key holding this browser's switch. */
export const ENABLED_STORAGE_KEY = 'dsh-client-ui-beep:enabled'

/**
 * Read the stored switch.
 * @returns this browser's choice, or undefined when it has never chosen (or the
 * browser refuses storage).
 */
function load(): boolean | undefined {
  try {
    const raw = window.localStorage.getItem(ENABLED_STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return undefined
  } catch {
    return undefined
  }
}

/** Persist the switch; a browser that refuses storage only loses it on reload. */
function save(value: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_STORAGE_KEY, value ? 'true' : 'false')
  } catch {
    // Preference only; never worth surfacing.
  }
}

/**
 * One per-browser switch with a stable snapshot reference, so both the Settings
 * page and the composer button subscribe through `useSyncExternalStore`.
 */
class LocalEnabledStore {
  private snapshot: boolean | undefined = load()
  private readonly listeners = new Set<() => void>()

  /**
   * @returns this browser's stored choice, or undefined when it has none. The
   * value is stable until the next change.
   */
  getSnapshot = (): boolean | undefined => this.snapshot

  /**
   * Observe switch replacements.
   * @param listener - invoked after each change.
   * @returns the disposer removing this listener.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * The switch this browser should actually use.
   * @param hostDefault - the Host Config value, used until this browser chooses.
   * @returns whether beeps play in this browser.
   */
  resolve(hostDefault: boolean): boolean {
    return this.snapshot ?? hostDefault
  }

  /**
   * Store this browser's choice, persist it, and notify.
   * @param value - whether beeps should play in this browser.
   */
  set(value: boolean): void {
    if (this.snapshot === value) return
    this.snapshot = value
    save(value)
    for (const listener of this.listeners) listener()
  }

  /**
   * Flip the switch — what both UI surfaces do.
   * @param hostDefault - the Host Config value, used until this browser chooses.
   */
  toggle(hostDefault: boolean): void {
    this.set(!this.resolve(hostDefault))
  }
}

/** The one per-browser beep switch. */
export const localEnabled = new LocalEnabledStore()
