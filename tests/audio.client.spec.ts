/**
 * Beep audio engine tests: pure Web-Audio tone synthesis with fade envelopes.
 * The engine is DOM-free until armed, and every play before a gesture is a
 * silent no-op — the two behaviors this spec pins.
 */
import { describe, expect, it, vi } from 'vitest'
import { BeepAudio } from '../src/client/audio.ts'

describe('BeepAudio', () => {
  it('defaults volume to 0.5 and clamps to 0…1', () => {
    const audio = new BeepAudio()
    expect(audio.getVolume()).toBe(0.5)
    audio.setVolume(1.7)
    expect(audio.getVolume()).toBe(1)
    audio.setVolume(-1)
    expect(audio.getVolume()).toBe(0)
  })

  it('defaults every voice to full gain and clamps per-voice values', () => {
    const audio = new BeepAudio()
    expect(audio.getVoiceVolumes()).toEqual({ tick: 1, hum: 1, chime: 1 })
    audio.setVoiceVolume('tick', 0.4)
    audio.setVoiceVolume('hum', 2)
    audio.setVoiceVolume('chime', -1)
    expect(audio.getVoiceVolumes()).toEqual({ tick: 0.4, hum: 1, chime: 0 })
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
})
