/**
 * ui-beep Host half routes: serve user-supplied audio files and browse the
 * filesystem for them. Both routes speak the same trust fence as every other
 * harness API (`ctx.connection.requestRejection`), so only a loopback,
 * browser-authenticated page can read a configured file.
 *
 * Route inventory:
 * - `GET /ui-beep/audio/:voice` — read the configured custom audio file for
 *   one voice and return its bytes. The path comes from the settings
 *   document, never from the URL, so the route cannot be pointed at arbitrary
 *   files. Missing voice, missing path, or an unreadable file answers 404 and
 *   the browser falls back to the built-in tone.
 * - `GET /ui-beep/browse?path=<abs>` — one directory level: child directories
 *   (enterable) and audio files (selectable), name-sorted, with the current
 *   path and its ancestor crumbs so the browser can render navigation. The
 *   whole filesystem is browsable (rooted at `/` or the drive root); hidden
 *   (dotfile) entries and system directories are skipped, so the picker shows
 *   only ordinary user-browsable folders and audio files.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import {
  BEEP_SETTINGS_NAMESPACE, CHIME_PATH_FIELD, HUM_PATH_FIELD, TICK_PATH_FIELD,
  type BeepVoice,
} from './beep-settings.ts'

/** Route prefixes owned by this plugin. */
export const AUDIO_ROUTE_PREFIX = '/ui-beep/audio'
export const BROWSE_ROUTE = '/ui-beep/browse'

/** Audio extensions the browser can decode via `decodeAudioData`. */
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.opus', '.weba', '.webm',
])

/** MIME types by extension for the audio route response. */
const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg',
  '.weba': 'audio/webm',
  '.webm': 'audio/webm',
}

/** The settings field carrying one voice's custom audio path. */
export function voicePathField(voice: BeepVoice): string {
  switch (voice) {
    case 'tick': return TICK_PATH_FIELD
    case 'hum': return HUM_PATH_FIELD
    case 'chime': return CHIME_PATH_FIELD
  }
}

/** One entry in a browse listing. */
export interface BrowseEntry {
  /** Entry name (basename). */
  name: string
  /** Absolute path. */
  path: string
  /** Whether this is a directory (enterable) rather than an audio file (selectable). */
  directory: boolean
}

/** One directory level served by the browse route. */
export interface BrowseListing {
  /** Absolute path of the listed directory. */
  path: string
  /** Breadcrumb chain from the filesystem root to `path` inclusive. */
  crumbs: string[]
  /** Child directories (enterable), name-sorted. */
  directories: BrowseEntry[]
  /** Audio files (selectable), name-sorted. */
  files: BrowseEntry[]
  /** Whether the path is a readable directory at all. */
  ok: boolean
  /** Human-readable failure message when `ok` is false. */
  error?: string
}

/** Whether one filesystem entry name is hidden (dotfile) and should not be browsable. */
function isHidden(name: string): boolean {
  return name.startsWith('.')
}

/**
 * Whether a directory entry is a system directory ordinary users should not
 * browse into (macOS `/System`, `/Library`, `/private`, `/dev`, `/Volumes`
 * internals; Windows `Windows`, `Program Files` internals are reachable but
 * the drive-root system dirs are hidden). These are skipped from listings so
 * the picker only shows normal, user-browsable folders.
 */
function isSystemDirectory(name: string): boolean {
  return name === 'System'
    || name === 'Library'
    || name === 'private'
    || name === 'dev'
    || name === 'net'
    || name === 'cores'
    || name === 'Volumes'
    || name === 'tmp'
    || name === 'var'
    || name === 'etc'
    || name === 'bin'
    || name === 'sbin'
    || name === 'usr'
    || name === 'proc'
    || name === 'sys'
    || name === 'Windows'
    || name === 'ProgramData'
    || name === 'Recovery'
    || name === '$RECYCLE.BIN'
    || name === 'System Volume Information'
}

/** Resolve the filesystem root for whole-disk browsing (POSIX `/`, Windows drive root). */
function filesystemRoot(): string {
  // On Windows, an empty root path means the current drive's root.
  return process.platform === 'win32' ? dirname(process.cwd().split('\\')[0] + '\\') : '/'
}

/**
 * Reject an untrusted/unauthenticated request; true when it was rejected.
 * Mirrors the open-in-app pattern: the connection service applies the
 * host/origin fence then the browser authentication.
 */
function rejected(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
  return true
}

/** Send a JSON response. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(payload)
}

/** Send a method-not-allowed response. */
function sendMethodNotAllowed(res: ServerResponse, allowed: string): void {
  res.statusCode = 405
  res.setHeader('allow', allowed)
  res.end()
}

/**
 * Read one voice's configured custom audio path from the settings document.
 * @param ctx - host context with the settings service.
 * @param voice - which voice's path to read.
 * @returns the configured absolute path, or undefined when unset or not absolute.
 */
