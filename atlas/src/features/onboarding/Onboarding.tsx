import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings, FONT_SIZES, type GraphicsQuality, type Language, type ThemeMode } from '../../store/settings';
import { QUALITY_ORDER, profileFor } from '../welcome/quality';
import { LOCALES } from '../../i18n';

/**
 * First-run introduction.
 *
 * A fresh install used to open straight onto the welcome screen with an empty
 * greeting ("Good evening," with no name), a default theme, and the backdrop at
 * its most conservative setting — so the first minute showed the app at its least
 * characteristic. Three questions fix that, and they're the three that genuinely
 * change what the user sees rather than settings we could sensibly default.
 *
 * Principles this follows:
 *  - **Skippable at every step, and never shown again either way.** Onboarding that
 *    can't be dismissed is hostile, and one that reappears is worse.
 *  - **Nothing is required.** Skipping leaves the existing defaults in place; the
 *    app is fully usable having answered nothing.
 *  - **Every choice is reversible in Settings**, and the copy says so, so no answer
 *    feels load-bearing.
 *  - **No data is collected and nothing is sent.** It writes to the same
 *    localStorage settings the Settings screen does.
 *
 * The `onboarded` flag lives in the settings store so it persists with everything
 * else and survives across sessions on that device.
 */

type Step = 'welcome' | 'you' | 'look' | 'done';
const STEPS: Step[] = ['welcome', 'you', 'look', 'done'];

/** The compass emblem from the loading screen, reused so the intro is recognisably
 *  the same app. Decorative, hence aria-hidden. */
function Compass({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="animate-floaty">
      <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
      <path d="M32 11 A21 21 0 0 1 50 22" fill="none" stroke="#C05A45" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M32 14 L37 32 L32 50 Z" fill="#C05A45" />
      <path d="M32 14 L27 32 L32 50 Z" fill="currentColor" fillOpacity="0.32" />
      <circle cx="32" cy="32" r="3.2" fill="currentColor" fillOpacity="0.55" />
    </svg>
  );
}

