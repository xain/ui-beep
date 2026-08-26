/**
 * Beep state-watcher tests: busy heartbeat, output tick, and chime edges.
 *
 * The watcher consumes `ctx.sessions.list` (an ObservableSnapshot) and the
 * `ctx.sessions.binding(id)` face (for the current session's conversation
 * observable):
 * - hum: level-based — a heartbeat runs while ANY session is `running` (busy),
 *   first beat immediate, stops when the last running session goes idle;
 * - tick: edge-based on the current session's visible text growth;
 * - chime: edge-based on a session gaining a pending interaction.
 *
 * The double is a plain object with mutable snapshots — no real runtime
 * needed. Heartbeat timing uses fake timers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchBeepState } from '../src/client/watch.ts'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

afterEach(() => { vi.useRealTimers() })

/** One streaming frame's content: visible text (reasoning is not ticked). */
type StreamFrame = { text?: string } | null

/** Minimal snapshot-shaped sessions double with a mutable conversation face. */
function makeSessions() {
  let snapshot: {
    ids: string[]
    byId: Record<string, { running: boolean; pendingInteraction?: string }>
    current?: string
  } = { ids: [], byId: {} }
  const listListeners = new Set<() => void>()
  /** Per-session conversation observers; the spec drives them via `stream()`. */
  const conversations = new Map<string, { partial: StreamFrame }>()
  const conversationListeners = new Map<string, Set<() => void>>()

  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: (fn: () => void) => {
        listListeners.add(fn)
        return () => { listListeners.delete(fn) }
      },
    },
    binding: (id: string) => {
      const session = {
        subscribe: (fn: () => void) => {
          let set = conversationListeners.get(id)
          if (set === undefined) { set = new Set(); conversationListeners.set(id, set) }
          set.add(fn)
          return () => { set?.delete(fn) }
        },
        getSnapshot: () => {
          const frame = conversations.get(id)?.partial ?? null
          const blocks = frame === null
            ? []
            : [...(frame.text === undefined ? [] : [{ kind: 'text' as const, text: frame.text }])]
          return { sessionId: id, partial: frame === null ? null : { blocks } }
        },
      }
      return { session }
    },
    set(next: typeof snapshot) {
      snapshot = next
      for (const fn of [...listListeners]) fn()
    },
    /** Drive the conversation observable for one session (streaming frames). */
    stream(id: string, frame: StreamFrame) {
      conversations.set(id, { partial: frame })
      for (const fn of [...(conversationListeners.get(id) ?? [])]) fn()
    },
  }
}

const ID = 's1' as SessionId

/** Cast a sessions double into the ClientContext slice the watcher reads. */
function asCtx(sessions: ReturnType<typeof makeSessions>): { sessions: typeof sessions } {
  return { sessions }
}

function watch(beeps: string[], heartbeatMs = 1000, extra: { pendingFirstRechimeMs?: number; pendingRechimeMs?: number } = {}) {
  const sessions = makeSessions()
  const stop = watchBeepState(asCtx(sessions) as never, { onBeep: v => { beeps.push(v) } }, {
    heartbeatMs,
    ...extra,
  })
  return { sessions, stop }
}

