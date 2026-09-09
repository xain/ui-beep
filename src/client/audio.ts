/**
 * Beep audio engine: procedural Web-Audio tones with fade envelopes, played
 * through one lazily-created AudioContext, with optional user-supplied audio
 * files per voice.
 *
 * Browsers block audio until a user gesture (autoplay policy), so the context
 * is created and resumed on the first pointer/keydown interaction observed
 * anywhere on the page. Before that gesture every `play` is a silent no-op —
 * the plugin must never throw or spam the console because audio is not ready.
 *
 * Every voice has a built-in synthesized tone (zero asset files): a short
 * high tick for streaming output, a soft low "lub-dub" heartbeat hum for a
 * working agent, and a two-tone chime for "this session awaits your input".
 * A user may configure a custom audio file path for any voice through the
 * Settings page; the engine then plays that file (fetched from the Host route
 * and decoded once, then cached) instead of the synthesized tone. Semantics:
 * - **tick / chime** — the custom file plays once per trigger (one-shot).
 * - **hum** — the custom file loops seamlessly from the first beat until the
 *   working state ends (`stopLoop`), so the file's own length sets the
 *   heartbeat cadence; replacing the file changes the interval.
 * - A voice with no configured path, or whose file cannot be read or decoded,
 *   falls back to the built-in tone.
 */

import type { BeepVoice } from '../beep-settings.ts'

export type { BeepVoice } from '../beep-settings.ts'

/** Audio engine options. */
export interface BeepAudioOptions {
  /** Master gain (0…2; above 1 amplifies past nominal full scale). Default 0.4. */
  volume?: number
  /** Minimum seconds between two plays of the same voice (debounce). Default 0.05. */
  minInterval?: number
  /**
   * Custom audio path per voice (absolute filesystem path, served by the Host
   * `/ui-beep/audio/:voice` route). Absent or unreadable → built-in tone.
   */
  customPaths?: Partial<Record<BeepVoice, string>>
}

/** Per-voice gain table (0…2), multiplied into the master bus on play. */
export type BeepVoiceVolumes = Record<BeepVoice, number>

/** Per-voice custom audio path table; a missing key means built-in tone. */
export type BeepCustomPaths = Partial<Record<BeepVoice, string>>

/**
 * Per-voice buffer cache state: the decoded buffer once ready, `'pending'`
 * while a fetch/decode is in flight, `'failed'` after an unreadable or
 * undecodable file (so we do not retry the network on every beat).
 */
type BufferState = AudioBuffer | 'pending' | 'failed'

/** The one audio engine instance per page. */
export class BeepAudio {
  private ctx: AudioContext | undefined
  private master: GainNode | undefined
  private volume: number
  private enabled = true
  private voiceVolumes: BeepVoiceVolumes = { tick: 1, hum: 1, chime: 1 }
  private readonly minInterval: number
  private readonly lastPlayed = new Map<BeepVoice, number>()
  private gestureBound = false
  private customPaths: BeepCustomPaths = {}
  private readonly buffers = new Map<BeepVoice, BufferState>()
  /** Active seamless loop per voice (only hum uses it), with its voice gain node. */
  private readonly loops = new Map<BeepVoice, { source: AudioBufferSourceNode; gain: GainNode }>()

  constructor(options: BeepAudioOptions = {}) {
    this.volume = clampVolume(options.volume ?? DEFAULT_VOLUME)
    this.minInterval = options.minInterval ?? 0.05
    this.customPaths = { ...options.customPaths }
  }

  /** Current master volume (0…2). */
  getVolume(): number {
    return this.volume
  }

