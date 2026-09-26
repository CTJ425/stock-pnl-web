/**
 * App brand mark: a statement sheet — a ruled frame with three printed lines, the last one in
 * the market's up colour (2026-09-26 redesign; replaced the glowing ascending bars).
 */
export function BrandMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="股票小幫手"
    >
      <rect x="1" y="1" width="22" height="22" stroke="var(--cds-text-primary)" strokeWidth="2" />
      <rect x="5" y="6" width="14" height="2.5" fill="var(--cds-text-primary)" />
      <rect x="5" y="10.75" width="10" height="2.5" fill="var(--cds-text-primary)" />
      <rect x="5" y="15.5" width="6.5" height="2.5" fill="var(--up)" />
    </svg>
  )
}
