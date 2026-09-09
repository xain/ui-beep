/**
 * Host half handler tests: the audio route reads a configured file and falls
 * back with 404; the browse route lists directories and audio files. Both run
 * against fake req/res objects and a fake settings service, exercising the
 * full handler path (trust check excluded — that is the connection service's
 * own tested surface).
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleAudio, handleBrowse, voicePathField } from '../src/host.ts'

/** A minimal fake ServerResponse that captures the status and body. */
function fakeRes() {
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { (this as unknown as { headers: Record<string, string> }).headers[name] = value },
    end(body?: unknown) {
      (this as unknown as { body: string; status: number }).body = String(body ?? '')
      ;(this as unknown as { status: number }).status = this.statusCode
    },
    headers: {} as Record<string, string>,
    body: '',
    status: 200,
  }
  return { res: res as unknown as import('node:http').ServerResponse }
}

/** A fake settings service carrying one voice path. */
function fakeCtx(paths: Record<string, string>) {
  return {
    get: (_name: string) => ({ get: () => paths }),
  } as unknown as import('@deepseek-ai/cordis').Context
}

function getReq(url: string) {
  return { method: 'GET', url } as unknown as import('node:http').IncomingMessage
}

describe('voicePathField', () => {
  it('maps each voice to its settings field', () => {
    expect(voicePathField('tick')).toBe('tickPath')
    expect(voicePathField('hum')).toBe('humPath')
    expect(voicePathField('chime')).toBe('chimePath')
  })
})

describe('GET /ui-beep/audio/:voice', () => {
  it('returns the configured file bytes with an audio content type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ui-beep-audio-'))
    const file = join(dir, 'chime.wav')
    await writeFile(file, Buffer.from([0x52, 0x49, 0x46, 0x46]))
    const ctx = fakeCtx({ chimePath: file })
    const { res } = fakeRes()
    await handleAudio(ctx, getReq('/ui-beep/audio/chime'), res, '/ui-beep/audio/chime')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('audio/wav')
  })

  it('answers 404 for a voice with no configured path', async () => {
    const ctx = fakeCtx({})
    const { res } = fakeRes()
    await handleAudio(ctx, getReq('/ui-beep/audio/tick'), res, '/ui-beep/audio/tick')
    expect(res.status).toBe(404)
  })

  it('answers 404 when the configured file is unreadable', async () => {
    const ctx = fakeCtx({ humPath: '/no/such/file.mp3' })
    const { res } = fakeRes()
    await handleAudio(ctx, getReq('/ui-beep/audio/hum'), res, '/ui-beep/audio/hum')
    expect(res.status).toBe(404)
  })

  it('answers 404 for an unknown voice', async () => {
    const ctx = fakeCtx({})
    const { res } = fakeRes()
    await handleAudio(ctx, getReq('/ui-beep/audio/ding'), res, '/ui-beep/audio/ding')
    expect(res.status).toBe(404)
  })
})

describe('GET /ui-beep/browse', () => {
  it('lists directories and audio files, skipping non-audio files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ui-beep-browse-'))
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'ding.mp3'), Buffer.from([0]))
    await writeFile(join(dir, 'note.wav'), Buffer.from([0]))
    await writeFile(join(dir, 'readme.txt'), Buffer.from([0]))
    const ctx = fakeCtx({})
    const { res } = fakeRes()
    const url = new URL(`/ui-beep/browse?path=${encodeURIComponent(dir)}`, 'http://localhost')
    await handleBrowse(getReq(url.pathname + url.search), res, url)
    expect(res.status).toBe(200)
    const listing = JSON.parse(res.body) as {
      ok: boolean; directories: { name: string }[]; files: { name: string }[]
    }
    expect(listing.ok).toBe(true)
    expect(listing.directories.map(d => d.name)).toEqual(['sub'])
    expect(listing.files.map(f => f.name).sort()).toEqual(['ding.mp3', 'note.wav'])
  })

  it('skips hidden files, hidden directories, and system directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ui-beep-browse-'))
    await mkdir(join(dir, '.hidden-dir'))
    await mkdir(join(dir, 'Library')) // macOS system dir
    await mkdir(join(dir, 'Music')) // ordinary dir, kept
    await writeFile(join(dir, '.hidden.mp3'), Buffer.from([0]))
    await writeFile(join(dir, 'song.mp3'), Buffer.from([0]))
    const { res } = fakeRes()
    const url = new URL(`/ui-beep/browse?path=${encodeURIComponent(dir)}`, 'http://localhost')
    await handleBrowse(getReq(url.pathname + url.search), res, url)
    expect(res.status).toBe(200)
    const listing = JSON.parse(res.body) as {
      ok: boolean; directories: { name: string }[]; files: { name: string }[]
    }
    expect(listing.ok).toBe(true)
    expect(listing.directories.map(d => d.name)).toEqual(['Music'])
    expect(listing.files.map(f => f.name)).toEqual(['song.mp3'])
  })

  it('reports failure for an unreadable directory', async () => {
    const ctx = fakeCtx({})
    const { res } = fakeRes()
    const url = new URL('/ui-beep/browse?path=%2Fdefinitely%2Fnot%2Freal', 'http://localhost')
    await handleBrowse(getReq(url.pathname + url.search), res, url)
    expect(res.status).toBe(200)
    const listing = JSON.parse(res.body) as { ok: boolean; error?: string }
    expect(listing.ok).toBe(false)
    expect(listing.error).toBeTruthy()
  })

  it('rejects a non-absolute path', async () => {
    const ctx = fakeCtx({})
    const { res } = fakeRes()
    const url = new URL('/ui-beep/browse?path=relative%2Fpath', 'http://localhost')
    await handleBrowse(getReq(url.pathname + url.search), res, url)
    expect(res.status).toBe(400)
  })
})