/**
 * Standalone tsdown config for the dsh-beep client plugin.
 *
 * Emits the DSH client-plugin artifact format: a closure factory registered
 * through `window.__ModuleLoader__.load({ id, factory })`, consumed by the
 * harness's browser module table. ui-beep has no external runtime imports
 * (every `@deepseek-ai` import is type-only and erased), so the client bundle
 * is fully self-contained — only the loader wrapper is required.
 *
 * Inside the deepseek-harness repo this is produced by the shared
 * `clientBundle` preset (`packages/client/tsdown.client.ts`); this file is the
 * standalone equivalent for the published package. `outExtensions` pins `.js`
 * (instead of tsdown's default `.mjs`/`.cjs` under `"type": "module"`) so the
 * artifact names match the DSH module table's contract (`lib/client.js`).
 */
import { defineConfig } from 'tsdown'

const ID = '@xain_npm/dsh-client-ui-beep'

/** Force `.js` output names regardless of format (matches the DSH contract). */
const jsExtensions = () => ({ js: '.js' })

export default defineConfig([
  // Node half: the host plugin entry (also emitted by tsc into lib/types).
  {
    name: ID,
    entry: { index: 'lib/types/index.js', invariant: 'lib/types/invariant.js' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    clean: false,
    dts: false,
    outExtensions: jsExtensions,
  },
  // Browser half: the closure-factory artifact served as /plugins/<id>/client.js.
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    clean: false,
    dts: false,
    sourcemap: true,
    outExtensions: jsExtensions,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
  },
])