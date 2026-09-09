/**
 * End-to-end route integration: boot a real HTTP server with the ui-beep Host
 * routes registered (via a fake connection that trusts everything), then hit
 * the audio and browse routes over real HTTP. This validates the full
 * registration → handler → response path, not just the pure handlers.
 */
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { registerBeepRoutes } from '../src/host.ts'

let server: Server | undefined
let root: string | undefined

afterEach(async () => {
  await new Promise<void>((resolve) => { server?.close(() => resolve()) })
  server = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot one HTTP server with the beep routes registered. */
async function boot(): Promise<{ base: string; dir: string }> {
  root = await mkdtemp(join(tmpdir(), 'ui-beep-e2e-'))
  const dir = root
  await writeFile(join(dir, 'chime.wav'), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]))
  await mkdir(join(dir, 'sub'))
  await writeFile(join(dir, 'note.mp3'), Buffer.from([0x49, 0x44, 0x33]))

  const ctx = new Context()
  // Fake settings: chimePath points into the temp dir.
  const settings = {
    get: (ns: string) => ns === 'ui-beep' ? { chimePath: join(dir, 'chime.wav') } : undefined,
    register: () => ({ get: () => ({}), watch: () => () => {} }),
  }
  ctx.provide('settings', settings)
  // Fake connection: trust everything (the real fence is tested elsewhere).
  ctx.provide('connection', { requestRejection: () => undefined })
  // Capture route registrations into a plain table instead of a real WebServer.
  const routes: { kind: string; path: string; handler: (req: never, res: never) => void }[] = []
  ctx.provide('webServer', {
    register: (route: { kind: string; path: string; handler: (req: never, res: never) => void }) => {
      routes.push(route)
      return () => {}
    },
  })
  registerBeepRoutes(ctx)
  const audioRoute = routes.find(r => r.path.startsWith('/ui-beep/audio'))
  const browseRoute = routes.find(r => r.path === '/ui-beep/browse')
  if (audioRoute === undefined || browseRoute === undefined) {
    throw new Error('routes were not registered')
  }

  server = createServer((req, res) => {
    const url = new URL(String(req.url), 'http://localhost')
    const pathname = url.pathname
    if (pathname.startsWith('/ui-beep/audio/')) {
      audioRoute.handler(req as never, res as never)
      return
    }
    if (pathname === '/ui-beep/browse') {
      browseRoute.handler(req as never, res as never)
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => { server!.listen(0, '127.0.0.1', resolve) })
  const address = server!.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { base: `http://127.0.0.1:${port}`, dir }
}

describe('ui-beep routes over real HTTP', () => {
  it('serves a configured audio file', async () => {
    const { base } = await boot()
    const response = await fetch(`${base}/ui-beep/audio/chime`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/wav')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual([0x52, 0x49, 0x46, 0x46])
  })

  it('answers 404 for a voice without a configured path', async () => {
    const { base } = await boot()
    const response = await fetch(`${base}/ui-beep/audio/tick`)
    expect(response.status).toBe(404)
  })

  it('browses directories and audio files over HTTP', async () => {
    const { base, dir } = await boot()
    const response = await fetch(`${base}/ui-beep/browse?path=${encodeURIComponent(dir)}`)
    expect(response.status).toBe(200)
    const listing = await response.json() as {
      ok: boolean; directories: { name: string }[]; files: { name: string }[]
    }
    expect(listing.ok).toBe(true)
    expect(listing.directories.map(d => d.name)).toEqual(['sub'])
    expect(listing.files.map(f => f.name).sort()).toEqual(['chime.wav', 'note.mp3'])
  })

  it('browses the filesystem root when no path is given', async () => {
    const { base } = await boot()
    const response = await fetch(`${base}/ui-beep/browse`)
    expect(response.status).toBe(200)
    const listing = await response.json() as { ok: boolean }
    expect(listing.ok).toBe(true)
  })
})