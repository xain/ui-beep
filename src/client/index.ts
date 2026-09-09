/**
 * Agent-heartbeat sonification plugin, browser half: dsh-beep.
 *
 * Plays three procedural Web-Audio tones as a subtle, non-intrusive heartbeat
 * for what the agents on this page are doing (one voice at a time):
 * - **hum** — any session is busy (working) and not awaiting you and not
 *   streaming visible output: a low heartbeat repeats every 4 s through
 *   "Deep diving…" (the model request in flight), tool execution (running
 *   code, reading files), and reasoning. It pauses while the current session
 *   streams visible output (the ticks take over) and while any interaction is
 *   pending (the chime already called you), resuming when work continues,
 * - **tick** — the current session streams visible output,
 * - **chime** — any session begins awaiting your input (approval / plan
 *   review / question).
 *
 * The plugin also owns its Settings surface: a `settings.section` page where
 * the enable switch and one volume per voice (plus the master gain) are read
 * from and written to the durable `ui-beep` settings section, and applied to
 * the audio engine live. The cordis row `config:` seeds the section as the
 * composition base; a user override wins from then on.
 *
 * Audio is silent until the first user gesture (browser autoplay policy), and
 * every subscription rides the plugin fiber's effect lifecycle, so unload and
 * HMR dispose cleanly. No host half behavior beyond the settings registration;
 * the node half exists so the plugin appears in the Loader.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the settingsScope Context merge (the durable section's transport).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the composer `conversation.input.right` slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BEEP_SETTINGS_NAMESPACE, DEFAULT_ENABLED,
  type BeepSettings,
} from '../beep-settings.ts'
import { BeepAudio, type BeepVoice } from './audio.ts'
import { watchBeepState } from './watch.ts'
import { BeepSettingsSection } from './BeepSettingsSection.tsx'
import type { BeepSettingsSectionInjected } from './BeepSettingsSection.tsx'
import { MuteToggle } from './MuteToggle.tsx'
import type { MuteToggleInjected } from './MuteToggle.tsx'
import { createBeepSettingsRowStore } from './settings-store.ts'
import { en, zh, type BeepKey } from './locales.ts'

/** Plugin config (cordis row `config:`). Every field optional. */
export interface BeepConfig {
  /** Master volume 0…1. Default 0.5. */
  volume?: number
  /** Silence everything while false. Default true. */
  enabled?: boolean
  /** Busy heartbeat period in ms. Default 4000. */
  heartbeatMs?: number
  /** Delay before the first re-chime of an unanswered interaction. Default 10000. */
  pendingFirstRechimeMs?: number
  /** Period between later re-chimes of an unanswered interaction. Default 30000. */
  pendingRechimeMs?: number
  /** How long after the last visible-text growth the output still counts as streaming. Default 1500. */
  streamingPauseMs?: number
}

/** Required services: the sessions list, the pending-interaction registry, the
 *  Conversation assembly the beep watcher reads, the settings scope, the slot
 *  registry, and the locale service. */
export const inject = [
  'sessions', 'uiSession', 'uiConversation', 'slots', 'locale', 'settingsScope',
]

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The UI Beep settings section copy. */
    'settings.beep': BeepKey
  }
}

/** Dictionary namespace owned by this plugin's settings section. */
const SETTINGS_NS = 'settings.beep'

/**
 * Client plugin body: build the audio engine, bind the first-gesture arm,
 * watch session state for beep edges, and own the UI Beep settings section —
 * its values drive the engine live from the durable settings document.
 * @param ctx - client root context.
 * @param config - row config; falls back to defaults.
 */
