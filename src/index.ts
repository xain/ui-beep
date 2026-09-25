/**
 * Agent-heartbeat sonification plugin, node half. Owns the plugin's live
 * `Config` (the settings form seam introduced in DSH 0.1.7) and mounts the
 * audio/browse routes that serve user-supplied custom audio files; the browser
 * half ships via exports["./client"], discovered through the package.json
 * `dsh.client` declaration.
 *
 * Settings are the plugin's own cordis Config: every field is declared
 * `.volatile()` in {@link Config}, so a value written from the Settings page is
 * adopted without restarting the plugin. `configure({ auto: false })` keeps DSH
 * from generating a generic form page — ui-beep renders its own Settings
 * section (volume sliders, audio picker, mute toggle).
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { Config, type BeepConfig } from './beep-settings.ts'
import { registerBeepRoutes } from './host.ts'

export {
  BEEP_SETTINGS_NAMESPACE, ENABLED_FIELD, MASTER_VOLUME_FIELD, TICK_VOLUME_FIELD,
  HUM_VOLUME_FIELD, CHIME_VOLUME_FIELD, TICK_PATH_FIELD, HUM_PATH_FIELD, CHIME_PATH_FIELD,
  VOLUME_MIN, VOLUME_MAX, DEFAULT_ENABLED, DEFAULT_MASTER_VOLUME, DEFAULT_VOICE_VOLUME,
  voicePathField,
  type BeepSettings, type BeepConfig,
} from './beep-settings.ts'
export { Config } from './beep-settings.ts'
export {
  AUDIO_ROUTE_PREFIX, BROWSE_ROUTE,
  type BrowseEntry, type BrowseListing,
} from './host.ts'

/** Required host services: the web server and the connection trust fence. */
export const inject = ['webServer', 'connection']

/**
 * Claim the plugin's settings presentation and mount the custom-audio routes.
 * @param ctx - Host context that may acquire the settings service.
 * @param config - validated live Config (every field is a Volatile reference).
 */
export function apply(ctx: Context, config: BeepConfig): void {
  // `auto: false`: ui-beep owns its Settings page, so DSH must not generate a
  // generic form for this entry. The call belongs to this plugin's fiber so the
  // policy is released with it.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  // The routes are mounted regardless of settings presence; they answer 404
  // when no path is configured.
  registerBeepRoutes(ctx, config)
}
