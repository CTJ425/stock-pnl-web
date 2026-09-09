import type { KeyboardEvent, MouseEvent } from 'react'

/**
 * Props to spread onto a clickable `<tr>`/`<div>` so it behaves like a button for
 * both mouse and keyboard: Enter/Space activate it, and Space does not scroll the page.
 */
export function useRowActivate(onActivate: () => void, label: string) {
  const onClick = (_e: MouseEvent) => {
    onActivate()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onActivate()
  }

  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick,
    onKeyDown,
  }
}
