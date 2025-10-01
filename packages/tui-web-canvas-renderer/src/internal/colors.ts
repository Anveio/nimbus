import type { TerminalAttributes, TerminalColor } from '@mana/vt'
import type { RendererColor, RendererPalette, RendererTheme } from '../types'

const clampByte = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)))

const clampAlpha = (value: number): number => Math.max(0, Math.min(1, value))

export const rgba = (
  r: number,
  g: number,
  b: number,
  alpha = 1,
): RendererColor =>
  `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${clampAlpha(alpha)})`

const BRIGHT_OFFSET = 8

export type PaletteOverrides = Map<number, RendererColor>

export const resolvePaletteEntry = (
  palette: RendererPalette,
  overrides: PaletteOverrides,
  index: number,
  fallback: RendererColor,
): RendererColor => {
  if (Number.isNaN(index) || index < 0) {
    return fallback
  }
  const override = overrides.get(index)
  if (override) {
    return override
  }
  if (index < palette.ansi.length) {
    return palette.ansi[index] ?? fallback
  }
  const extendedIndex = index - 16
  if (extendedIndex >= 0 && palette.extended) {
    return palette.extended[extendedIndex] ?? fallback
  }
  return fallback
}

export const terminalColorToCss = (
  color: TerminalColor,
  theme: RendererTheme,
  overrides: PaletteOverrides,
  fallback: RendererColor,
  treatDefaultAsNull: boolean,
): RendererColor | null => {
  switch (color.type) {
    case 'default':
      return treatDefaultAsNull ? null : fallback
    case 'ansi':
      return resolvePaletteEntry(
        theme.palette,
        overrides,
        color.index,
        fallback,
      )
    case 'ansi-bright':
      return resolvePaletteEntry(
        theme.palette,
        overrides,
        color.index + BRIGHT_OFFSET,
        fallback,
      )
    case 'palette':
      return resolvePaletteEntry(
        theme.palette,
        overrides,
        color.index,
        fallback,
      )
    case 'rgb':
      return rgba(color.r, color.g, color.b)
    default:
      return fallback
  }
}

export const resolveCellColors = (
  attributes: TerminalAttributes,
  theme: RendererTheme,
  overrides: PaletteOverrides,
  fallbackForeground: RendererColor,
  fallbackBackground: RendererColor,
): {
  foreground: RendererColor | null
  background: RendererColor | null
} => {
  let foreground = terminalColorToCss(
    attributes.foreground,
    theme,
    overrides,
    fallbackForeground,
    false,
  )

  let background = terminalColorToCss(
    attributes.background,
    theme,
    overrides,
    fallbackBackground,
    true,
  )

  const invert = attributes.inverse
  if (invert) {
    const resolvedForeground = foreground ?? fallbackForeground
    const resolvedBackground = background ?? fallbackBackground
    background = resolvedForeground
    foreground = resolvedBackground
  }

  if (attributes.hidden) {
    foreground = null
  }

  return { foreground, background }
}

export const resolvePaletteOverrideColor = (
  color: TerminalColor,
  theme: RendererTheme,
  overrides: PaletteOverrides,
  index: number,
): RendererColor | null => {
  switch (color.type) {
    case 'default':
      return null
    case 'ansi':
      return resolvePaletteEntry(
        theme.palette,
        overrides,
        color.index,
        theme.foreground,
      )
    case 'ansi-bright':
      return resolvePaletteEntry(
        theme.palette,
        overrides,
        color.index + BRIGHT_OFFSET,
        theme.foreground,
      )
    case 'palette':
      return resolvePaletteEntry(
        theme.palette,
        overrides,
        color.index,
        theme.foreground,
      )
    case 'rgb':
      return rgba(color.r, color.g, color.b)
    default:
      return resolvePaletteEntry(
        theme.palette,
        overrides,
        index,
        theme.foreground,
      )
  }
}
