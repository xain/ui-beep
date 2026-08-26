# @xain/dsh-client-ui-beep

English | [中文](README.zh.md)

**dsh-beep** — an agent-heartbeat sonification plugin for the DeepSeek Harness Web surface. It plays three procedural Web-Audio tones as a subtle, non-intrusive heartbeat that tells you what the agents on this page are doing without watching the screen:

> This package is a standalone, publishable fork of the `ui-beep` plugin from the
> [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) repository
> (MIT). It builds with its own `tsconfig.json` + `tsdown.config.ts` (the in-repo
> build uses the shared `clientBundle` preset; this copy reproduces the same
> output format standalone).

## Installation & usage

```sh
npm install @xain/dsh-client-ui-beep
# or: pnpm add / yarn add
```

Then mount it in your harness `cordis.yml` (or a `cordis.patch.yml` overlay) as a
web client row:

```yaml
- id: ui-beep
  name: '@xain/dsh-client-ui-beep'
  config:
    volume: 0.5      # master gain 0…1
    enabled: true    # false silences everything
```

## Development

```sh
npm install
npm run build   # tsc + tsdown → lib/
npm test        # vitest (19 specs)
```

## Publishing

```sh
npm login                 # your npm account
npm version patch         # bump
npm publish               # prepublishOnly runs build + test first
```

## Voices

| Voice | When | Sound |
|---|---|---|
| **hum** | Any session is busy (working) — "Deep diving…" (model request in flight), tool execution (running code, reading files), reasoning — **and** no session awaits your input **and** the current session is not streaming visible output. Repeats as a calm heartbeat every 4 s; pauses while output streams (ticks take over) and while an interaction is pending (the chime already alerted you) | Soft low "lub-dub" heartbeat (~118 Hz + ~92 Hz), ~500 ms |
| **tick** | The current session streams visible output | Short high 2 kHz pop (~60 ms) |
| **chime** | Any session begins awaiting your input (approval, plan review, or question). An unanswered interaction re-chimes after 10 s, then every 30 s, until answered | Two-tone 880 Hz + 1320 Hz bell (~500 ms) |

The mapping is an AgentPulse heritage: the agent working → a low heartbeat hum, output activity → a light tick, the agent waiting on you → a clear chime.

## How it works

The browser half observes two React-free runtime faces:

- **`ctx.sessions.list`** (an `ObservableSnapshot<SessionListState>`): every session row's `running` and `pendingInteraction` bits.
  - `running` is the **busy** signal: it stays true for a whole turn, from prompt admission through tool execution and reasoning. While **any** session is running, the low **hum** repeats on a fixed interval (default 4 s, configurable) — first beat immediate when work begins (or on page load, if a session is already mid-work). The hum **pauses** only while the current session is *actively* streaming visible output (ticks take over — "streaming" means text growth within the last 1.5 s, configurable) and while **any** session holds a pending interaction (the chime already alerted you). It **resumes ~1.5 s after output stops** — even when the agent keeps working (a tool call after a message) — and when the interaction clears. It stops entirely when the last running session goes idle. This is level-based: it is the "something is working" indicator. The tone itself is a soft low lub-dub heartbeat (two gentle sine swells around 90–120 Hz with slow attacks) — reassuring, not urgent.
  - A 0→1 appearance of `pendingInteraction` (approval / plan-review / question) **chimes**. Decisions are *edges*, never levels — a session that stays pending does not re-chime on every refresh. An interaction that stays **unanswered** re-chimes after 10 s and then every 30 s (both configurable) until it is answered or the session disappears; an interaction already pending when the page loads starts the same reminder ladder (no immediate chime).
- **the current session's conversation observable** (`binding.session`, an `ObservableSnapshot<ConversationSnapshot>`): its notifier fires on every streaming frame; visible output text growth fires the **tick** at the render cadence (the audio engine's debounce adds a hard floor).

All tones are synthesized in code with linear fade in/out envelopes — no asset files, no clicks or pops on rapid state flips. Each voice is debounced to a 50 ms minimum interval.

## Browser autoplay policy

Browsers block audio until a user gesture, so the engine arms on the first `pointerdown`/`keydown` anywhere on the page and is a silent no-op before that. It never throws or spams the console when audio is unavailable.

## Configuration

The cordis row accepts a `config:` object (all optional):

```yaml
- id: ui-beep
  name: '@xain/dsh-client-ui-beep'
  config:
    volume: 0.5                    # master gain 0…1
    enabled: true                  # false silences everything
    heartbeatMs: 4000              # busy hum period in ms
    pendingFirstRechimeMs: 10000   # first re-chime of an unanswered interaction
    pendingRechimeMs: 30000        # later re-chimes of an unanswered interaction
    streamingPauseMs: 1500         # output counts as "streaming" this long after the last text growth
```

## Model Experience

None. The package is a browser-side read-only sonification of already-logged session facts (running/busy, streaming output, pending interactions); it plays audio and registers nothing model-facing. The model's own view of its work stays with the tools and host services that produce those facts.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Sound is page-local.** Beeps only play in the tab where the web GUI is open and focused enough to receive the gesture arm; the plugin does not reach into other tabs or the host process.
- **One voice per edge.** The chime fires once when a session enters a pending interaction; a *still*-pending session does not re-chime on timeout (the macOS AgentPulse escalation ladder — re-chime at 30 s, notify at 120 s — is future work).
- **Tick is the current session only.** Output from a running *background* session (a subagent you are not watching) ticks nothing; only the focused session's stream drives the tick.
- **No settings card yet.** Volume and mute are row-config only; a web settings card is a natural follow-up.