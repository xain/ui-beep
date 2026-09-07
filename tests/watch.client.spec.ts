/**
 * Beep state-watcher tests: busy heartbeat, output tick, and chime edges.
 *
 * The watcher consumes three observable faces:
 * - `ctx.sessions.list` (an ObservableSnapshot) for the running/busy rows;
 * - `ctx.uiSession.pendingInteractions` (an ObservableSnapshot map) for the
 *   pending-interaction edges;
 * - `ctx.uiConversation.binding(id).snapshot` for the current session's
 *   assembled Conversation, whose chat-target `partial` text growth drives
 *   the tick.
 *
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
import type { SessionId } from '@deepseek-ai/dsh-session/types'

afterEach(() => { vi.useRealTimers() })

/** One streaming frame's content: visible text (reasoning is not ticked). */
type StreamFrame = { text?: string } | null

/** Minimal snapshot-shaped client double with mutable list/pending/conversation faces. */
function makeCtx() {
  let snapshot: {
    ids: string[]
    byId: Record<string, { running: boolean }>
    current?: string
  } = { ids: [], byId: {} }
  const listListeners = new Set<() => void>()
  /** Per-session pending interactions (uiSession.pendingInteractions). */
  let pending = new Map<string, { key: string; kind: string; sessionId: string }>()
  const pendingListeners = new Set<() => void>()
  /** Per-session conversation observers; the spec drives them via `stream()`. */
  const conversations = new Map<string, { partial: StreamFrame }>()
  const conversationListeners = new Map<string, Set<() => void>>()

  return {
    sessions: {
      list: {
        getSnapshot: () => snapshot,
        subscribe: (fn: () => void) => {
          listListeners.add(fn)
          return () => { listListeners.delete(fn) }
        },
      },
      // The watcher only gates on binding presence before opening the
      // conversation; a listed session is always bound in the double.
      binding: (_id: string) => ({ session: { getSnapshot: () => ({ sessionId: _id }), subscribe: () => () => {} } }),
    },
    uiSession: {
      pendingInteractions: {
        getSnapshot: () => pending,
        subscribe: (fn: () => void) => {
          pendingListeners.add(fn)
          return () => { pendingListeners.delete(fn) }
        },
      },
    },
    uiConversation: {
      binding: (id: string) => {
        const snapshot = {
          getSnapshot: () => {
            const frame = conversations.get(id)?.partial ?? null
            const blocks = frame === null
              ? []
              : [...(frame.text === undefined ? [] : [{ kind: 'text' as const, text: frame.text }])]
            return {
              views: {
                get: (target: string) => target === 'chat'
                  ? { legacy: { partial: frame === null ? null : { blocks } } }
                  : undefined,
              },
            }
          },
          subscribe: (fn: () => void) => {
            let set = conversationListeners.get(id)
            if (set === undefined) { set = new Set(); conversationListeners.set(id, set) }
            set.add(fn)
            return () => { set?.delete(fn) }
          },
        }
        return { snapshot }
      },
    },
    set(next: typeof snapshot) {
      snapshot = next
      for (const fn of [...listListeners]) fn()
    },
    /** Drive the uiSession pending-interaction map (chime edges). */
    setPending(ids: readonly string[]) {
      pending = new Map(ids.map(id => [id, { key: `p-${id}`, kind: 'approval', sessionId: id }]))
      for (const fn of [...pendingListeners]) fn()
    },
    /** Update list and pending in one observation (page-load baseline cases). */
    setWithPending(nextList: typeof snapshot, ids: readonly string[]) {
      snapshot = nextList
      pending = new Map(ids.map(id => [id, { key: `p-${id}`, kind: 'approval', sessionId: id }]))
      for (const fn of [...listListeners]) fn()
      for (const fn of [...pendingListeners]) fn()
    },
    /** Drive the conversation observable for one session (streaming frames). */
    stream(id: string, frame: StreamFrame) {
      conversations.set(id, { partial: frame })
      for (const fn of [...(conversationListeners.get(id) ?? [])]) fn()
    },
  }
}

const ID = 's1' as SessionId