export function apply(ctx: Context, config?: BeepConfig): void {
  const audio = new BeepAudio(config?.volume === undefined ? {} : { volume: config.volume })
  audio.bindGesture()
  audio.setEnabled(config?.enabled ?? DEFAULT_ENABLED)

  // ── durable settings section ────────────────────────────────────────────
  // The scope resolves schema defaults → row config (composition base) →
  // user overrides. The engine follows the resolved value live.
  const host = ctx.settingsScope.bind<BeepSettings>({ namespace: BEEP_SETTINGS_NAMESPACE })
  const store = createBeepSettingsRowStore()
  let bound: BoundActions<typeof store> | undefined

  // The composer mute toggle's reactive source: true = beeps muted.
  const muteStore = createSnapshotStore<{ value: boolean }>({ value: !(config?.enabled ?? DEFAULT_ENABLED) })
  // Whether a busy session is humming right now (fed by the watcher's
  // onHumStateChange). Used to play an immediate beat when beeps are
  // re-enabled, instead of waiting for the next heartbeat interval.
  let humActive = false
  // Tracks the previous enabled state so the mute→unmute edge is visible.
  let wasEnabled = config?.enabled ?? DEFAULT_ENABLED

  const sync = (): void => {
    const snapshot = host.getSnapshot()
    const section = snapshot.value
    // Adopt the resolved value into the engine first so a settings change
    // applies before the UI mirrors it.
    if (section !== undefined) {
      audio.setEnabled(section.enabled)
      audio.setVolume(section.masterVolume)
      audio.setVoiceVolume('tick', section.tickVolume)
      audio.setVoiceVolume('hum', section.humVolume)
      audio.setVoiceVolume('chime', section.chimeVolume)
      audio.setCustomAudio('tick', section.tickPath)
      audio.setCustomAudio('hum', section.humPath)
      audio.setCustomAudio('chime', section.chimePath)
      muteStore.update(draft => { draft.value = !section.enabled })
      // Unmute while a busy session is humming: play a beat at once so the
      // user hears the state change instead of waiting for the interval.
      if (section.enabled && !wasEnabled && humActive) {
        audio.play('hum')
      }
      wasEnabled = section.enabled
    }
    bound?.sync(section, snapshot.writable)
  }
  ctx.effect(() => host.subscribe(sync), 'ui-beep: settings scope adoption')
  // Adopt the initial resolved value (already folded by the Host) — the
  // scope's first snapshot arrives before the mirror's first describe, so
  // this also seeds the engine when a section exists.
  sync()

  // ── state watcher ───────────────────────────────────────────────────────
  // The watcher always runs; the engine's enabled gate (driven by the
  // settings section) decides audibility, so toggling the switch mid-session
  // silences or restores beeps without re-wiring the subscriptions.
  ctx.effect(() => {
    return watchBeepState(ctx, {
      onBeep: (voice: BeepVoice) => { audio.play(voice) },
      // A looping custom hum must stop when the working state ends; the
      // synthesized hum needs no stop signal.
      onHumStop: () => { audio.stopLoop('hum') },
      // Remember whether the heartbeat is active so unmuting can play an
      // immediate beat.
      onHumStateChange: (active) => { humActive = active },
    }, {
      ...(config?.heartbeatMs === undefined ? {} : { heartbeatMs: config.heartbeatMs }),
      ...(config?.pendingFirstRechimeMs === undefined ? {} : { pendingFirstRechimeMs: config.pendingFirstRechimeMs }),
      ...(config?.pendingRechimeMs === undefined ? {} : { pendingRechimeMs: config.pendingRechimeMs }),
      ...(config?.streamingPauseMs === undefined ? {} : { streamingPauseMs: config.streamingPauseMs }),
    })
  }, 'ui-beep: session state watcher')

  // ── settings section ────────────────────────────────────────────────────
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-beep: settings dictionaries')
  const t = ctx.locale.bind(SETTINGS_NS) as TranslateNS<'settings.beep'>

  const injected = (actions: BoundActions<typeof store>): BeepSettingsSectionInjected => {
    bound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's sync action is idempotent).
    sync()
    return {
      setEnabled: (value) => { void host.set('enabled', value) },
      setVolume: (voice, value) => {
        const field = voice === 'master' ? 'masterVolume'
          : voice === 'tick' ? 'tickVolume'
            : voice === 'hum' ? 'humVolume' : 'chimeVolume'
        void host.set(field, value)
      },
      preview: (voice) => { audio.preview(voice) },
      setCustomAudio: (voice, path) => {
        const field = voice === 'tick' ? 'tickPath'
          : voice === 'hum' ? 'humPath' : 'chimePath'
        if (path === undefined) void host.unset(field)
        else void host.set(field, path)
      },
    }
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'ui-beep',
    order: 20,
    label: () => t('nav'),
    locale: SETTINGS_NS,
    store,
    inject: injected,
  }, BeepSettingsSection))

  // ── composer mute toggle ────────────────────────────────────────────────
  // A speaker button beside the model selector mutes/unmutes every beep. The
  // muted state mirrors the durable `enabled` field (muted = !enabled), so it
  // stays in sync with the Settings page switch and the row config.
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'ui-beep-mute',
    order: 0,
    locale: SETTINGS_NS,
    inject: (): MuteToggleInjected => ({
      hooks: {
        muted: {
          getSnapshot: () => muteStore.getSnapshot().value,
          subscribe: (listener) => muteStore.subscribe(listener),
        },
      },
      setMuted: (muted) => { void host.set('enabled', !muted) },
    }),
  }, MuteToggle))
}