  /**
   * Set master volume (0…2; above 1 amplifies past full scale). Safe before
   * the context exists.
   * @param value - linear gain.
   */
  setVolume(value: number): void {
    this.volume = clampVolume(value)
    if (this.master !== undefined) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx?.currentTime ?? 0, 0.01)
    }
  }

  /** Whether any play is audible. */
  getEnabled(): boolean {
    return this.enabled
  }

  /** Set whether any play is audible (a global mute). */
  setEnabled(value: boolean): void {
    this.enabled = value
    // Muting stops any running custom loop immediately; unmuting lets the
    // next heartbeat start it again.
    if (!value) {
      for (const voice of [...this.loops.keys()]) this.stopLoop(voice)
    }
  }

  /** Current per-voice gain table (0…2). */
  getVoiceVolumes(): BeepVoiceVolumes {
    return { ...this.voiceVolumes }
  }

  /**
   * Set one voice's gain (0…2; above 1 amplifies past full scale). Multiplied
   * into the master bus on play; a running custom loop picks the change up
   * immediately.
   * @param voice - which voice to tune.
   * @param value - linear gain.
   */
  setVoiceVolume(voice: BeepVoice, value: number): void {
    this.voiceVolumes[voice] = clampVolume(value)
    const loop = this.loops.get(voice)
    if (loop !== undefined) {
      loop.gain.gain.setTargetAtTime(this.voiceVolumes[voice], this.ctx?.currentTime ?? 0, 0.01)
    }
  }

  /** Current custom audio path per voice (undefined = built-in tone). */
  getCustomPaths(): BeepCustomPaths {
    return { ...this.customPaths }
  }

  /**
   * Set one voice's custom audio path. Changing the path invalidates the
   * decoded-buffer cache; clearing it stops any running loop and returns the
   * voice to the built-in tone. Fetching is deferred to the next play so a
   * path set before the context exists still works after the first gesture.
   * @param voice - which voice to retarget.
   * @param path - absolute filesystem path, or undefined for the built-in tone.
   */
  setCustomAudio(voice: BeepVoice, path: string | undefined): void {
    const previous = this.customPaths[voice]
    if (path === undefined) delete this.customPaths[voice]
    else this.customPaths[voice] = path
    if (previous === path) return
    this.buffers.delete(voice)
    if (path === undefined) this.stopLoop(voice)
  }

  /**
   * Stop a running seamless loop (used by the watcher's `onHumStop`).
   * @param voice - which looping voice to stop.
   */
  stopLoop(voice: BeepVoice): void {
    const loop = this.loops.get(voice)
    if (loop === undefined) return
    this.loops.delete(voice)
    try {
      loop.source.stop()
    } catch {
      // A source that already stopped on its own is fine to ignore.
    }
    loop.source.disconnect()
    loop.gain.disconnect()
  }

  /**
   * Arm audio for a user gesture: create/resume the context on first call.
   * Called from a document-level gesture listener.
   */
  arm(): void {
    if (this.ctx === undefined) {
      // `globalThis` (not `window`) so tests without a jsdom DOM still work;
      // the browser always provides AudioContext (or the webkit prefix).
      const globalObj = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
      const Ctor = globalObj.AudioContext ?? globalObj.webkitAudioContext
      if (Ctor === undefined) return
      const ctx = new Ctor()
      const master = ctx.createGain()
      master.gain.value = this.volume
      master.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {})
    }
  }

  /**
   * Bind a one-time gesture arm: the first pointer/keydown anywhere arms the
   * engine, and every later play works without further gestures.
   * @param target - gesture surface (defaults to `window`).
   */
  bindGesture(target: EventTarget = window): void {
    if (this.gestureBound) return
    this.gestureBound = true
    const arm = (): void => {
      this.arm()
      target.removeEventListener('pointerdown', arm)
      target.removeEventListener('keydown', arm)
    }
    target.addEventListener('pointerdown', arm)
    target.addEventListener('keydown', arm)
  }

  /**
   * Play one voice. A configured custom audio file plays when available
   * (one-shot for tick/chime, seamless loop for hum); otherwise the built-in
   * synthesized tone plays. Silent no-op until armed, while globally muted,
   * and while a custom buffer is still loading (the next beat retries).
   * @param voice - which tone to play.
   */
  play(voice: BeepVoice): void {
    const ctx = this.ctx
    if (ctx === undefined || this.master === undefined) return
    if (!this.enabled) return
    // A running custom loop is already audible; the heartbeat interval keeps
    // calling play, so do not stack a second loop on top.
    if (voice === 'hum' && this.loops.has('hum')) return

    const now = performance.now()
    const last = this.lastPlayed.get(voice)
    if (last !== undefined && now - last < this.minInterval * 1000) return
    this.lastPlayed.set(voice, now)

    const gain = this.voiceVolumes[voice]
    const path = this.customPaths[voice]
    if (path !== undefined) {
      const buffer = this.buffers.get(voice)
      if (buffer === undefined) {
        void this.loadCustom(voice)
        return // silent this beat; the next one plays the custom file
      }
      if (typeof buffer === 'object') {
        this.playBuffer(buffer, gain, voice === 'hum')
        return
      }
      // 'pending' or 'failed': fall through to the built-in tone.
    }
    switch (voice) {
      case 'tick': renderTick(ctx, this.master, gain); break
      case 'hum': renderHum(ctx, this.master, gain); break
      case 'chime': renderChime(ctx, this.master, gain); break
    }
  }

  /** Fetch and decode one voice's custom audio file into the cache. */
  private async loadCustom(voice: BeepVoice): Promise<void> {
    const ctx = this.ctx
    if (ctx === undefined) return
    this.buffers.set(voice, 'pending')
    let bytes: ArrayBuffer
    try {
      const response = await fetch(`/ui-beep/audio/${voice}`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`audio route answered ${response.status}`)
      bytes = await response.arrayBuffer()
    } catch {
      this.buffers.set(voice, 'failed')
      return
    }
    try {
      const buffer = await ctx.decodeAudioData(bytes)
      this.buffers.set(voice, buffer)
    } catch {
      this.buffers.set(voice, 'failed')
    }
  }

  /** Play one decoded buffer: one-shot, or seamless loop when `loop` is true. */
  private playBuffer(buffer: AudioBuffer, gain: number, loop: boolean): void {
    const ctx = this.ctx
    if (ctx === undefined || this.master === undefined) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const voiceGain = ctx.createGain()
    voiceGain.gain.value = gain
    source.connect(voiceGain)
    voiceGain.connect(this.master)
    if (loop) {
      // Seamless loop: the file's own length is the heartbeat cadence. Only
      // the hum voice loops, so the loop registry is keyed by 'hum'.
      source.loop = true
      source.start()
      this.loops.set('hum', { source, gain: voiceGain })
    } else {
      source.start()
      source.onended = () => {
        source.disconnect()
        voiceGain.disconnect()
      }
    }
  }

  /**
   * Preview one voice: plays the custom audio file once (never loops, even
   * for hum) or the built-in tone, at the current voice/master gain. Used by
   * the Settings page's preview buttons, so a looping hum preview does not
   * keep playing.
   * @param voice - which voice to audition.
   */
  preview(voice: BeepVoice): void {
    const ctx = this.ctx
    if (ctx === undefined || this.master === undefined) return
    if (!this.enabled) return
    const gain = this.voiceVolumes[voice]
    const path = this.customPaths[voice]
    if (path !== undefined) {
      const buffer = this.buffers.get(voice)
      if (buffer === undefined) {
        // Prefer the custom file for the audition; fall back to the tone if
        // it cannot be fetched/decoded (the fetch also warms the cache).
        void this.loadCustom(voice)
      } else if (typeof buffer === 'object') {
        this.playBuffer(buffer, gain, false)
        return
      }
      // 'pending'/'failed': fall through to the built-in tone.
    }
    switch (voice) {
      case 'tick': renderTick(ctx, this.master, gain); break
      case 'hum': renderHum(ctx, this.master, gain); break
      case 'chime': renderChime(ctx, this.master, gain); break
    }
  }
}

