# @xain_npm/dsh-client-ui-beep

English | [中文](README.zh.md)

**dsh-beep** — an agent-heartbeat sonification plugin for the DeepSeek Harness Web surface. It plays three procedural Web-Audio tones as a subtle, non-intrusive heartbeat that tells you what the agents on this page are doing without watching the screen:

> **Requires DSH ≥ 0.1.7.** That release replaced the `settingsScope` service (and
> the `settings.yaml` document behind it) with profile-backed configuration forms,
> where a plugin's settings ARE its cordis `Config`. Versions 0.5.0+ use that seam
> (`configForms` in the browser, a `.volatile()` Config schema on the host);
> 0.4.x and earlier fail to activate on 0.1.7+.

> This package is a standalone, publishable fork of the `ui-beep` plugin from the
> [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) repository
> (MIT). It builds with its own `tsconfig.json` + `tsdown.config.ts` (the in-repo
> build uses the shared `clientBundle` preset; this copy reproduces the same
> output format standalone).

## Installation & usage

```sh
npm install @xain_npm/dsh-client-ui-beep
# or: pnpm add / yarn add
```

Then mount it in your harness `cordis.yml` (or a `cordis.patch.yml` overlay) as a
web client row:

```yaml
- id: ui-beep
  name: '@xain_npm/dsh-client-ui-beep'
  config:
    enabled: true        # false silences every beep
    masterVolume: 0.4    # master gain 0…2 (100% = Web Audio full scale)
```

## Development

```sh
npm install
npm run build   # tsc + tsdown → lib/
npm test        # vitest (66 specs)
```

## Publishing

```sh
npm login                 # your npm account
npm version minor         # bump (see Versioning below)
npm publish               # prepublishOnly runs build + test first
```

## Voices

| Voice | When | Sound |
|---|---|---|
| **hum** | Any session is busy (working) — "Deep diving…" (model request in flight), tool execution (running code, reading files), reasoning — **and** no session awaits your input **and** the current session is not streaming visible output. Repeats as a calm heartbeat every 4 s; pauses while output streams (ticks take over) and while an interaction is pending (the chime already alerted you) | Soft low "lub-dub" heartbeat (~118 Hz + ~92 Hz), ~500 ms |
| **tick** | The current session streams visible output | Short high 2 kHz pop (~60 ms) |
| **chime** | Any session begins awaiting your input (approval, plan review, or question), **or the last busy session goes idle** (work finished — your turn again). An unanswered interaction re-chimes after 10 s, then every 30 s, until answered | Two-tone 880 Hz + 1320 Hz bell (~500 ms) |

The mapping is an AgentPulse heritage: the agent working → a low heartbeat hum, output activity → a light tick, the agent waiting on you (or done) → a clear chime.

## How it works

The browser half reads two React-free observable faces:

- **`ctx.uiSession.sessionStatus`** — the unified per-session status surface DSH 0.1.7 introduced (it replaced the separate `sessions.list` + `uiSession.pendingInteractions` pair). It is a map of `SessionId → { running, pendingInteraction }`, so one subscription drives both the heartbeat and the chime.
  - `running` is the **busy** signal: it stays true for a whole turn, from prompt admission through tool execution and reasoning. While **any** session is running, the low **hum** repeats on a fixed interval (default 4 s) — first beat immediate when work begins (or on page load, if a session is already mid-work). The hum **pauses** only while the current session is *actively* streaming visible output (ticks take over — "streaming" means text growth within the last 1.5 s) and while **any** session holds a pending interaction (the chime already alerted you). It **resumes ~1.5 s after output stops** — even when the agent keeps working (a tool call after a message) — and when the interaction clears. It stops entirely when the last running session goes idle. This is level-based: it is the "something is working" indicator. The tone itself is a soft low lub-dub heartbeat (two gentle sine swells around 90–120 Hz with slow attacks) — reassuring, not urgent.
  - `pendingInteraction` drives the **chime**: a 0→1 appearance for a session chimes. Decisions are *edges*, never levels — a session that stays pending does not re-chime on every refresh. An interaction that stays **unanswered** re-chimes after 10 s and then every 30 s until it is answered or the session disappears; an interaction already pending when the page loads starts the same reminder ladder (no immediate chime). The **end-of-work** case is the mirror edge: when the last running session goes idle, a chime tells you the agent is done.
