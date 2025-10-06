import type { TerminalAttributes, TerminalColor } from '@mana/vt'
import type { RendererColor, RendererTheme } from '../types'

const clampByte = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)))

const clampAlpha = (value: number): number => Math.max(0, Math.min(1, value))

export interface ResolvedCellColors {
  readonly foreground: [number, number, number, number] | null
  readonly background: [number, number, number, number] | null
}

export const rgba = (
  r: number,
  g: number,
  b: number,
  alpha = 1,
): RendererColor =>
  `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${clampAlpha(alpha)})`

const BRIGHT_OFFSET = 8

const parseHex = (color: string): [number, number, number, number] => {
  const normalized = color.replace('#', '')
  if (normalized.length === 3) {
    const r = parseInt(normalized[0]!.repeat(2), 16)
    const g = parseInt(normalized[1]!.repeat(2), 16)
    const b = parseInt(normalized[2]!.repeat(2), 16)
    return [r, g, b, 255]
  }
  if (normalized.length === 4) {
    const r = parseInt(normalized[0]!.repeat(2), 16)
    const g = parseInt(normalized[1]!.repeat(2), 16)
    const b = parseInt(normalized[2]!.repeat(2), 16)
    const a = parseInt(normalized[3]!.repeat(2), 16)
    return [r, g, b, a]
  }
  if (normalized.length === 6 || normalized.length === 8) {
    const r = parseInt(normalized.slice(0, 2), 16)
    const g = parseInt(normalized.slice(2, 4), 16)
    const b = parseInt(normalized.slice(4, 6), 16)
    const a =
      normalized.length === 8 ? parseInt(normalized.slice(6, 8), 16) : 255
    return [r, g, b, a]
  }
  throw new Error(`Unsupported hex colour: ${color}`)
}

const parseCssRgb = (color: string): [number, number, number, number] => {
  const match = color.match(/rgba?\(([^)]+)\)/i)
  if (!match) {
    throw new Error(`Unsupported colour format: ${color}`)
  }
  const parts = match[1]!.split(',').map((part) => part.trim())
  const parseComponent = (value: string | undefined): number => {
    if (!value) {
      return 0
    }
    if (value.endsWith('%')) {
      return Math.round((parseFloat(value) / 100) * 255)
    }
    return Math.round(parseFloat(value))
  }
  const r = parseComponent(parts[0])
  const g = parseComponent(parts[1])
  const b = parseComponent(parts[2])
  const a =
    parts[3] !== undefined ? Math.round(parseFloat(parts[3]!) * 255) : 255
  return [r, g, b, a]
}

export const rendererColorToRgba = (
  color: string,
): [number, number, number, number] => {
  if (color.startsWith('#')) {
    return parseHex(color)
  }
  if (color.startsWith('rgb')) {
    return parseCssRgb(color)
  }
  throw new Error(`Unsupported renderer colour string: ${color}`)
}

export const resolveCellColorBytes = (
  attributes: TerminalAttributes,
  theme: RendererTheme,
  overrides: PaletteOverrides,
  fallbackForeground: string,
  fallbackBackground: string,
): ResolvedCellColors => {
  const resolved = resolveCellColors(
    attributes,
    theme,
    overrides,
    fallbackForeground,
    fallbackBackground,
  )

  const clamp = (value: number): number =>
    Math.max(0, Math.min(255, Math.round(value)))

  const map = (rgba: [number, number, number, number] | null) =>
    rgba ? (rgba.map(clamp) as [number, number, number, number]) : null

  const foreground = map(
    resolved.foreground ? rendererColorToRgba(resolved.foreground) : null,
  )
  const background = map(
    resolved.background ? rendererColorToRgba(resolved.background) : null,
  )

  return { foreground, background }
}

export type PaletteOverrides = Map<number, RendererColor>

export const resolvePaletteEntry = (
  palette: RendererTheme['palette'],
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