/** Default master gain when no option is given (conservative). */
const DEFAULT_VOLUME = 0.4

/**
 * Clamp a gain into 0…2. The ceiling is deliberately above Web Audio's
 * nominal full scale (1.0): the user owns the loudness decision, so the
 * engine only guards against nonsense values, never against loud ones.
 */
function clampVolume(value: number): number {
  return Math.min(2, Math.max(0, value))
}

/**
 * Schedule one oscillator burst into the master bus.
 * @param ctx - audio context.
 * @param destination - master gain node.
 * @param frequency - tone frequency in Hz.
 * @param start - start offset in seconds from now.
 * @param duration - total tone length in seconds.
 * @param peak - peak amplitude 0…1 (before the master gain).
 * @param secondFrequency - optional second tone (chime); 0.6x amplitude.
 */
function scheduleTone(
  ctx: AudioContext,
  destination: AudioNode,
  frequency: number,
  start: number,
  duration: number,
  peak: number,
  secondFrequency?: number,
): void {
  const fade = 0.005
  const now = ctx.currentTime
  const t0 = now + start

  const playOne = (freq: number, amp: number): void => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    // Linear fade in/out prevents clicks at the envelope edges.
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(amp, t0 + fade)
    gain.gain.setValueAtTime(amp, t0 + duration - fade)
    gain.gain.linearRampToValueAtTime(0, t0 + duration)
    osc.connect(gain)
    gain.connect(destination)
    osc.start(t0)
    osc.stop(t0 + duration + 0.01)
  }

  playOne(frequency, peak)
  if (secondFrequency !== undefined) {
    playOne(secondFrequency, peak * 0.6)
  }
}

