import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Always serve on port 5173. `strictPort` makes Vite ERROR if 5173 is already in
  // use rather than silently moving to 5174/5175 — which would be a different origin
  // with its own (empty) IndexedDB, making saved entries appear to vanish. One stable
  // port = one persistent data store. If you see "Port 5173 is in use", close the other
  // running copy of the app instead of opening a second one.
  // host: true makes Vite listen on all interfaces so phones on the same WiFi
  // can open the app directly at http://<pc-ip>:5173.
  server: { port: 5173, strictPort: true, host: true },
  build: {
    // The only chunk over ~500 kB is maplibre-gl, which is now an isolated,
    // lazy-loaded chunk (see MainPane) — there's nothing further to split inside
    // it, so lift the warning threshold above it rather than chase a non-issue.
    chunkSizeWarningLimit: 1200,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      // The launcher runs `npm run dev`, and by default vite-plugin-pwa only
      // emits a service worker for production builds. Without one, the browser
      // won't treat the app as installable — so enable it in dev too. This is
      // what lets the PC (http://localhost, a secure context) install Meridian
      // as a real app. Phones reach the app over plain http on the LAN, which is
      // NOT a secure context, so they get a Home Screen shortcut instead (full
      // app-like on iOS, a bookmark on Android) — that's a browser rule, not a
      // config gap.
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
      manifest: {
        // A stable `id` is what lets Android/Samsung recognise this as the SAME
        // installable app across visits, rather than minting a fresh home-screen
        // shortcut each time. Without it, some launchers fall back to a plain
        // bookmark (the "added but not a real app" symptom on Samsung phones).
        id: '/',
        name: 'Meridian Community Edition',
        short_name: 'Meridian',
        description: 'A journal for geographers',
        theme_color: '#FDFBF7',
        background_color: '#FDFBF7',
        display: 'standalone',
        // Belt-and-braces fallbacks for older WebView/Samsung Internet engines
        // that don't honour `display` alone.
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'en',
        // Required to be present-and-not-true for Android installability; makes
        // it explicit that this is the app to install (not a related native one).
        prefer_related_applications: false,
        icons: [
          // Declare `purpose: 'any'` explicitly on the raster icons. A WebAPK
          // mint on Android needs both a 192 and a 512 "any" icon; leaving
          // purpose implicit is what trips up stricter Samsung builds.
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        runtimeCaching: [
          {
            // Cache OpenStreetMap raster tiles (the host the map actually loads
            // from — see Map.tsx) so areas you've viewed work offline. Optional
            // a/b/c. subdomain is matched too, in case the tile URL ever changes.
            urlPattern: /^https:\/\/(?:[a-c]\.)?tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 1000, maxAgeSeconds: 86400 * 30 }
            }
          },
          {
            // Satellite imagery for the default (hybrid) and satellite basemaps —
            // Esri World Imagery, see features/map/mapStyle.ts. Cached the same way
            // as OSM raster so an area you've already looked at still draws with no
            // connection. A generous entry cap: imagery tiles are JPEG and small,
            // and a day in the field can pan across a lot of them.
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-imagery',
              expiration: { maxEntries: 2000, maxAgeSeconds: 86400 * 30 }
            }
          }
        ]
      }
    })
  ]
})
