import { defineConfig } from 'vitest/config'

/**
 * Vitest config — the unit/component test runner.
 *
 * Why a second runner along`node --test`: the original sync/merge suite
 * (`src/data/*.test.mjs`, 37 tests) runs on Node's built-in runner and stays
 * there untouched — it guards the most dangerous code in the app and has caught
 * real data-loss bugs. But Node can only import a `.ts` module when every import
 * *inside* it carries an explicit extension, and the app uses bundler-style
 * extensionless imports throughout (`import { haversineKm } from '../utils'`).
 * Rather than mirror app logic into test files (which is how `syncPass` ended up
 * duplicated in `sync.test.mjs`), everything new imports the REAL module through
 * Vite's resolver.
 *
 * `npm test` runs both runners. See package.json.
 *
 * NO PLUGINS, deliberately:
 *   - The PWA plugin only generates a service worker, which no test needs.
 *   - `@vitejs/plugin-react` provides Fast Refresh, which is a dev-server feature
 *     with nothing to do with a test run. JSX still compiles, because Vite's
 *     esbuild transform reads `jsx: 'react-jsx'` from tsconfig.app.json.
 *
 * Leaving the React plugin out also avoids a real type conflict: Vitest 3 bundles
 * its own (rollup-based) Vite, while this project is on Vite 8 (rolldown-based),
 * so their `Plugin` types are structurally incompatible and passing a Vite-8
 * plugin here fails `tsc -b` — which `npm run build` runs. Fewer plugins, no skew.
 */
export default defineConfig({
  test: {
    // jsdom everywhere: the pure-logic suites don't need it, but several touch
    // localStorage (pickFresh, the settings store) and the cost is negligible at
    // this scale. Component suites need it outright.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // The .mjs sync suite belongs to `node --test`; never let Vitest collect it.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.mjs'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
})