describe('watchBeepState', () => {
  // ── busy heartbeat (hum) ─────────────────────────────────────────────────

  it('hums immediately and on the heartbeat interval while any session runs', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000)
    sessions.set({ ids: [ID], byId: { [ID]: { running: false } } })
    expect(beeps).toEqual([])
    // A turn starts — busy: first beat immediate.
    sessions.set({ ids: [ID], byId: { [ID]: { running: true } } })
    expect(beeps).toEqual(['hum'])
    vi.advanceTimersByTime(1000)
    expect(beeps).toEqual(['hum', 'hum'])
    vi.advanceTimersByTime(3000)
    expect(beeps).toEqual(['hum', 'hum', 'hum', 'hum', 'hum'])
    stop()
  })

  it('stops humming when the last running session goes idle', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000)
    sessions.set({ ids: [ID], byId: { [ID]: { running: true } } })
    expect(beeps).toEqual(['hum'])
    vi.advanceTimersByTime(1000)
    expect(beeps).toEqual(['hum', 'hum'])
    sessions.set({ ids: [ID], byId: { [ID]: { running: false } } })
    vi.advanceTimersByTime(5000)
    expect(beeps).toEqual(['hum', 'hum'])
    stop()
  })

  it('hums from page load when a session is already busy', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000)
    // The first snapshot already shows a running session ("Deep diving…").
    sessions.set({ ids: [ID], byId: { [ID]: { running: true } } })
    expect(beeps).toEqual(['hum'])
    stop()
  })

  it('keeps humming while ANY session is busy, not just the current one', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000)
    const other = 's2' as SessionId
    sessions.set({ ids: [ID], byId: { [ID]: { running: false } } })
    expect(beeps).toEqual([])
    // A background subagent turns busy while the current session is idle.
    sessions.set({ ids: [ID, other], byId: { [ID]: { running: false }, [other]: { running: true } } })
    expect(beeps).toEqual(['hum'])
    stop()
  })

  it('stops humming while a pending interaction is present, resumes after it clears', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000)
    sessions.set({ ids: [ID], byId: { [ID]: { running: true } } })
    expect(beeps).toEqual(['hum'])
    // A pending interaction arrives: chime fires, hum stops.
    sessions.set({ ids: [ID], byId: { [ID]: { running: true, pendingInteraction: 'approval' } } })
    expect(beeps).toEqual(['hum', 'chime'])
    vi.advanceTimersByTime(5000)
    expect(beeps).toEqual(['hum', 'chime'])
    // Interaction cleared: work continues, hum resumes.
    sessions.set({ ids: [ID], byId: { [ID]: { running: true } } })
    expect(beeps).toEqual(['hum', 'chime', 'hum'])
    stop()
  })

  it('stops humming while the current session streams output, resumes when output pauses', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000)
    sessions.set({ ids: [ID], byId: { [ID]: { running: true } }, current: ID })
    expect(beeps).toEqual(['hum'])
    // Output streams: tick fires, hum stops.
    sessions.stream(ID, { text: 'hello' })
    expect(beeps).toEqual(['hum', 'tick'])
    // The streaming window (1.5s) lapses while still running: hum resumes.
    vi.advanceTimersByTime(1500)
    expect(beeps).toEqual(['hum', 'tick', 'hum'])
    // Keep humming on the interval.
    vi.advanceTimersByTime(1000)
    expect(beeps).toEqual(['hum', 'tick', 'hum', 'hum'])
    stop()
  })

  // ── pending chime ────────────────────────────────────────────────────────

  it('chimes when a session gains a pending interaction (no immediate repeat)', () => {
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps)
    sessions.set({ ids: [ID], byId: { [ID]: { running: false } } })
    expect(beeps).toEqual([])
    sessions.set({ ids: [ID], byId: { [ID]: { running: false, pendingInteraction: 'approval' } } })
    expect(beeps).toEqual(['chime'])
    sessions.set({ ids: [ID], byId: { [ID]: { running: false, pendingInteraction: 'approval' } } })
    expect(beeps).toEqual(['chime'])
    stop()
  })

  // ── unanswered-interaction re-chime ladder ───────────────────────────────

  it('re-chimes 10s after an unanswered interaction, then every 30s', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000, { pendingFirstRechimeMs: 10_000, pendingRechimeMs: 30_000 })
    sessions.set({ ids: [ID], byId: { [ID]: { running: false } } })
    sessions.set({ ids: [ID], byId: { [ID]: { running: false, pendingInteraction: 'approval' } } })
    expect(beeps).toEqual(['chime'])
    // Not yet 10s: no repeat.
    vi.advanceTimersByTime(9000)
    expect(beeps).toEqual(['chime'])
    // At 10s: first repeat.
    vi.advanceTimersByTime(1000)
    expect(beeps).toEqual(['chime', 'chime'])
    // Before 30s more: no repeat.
    vi.advanceTimersByTime(29_000)
    expect(beeps).toEqual(['chime', 'chime'])
    // At 30s: next repeat.
    vi.advanceTimersByTime(1000)
    expect(beeps).toEqual(['chime', 'chime', 'chime'])
    stop()
  })

  it('stops re-chiming once the interaction is answered', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000, { pendingFirstRechimeMs: 10_000, pendingRechimeMs: 30_000 })
    sessions.set({ ids: [ID], byId: { [ID]: { running: false } } })
    sessions.set({ ids: [ID], byId: { [ID]: { running: false, pendingInteraction: 'approval' } } })
    expect(beeps).toEqual(['chime'])
    // Answered before the first re-chime.
    sessions.set({ ids: [ID], byId: { [ID]: { running: false } } })
    vi.advanceTimersByTime(120_000)
    expect(beeps).toEqual(['chime'])
    stop()
  })

  it('starts the reminder ladder for an interaction already pending at baseline', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000, { pendingFirstRechimeMs: 10_000, pendingRechimeMs: 30_000 })
    // Page loads with the interaction already pending: no immediate chime.
    sessions.set({ ids: [ID], byId: { [ID]: { running: false, pendingInteraction: 'approval' } } })
    expect(beeps).toEqual([])
    vi.advanceTimersByTime(10_000)
    expect(beeps).toEqual(['chime'])
    stop()
  })

  it('forgets removed sessions so a later re-add beeps again', () => {
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps)
    sessions.set({ ids: [ID], byId: { [ID]: { pendingInteraction: 'approval' } } })
    expect(beeps).toEqual([])
    sessions.set({ ids: [], byId: {} })
    sessions.set({ ids: [ID], byId: { [ID]: { pendingInteraction: 'approval' } } })
    expect(beeps).toEqual(['chime'])
    stop()
  })

  // ── output tick ──────────────────────────────────────────────────────────

  it('ticks as the current session streams visible text, and only on growth', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000, { streamingPauseMs: 1500 })
    sessions.set({ ids: [ID], byId: { [ID]: { running: true } }, current: ID })
    // Baseline conversation snapshot; the running flip already hummed.
    sessions.stream(ID, { text: 'hello' })
    expect(beeps).toEqual(['hum', 'tick'])
    sessions.stream(ID, { text: 'hello world' })
    expect(beeps).toEqual(['hum', 'tick', 'tick'])
    // Output stops (no more growth) while still running: the hum stays paused
    // during the streaming window, then resumes once it lapses.
    vi.advanceTimersByTime(1500)
    expect(beeps).toEqual(['hum', 'tick', 'tick', 'hum'])
    // Output resumes (grows past the previous length): tick again, hum pauses again.
    sessions.stream(ID, { text: 'hello world, again' })
    expect(beeps).toEqual(['hum', 'tick', 'tick', 'hum', 'tick'])
    stop()
  })

  it('resumes humming after output stops even while the partial still holds text (tool-call phase)', () => {
    // Regression: the assistant-step stays "running" with its finished text in
    // the partial through the whole tool-call phase, so "has text" must not
    // keep the hum paused — only recent text GROWTH should.
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000, { streamingPauseMs: 1500 })
    sessions.set({ ids: [ID], byId: { [ID]: { running: true } }, current: ID })
    sessions.stream(ID, { text: 'I will edit the file' })
    expect(beeps).toEqual(['hum', 'tick'])
    // The partial keeps the same text (tool call executing, no new tokens):
    // hum resumes after the streaming window even though partial is non-null.
    vi.advanceTimersByTime(1500)
    expect(beeps).toEqual(['hum', 'tick', 'hum'])
    vi.advanceTimersByTime(1000)
    expect(beeps).toEqual(['hum', 'tick', 'hum', 'hum'])
    stop()
  })

  it('does not tick when a non-current session streams', () => {
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps)
    sessions.set({ ids: [ID], byId: { [ID]: { running: false } }, current: undefined })
    sessions.stream(ID, { text: 'hello' })
    expect(beeps).toEqual([])
    stop()
  })

  it('re-wires the conversation watcher when the current session changes', () => {
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps)
    const other = 's2' as SessionId
    sessions.set({ ids: [ID, other], byId: { [ID]: { running: false }, [other]: { running: false } }, current: ID })
    sessions.stream(ID, { text: 'hi' })
    expect(beeps).toEqual(['tick'])
    // Switch current to the other session; its stream ticks, the old one does not.
    sessions.set({ ids: [ID, other], byId: { [ID]: { running: false }, [other]: { running: false } }, current: other })
    sessions.stream(other, { text: 'hey' })
    expect(beeps).toEqual(['tick', 'tick'])
    sessions.stream(ID, { text: 'hi there' })
    expect(beeps).toEqual(['tick', 'tick'])
    stop()
  })

  it('disposes every subscription, the heartbeat, and the reminder ladders', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { sessions, stop } = watch(beeps, 1000, { pendingFirstRechimeMs: 10_000, pendingRechimeMs: 30_000 })
    sessions.set({ ids: [ID], byId: { [ID]: { running: true } }, current: ID })
    sessions.set({ ids: [ID], byId: { [ID]: { running: true, pendingInteraction: 'approval' } }, current: ID })
    expect(beeps).toEqual(['hum', 'chime'])
    stop()
    vi.advanceTimersByTime(120_000)
    expect(beeps).toEqual(['hum', 'chime'])
  })
})