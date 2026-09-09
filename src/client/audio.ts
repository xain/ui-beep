/**
 * Beep audio engine: procedural Web-Audio tones with fade envelopes, played
 * through one lazily-created AudioContext.
 *
 * Browsers block audio until a user gesture (autoplay policy), so the context
 * is created and resumed on the first pointer/keydown interaction observed
 * anywhere on the page. Before that gesture every `play` is a silent no-op —
 * the plugin must never throw or spam the console because audio is not ready.
 *
 * All tones are synthesized in code (no asset files): a short high tick for
 * streaming output, a soft low "lub-dub" heartbeat hum for a working agent,
 * and a two-tone chime for "this session awaits your input". Every tone
 * carries a fade envelope so rapid state flips never click or pop — and the
 * hum's slow attack and long release are what make it calm rather than
 * urgent.
 */

/** One playable beep voice. */
export type BeepVoice = 'tick' | 'hum' | 'chime'

/** Audio engine options. */
export interface BeepAudioOptions {
  /** Master gain (0…2; above 1 amplifies past nominal full scale). Default 0.4. */
  volume?: number
  /** Minimum seconds between two plays of the same voice (debounce). Default 0.05. */
  minInterval?: number
}

/** Per-voice gain table (0…2), multiplied into the master bus on play. */
export type BeepVoiceVolumes = Record<BeepVoice, number>

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

  constructor(options: BeepAudioOptions = {}) {
    this.volume = clampVolume(options.volume ?? DEFAULT_VOLUME)
    this.minInterval = options.minInterval ?? 0.05
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
  }

  /** Current per-voice gain table (0…2). */
  getVoiceVolumes(): BeepVoiceVolumes {
    return { ...this.voiceVolumes }
  }

  /**
   * Set one voice's gain (0…2; above 1 amplifies past full scale). Multiplied
   * into the master bus on play.
   * @param voice - which voice to tune.
   * @param value - linear gain.
   */
  setVoiceVolume(voice: BeepVoice, value: number): void {
    this.voiceVolumes[voice] = clampVolume(value)
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
   * Play one voice if the debounce window allows. Silent no-op until armed,
   * and while globally muted (`setEnabled(false)`).
   * @param voice - which tone to play.
   */
  play(voice: BeepVoice): void {
    const ctx = this.ctx
    if (ctx === undefined || this.master === undefined) return
    if (!this.enabled) return
    const now = performance.now()
    const last = this.lastPlayed.get(voice)
    if (last !== undefined && now - last < this.minInterval * 1000) return
    this.lastPlayed.set(voice, now)

    const gain = this.voiceVolumes[voice]
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
