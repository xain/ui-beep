/**
 * Beep state watcher: translates live session facts into beep voices.
 *
 * Sources (both are the React-free observable faces of the client runtime):
 * - `ctx.sessions.list` — every session row's `running` and
 *   `pendingInteraction` bits. `running` is the "agent is busy" signal: a
 *   model request in flight ("Deep diving…"), tool execution (running code,
 *   reading files), and reasoning all keep it true while they happen.
 *   `pendingInteraction` marks a host interaction blocking a session
 *   (approval / plan review / question) — the agent is waiting on the user,
 *   not working.
 * - the current session's conversation observable (`binding.session`, itself
 *   an `ObservableSnapshot<ConversationSnapshot>`) — its notifier fires on
 *   every streaming frame, and the live `partial` visible text growth drives
 *   the output tick.
 *
 * Voice mapping (AgentPulse heritage, one voice at a time):
 * - **hum** — any session is busy (working) AND no session awaits your input
 *   AND the current session is not *actively* streaming visible output. A low
 *   heartbeat repeats on a fixed interval (default 4 s) through "Deep
 *   diving…", tool execution, and reasoning. The first beat plays immediately
 *   when work begins (or on page load, if a session is already mid-work). The
 *   hum pauses while the current session streams output (the ticks take over)
 *   and while any interaction is pending (the chime already called you), and
 *   resumes shortly after output stops — even when the agent keeps working
 *   (a tool call after a message) — or when the interaction clears.
 * - **tick** — the current session's partial visible text grows (output
 *   streaming). Edge-based on cumulative text length, so a growing stream
 *   ticks while a paused one stays silent.
 * - **chime** — any session flips to a `pendingInteraction` (it awaits you).
 *   Edge-based: a session that stays pending does not re-chime, and the first
 *   observation of a session is a silent baseline. An interaction that stays
 *   unanswered re-chimes after 10 s and then every 30 s until it is answered.
 */

