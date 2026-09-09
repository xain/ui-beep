/**
 * Standalone tsdown config for the dsh-beep client plugin.
 *
 * Emits the DSH client-plugin artifact format: a closure factory registered
 * through `window.__ModuleLoader__.load({ id, factory })`, consumed by the
 * harness's browser module table. Runtime imports that the loader table
 * answers (`react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-store`,
 * `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`)
 * stay external so every bundle shares the platform singletons; every other
 * `@deepseek-ai` import is type-only and erased, and the remaining runtime
 * code inlines. CSS Modules compile with lightningcss into an injected style
 * tag plus a hashed class map — the same artifact contract as the shared
 * `clientBundle` preset.
 *
 * Inside the deepseek-harness repo this is produced by the shared
 * `clientBundle` preset (`packages/client/tsdown.client.ts`); this file is the
 * standalone equivalent for the published package. `outExtensions` pins `.js`
 * (instead of tsdown's default `.mjs`/`.cjs` under `"type": "module"`) so the
 * artifact names match the DSH module table's contract (`lib/client.js`).
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const ID = '@xain_npm/dsh-client-ui-beep'

/**
 * Module-table specifiers the loader's require answers (platform seed words in
 * `packages/client/web/src/platform.ts`). These must stay external in the
 * browser bundle — inlining them would duplicate React, the slot registry, or
 * the store identity and break cross-plugin collaboration.
 */
const LOADER_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** Force `.js` output names regardless of format (matches the DSH contract). */
const jsExtensions = () => ({ js: '.js' })

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline
 * (which requires @tsdown/css). The suffix matters: tsdown's guard matches ids
 * ending in `.css`, so the virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Emit one plugin-owned style injector and the CSS Modules class-map export. */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

export default defineConfig([
  // Node half: the host plugin entry (also emitted by tsc into lib/types).
  // A production dependency (schemastery) stays an import — the Host install
  // resolves it from disk — while dev-only code inlines.
  {
    name: ID,
    entry: { index: 'lib/types/index.js', invariant: 'lib/types/invariant.js' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    clean: false,
    dts: false,
    outExtensions: jsExtensions,
    deps: {
      neverBundle: (specifier: string) => specifier === '@deepseek-ai/schemastery',
      alwaysBundle: (specifier: string) => specifier !== '@deepseek-ai/schemastery',
    },
  },
  // Browser half: the closure-factory artifact served as /plugins/<id>/client.js.
  // The banner defines the CJS `module`/`exports` globals the factory body and
  // footer reference; tsdown's cjs format emits `exports.<x> = ...` statements
  // without a `var exports` in scope otherwise, so the browser throws
  // `exports is not defined`. Matches the shared clientBundle preset's intro.
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
    deps: {
      // Loader-table specifiers stay imports; everything else inlines (a
      // require() the table cannot answer is a guaranteed runtime throw).
      neverBundle: (specifier: string) => LOADER_EXTERNALS.includes(specifier),
      alwaysBundle: (specifier: string) => !LOADER_EXTERNALS.includes(specifier),
    },
    plugins: [{
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        // The virtual id otherwise hides the physical stylesheet from Rolldown's watch graph.
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        const exportEntries = Object.entries(cssExports ?? {})
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        for (const [local, exp] of exportEntries) classMap[local] = exp.name
        return styleInjectionModule(ID, fileId, code.toString(), classMap)
      },
    }],
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
    footer: 'return module.exports; } });',
  },
])

/** Path segment separating a package's tsc output from the sources it was emitted from. */
const TYPES_MARKER = '/lib/types/'

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}