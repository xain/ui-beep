/**
 * Agent-heartbeat sonification plugin, node half. Registers the durable
 * `ui-beep` settings section (schema defaults → row config → user overrides)
 * whenever a settings provider is composed; the browser half ships via
 * exports["./client"], discovered through the package.json `dsh.client`
 * declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import {
  BEEP_SETTINGS_NAMESPACE, BeepSettingsSchema, beepSettingsBase,
} from './beep-settings.ts'

export {
  BEEP_SETTINGS_NAMESPACE, ENABLED_FIELD, MASTER_VOLUME_FIELD, TICK_VOLUME_FIELD,
  HUM_VOLUME_FIELD, CHIME_VOLUME_FIELD, VOLUME_MIN, VOLUME_MAX,
  DEFAULT_ENABLED, DEFAULT_MASTER_VOLUME, DEFAULT_VOICE_VOLUME,
  type BeepSettings,
} from './beep-settings.ts'

/**
 * Register the durable beep section when the optional settings service is
 * composed. The cordis row `config:` becomes the composition base, so an
 * installed bundle keeps its declared defaults until the user overrides them
 * from the Settings page.
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
}
