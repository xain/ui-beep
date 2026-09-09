/**
 * One volume preference row for the UI Beep settings section: title +
 * description on the left, a native range slider with a live percentage readout
 * and an optional preview button on the right. The slider stays controlled —
 * the value prop is the persisted setting, never the drag echo — so a rapid
 * drag is throttled by the settings write path and the readout never jumps
 * ahead of what is actually applied.
 */
import type { CSSProperties } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BeepKey } from './locales.ts'
import css from './VolumeRow.module.css'

/** Volume readout scale: 0…1 maps to 0…100%. */
const PERCENT = 100

/** The section's translate function, narrowed to its own dictionary keys. */
export type BeepSettingsTranslate = TranslateNS<'settings.beep'>

/** Full component props for one volume row. */
export interface VolumeRowProps {
  /** Visible title key. */
  title: BeepKey
  /** One-line description key. */
  description: BeepKey
  /** Preview button aria-label key (omit to hide the preview control). */
  previewLabel?: BeepKey
  /** Current volume 0…1 (the persisted setting). */
  value: number
  /** Whether the control accepts input. */
  disabled: boolean
  /** Callback with the new volume 0…1. */
  onChange: (value: number) => void
  /** Callback firing the preview play. */
  onPreview?: () => void
  /** Translate function (dictionary keyed by {@link BeepKey}). */
  t: BeepSettingsTranslate
}

/**
 * Render one volume row.
 * @param props - row copy, value, and actions.
 * @returns the row element tree.
 */
export function VolumeRow({ title, description, previewLabel, value, disabled, onChange, onPreview, t }: VolumeRowProps) {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(title)}</div>
        <div className={css.desc}>{t(description)}</div>
      </div>
      <div className={css.control}>
        {previewLabel !== undefined && onPreview !== undefined
          ? (
            <button
              type="button"
              className={css.preview}
              aria-label={t(previewLabel)}
              disabled={disabled}
              onClick={onPreview}
            >
              {t('preview')}
            </button>
          )
          : null}
        <input
          type="range"
          className={css.slider}
          style={{ '--dsh-beep-fill': `${Math.round(value * PERCENT)}%` } as CSSProperties}
          min={0}
          max={100}
          value={Math.round(value * PERCENT)}
          aria-valuetext={t('percent', { value: String(Math.round(value * PERCENT)) })}
          aria-label={t(title)}
          disabled={disabled}
          onChange={(event) => { onChange(Number(event.target.value) / PERCENT) }}
        />
        <span className={css.percent}>{t('percent', { value: String(Math.round(value * PERCENT)) })}</span>
      </div>
    </div>
  )
}