/**
 * Schedule one soft oscillator swell into the master bus. Unlike the
 * click-guard fades in {@link scheduleTone}, this uses a slow attack and a
 * long release, so the note *breathes* in and out instead of striking — the
 * calm, non-anxious character of the working heartbeat.
 * @param ctx - audio context.
 * @param destination - master gain node.
 * @param start - start offset in seconds from now.
 * @param frequency - tone frequency in Hz.
 * @param peak - peak amplitude 0…1 (before the master gain).
 * @param duration - total tone length in seconds.
 * @param harmonic - optional second frequency at 0.35x peak (adds warmth and
 *   speaker audibility without making the tone brighter).
 */
function scheduleSoftBeat(
  ctx: AudioContext,
  destination: AudioNode,
  start: number,
  frequency: number,
  peak: number,
  duration: number,
  harmonic?: number,
): void {
  const now = ctx.currentTime
  const t0 = now + start
  const attack = 0.04
  const release = Math.min(0.12, duration * 0.5)

  const playOne = (freq: number, amp: number): void => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    // Slow attack removes the percussive "thump" transient; the long release
    // makes the tail melt away instead of cutting off.
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(amp, t0 + attack)
    gain.gain.setValueAtTime(amp, t0 + duration - release)
    gain.gain.linearRampToValueAtTime(0, t0 + duration)
    osc.connect(gain)
    gain.connect(destination)
    osc.start(t0)
    osc.stop(t0 + duration + 0.02)
  }

  playOne(frequency, peak)
  if (harmonic !== undefined) playOne(harmonic, peak * 0.35)
}

/** Streaming-output tick: short 2 kHz pop, 60 ms. */
function renderTick(ctx: AudioContext, destination: AudioNode, gain: number): void {
  scheduleTone(ctx, destination, 2000, 0, 0.06, 0.5 * gain)
}

/**
 * Working hum: a soft, low "lub-dub" heartbeat — two gentle sine swells in
 * the warm 90–120 Hz range, spaced like a resting heartbeat. The slow attack
 * and the falling second beat are what make it reassuring rather than urgent.
 */
function renderHum(ctx: AudioContext, destination: AudioNode, gain: number): void {
  // "lub": the main beat, with a quiet octave harmonic for small-speaker
  // audibility. "dub": the softer, lower follow-up, like a real heartbeat.
  // Peaks are chosen so the loudest instantaneous sum (lub + its harmonic)
  // stays under the 1.0 clip threshold at full master/voice gain.
  scheduleSoftBeat(ctx, destination, 0, 118, 0.7 * gain, 0.4, 236)
  scheduleSoftBeat(ctx, destination, 0.32, 92, 0.55 * gain, 0.34)
}

/** Awaiting-input chime: two-tone bell (880 Hz + 1320 Hz), 500 ms. */
function renderChime(ctx: AudioContext, destination: AudioNode, gain: number): void {
  scheduleTone(ctx, destination, 880, 0, 0.5, 0.6 * gain, 1320)
}