export default function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const update = useSettings((s) => s.update);
  const flush = useSettings((s) => s.flush);
  const name = useSettings((s) => s.name);
  const title = useSettings((s) => s.title);
  const theme = useSettings((s) => s.theme);
  const language = useSettings((s) => s.language);
  const fontSize = useSettings((s) => s.fontSize);
  const graphicsQuality = useSettings((s) => s.graphicsQuality);

  const panelRef = useRef<HTMLDivElement>(null);
  const index = STEPS.indexOf(step);

  /** Mark the install as introduced and persist everything chosen along the way. */
  const finish = useCallback(() => {
    update('onboarded', true);
    flush();
  }, [update, flush]);

  // Escape skips — the same affordance every other dialog in the app has.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  // Move focus into the panel so keyboard and screen-reader users start here
  // rather than at the top of the page behind it.
  useEffect(() => { panelRef.current?.focus(); }, []);

  const next = () => setStep(STEPS[Math.min(index + 1, STEPS.length - 1)]);
  const back = () => setStep(STEPS[Math.max(index - 1, 0)]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm animate-dialog-fade">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Meridian"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-water bg-surface shadow-2xl outline-none animate-dialog-pop"
      >
        <div className="space-y-5 p-6">
          {step === 'welcome' && (
            <div className="space-y-4 text-center">
              <div className="flex justify-center text-ink">
                <Compass />
              </div>
              <div className="space-y-1.5">
                <h1 className="u-display u-display-md">Meridian</h1>
                <p className="text-sm text-ink/60">A journal for geographers.</p>
              </div>
              <p className="u-measure mx-auto text-sm leading-relaxed text-ink/70">
                Write entries, pin them on a map, and watch the landscape behind them change
                with the weather and the season. Everything stays on this device — there is no
                account and no server holding your journal.
              </p>
              <p className="text-xs text-ink/45">Three quick questions, all changeable later.</p>
            </div>
          )}

          {step === 'you' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="u-display u-display-sm">Who's writing?</h2>
                <p className="text-sm text-ink/60">Used to greet you on the home screen. Optional.</p>
              </div>
              <label className="block space-y-1">
                <span className="u-label">Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded border border-water bg-surface px-3 py-2 text-sm focus:border-terracotta focus:outline-none"
                  autoFocus
                />
              </label>
              <label className="block space-y-1">
                <span className="u-label">What you do</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => update('title', e.target.value)}
                  placeholder="e.g. Geoinformatiker"
                  className="w-full rounded border border-water bg-surface px-3 py-2 text-sm focus:border-terracotta focus:outline-none"
                />
              </label>
              <div className="space-y-1">
                <span className="u-label">Language</span>
                <div className="flex flex-wrap gap-2">
                  {LOCALES.map((locale) => (
                    <button
                      key={locale.id}
                      type="button"
                      onClick={() => update('language', locale.id as Language)}
                      className={`btn btn-sm ${language === locale.id ? 'btn-active' : 'btn-secondary'}`}
                    >
                      {locale.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-ink/45">
                  Meridian's own labels. You can write entries in any language regardless.
                </p>
              </div>
            </div>
          )}

          {step === 'look' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="u-display u-display-sm">How should it look?</h2>
                <p className="text-sm text-ink/60">All of this lives in Settings too.</p>
              </div>

              <div className="space-y-1.5">
                <span className="u-label">Theme</span>
                <div className="flex gap-2">
                  {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => update('theme', mode)}
                      className={`btn btn-sm flex-1 ${theme === mode ? 'btn-active' : 'btn-secondary'}`}
                    >
                      {mode === 'light' ? '☀ Light' : mode === 'dark' ? '☾ Dark' : 'Auto'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="u-label">Text size</span>
                <div className="flex gap-2">
                  {(Object.keys(FONT_SIZES) as Array<keyof typeof FONT_SIZES>).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => update('fontSize', size)}
                      className={`btn btn-sm flex-1 ${fontSize === size ? 'btn-active' : 'btn-secondary'}`}
                    >
                      {FONT_SIZES[size].label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="u-label">Animated backdrop</span>
                <div className="flex gap-2">
                  {QUALITY_ORDER.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => update('graphicsQuality', tier as GraphicsQuality)}
                      className={`btn btn-sm flex-1 ${graphicsQuality === tier ? 'btn-active' : 'btn-secondary'}`}
                    >
                      {profileFor(tier).label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] leading-snug text-ink/45">{profileFor(graphicsQuality).blurb}</p>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4 text-center">
              <div className="flex justify-center text-ink">
                <Compass size={52} />
              </div>
              <div className="space-y-1.5">
                <h2 className="u-display u-display-sm">
                  {name ? `Ready when you are, ${name}.` : 'Ready when you are.'}
                </h2>
                <p className="u-measure mx-auto text-sm leading-relaxed text-ink/65">
                  Your first entry is the hardest one. Note where you are and what the weather's
                  doing — Meridian fills in the rest.
                </p>
              </div>
              <p className="text-xs text-ink/45">
                Everything you just chose is under the ⚙ button, along with a lot more.
              </p>
            </div>
          )}
        </div>

        {/* Footer: progress, skip, and navigation. */}
        <div className="flex items-center justify-between gap-3 border-t border-water bg-land/50 px-6 py-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-4 bg-terracotta' : 'w-1.5 bg-ink/20'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && index < STEPS.length - 1 && (
              <button type="button" onClick={back} className="btn btn-sm btn-secondary">
                Back
              </button>
            )}
            {step !== 'done' ? (
              <>
                <button type="button" onClick={finish} className="text-xs text-ink/45 hover:text-ink">
                  Skip
                </button>
                <button type="button" onClick={next} className="btn btn-sm btn-primary">
                  {step === 'welcome' ? 'Get started' : 'Next'}
                </button>
              </>
            ) : (
              <button type="button" onClick={finish} className="btn btn-sm btn-primary">
                Start journaling
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
