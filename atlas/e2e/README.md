# Meridian end-to-end smoke test

One script, no new dependencies: `e2e/run.mjs` builds the app, serves `dist/`,
drives a real headless Chrome through writing a journal entry, and proves the
entry is still there after a full page reload.

```bash
cd atlas
npm run test:e2e
```

Exit code is `0` when nothing failed (including when the suite is skipped for
want of a browser) and `1` when any assertion failed.

## Why this exists

An earlier session ran exactly this check by hand, in a throwaway scratchpad,
and the harness was lost when the session ended — so the evidence had to be
recreated from scratch. This is that check, committed, so it is repeatable by
anyone.

It also covers the one thing no unit test can. Meridian's durability story is
`sql.js` (WebAssembly) → SQLite bytes → IndexedDB → `sql.js` again. jsdom has no
WebAssembly-backed SQLite and no real IndexedDB, so the only way to know that a
saved entry actually survives a reload is to reload a real browser. That is
assertion 9, and it is the reason the rest of the file exists.

## What it asserts

Printed in order as `PASS` / `FAIL` / `SKIP` lines.

| # | Assertion |
|---|-----------|
| 0 | `npm run build` succeeds (pre-flight, see *Build failures* below) |
| 1 | The page loads and React mounts — the compass loading screen is gone, the app shell is rendered, and it is not the `index.html` "Meridian could not start" boot fallback |
| 2 | No page exceptions during boot |
| 3 | sql.js's WebAssembly binary loaded with a real body, and the `atlas.db` IndexedDB database exists |
| 4 | The welcome screen renders its time-of-day greeting |
| 5 | The sidebar closes on "Hide" and reopens on "☰ Meridian", with all four navigation tabs (timeline / trips / search / data) actually on screen |
| 6 | "New entry" opens the lazy-loaded journal editor (waits for the chunk) |
| 7 | Typing into the TipTap rich-text body lands in the ProseMirror document |
| 8 | Saving closes the editor and the entry appears in the timeline |
| 9 | **The entry survives a full page reload.** Re-read out of storage after `Page.reload`, and the persisted blob is verified to be a real SQLite file (`SQLite format 3` header) containing the typed body text |
| 10 | The insights/stats card recomputes after the reload and reports 1 entry |
| 11 | Settings opens and shows its sections and controls |
| 12 | `screenshots/welcome.png` and `screenshots/timeline.png` are written and non-empty |
| 13 | No page exceptions or console errors for the whole run |

Assertions 1, 6, 7 and 8 are *critical*: if one fails the remaining assertions
are reported as `SKIP` rather than cascading into a wall of timeouts.

## What it deliberately does **not** do

- **No network.** Every request to anything other than the local test server is
  blocked (`Fetch.failRequest`), so the run behaves identically on a machine with
  and without internet. Consequences, all expected: no map tiles, no weather, no
  reverse-geocoding, no place names. The app is supposed to degrade gracefully
  and those failures show up as console *warnings*, which are reported but never
  fail the suite.
- **No geolocation.** Headless Chrome denies it. Entries therefore save with no
  coordinates, which is why assertion 10 checks the entry count and not the
  "places" figure.
- **No first-run onboarding.** The fresh Chrome profile would otherwise get the
  one-time `Onboarding` overlay covering the app. The runner seeds
  `localStorage['meridian_settings'] = {"onboarded": true}` before any page
  script, so it tests a returning device. Onboarding needs its own test.
- **No sync, no file linking, no export, no map interaction, no mobile
  viewport.** The viewport is a fixed 1440×1000 desktop layout, so the two-pane
  branch is what gets exercised — never the mobile drawer.
- **No editing or deleting an entry**, no multi-entry timeline grouping, no
  trips, no search.
- **Not a visual regression test.** The screenshots are evidence for a human to
  glance at, not compared against baselines.
- **Not a replacement for `npm test`.** This is one happy path in a real browser;
  the unit tests cover breadth.

## Requirements

- **Node 24+** — the runner speaks the Chrome DevTools Protocol over Node's
  built-in `WebSocket` global. Check with
  `node -e "console.log(typeof WebSocket)"` (must print `function`).
- **Any Chrome or Chromium.** Looked for in this order: `$CHROME_PATH`,
  `C:\Program Files\Google\Chrome\Application\chrome.exe`,
  `C:\Program Files (x86)\...`, `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`,
  then `chrome` / `google-chrome` on `PATH`.

  **If no browser is found the suite prints `SKIPPED` and exits 0.** A machine
  without Chrome is not a failing test. Point `CHROME_PATH` at an executable to
  run it anywhere:

  ```bash
  CHROME_PATH="/usr/bin/chromium" npm run test:e2e
  ```

No npm dependency is added, and nothing is installed on the fly.

## Environment variables

| Variable | Effect |
|---|---|
| `CHROME_PATH` | Browser executable to use, tried first |
| `E2E_SKIP_BUILD=1` | Reuse the existing `dist/` instead of rebuilding. Much faster while iterating on the harness. Assertion 0 then reports `SKIP`, because no build was verified |

## Build failures

`npm run build` is `tsc -b && vite build`, so a type error in *any* file the
project type-checks — including files the bundle never imports — stops it.

When that happens the runner does not go silent: it records assertion 0 as
`FAIL`, then falls back to a bundle-only `vite build` so the thirteen page
assertions still produce evidence. The suite therefore never *passes* against a
repo whose real build is broken, but you still learn whether the app itself
works. If even the fallback bundle fails, there is nothing to serve and the run
stops after assertion 0.

## Screenshots

Written to `e2e/screenshots/` (created on demand). They are overwritten every
run and are pure build output — **add `atlas/e2e/screenshots/` to `.gitignore`**
if you would rather not commit them. They are not currently ignored.

## Notes for whoever maintains this

- **It asserts on English UI text** (`field journal`, `New Entry`, `Save Entry`,
  `About you`, …). The i18n work in `src/i18n/` will break these selectors the
  moment those strings become translatable; they will need to be pinned to the
  `en` locale or replaced with `data-testid` hooks.
- **Two visibility helpers, and the difference matters.** `__vis(el)` is a layout
  and style check. `__onscreen(el)` additionally hit-tests with
  `elementFromPoint`. The desktop sidebar collapses to `width: 0` with
  `overflow: hidden` while its children keep their full 340px bounding boxes, so
  only the hit test can tell an open sidebar from a closed one (assertion 5).
- **Typing has two paths.** Plain `<input>`s are driven through React's own value
  setter plus an `input` event; contenteditable (TipTap/ProseMirror) gets a real
  `Input.insertText`, because ProseMirror ignores synthetic input events.
- **Every wait has a timeout and a descriptive label**, so a failure says what it
  was waiting for rather than just "timed out". Nothing polls forever. The
  browser phase additionally has a hard 180s watchdog that kills Chrome and exits
  1, and Chrome is launched with a throwaway `--user-data-dir` in the OS temp
  directory that is removed in a `finally`.
- `--use-angle=swiftshader --enable-unsafe-swiftshader` are passed alongside
  `--disable-gpu` on purpose. Without software WebGL, `maplibre-gl` throws into
  the map's `ErrorBoundary` and React reports it via `console.error` — a browser
  artefact that would read as an app failure under assertion 13.
