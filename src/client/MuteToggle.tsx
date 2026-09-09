/**
 * Composer mute toggle: a small speaker button in the composer's right tool
 * row (beside the model selector) that mutes/unmutes every beep. The muted
 * state mirrors the durable `ui-beep` settings `enabled` field, so the button
 * stays in sync with the Settings page switch.
 *
 * Speaker glyphs are inline SVG (the platform icon set has no volume glyph in
 * the shipped train): a filled speaker for "on", a speaker with an X for
 * "muted", matching the composer's stop-button approach.
 */
import type { HostObservable, PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MuteToggle.module.css'

/** Injected business face: the muted-state source and the toggle write. */
export interface MuteToggleInjected {
  hooks: {
    /** Live muted state (true = beeps are off). */
    muted: HostObservable<boolean>
  }
  /** Toggle muted on/off (writes the durable settings `enabled` field). */
  setMuted: (muted: boolean) => void
}

/** Full component props: runtime share + locale seat + injected face (hooks synthesized into `useMuted`). */
export type MuteToggleProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<'settings.beep'>
  & Omit<MuteToggleInjected, 'hooks'>
  & { useMuted: SnapshotSelectorHook<boolean> }

/**
 * Render the composer mute toggle.
 * @param props - composed slot props.
 * @returns the button element tree.
 */
export function MuteToggle({ t, useMuted, setMuted }: MuteToggleProps) {
  const muted = useMuted(v => v)
  return (
    <button
      type="button"
      className={css.toggle}
      aria-label={muted ? t('mute.off') : t('mute.on')}
      aria-pressed={muted}
      title={muted ? t('mute.disabledLabel') : t('mute.enabledLabel')}
      data-muted={muted ? 'true' : undefined}
      onClick={() => { setMuted(!muted) }}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        {/* Speaker body: cone + cabinet. */}
        <path
          d="M2.5 6.2v3.6c0 .6.5 1 1.1 1h1.9l3.5 2.6c.5.4 1.2.1 1.2-.6V3.2c0-.7-.7-1-1.2-.6L5.5 5.2H3.6c-.6 0-1.1.4-1.1 1z"
          fill="currentColor"
        />
        {/* Wave arcs when audible; X overlay when muted. */}
        {muted
          ? (
            <path
              d="M10.5 5.5l3.6 3.6M14.1 5.5l-3.6 3.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              fill="none"
            />
          )
          : (
            <path
              d="M10.3 5.2c.9.7 1.4 1.6 1.4 2.8s-.5 2.1-1.4 2.8M11.8 3.8c1.4 1 2.1 2.4 2.1 4.2s-.7 3.2-2.1 4.2"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              fill="none"
            />
          )}
      </svg>
    </button>
  )
}