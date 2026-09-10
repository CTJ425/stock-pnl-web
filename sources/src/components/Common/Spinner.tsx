interface SpinnerProps {
  size?: number
}

/** Carbon Design loading indicator: a grey track circle plus a 3/4 blue arc, 690ms per turn. */
export function Spinner({ size = 16 }: SpinnerProps) {
  return (
    <svg className="cds-spinner" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle className="cds-spinner__track" cx="50" cy="50" r="42" />
      <circle className="cds-spinner__stroke" cx="50" cy="50" r="42" />
    </svg>
  )
}
