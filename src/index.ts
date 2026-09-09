/**
 * Agent-heartbeat sonification plugin, node half. Registers the durable
 * `ui-beep` settings section (schema defaults → row config → user overrides)
 * whenever a settings provider is composed, and mounts the audio/browse
 * routes that serve user-supplied custom audio files; the browser half ships
 * via exports["./client"], discovered through the package.json `dsh.client`
 * declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import {
  BEEP_SETTINGS_NAMESPACE, BeepSettingsSchema, beepSettingsBase,
} from './beep-settings.ts'
import { registerBeepRoutes } from './host.ts'

export {
  BEEP_SETTINGS_NAMESPACE, ENABLED_FIELD, MASTER_VOLUME_FIELD, TICK_VOLUME_FIELD,
  HUM_VOLUME_FIELD, CHIME_VOLUME_FIELD, TICK_PATH_FIELD, HUM_PATH_FIELD, CHIME_PATH_FIELD,
  VOLUME_MIN, VOLUME_MAX, DEFAULT_ENABLED, DEFAULT_MASTER_VOLUME, DEFAULT_VOICE_VOLUME,
  type BeepSettings,
} from './beep-settings.ts'
export {
  AUDIO_ROUTE_PREFIX, BROWSE_ROUTE, voicePathField,
  type BrowseEntry, type BrowseListing,
} from './host.ts'

/** Required host services: the web server and the connection trust fence. */
export const inject = ['webServer', 'connection']

/**
 * Register the durable beep section when the optional settings service is
 * composed, and mount the custom-audio routes. The cordis row `config:`
 * becomes the composition base, so an installed bundle keeps its declared
 * defaults until the user overrides them from the Settings page.
 * @param ctx - Host context that may acquire the settings service.
 * @param config - cordis row config (falls back to schema defaults).
 */
export function apply(ctx: Context, config?: { volume?: number; enabled?: boolean }): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const base = beepSettingsBase(config)
    settingsCtx.settings.register(BEEP_SETTINGS_NAMESPACE, BeepSettingsSchema, {
      ...(base === undefined ? {} : { base }),
    })
  })
  // The routes are mounted regardless of settings presence; they answer 404
  // when no path is configured.
  registerBeepRoutes(ctx)
}