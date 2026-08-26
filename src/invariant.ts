/**
 * Package-owned invariant companion for `@xain_npm/dsh-client-ui-beep`.
 * @module @xain_npm/dsh-client-ui-beep/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@xain_npm/dsh-client-ui-beep'

/** Cordis companion plugin name. */
export const name = 'client-ui-beep-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a read-only consumer of the sessions
 * list and conversation snapshots. It emits no cordis events and owns no
 * cross-plugin mutable state; every subscription is disposed through the
 * plugin fiber's own effect lifecycle.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
