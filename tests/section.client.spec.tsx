// @vitest-environment jsdom
/**
 * UI Beep settings section component tests: renders the enable switch and one
 * volume row per voice from the injected store, and forwards user gestures to
 * the injected write/preview faces.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BeepSettingsSection, type BeepSettingsSectionInjected } from '../src/client/BeepSettingsSection.tsx'
import { createBeepSettingsRowStore } from '../src/client/settings-store.ts'
import { en, type BeepKey } from '../src/client/locales.ts'
import type { BeepVoice } from '../src/client/audio.ts'

afterEach(cleanup)

/** Minimal param-aware translate over the en dictionary. */
function makeT(key: BeepKey, params?: Record<string, unknown>): string {
  const template = en[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{${name}}`)
}

/** Build a section wired to a real store, returning the write/preview spies. */
function mount(overrides: Partial<{
  enabled: boolean
  masterVolume: number
  tickVolume: number
  humVolume: number
  chimeVolume: number
  ready: boolean
  writable: boolean
}> = {}) {
  const store = createBeepSettingsRowStore().create()
  const section: {
    enabled: boolean
    masterVolume: number
    tickVolume: number
    humVolume: number
    chimeVolume: number
    ready: boolean
    writable: boolean
  } = {
    enabled: true,
    masterVolume: 0.5,
    tickVolume: 0.3,
    humVolume: 0.8,
    chimeVolume: 1,
    ready: true,
    writable: true,
    ...overrides,
  }
  store.actions.sync({
    enabled: section.enabled,
    masterVolume: section.masterVolume,
    tickVolume: section.tickVolume,
    humVolume: section.humVolume,
    chimeVolume: section.chimeVolume,
  }, section.writable)
  const setEnabled = vi.fn()
  const setVolume = vi.fn()
  const preview = vi.fn()
  const injected: BeepSettingsSectionInjected = { setEnabled, setVolume, preview }
  const view = render(
    <BeepSettingsSection
      t={makeT}
      useStore={selector => selector(store.getSnapshot())}
      {...injected}
    />,
  )
  return { view, setEnabled, setVolume, preview }
}

describe('BeepSettingsSection', () => {
  it('renders the heading, intro, enable switch, and all four volume rows', () => {
    const { view } = mount()
    expect(screen.getByRole('heading', { name: 'Sound' })).toBeTruthy()
    expect(screen.getByText('Volume of the beep for each state; changes apply immediately')).toBeTruthy()
    // Enable switch + 4 sliders (master, tick, hum, chime).
    expect(screen.getByRole('switch', { name: 'Enable beeps' })).toBeTruthy()
    const sliders = view.container.querySelectorAll('input[type="range"]')
    expect(sliders.length).toBe(4)
    // Readouts follow the persisted values.
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText('30%')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it('disables every control while the section is not writable', () => {
    mount({ writable: false })
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true)
    for (const slider of document.querySelectorAll('input[type="range"]')) {
      expect(slider).toHaveProperty('disabled', true)
    }
  })

  it('forwards the enable toggle to setEnabled', () => {
    const { setEnabled } = mount({ enabled: true })
    fireEvent.click(screen.getByRole('switch'))
    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  it('forwards slider changes to setVolume with the voice identity', () => {
    const { view, setVolume } = mount()
    const sliders = [...view.container.querySelectorAll('input[type="range"]')]
    // Master (first slider) → 60%.
    fireEvent.change(sliders[0] as HTMLInputElement, { target: { value: '60' } })
    expect(setVolume).toHaveBeenCalledWith('master', 0.6)
    // Tick (second) → 45%.
    fireEvent.change(sliders[1] as HTMLInputElement, { target: { value: '45' } })
    expect(setVolume).toHaveBeenCalledWith('tick', 0.45)
    // Hum (third) → 10%.
    fireEvent.change(sliders[2] as HTMLInputElement, { target: { value: '10' } })
    expect(setVolume).toHaveBeenCalledWith('hum', 0.1)
    // Chime (fourth) → 90%.
    fireEvent.change(sliders[3] as HTMLInputElement, { target: { value: '90' } })
    expect(setVolume).toHaveBeenCalledWith('chime', 0.9)
  })

  it('forwards each preview button to preview with its voice', () => {
    const { view, preview } = mount()
    const buttons = [...view.container.querySelectorAll('button')]
    const previewButtons = buttons.filter(button =>
      ['Preview the streaming beep', 'Preview the working beep', 'Preview the waiting beep'].includes(
        button.getAttribute('aria-label') ?? ''))
    expect(previewButtons.length).toBe(3)
    fireEvent.click(previewButtons[0] as HTMLButtonElement)
    expect(preview).toHaveBeenCalledWith('tick' satisfies BeepVoice)
    fireEvent.click(previewButtons[1] as HTMLButtonElement)
    expect(preview).toHaveBeenCalledWith('hum' satisfies BeepVoice)
    fireEvent.click(previewButtons[2] as HTMLButtonElement)
    expect(preview).toHaveBeenCalledWith('chime' satisfies BeepVoice)
  })
})