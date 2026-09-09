/**
 * UI Beep settings section: enable switch plus one volume row per voice.
 * The section is a pure preference surface — the persisted section comes
 * through the injected store hooks and writes go through the injected faces,
 * so the component holds no settings state of its own.
 */
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { BeepVoice } from './audio.ts'
import type { BeepKey } from './locales.ts'
import type { createBeepSettingsRowStore } from './settings-store.ts'
import { VolumeRow } from './VolumeRow.tsx'
import css from './BeepSettingsSection.module.css'

/** Injected business face: the settings writes plus a preview play. */
export interface BeepSettingsSectionInjected {
  /** Toggle whether any beep plays. */
  setEnabled: (enabled: boolean) => void
  /** Set one voice's volume 0…2 (and the master gain when voice is 'master'). */
  setVolume: (voice: BeepVoice | 'master', value: number) => void
  /** Play one voice through the engine (preview audition). */
  preview: (voice: BeepVoice) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type BeepSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createBeepSettingsRowStore>>
  & PropsLocale<'settings.beep'>
  & Partial<InjectFace<BeepSettingsSectionInjected>>

/** Voice volume rows in display order. */
const VOICE_ROWS: readonly { voice: BeepVoice; title: BeepKey; description: BeepKey; previewLabel: BeepKey }[] = [
  { voice: 'tick', title: 'tick.title', description: 'tick.description', previewLabel: 'previewTick' },
  { voice: 'hum', title: 'hum.title', description: 'hum.description', previewLabel: 'previewHum' },
  { voice: 'chime', title: 'chime.title', description: 'chime.description', previewLabel: 'previewChime' },
]

/**
 * Render the UI Beep settings section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function BeepSettingsSection({ t, useStore, setEnabled, setVolume, preview }: BeepSettingsSectionProps) {
  const state = useStore(s => s)
  const writable = state.ready && state.writable
  const voiceVolume = (voice: BeepVoice): number =>
    voice === 'tick' ? state.tickVolume : voice === 'hum' ? state.humVolume : state.chimeVolume
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
      {VOICE_ROWS.map(({ voice, title, description, previewLabel }) => (
        <VolumeRow
          key={voice}
          title={title}
          description={description}
          previewLabel={previewLabel}
          value={voiceVolume(voice)}
          disabled={!writable}
          onChange={(value) => { setVolume?.(voice, value) }}
          onPreview={() => { preview?.(voice) }}
          t={t}
        />
      ))}
    </div>
  )
}