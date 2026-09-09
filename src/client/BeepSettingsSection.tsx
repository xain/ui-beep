/**
 * UI Beep settings section: enable switch, one volume row per voice, and per
 * voice a custom-audio picker (choose a file, restore the built-in sound).
 * The section is a pure preference surface — the persisted section comes
 * through the injected store hooks and writes go through the injected faces,
 * so the component holds no settings state of its own beyond the picker
 * dialog's open voice.
 */
import { useState } from 'react'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { BeepVoice } from './audio.ts'
import type { BeepKey } from './locales.ts'
import type { createBeepSettingsRowStore } from './settings-store.ts'
import { AudioFileBrowser } from './AudioFileBrowser.tsx'
import { VolumeRow } from './VolumeRow.tsx'
import css from './BeepSettingsSection.module.css'

/** Injected business face: the settings writes, the preview play, and the custom audio write. */
export interface BeepSettingsSectionInjected {
  /** Toggle whether any beep plays. */
  setEnabled: (enabled: boolean) => void
  /** Set one voice's volume 0…2 (and the master gain when voice is 'master'). */
  setVolume: (voice: BeepVoice | 'master', value: number) => void
  /** Play one voice through the engine (preview audition). */
  preview: (voice: BeepVoice) => void
  /** Set one voice's custom audio path (undefined restores the built-in tone). */
  setCustomAudio: (voice: BeepVoice, path: string | undefined) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type BeepSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createBeepSettingsRowStore>>
  & PropsLocale<'settings.beep'>
  & Partial<InjectFace<BeepSettingsSectionInjected>>

/** Voice rows in display order, with the copy keys for volume and picker. */
const VOICE_ROWS: readonly {
  voice: BeepVoice
  title: BeepKey
  description: BeepKey
  previewLabel: BeepKey
  selectLabel: BeepKey
  restoreLabel: BeepKey
}[] = [
  {
    voice: 'tick', title: 'tick.title', description: 'tick.description',
    previewLabel: 'previewTick', selectLabel: 'custom.selectTick', restoreLabel: 'custom.restoreTick',
  },
  {
    voice: 'hum', title: 'hum.title', description: 'hum.description',
    previewLabel: 'previewHum', selectLabel: 'custom.selectHum', restoreLabel: 'custom.restoreHum',
  },
  {
    voice: 'chime', title: 'chime.title', description: 'chime.description',
    previewLabel: 'previewChime', selectLabel: 'custom.selectChime', restoreLabel: 'custom.restoreChime',
  },
]

/**
 * Render the UI Beep settings section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function BeepSettingsSection({ t, useStore, setEnabled, setVolume, preview, setCustomAudio }: BeepSettingsSectionProps) {
  const state = useStore(s => s)
  const writable = state.ready && state.writable
  const [pickingVoice, setPickingVoice] = useState<BeepVoice | undefined>(undefined)
  const voiceVolume = (voice: BeepVoice): number =>
    voice === 'tick' ? state.tickVolume : voice === 'hum' ? state.humVolume : state.chimeVolume
  const voicePath = (voice: BeepVoice): string | undefined =>
    voice === 'tick' ? state.tickPath : voice === 'hum' ? state.humPath : state.chimePath
  const picking = VOICE_ROWS.find(row => row.voice === pickingVoice)
  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <div className={css.enableRow}>
        <div className={css.enableText}>
          <div className={css.title}>{t('enabled.title')}</div>
          <div className={css.desc}>{t('enabled.description')}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label={t('enabled.title')}
          disabled={!writable}
          className={css.switch}
          data-on={state.enabled ? 'true' : undefined}
          onClick={() => { setEnabled?.(!state.enabled) }}
        >
          <span className={css.thumb} />
        </button>
      </div>
      <VolumeRow
        title="master.title"
        description="master.description"
        value={state.masterVolume}
        disabled={!writable}
        onChange={(value) => { setVolume?.('master', value) }}
        t={t}
      />
      {VOICE_ROWS.map(({ voice, title, description, previewLabel, selectLabel, restoreLabel }) => {
        const path = voicePath(voice)
        return (
          <div key={voice} className={css.voiceBlock}>
            <VolumeRow
              title={title}
              description={description}
              previewLabel={previewLabel}
              value={voiceVolume(voice)}
              disabled={!writable}
              onChange={(value) => { setVolume?.(voice, value) }}
              onPreview={() => { preview?.(voice) }}
              t={t}
            />
            <div className={css.customRow}>
              <button
                type="button"
                className={css.customButton}
                aria-label={t(selectLabel)}
                disabled={!writable}
                onClick={() => { setPickingVoice(voice) }}
              >
                {t('custom.select')}
              </button>
              {path === undefined
                ? null
                : (
                  <>
                    <span className={css.customBadge}>{t('custom.badge')}</span>
                    <span className={css.customPath} title={path}>{path}</span>
                    <button
                      type="button"
                      className={css.customRestore}
                      aria-label={t(restoreLabel)}
                      disabled={!writable}
                      onClick={() => { setCustomAudio?.(voice, undefined) }}
                    >
                      {t('custom.restore')}
                    </button>
                  </>
                )}
            </div>
          </div>
        )
      })}
      {picking !== undefined && (
        <AudioFileBrowser
          voiceLabel={picking.title}
          t={t}
          onCancel={() => { setPickingVoice(undefined) }}
          onPick={(path) => {
            setPickingVoice(undefined)
            setCustomAudio?.(picking.voice, path)
          }}
        />
      )}
    </div>
  )
}