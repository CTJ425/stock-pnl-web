import { useId } from 'react'

/** App brand mark: hand-authored SVG (glow + three ascending bars), replacing the old PNG. */
export function BrandMark() {
  const uid = useId()
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={30}
      height={30}
      viewBox="0 0 96 96"
      fill="none"
      role="img"
      aria-label="股票小幫手"
    >
      <defs>
        <linearGradient id={`${uid}-p1`} x1="20" y1="80" x2="20" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--svg-main-1)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--svg-main-1)" />
        </linearGradient>
        <linearGradient id={`${uid}-p2`} x1="44" y1="80" x2="44" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--svg-accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--svg-accent)" />
        </linearGradient>
        <linearGradient id={`${uid}-p3`} x1="68" y1="80" x2="68" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--stock-up-bright)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--stock-up-bright)" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r="40" fill="var(--svg-bg-glow)" />
      <rect x="14" y="44" width="16" height="38" rx="8" fill={`url(#${uid}-p1)`} />
      <rect x="38" y="30" width="18" height="52" rx="9" fill={`url(#${uid}-p2)`} />
      <rect x="64" y="16" width="18" height="66" rx="9" fill={`url(#${uid}-p3)`} />
      <path
        d="M54 26L73 14L82 32"
        stroke="var(--stock-up-bright)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
