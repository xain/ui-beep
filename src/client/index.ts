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
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BEEP_SETTINGS_NAMESPACE, BEEP_SETTINGS_DEFAULTS,
  type BeepSettings,
} from '../beep-settings.ts'
import { BeepAudio, type BeepVoice } from './audio.ts'
import { watchBeepState } from './watch.ts'
import { localBeep, type LocalBeepSettings } from './local-store.ts'
import { BeepSettingsSection } from './BeepSettingsSection.tsx'
import type { BeepSettingsSectionInjected } from './BeepSettingsSection.tsx'
import { MuteToggle } from './MuteToggle.tsx'
import type { MuteToggleInjected } from './MuteToggle.tsx'
import { createBeepSettingsRowStore } from './settings-store.ts'
import { en, zh, type BeepKey } from './locales.ts'

/** Required services: the sessions list, the pending-interaction registry, the
 *  Conversation assembly the beep watcher reads, the settings form seam, the
 *  slot registry, and the locale service. */
export const inject = [
  'sessions', 'uiSession', 'uiConversation', 'slots', 'locale', 'configForms',
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
 * its values drive the engine live from the plugin Config.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const audio = new BeepAudio()
  audio.bindGesture()

  // ── live settings form ──────────────────────────────────────────────────
  // DSH 0.1.7's seam: the plugin Config IS the settings document, reached
  // through `configForms.get(<entry id>)` — same entry the Host `Config`
  // schema declares, so a write from either side is one document.
  const host = ctx.configForms.get<BeepSettings>(BEEP_SETTINGS_NAMESPACE)
  const store = createBeepSettingsRowStore()
  let bound: BoundActions<typeof store> | undefined

  // ── preferences are PER BROWSER ─────────────────────────────────────────
  // The Host Config supplies defaults only. Once this browser touches the
  // switch or a slider, its own localStorage value wins for that field. Both
  // the Settings page and the composer speaker button read and write that one
  // store, so they can never disagree — and a change applies immediately
  // instead of waiting for a config round trip (that round trip is what made
  // these controls unreliable on a phone).
  let hostDefaults: BeepSettings = BEEP_SETTINGS_DEFAULTS
  /** The preferences THIS browser should actually use. */
  const effective = (): LocalBeepSettings => localBeep.resolve(hostDefaults)

  // Whether a busy session is humming right now (fed by the watcher's
  // onHumStateChange). Used to play an immediate beat when beeps are
  // re-enabled, instead of waiting for the next heartbeat interval.
  let humActive = false
  // Tracks the previous effective state so the mute→unmute edge is visible.
  let wasEnabled = effective().enabled
  audio.setEnabled(wasEnabled)

  /** Push this browser's resolved preferences into the engine. */
  const applyLocal = (): void => {
    const settings = effective()
    audio.setEnabled(settings.enabled)
    // Unmute while a busy session is humming: beat at once so the state change
    // is audible instead of waiting for the next interval.
    if (settings.enabled && !wasEnabled && humActive) audio.play('hum')
    wasEnabled = settings.enabled
    audio.setVolume(settings.masterVolume)
    audio.setVoiceVolume('tick', settings.tickVolume)
    audio.setVoiceVolume('hum', settings.humVolume)
    audio.setVoiceVolume('chime', settings.chimeVolume)
  }

  const sync = (): void => {
    const snapshot = host.getSnapshot()
    const section = snapshot.value
    if (section !== undefined) {
      hostDefaults = section
      // Custom audio paths stay Host-owned: the files live on the machine
      // running the harness, so they are not a per-device concern.
      audio.setCustomAudio('tick', section.tickPath)
      audio.setCustomAudio('hum', section.humPath)
      audio.setCustomAudio('chime', section.chimePath)
    }
    // Adopt the resolved values into the engine first so a change applies
    // before the UI mirrors it.
    applyLocal()
    bound?.sync(section, snapshot.writable, effective())
  }
  ctx.effect(() => host.subscribe(sync), 'ui-beep: settings form adoption')
  // Local preferences are the live ones: a change re-applies at once, and also
  // re-syncs the row store so both surfaces move together.
  ctx.effect(() => localBeep.subscribe(() => { applyLocal(); sync() }), 'ui-beep: local preference adoption')
  // Adopt the initial resolved value (already folded by the Host) — the
  // form's first snapshot arrives before the mirror's first describe, so
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
      // The switch and every volume are per-browser: write the local store,
      // never the Host Config (which only supplies the initial defaults).
      setEnabled: (value) => { localBeep.set('enabled', value) },
      setVolume: (voice, value) => {
        const field = voice === 'master' ? 'masterVolume'
          : voice === 'tick' ? 'tickVolume'
            : voice === 'hum' ? 'humVolume' : 'chimeVolume'
        localBeep.set(field, value)
      },
      preview: (voice) => { audio.preview(voice) },
      // Custom audio paths remain Host-owned: the files live on the machine
      // running the harness, so a path is not a per-device preference.
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
  // A speaker button beside the model selector mutes/unmutes beeps IN THIS
  // BROWSER. It reads and writes the same per-browser store as the Settings
  // page switch, so the two always agree — and a click applies at once.
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'ui-beep-mute',
    order: 0,
    locale: SETTINGS_NS,
    inject: (): MuteToggleInjected => ({
      hooks: {
        muted: {
          getSnapshot: () => !effective().enabled,
          subscribe: (listener) => localBeep.subscribe(listener),
        },
      },
      setMuted: (muted) => { localBeep.set('enabled', !muted) },
    }),
  }, MuteToggle))
}