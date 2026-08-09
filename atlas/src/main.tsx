import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Bengali glyphs, bundled offline (no CDN). Only the Bengali unicode subset is
// imported — Latin stays on Inter/Merriweather, so the browser fetches these
// only when Bengali text is actually present. Serif pairs with the reading/
// editor font; sans with the UI. See --font-serif / --font-sans in index.css.
import '@fontsource/noto-serif-bengali/bengali-400.css'
import '@fontsource/noto-serif-bengali/bengali-700.css'
import '@fontsource/noto-sans-bengali/bengali-400.css'
import '@fontsource/noto-sans-bengali/bengali-600.css'
import './index.css'
import App from './App'
import { DialogProvider } from './components/ui/Dialog'
import ErrorBoundary from './components/ErrorBoundary'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <App />
        </DialogProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// Signal that the app has mounted, so the pre-boot diagnostic catcher in
// index.html stops treating later stray errors as a fatal "could not start"
// (those are handled in-app by the ErrorBoundary / per-feature try-catches).
;(window as unknown as { __meridianBooted?: boolean }).__meridianBooted = true
