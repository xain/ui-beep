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
 * Audio is silent until the first user gesture (browser autoplay policy), and
 * every subscription rides the plugin fiber's effect lifecycle, so unload and
 * HMR dispose cleanly. No host half behavior; the node half exists only so the
 * plugin appears in the Loader.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { BeepAudio, type BeepVoice } from './audio.ts'
import { watchBeepState } from './watch.ts'

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

/** Required services: the sessions face is the only runtime dependency. */
export const inject = ['sessions']

/**
 * Client plugin body: build the audio engine, bind the first-gesture arm, and
 * watch session state for beep edges.
 * @param ctx - client root context.
 * @param config - row config; falls back to defaults.
 */
export function apply(ctx: ClientContext, config?: BeepConfig): void {
  const audio = new BeepAudio(config?.volume === undefined ? {} : { volume: config.volume })
  audio.bindGesture()
  const enabled = config?.enabled ?? true

  ctx.effect(() => {
    if (!enabled) return () => {}
    return watchBeepState(ctx, {
      onBeep: (voice: BeepVoice) => { audio.play(voice) },
    }, {
      ...(config?.heartbeatMs === undefined ? {} : { heartbeatMs: config.heartbeatMs }),
      ...(config?.pendingFirstRechimeMs === undefined ? {} : { pendingFirstRechimeMs: config.pendingFirstRechimeMs }),
      ...(config?.pendingRechimeMs === undefined ? {} : { pendingRechimeMs: config.pendingRechimeMs }),
      ...(config?.streamingPauseMs === undefined ? {} : { streamingPauseMs: config.streamingPauseMs }),
    })
  }, 'ui-beep: session state watcher')
}