import type { ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { BeepVoice } from './audio.ts'

/** Default heartbeat period while the agent is busy. */
const DEFAULT_HEARTBEAT_MS = 4000

/** Default delay before the first unanswered-interaction re-chime. */
const DEFAULT_FIRST_RECHIME_MS = 10_000

/** Default period between later unanswered-interaction re-chimes. */
const DEFAULT_RECHIME_MS = 30_000

/** How long after the last visible-text growth the output is still "streaming". */
const DEFAULT_STREAMING_PAUSE_MS = 1500

/** One observed session's previous facts (edge bookkeeping for chime). */
interface TrackedSession {
  pending: boolean
  /** Whether this session was ever baselined (the first observation beeps nothing). */
  baselined: boolean
}

/** Emits beep voices as state transitions happen. */
export interface BeepWatcherCallbacks {
  /** Called for every state-transition voice that should play. */
  onBeep(voice: BeepVoice): void
}

/** Watcher tuning. */
export interface BeepWatcherOptions {
  /** Busy heartbeat period in ms. Default 4000. */
  heartbeatMs?: number
  /** Delay before the first re-chime of an unanswered interaction. Default 10000. */
  pendingFirstRechimeMs?: number
  /** Period between later re-chimes of an unanswered interaction. Default 30000. */
  pendingRechimeMs?: number
  /** How long after the last visible-text growth the output still counts as streaming. Default 1500. */
  streamingPauseMs?: number
}

/** Cumulative length of the visible text in the in-progress assistant output. */
function partialTextLength(snapshot: ConversationSnapshot): number {
  const partial = snapshot.partial
  if (partial === null) return 0
  let length = 0
  for (const block of partial.blocks) {
    if (block.kind === 'text') length += block.text.length
  }
  return length
}

/**
 * Watch session state and fire beep voices on transitions.
 * @param ctx - client root context (must provide `sessions`).
 * @param callbacks - voice sink.
 * @param options - tuning knobs.
 * @returns disposer that unsubscribes every watcher.
 */
export function watchBeepState(
  ctx: ClientContext,
  callbacks: BeepWatcherCallbacks,
  options: BeepWatcherOptions = {},
): () => void {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const firstRechimeMs = options.pendingFirstRechimeMs ?? DEFAULT_FIRST_RECHIME_MS
  const rechimeMs = options.pendingRechimeMs ?? DEFAULT_RECHIME_MS
  const streamingPauseMs = options.streamingPauseMs ?? DEFAULT_STREAMING_PAUSE_MS
  const tracked = new Map<string, TrackedSession>()

  // ── busy heartbeat (hum): running, not pending, not streaming output ─────
  let humming = false
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  // Shared facts updated by the list and conversation watchers below.
  let anyRunning = false
  let anyPending = false
  /**
   * Epoch ms of the last visible-text growth. "Streaming output" is true only
   * while this is recent (within `streamingPauseMs`): the assistant-step stays
   * "running" with its finished text in `partial` through the whole tool-call
   * phase, so mere text *presence* must not keep the hum paused — only active
   * token arrival should. Growth timestamps also make the pause robust when
   * `partial` never goes null between steps.
   */
  let lastTextGrowthAt: number | null = null

  const streamingNow = (): boolean =>
    lastTextGrowthAt !== null && Date.now() - lastTextGrowthAt < streamingPauseMs

  const stopHeartbeat = (): void => {
    humming = false
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
  }

  /** Start/stop the heartbeat from the current shared facts. */
  const evaluateHeartbeat = (): void => {
    const busy = anyRunning && !anyPending && !streamingNow()
    if (busy) {
      if (humming) return
      humming = true
      callbacks.onBeep('hum') // first beat immediately, then on the interval
      heartbeatTimer = setInterval(() => callbacks.onBeep('hum'), heartbeatMs)
    } else {
      stopHeartbeat()
    }
  }

  /**
   * Re-evaluate the heartbeat after the streaming window lapses. This is what
   * makes the hum resume when output stops but the agent keeps working (a tool
   * call after a message): the conversation watcher records the growth time,
   * and this timer flips `streamingNow()` to false once the window passes.
   */
  const scheduleStreamingPauseRecheck = (): void => {
    if (lastTextGrowthAt === null) return
    const elapsed = Date.now() - lastTextGrowthAt
    const delay = Math.max(streamingPauseMs - elapsed, 0)
    setTimeout(() => {
      // Only resume if no newer growth arrived while waiting.
      if (lastTextGrowthAt !== null && Date.now() - lastTextGrowthAt >= streamingPauseMs) {
        lastTextGrowthAt = null
      }
      evaluateHeartbeat()
    }, delay)
  }

  // ── unanswered-interaction re-chime ladder ────────────────────────────────
  // One recursive timeout per pending session: the first repeat lands after
  // `firstRechimeMs`, every later repeat after `rechimeMs`, until the
  // interaction is answered (pending clears) or the session disappears.
  const escalationHandles = new Map<string, ReturnType<typeof setTimeout>>()

  const scheduleEscalation = (sessionId: string, delay: number): void => {
    const handle = setTimeout(() => {
      // Still unanswered? (The pending→false transition clears the handle, so
      // reaching this callback with pending still true is the ladder firing.)
      if (!(tracked.get(sessionId)?.pending ?? false)) return
      callbacks.onBeep('chime')
      scheduleEscalation(sessionId, rechimeMs)
    }, delay)
    escalationHandles.set(sessionId, handle)
  }

  const clearEscalation = (sessionId: string): void => {
    const handle = escalationHandles.get(sessionId)
    if (handle !== undefined) {
      clearTimeout(handle)
      escalationHandles.delete(sessionId)
    }
  }

  // ── current-session conversation watcher: output tick + streaming flag ───
  // The session's own notifier fires on every streaming frame (markFrameDirty
  // → rAF flush); the list observable does not. Re-subscribe whenever the
  // current session changes or a binding becomes available.
  let currentId: SessionId | undefined
  let stopConversation: (() => void) | undefined
  let lastTextLength = 0

  const syncConversation = (state: { current: SessionId | undefined }): void => {
    const current = state.current
    if (current === currentId && stopConversation !== undefined) return
    stopConversation?.()
    stopConversation = undefined
    currentId = current
    lastTextLength = 0
    lastTextGrowthAt = null
    if (current === undefined) {
      evaluateHeartbeat()
      return
    }
    const binding = ctx.sessions.binding(current)
    if (binding === undefined) {
      evaluateHeartbeat()
      return
    }
    const handleConversation = (): void => {
      const snapshot: ConversationSnapshot = binding.session.getSnapshot()
      const textLength = partialTextLength(snapshot)
      if (textLength > lastTextLength) {
        lastTextLength = textLength
        lastTextGrowthAt = Date.now()
        scheduleStreamingPauseRecheck()
        callbacks.onBeep('tick')
      } else if (textLength < lastTextLength) {
        lastTextLength = textLength
      }
      evaluateHeartbeat()
    }
    stopConversation = binding.session.subscribe(handleConversation)
    handleConversation() // establish the baseline immediately
  }

  // ── list watcher: busy/pending facts + pending-interaction chime ─────────
  const handleList = (): void => {
    const state = ctx.sessions.list.getSnapshot()
    const seen = new Set<string>()
    anyRunning = false
    anyPending = false
    for (const id of state.ids) {
      const summary = state.byId[id]
      if (summary === undefined) continue
      seen.add(id)
      if (summary.running) anyRunning = true
      if (summary.pendingInteraction !== undefined) anyPending = true
      const prev = tracked.get(id)
      const isPending = summary.pendingInteraction !== undefined
      const next: TrackedSession = { pending: isPending, baselined: prev?.baselined ?? false }
      if (!next.baselined) {
        // First-ever observation: baseline edges, remember without beeping. A
        // session removed and later re-added keeps its baselined flag, so a
        // re-add that is pending fires chime again. An interaction already
        // pending at baseline gets no immediate chime, but the reminder
        // ladder still starts — an unanswered interaction keeps reminding.
        next.baselined = true
        if (isPending) scheduleEscalation(id, firstRechimeMs)
        tracked.set(id, next)
        continue
      }
      if (prev !== undefined && !prev.pending && isPending) {
        callbacks.onBeep('chime')
        scheduleEscalation(id, firstRechimeMs)
      } else if (prev !== undefined && prev.pending && !isPending) {
        // Answered: stop the reminder ladder.
        clearEscalation(id)
      }
      tracked.set(id, next)
    }
    // Sessions that disappeared reset to an inactive tombstone that keeps the
    // baselined flag: a re-add compares against "not pending", so the 0→1
    // edge fires again instead of being swallowed as a fresh baseline.
    for (const id of tracked.keys()) {
      if (!seen.has(id)) {
        clearEscalation(id)
        tracked.set(id, { pending: false, baselined: true })
      }
    }
    syncConversation(state)
    evaluateHeartbeat()
  }
  const stopList = ctx.sessions.list.subscribe(handleList)
  handleList() // initial pass: heartbeat if a session is already busy

  return () => {
    stopList()
    stopConversation?.()
    stopHeartbeat()
    for (const id of [...escalationHandles.keys()]) clearEscalation(id)
  }
}