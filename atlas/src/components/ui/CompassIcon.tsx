/**
 * Custom SVG Compass Icon matching Meridian's cartographic compass needle styling.
 * Features a distinct terracotta north pointer and muted south needle with center pivot.
 */
export default function CompassIcon({ className = 'w-4 h-4', size = 18 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {/* Outer compass ring */}
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" fill="currentColor" fillOpacity="0.06" />
      {/* Cardinal tick marks */}
      <line x1="12" y1="2" x2="12" y2="4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.7" />
      <line x1="22" y1="12" x2="19.5" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.5" />
      <line x1="12" y1="22" x2="12" y2="19.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.5" />
      <line x1="2" y1="12" x2="4.5" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.5" />
      {/* North needle (Terracotta / Red) */}
      <polygon points="12,4.5 14.5,12 12,10.2 9.5,12" fill="#E86A58" />
      {/* South needle (Muted Slate / Silver) */}
      <polygon points="12,19.5 14.5,12 12,13.8 9.5,12" fill="#94A3B8" />
      {/* Center pivot hub */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