function configuredAudioPath(ctx: Context, voice: BeepVoice): string | undefined {
  const settings = ctx.get('settings')
  const section = settings?.get(BEEP_SETTINGS_NAMESPACE) as
    | Partial<Record<string, unknown>>
    | undefined
  if (section === undefined) return undefined
  const value = section[voicePathField(voice)]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Serve one voice's custom audio file, or 404 (the browser falls back).
 * The path is resolved from settings — never from the request — so the route
 * cannot read arbitrary files.
 */
export async function handleAudio(
  ctx: Context, req: IncomingMessage, res: ServerResponse, pathname: string,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendMethodNotAllowed(res, 'GET, HEAD')
    return
  }
  const voice = pathname.slice(AUDIO_ROUTE_PREFIX.length).replace(/^\//, '')
  if (voice !== 'tick' && voice !== 'hum' && voice !== 'chime') {
    sendJson(res, 404, { code: 'unknown-voice', message: `no voice ${voice}` })
    return
  }
  const configured = configuredAudioPath(ctx, voice)
  if (configured === undefined) {
    sendJson(res, 404, { code: 'no-path', message: `no custom audio configured for ${voice}` })
    return
  }
  let bytes: Buffer
  try {
    bytes = await readFile(configured)
  } catch {
    sendJson(res, 404, { code: 'unreadable', message: `cannot read ${configured}` })
    return
  }
  const extension = configured.slice(configured.lastIndexOf('.')).toLowerCase()
  res.statusCode = 200
  res.setHeader('content-type', AUDIO_MIME[extension] ?? 'application/octet-stream')
  res.setHeader('cache-control', 'no-store')
  if (req.method === 'HEAD') {
    res.setHeader('content-length', String(bytes.length))
    res.end()
    return
  }
  res.end(bytes)
}

/**
 * List one directory level for the audio-file browser. Whole-filesystem
 * scope, rooted at `/` (or the drive root); hidden entries flagged but
 * returned. Only audio files are selectable; everything else is skipped.
 */
export async function handleBrowse(
  req: IncomingMessage, res: ServerResponse, requestUrl: URL,
): Promise<void> {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, 'GET')
    return
  }
  const rawPath = requestUrl.searchParams.get('path')
  const target = rawPath === null || rawPath.length === 0
    ? filesystemRoot()
    : rawPath
  if (!isAbsolute(target)) {
    sendJson(res, 400, { ok: false, path: target, crumbs: [], directories: [], files: [], error: 'path must be absolute' })
    return
  }
  const listing = await listDirectoryLevel(target)
  sendJson(res, 200, listing)
}

/** Read one directory level into a {@link BrowseListing}. */
export async function listDirectoryLevel(target: string): Promise<BrowseListing> {
  const listing: BrowseListing = {
    path: target,
    crumbs: ancestryCrumbs(target),
    directories: [],
    files: [],
    ok: true,
  }
  let entries: { name: string; path: string }[]
  try {
    const statResult = await stat(target)
    if (!statResult.isDirectory()) {
      return { ...listing, ok: false, error: 'not a directory' }
    }
    const dirents = await readdir(target, { withFileTypes: true })
    entries = dirents.map(dirent => ({ name: dirent.name, path: joinPaths(target, dirent.name) }))
  } catch (error) {
    return {
      ...listing,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  for (const entry of entries) {
    // Skip dotfiles and system directories: the picker shows only ordinary
    // user-browsable files and folders.
    if (isHidden(entry.name)) continue
    if (entry.name.endsWith('.') || entry.name.endsWith('..')) continue
    const entryStat = await statSafe(entry.path)
    if (entryStat === undefined) continue
    if (entryStat.isDirectory()) {
      if (isSystemDirectory(entry.name)) continue
      listing.directories.push({ name: entry.name, path: entry.path, directory: true })
    } else if (entryStat.isFile() && isAudioFile(entry.name)) {
      listing.files.push({ name: entry.name, path: entry.path, directory: false })
    }
  }
  listing.directories.sort((a, b) => a.name.localeCompare(b.name))
  listing.files.sort((a, b) => a.name.localeCompare(b.name))
  return listing
}

/** stat() that swallows errors (a dangling symlink or permission denial skips the entry). */
async function statSafe(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/** Whether a filename has an audio extension the browser can decode. */
function isAudioFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return AUDIO_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

/** Join a directory path with a child name (keeps Windows separators intact). */
function joinPaths(directory: string, name: string): string {
  return directory.endsWith('/') || directory.endsWith('\\')
    ? directory + name
    : directory + (process.platform === 'win32' ? '\\' : '/') + name
}

/** Ancestor chain from the filesystem root to `target` inclusive. */
function ancestryCrumbs(target: string): string[] {
  const crumbs: string[] = []
  let current = target
  for (;;) {
    crumbs.unshift(current)
    const parent = dirname(current)
    if (parent === current) return crumbs
    current = parent
  }
}

/**
 * Register the audio and browse routes on the host web server.
 * @param ctx - host context (must provide `webServer` and `connection`).
 */
export function registerBeepRoutes(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: AUDIO_ROUTE_PREFIX,
    handler: (req, res) => {
      if (rejected(ctx, req, res)) return
      const pathname = new URL(String(req.url), 'http://localhost').pathname
      void handleAudio(ctx, req, res, pathname)
    },
  }), 'ui-beep: GET /ui-beep/audio/:voice')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BROWSE_ROUTE,
    handler: (req, res) => {
      if (rejected(ctx, req, res)) return
      const requestUrl = new URL(String(req.url), 'http://localhost')
      void handleBrowse(req, res, requestUrl)
    },
  }), 'ui-beep: GET /ui-beep/browse')
}