function watch(beeps: string[], heartbeatMs = 1000, extra: { pendingFirstRechimeMs?: number; pendingRechimeMs?: number; streamingPauseMs?: number } = {}) {
  const ctx = makeCtx()
  const stop = watchBeepState(ctx as never, { onBeep: (v) => { beeps.push(v) } }, {
    heartbeatMs,
    ...extra,
  })
  return { ctx, stop }
}

describe('watchBeepState', () => {
  // ── busy heartbeat (hum) ─────────────────────────────────────────────────

  it('hums immediately and on the heartbeat interval while any session runs', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000)
    ctx.set({ ids: [ID], byId: { [ID]: { running: false } } })
    expect(beeps).toEqual([])
    // A turn starts — busy: first beat immediate.
    ctx.set({ ids: [ID], byId: { [ID]: { running: true } } })
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
    const { ctx, stop } = watch(beeps, 1000)
    ctx.set({ ids: [ID], byId: { [ID]: { running: true } } })
    expect(beeps).toEqual(['hum'])
    vi.advanceTimersByTime(1000)
    expect(beeps).toEqual(['hum', 'hum'])
    ctx.set({ ids: [ID], byId: { [ID]: { running: false } } })
    vi.advanceTimersByTime(5000)
    expect(beeps).toEqual(['hum', 'hum'])
    stop()
  })

  it('hums from page load when a session is already busy', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000)
    // The first snapshot already shows a running session ("Deep diving…").
    ctx.set({ ids: [ID], byId: { [ID]: { running: true } } })
    expect(beeps).toEqual(['hum'])
    stop()
  })

  it('keeps humming while ANY session is busy, not just the current one', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000)
    const other = 's2' as SessionId
    ctx.set({ ids: [ID], byId: { [ID]: { running: false } } })
    expect(beeps).toEqual([])
    // A background subagent turns busy while the current session is idle.
    ctx.set({ ids: [ID, other], byId: { [ID]: { running: false }, [other]: { running: true } } })
    expect(beeps).toEqual(['hum'])
    stop()
  })

  it('stops humming while a pending interaction is present, resumes after it clears', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000)
    ctx.set({ ids: [ID], byId: { [ID]: { running: true } } })
    expect(beeps).toEqual(['hum'])
    // A pending interaction arrives: chime fires, hum stops.
    ctx.setPending([ID])
    expect(beeps).toEqual(['hum', 'chime'])
    vi.advanceTimersByTime(5000)
    expect(beeps).toEqual(['hum', 'chime'])
    // Interaction cleared: work continues, hum resumes.
    ctx.setPending([])
    expect(beeps).toEqual(['hum', 'chime', 'hum'])
    stop()
  })

  it('stops humming while the current session streams output, resumes when output pauses', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000)
    ctx.set({ ids: [ID], byId: { [ID]: { running: true } }, current: ID })
    expect(beeps).toEqual(['hum'])
    // Output streams: tick fires, hum stops.
    ctx.stream(ID, { text: 'hello' })
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
    const { ctx, stop } = watch(beeps)
    ctx.set({ ids: [ID], byId: { [ID]: { running: false } } })
    expect(beeps).toEqual([])
    ctx.setPending([ID])
    expect(beeps).toEqual(['chime'])
    ctx.setPending([ID])
    expect(beeps).toEqual(['chime'])
    stop()
  })

  // ── unanswered-interaction re-chime ladder ───────────────────────────────

  it('re-chimes 10s after an unanswered interaction, then every 30s', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000, { pendingFirstRechimeMs: 10_000, pendingRechimeMs: 30_000 })
    ctx.set({ ids: [ID], byId: { [ID]: { running: false } } })
    ctx.setPending([ID])
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
    const { ctx, stop } = watch(beeps, 1000, { pendingFirstRechimeMs: 10_000, pendingRechimeMs: 30_000 })
    ctx.set({ ids: [ID], byId: { [ID]: { running: false } } })
    ctx.setPending([ID])
    expect(beeps).toEqual(['chime'])
    // Answered before the first re-chime.
    ctx.setPending([])
    vi.advanceTimersByTime(120_000)
    expect(beeps).toEqual(['chime'])
    stop()
  })

  it('starts the reminder ladder for an interaction already pending at baseline', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000, { pendingFirstRechimeMs: 10_000, pendingRechimeMs: 30_000 })
    // Page loads with the interaction already pending: no immediate chime.
    ctx.setWithPending({ ids: [ID], byId: { [ID]: { running: false } } }, [ID])
    expect(beeps).toEqual([])
    vi.advanceTimersByTime(10_000)
    expect(beeps).toEqual(['chime'])
    stop()
  })

  it('forgets removed sessions so a later re-add beeps again', () => {
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps)
    ctx.setWithPending({ ids: [ID], byId: { [ID]: { running: false } } }, [ID])
    expect(beeps).toEqual([])
    ctx.setWithPending({ ids: [], byId: {} }, [])
    ctx.setWithPending({ ids: [ID], byId: { [ID]: { running: false } } }, [ID])
    expect(beeps).toEqual(['chime'])
    stop()
  })

  // ── output tick ──────────────────────────────────────────────────────────

  it('ticks as the current session streams visible text, and only on growth', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000, { streamingPauseMs: 1500 })
    ctx.set({ ids: [ID], byId: { [ID]: { running: true } }, current: ID })
    // Baseline conversation snapshot; the running flip already hummed.
    ctx.stream(ID, { text: 'hello' })
    expect(beeps).toEqual(['hum', 'tick'])
    ctx.stream(ID, { text: 'hello world' })
    expect(beeps).toEqual(['hum', 'tick', 'tick'])
    // Output stops (no more growth) while still running: the hum stays paused
    // during the streaming window, then resumes once it lapses.
    vi.advanceTimersByTime(1500)
    expect(beeps).toEqual(['hum', 'tick', 'tick', 'hum'])
    // Output resumes (grows past the previous length): tick again, hum pauses again.
    ctx.stream(ID, { text: 'hello world, again' })
    expect(beeps).toEqual(['hum', 'tick', 'tick', 'hum', 'tick'])
    stop()
  })

  it('resumes humming after output stops even while the partial still holds text (tool-call phase)', () => {
    // Regression: the assistant-step stays "running" with its finished text in
    // the partial through the whole tool-call phase, so "has text" must not
    // keep the hum paused — only recent text GROWTH should.
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000, { streamingPauseMs: 1500 })
    ctx.set({ ids: [ID], byId: { [ID]: { running: true } }, current: ID })
    ctx.stream(ID, { text: 'I will edit the file' })
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
    const { ctx, stop } = watch(beeps)
    ctx.set({ ids: [ID], byId: { [ID]: { running: false } } })
    ctx.stream(ID, { text: 'hello' })
    expect(beeps).toEqual([])
    stop()
  })

  it('re-wires the conversation watcher when the current session changes', () => {
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps)
    const other = 's2' as SessionId
    ctx.set({ ids: [ID, other], byId: { [ID]: { running: false }, [other]: { running: false } }, current: ID })
    ctx.stream(ID, { text: 'hi' })
    expect(beeps).toEqual(['tick'])
    // Switch current to the other session; its stream ticks, the old one does not.
    ctx.set({ ids: [ID, other], byId: { [ID]: { running: false }, [other]: { running: false } }, current: other })
    ctx.stream(other, { text: 'hey' })
    expect(beeps).toEqual(['tick', 'tick'])
    ctx.stream(ID, { text: 'hi there' })
    expect(beeps).toEqual(['tick', 'tick'])
    stop()
  })

  it('disposes every subscription, the heartbeat, and the reminder ladders', () => {
    vi.useFakeTimers()
    const beeps: string[] = []
    const { ctx, stop } = watch(beeps, 1000, { pendingFirstRechimeMs: 10_000, pendingRechimeMs: 30_000 })
    ctx.set({ ids: [ID], byId: { [ID]: { running: true } }, current: ID })
    ctx.setPending([ID])
    expect(beeps).toEqual(['hum', 'chime'])
    stop()
    vi.advanceTimersByTime(120_000)
    expect(beeps).toEqual(['hum', 'chime'])
  })
})
