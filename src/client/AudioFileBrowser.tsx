/**
 * Audio file browser dialog: whole-filesystem navigation rooted at `/` (or the
 * drive root), listing enterable directories and selectable audio files. The
 * Host `/ui-beep/browse` route answers each level; selecting a file (or
 * clicking Open while a file is highlighted) returns its absolute path.
 */
import { useEffect, useState } from 'react'
import type { BeepKey } from './locales.ts'
import css from './AudioFileBrowser.module.css'

/** One entry in a browse listing (mirrors the Host route's JSON shape). */
interface BrowseEntry {
  name: string
  path: string
  directory: boolean
  hidden: boolean
}

/** One directory level served by the browse route. */
interface BrowseListing {
  path: string
  crumbs: string[]
  directories: BrowseEntry[]
  files: BrowseEntry[]
  ok: boolean
  error?: string
}

/** A translate narrowed to the settings.beep dictionary (plus common keys). */
type BrowseT = (key: BeepKey, params?: Record<string, unknown>) => string

/** Full component props for the browser dialog. */
export interface AudioFileBrowserProps {
  /** Which voice this picker is choosing audio for (copy only). */
  voiceLabel: BeepKey
  /** Translate function. */
  t: BrowseT
  /** Close the dialog without choosing. */
  onCancel: () => void
  /** Choose one audio file path. */
  onPick: (path: string) => void
}

/**
 * Render the audio file browser dialog.
 * @param props - copy, cancel, and pick actions.
 * @returns the dialog element tree.
 */
export function AudioFileBrowser({ voiceLabel, t, onCancel, onPick }: AudioFileBrowserProps) {
  const [listing, setListing] = useState<BrowseListing | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  const load = (path: string): void => {
    setLoading(true)
    setError(undefined)
    setSelected(undefined)
    void fetch(`/ui-beep/browse?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`browse answered ${response.status}`)
        const body = await response.json() as BrowseListing
        setListing(body)
        if (!body.ok) setError(body.error ?? t('browser.loadFailed'))
      })
      .catch(() => { setError(t('browser.loadFailed')) })
      .finally(() => { setLoading(false) })
  }

  // Root on first mount.
  useEffect(() => {
    load('')
  }, [])

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onCancel} />
      <div className={css.dialog} role="dialog" aria-modal="true" aria-label={t('browser.title')}>
        <div className={css.heading}>{t('browser.title')}</div>
        <div className={css.subheading}>{t(voiceLabel)}</div>
        <div className={css.breadcrumbs}>
          {listing?.crumbs.map((crumb, index) => (
            <button
              key={`${crumb}-${index}`}
              type="button"
              className={css.crumb}
              onClick={() => { load(crumb) }}
            >
              {index === 0 ? t('browser.root') : crumb}
            </button>
          ))}
        </div>
        {error !== undefined && <p className={css.error}>{error}</p>}
        {loading && <p className={css.status}>{t('browser.loading')}</p>}
        {listing !== undefined && !loading && (
          <div className={css.list} role="listbox" aria-label={t('browser.files')}>
            {listing.directories.map(dir => (
              <button
                key={dir.path}
                type="button"
                role="option"
                className={css.entry}
                onClick={() => { load(dir.path) }}
                onDoubleClick={() => { load(dir.path) }}
              >
                <span className={css.dirIcon}>📁</span>
                <span className={css.entryName}>{dir.name}</span>
                <span className={css.entryType}>{t('browser.folder')}</span>
              </button>
            ))}
            {listing.files.map(file => (
              <button
                key={file.path}
                type="button"
                role="option"
                aria-selected={selected === file.path}
                className={css.entry}
                onClick={() => { setSelected(file.path) }}
                onDoubleClick={() => { onPick(file.path) }}
              >
                <span className={css.fileIcon}>🎵</span>
                <span className={css.entryName}>{file.name}</span>
                <span className={css.entryType}>{t('browser.audioFile')}</span>
              </button>
            ))}
            {listing.directories.length === 0 && listing.files.length === 0 && (
              <p className={css.empty}>{t('browser.empty')}</p>
            )}
          </div>
        )}
        <div className={css.footer}>
          <span className={css.selectedPath}>{selected ?? ''}</span>
          <div className={css.actions}>
            <button type="button" className={css.button} onClick={onCancel}>
              {t('browser.cancel')}
            </button>
            <button
              type="button"
              className={`${css.button} ${css.primary}`}
              disabled={selected === undefined}
              onClick={() => { if (selected !== undefined) onPick(selected) }}
            >
              {t('browser.open')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}