export interface ProgressBarProps {
  /** 0–1. Values outside that range are clamped. */
  value: number;
  className?: string;
  'aria-label'?: string;
}

/**
 * One shared determinate progress bar. Animates `transform: scaleX()`, never
 * `width`, so a progress update never triggers layout — the pattern already
 * used correctly by `OfflineTilesPanel`'s downloader, promoted here so the
 * storage quota bar (`DataView`) and the place-name backfill
 * (`SettingsView`) — which currently has no bar at all, only text — can share
 * it instead of each re-implementing their own `<div style={{width}}>`.
 */
export default function ProgressBar({ value, className, 'aria-label': ariaLabel }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const cls = ['mo-progress-track', className].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-label={ariaLabel}
    >
      <div className="mo-progress-fill" style={{ '--mo-progress': clamped } as React.CSSProperties} />
    </div>
  );
}
