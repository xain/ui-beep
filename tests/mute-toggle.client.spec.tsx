// @vitest-environment jsdom
/**
 * Composer mute toggle tests: renders the speaker button, reflects the muted
 * state, and forwards the toggle to setMuted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MuteToggle } from '../src/client/MuteToggle.tsx'
import type { BeepKey } from '../src/client/locales.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function makeT(key: BeepKey): string {
  return en[key] ?? key
}

function mount(muted: boolean) {
  const setMuted = vi.fn()
  const view = render(
    <MuteToggle
      t={makeT}
      useMuted={() => muted}
      setMuted={setMuted}
    />,
  )
  return { view, setMuted }
}

describe('MuteToggle', () => {
  it('renders an audible-state speaker button', () => {
    const { view } = mount(false)
    expect(screen.getByRole('button', { name: 'Mute' })).toBeTruthy()
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
    // The audible glyph has the wave path (no X overlay).
    const svg = view.container.querySelector('svg')
    expect(svg?.innerHTML).not.toContain('M10.5 5.5')
  })

  it('renders a muted speaker with the X overlay', () => {
    const { view } = mount(true)
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy()
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
    const svg = view.container.querySelector('svg')
    expect(svg?.innerHTML).toContain('M10.5 5.5')
  })

  it('forwards the toggle to setMuted with the negated state', () => {
    const { view, setMuted } = mount(false)
    fireEvent.click(screen.getByRole('button'))
    expect(setMuted).toHaveBeenCalledWith(true)
    view.unmount()
    const second = mount(true)
    fireEvent.click(screen.getByRole('button'))
    expect(second.setMuted).toHaveBeenCalledWith(false)
  })
})