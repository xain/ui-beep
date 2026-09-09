/**
 * One volume preference row for the UI Beep settings section: title +
 * description on the left, a native range slider with a live percentage readout
 * and an optional preview button on the right. The slider stays controlled —
 * the value prop is the persisted setting, never the drag echo — so a rapid
 * drag is throttled by the settings write path and the readout never jumps
 * ahead of what is actually applied.
 *
 * The slider spans 0–200 %: 100 % is Web Audio's nominal full scale, and the
 * stretch past it is the user's own headroom (values above full scale amplify
 * the tone peaks and may clip). The track fill follows the slider position so
 * the visible fill never exceeds the track.
 */
import type { CSSProperties } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BeepKey } from './locales.ts'
import { VOLUME_MAX } from '../beep-settings.ts'
import css from './VolumeRow.module.css'

/** Volume readout scale: 0…2 maps to 0…200 %. */
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
  /** Current volume 0…2 (the persisted setting). */
  value: number
  /** Whether the control accepts input. */
  disabled: boolean
  /** Callback with the new volume 0…2. */
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
  const percent = Math.round(value * PERCENT)
  const sliderMax = Math.round(VOLUME_MAX * PERCENT)
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
          style={{ '--dsh-beep-fill': `${Math.round((percent / sliderMax) * 100)}%` } as CSSProperties}
          min={0}
          max={sliderMax}
          value={percent}
          aria-valuetext={t('percent', { value: String(percent) })}
          aria-label={t(title)}
          disabled={disabled}
          onChange={(event) => { onChange(Number(event.target.value) / PERCENT) }}
        />
        <span className={css.percent}>{t('percent', { value: String(percent) })}</span>
      </div>
    </div>
  )
}