- **the current session's Conversation snapshot** (`ctx.uiConversation.binding(id).snapshot`, an `ObservableSnapshot<ConversationSnapshot>`): its notifier fires on every assembled frame; visible output text growth in the chat target's live `partial` fires the **tick** at the render cadence (the audio engine's debounce adds a hard floor). The current session id comes from the renderer scope adapter — `ctx.uiSession.adapter.current.getSnapshot().key` (DSH 0.1.7 moved it there; the list state no longer carries `current`).

All tones are synthesized in code with linear fade in/out envelopes — no asset files, no clicks or pops on rapid state flips. Each voice is debounced to a 50 ms minimum interval.

## Browser autoplay policy

Browsers block audio until a user gesture, so the engine arms on the first `pointerdown`/`keydown` anywhere on the page and is a silent no-op before that. It never throws or spams the console when audio is unavailable. A **Preview** click also arms the engine directly (the click is itself a gesture).

## Configuration

The row `config:` **IS** the plugin's settings document — DSH 0.1.7 stores a
plugin's settings as its own cordis `Config`, every field declared `.volatile()`
so a value written from the Settings page is adopted live (no restart). All fields
are optional:

```yaml
- id: ui-beep
  name: '@xain_npm/dsh-client-ui-beep'
  config:
    enabled: true        # false silences every beep (the mute switch writes this)
    masterVolume: 0.4    # master gain 0…2, applied on top of every voice
    tickVolume: 1        # streaming-output tick gain 0…2
    humVolume: 1         # working heartbeat gain 0…2
    chimeVolume: 1       # awaiting-input / work-finished gain 0…2
    tickPath: ''         # optional absolute path to a custom audio file
    humPath: ''          #   (omit or leave empty to use the built-in tone)
    chimePath: ''
```

The **Settings → 提示音 (Sound)** page owns the same values: an enable switch, a
master volume, and one volume per voice (streaming tick / working hum /
awaiting-input chime), each 0–200 % with a preview button. 100 % is Web Audio's
nominal full scale; the stretch past it is the user's own headroom — the plugin
caps nothing, so anyone who raises a slider decides for themselves how loud the
beeps are (values above full scale may clip). The defaults stay conservative so a
first-time user is not startled.

> **Internal cadence is not configurable.** The heartbeat period (4 s), the
> re-chime delays (10 s / 30 s) and the streaming-pause window (1.5 s) are
> defaults inside the watcher; they were row-config knobs before 0.5.0 and are
> deliberately no longer part of the Config (they are tuning, not user settings).

A **mute toggle** also sits in the composer's right tool row, beside the model
selector: a speaker button that mutes/unmutes every beep (speaker with an X when
muted). It mirrors the same `enabled` field as the Settings switch, so the two
stay in sync; muting stops a looping hum immediately, and unmuting while an agent
is busy plays a beat at once (no waiting for the next heartbeat interval).

### Custom audio per voice

Each voice can play a **user-supplied audio file** instead of the built-in
tone. The Settings page shows a *Choose audio* button per voice; picking one
opens a whole-filesystem file browser (rooted at `/` or the drive root) that
lists ordinary user folders and audio files (`.mp3`, `.wav`, `.ogg`, `.flac`,
`.m4a`, `.aac`, `.opus`, `.webm`) — hidden (dotfile) entries and system
directories are skipped. The chosen **absolute path** is stored in the plugin
Config (a plain string field) — the file is never uploaded or copied, and it can
be moved/replaced on disk freely. Playback semantics:

- **tick / chime** — the custom file plays once per trigger.
- **hum** — the custom file **loops seamlessly** while the agent is busy, so
  the file's own length sets the heartbeat cadence (a longer file = a slower
  beat; replace the file to change the interval).
- **Preview** (the *试听/Preview* button) always plays the file **once** — even
  for hum — so auditioning never loops. A preview is **not gated by the mute
  switch**: you audition a sound precisely when deciding whether to turn beeps
  on, so pressing Preview while muted still plays (the master/voice gains apply,
  so you hear what the voice will actually sound like).
- A voice with **no path, or a path whose file cannot be read or decoded**
  (missing, moved, permission-denied, unsupported format) falls back to the
  built-in tone automatically. The *Restore default* button clears the path.

The Host half serves the file through two loopback, browser-authenticated
routes (`GET /ui-beep/audio/:voice`, `GET /ui-beep/browse`) — the path is read
from the plugin Config, never from the request URL, so the routes cannot be
pointed at arbitrary files. The browser fetches and decodes each file once, then
caches the decoded buffer.

## Versioning

- **0.5.0** — migrated to the DSH 0.1.7 settings seam (breaking: requires
  DSH ≥ 0.1.7 / cordis ≥ 4.0.4). Host settings became the plugin's own Config
  schema; the browser half moved to `ctx.configForms`; the watcher moved to
  `uiSession.sessionStatus`.
- **0.4.0** — Settings page, 0–200 % volume, per-voice custom audio files,
  composer mute toggle.

## Model Experience

None. The package is a browser-side read-only sonification of already-logged session facts (running/busy, streaming output, pending interactions); it plays audio and registers nothing model-facing. The model's own view of its work stays with the tools and host services that produce those facts.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Sound is page-local.** Beeps only play in the tab where the web GUI is open and focused enough to receive the gesture arm; the plugin does not reach into other tabs or the host process.
- **The reminder ladder has no OS tier.** An unanswered interaction re-chimes at 10 s and then every 30 s, but there is no system-notification step (the macOS AgentPulse ladder's "notify at 120 s" tier is future work).
- **Tick is the current session only.** Output from a running *background* session (a subagent you are not watching) ticks nothing; only the focused session's stream drives the tick.
