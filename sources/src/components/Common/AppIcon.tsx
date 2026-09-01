/** Shared icon wrapper: fixes size and stroke width to one of six design tokens. */
import type { LucideIcon, LucideProps } from 'lucide-react'

export type IconSizeToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'

export interface AppIconProps extends Omit<LucideProps, 'size' | 'ref'> {
  icon: LucideIcon
  size?: IconSizeToken | number
}

export const ICON_SIZE_PX: Record<IconSizeToken, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
}

export const ICON_STROKE_WIDTH: Record<IconSizeToken, number> = {
  xs: 2,
  sm: 1.75,
  md: 1.75,
  lg: 1.5,
  xl: 1.5,
  '2xl': 1.25,
}

export function AppIcon({ icon: Icon, size = 'md', strokeWidth, ...rest }: AppIconProps) {
  const isToken = typeof size !== 'number'
  const px = isToken ? ICON_SIZE_PX[size as IconSizeToken] : size
  const defaultStrokeWidth = isToken ? ICON_STROKE_WIDTH[size as IconSizeToken] : ICON_STROKE_WIDTH.md
  return <Icon size={px} strokeWidth={strokeWidth ?? defaultStrokeWidth} {...rest} />
}
