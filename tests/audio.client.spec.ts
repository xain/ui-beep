/**
 * Beep audio engine tests: pure Web-Audio tone synthesis with fade envelopes.
 * The engine is DOM-free until armed, and every play before a gesture is a
 * silent no-op — the two behaviors this spec pins.
 */
import { describe, expect, it, vi } from 'vitest'
import { BeepAudio } from '../src/client/audio.ts'

describe('BeepAudio', () => {
  it('defaults volume to 0.4 and clamps to 0…2 (user owns the ceiling)', () => {
    const audio = new BeepAudio()
    expect(audio.getVolume()).toBe(0.4)
    audio.setVolume(2.5)
    expect(audio.getVolume()).toBe(2)
    audio.setVolume(-1)
    expect(audio.getVolume()).toBe(0)
  })

  it('defaults every voice to full gain and clamps per-voice values to 0…2', () => {
    const audio = new BeepAudio()
    expect(audio.getVoiceVolumes()).toEqual({ tick: 1, hum: 1, chime: 1 })
    audio.setVoiceVolume('tick', 0.4)
    audio.setVoiceVolume('hum', 2)
    audio.setVoiceVolume('chime', 2.5)
    audio.setVoiceVolume('tick', -1)
    expect(audio.getVoiceVolumes()).toEqual({ tick: 0, hum: 2, chime: 2 })
  })

  it('is enabled by default and honors setEnabled as a global mute', () => {
    const audio = new BeepAudio()
    expect(audio.getEnabled()).toBe(true)
    audio.setEnabled(false)
    expect(audio.getEnabled()).toBe(false)
    // The mute gate is enforced before any context work: nothing throws.
    expect(() => audio.play('tick')).not.toThrow()
    audio.setEnabled(true)
    expect(audio.getEnabled()).toBe(true)
  })

  it('plays nothing before a gesture arms the engine (no throw, no console noise)', () => {
    const audio = new BeepAudio()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => audio.play('tick')).not.toThrow()
    expect(() => audio.play('hum')).not.toThrow()
    expect(() => audio.play('chime')).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('arms once on the first gesture and keeps arming idempotent', () => {
    // jsdom has no AudioContext; arm() must fail soft rather than throw.
    const audio = new BeepAudio()
    const listeners = new Map<string, () => void>()
    const target = {
      addEventListener: vi.fn((type: string, fn: () => void) => { listeners.set(type, fn) }),
      removeEventListener: vi.fn((type: string) => { listeners.delete(type) }),
    } as unknown as EventTarget
    audio.bindGesture(target)
    expect(target.addEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    expect(target.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
    // A second bind must not double-register.
    audio.bindGesture(target)
    expect(target.addEventListener).toHaveBeenCalledTimes(2)
    // The gesture removes both listeners (one-shot arm).
    listeners.get('pointerdown')?.()
    expect(target.removeEventListener).toHaveBeenCalledTimes(2)
  })

  it('tracks custom audio paths per voice and reports them back', () => {
    const audio = new BeepAudio()
    expect(audio.getCustomPaths()).toEqual({})
    audio.setCustomAudio('tick', '/music/tick.wav')
    audio.setCustomAudio('hum', '/music/hum.mp3')
    expect(audio.getCustomPaths()).toEqual({ tick: '/music/tick.wav', hum: '/music/hum.mp3' })
    // Clearing a path removes it (restore default).
    audio.setCustomAudio('tick', undefined)
    expect(audio.getCustomPaths()).toEqual({ hum: '/music/hum.mp3' })
  })

  it('clearing a custom hum path stops a running loop without throwing', () => {
    const audio = new BeepAudio()
    audio.setCustomAudio('hum', '/music/hum.mp3')
    // No loop is running yet; stopLoop is a safe no-op.
    expect(() => audio.stopLoop('hum')).not.toThrow()
    audio.setCustomAudio('hum', undefined)
    expect(() => audio.stopLoop('hum')).not.toThrow()
  })

  it('preview is a safe no-op before the engine is armed', () => {
    // jsdom has no AudioContext; preview must fail soft like play, and never
    // start a loop.
    const audio = new BeepAudio()
    audio.setCustomAudio('hum', '/music/hum.mp3')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => audio.preview('tick')).not.toThrow()
    expect(() => audio.preview('hum')).not.toThrow()
    expect(() => audio.preview('chime')).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('constructs with custom paths from options', () => {
    const audio = new BeepAudio({ customPaths: { chime: '/sounds/chime.ogg' } })
    expect(audio.getCustomPaths()).toEqual({ chime: '/sounds/chime.ogg' })
  })

  // ── preview bypasses the mute gate (control group: play does not) ────────

  /**
   * Install a minimal AudioContext double so `arm()` succeeds and the spec can
   * count how many oscillators were actually scheduled.
   */
  function installFakeAudioContext(): { created: () => number; restore: () => void } {
    let count = 0
    /** A minimal AudioParam: the tone schedulers ramp these. */
    const param = () => ({
      value: 0,
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      setTargetAtTime: () => {},
    })
    const gainNode = () => ({ gain: param(), connect: () => {}, disconnect: () => {} })
    const oscNode = () => {
      count += 1
      return { type: '', frequency: param(), connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {} }
    }
    const fake = {
      currentTime: 0,
      state: 'running',
      destination: {},
      resume: async () => {},
      createGain: gainNode,
      createOscillator: oscNode,
      createBufferSource: () => ({ buffer: null, loop: false, connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {} }),
    }
    const globals = globalThis as { AudioContext?: unknown }
    const previous = globals.AudioContext
    globals.AudioContext = function FakeAudioContext() { return fake }
    return {
      created: () => count,
      restore: () => {
        if (previous === undefined) delete globals.AudioContext
        else globals.AudioContext = previous
      },
    }
  }

  it('preview still sounds while beeps are muted, unlike play', () => {
    const fake = installFakeAudioContext()
    try {
      const audio = new BeepAudio()
      audio.setEnabled(false)

      // Control group: a normal play is gated by the mute switch.
      const beforePlay = fake.created()
      audio.play('tick')
      expect(fake.created()).toBe(beforePlay)

      // Preview is an explicit user action: it must audition even while muted.
      audio.preview('tick')
      expect(fake.created()).toBeGreaterThan(beforePlay)
    } finally {
      fake.restore()
    }
  })

  it('preview still sounds while muted for a voice with custom audio configured', () => {
    const fake = installFakeAudioContext()
    try {
      const audio = new BeepAudio()
      // A configured path makes preview take the custom-audio branch; with no
      // decoded buffer yet it falls back to the built-in tone, which must also
      // not be gated by the mute switch.
      audio.setCustomAudio('chime', '/music/chime.wav')
      audio.setEnabled(false)
      const before = fake.created()
      audio.preview('chime')
      expect(fake.created()).toBeGreaterThan(before)
    } finally {
      fake.restore()
    }
  })
})
