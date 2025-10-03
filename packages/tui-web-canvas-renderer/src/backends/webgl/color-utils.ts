import type { TerminalAttributes } from '@mana/vt'
import type { RendererTheme } from '../../types'
import {
  type PaletteOverrides,
  resolveCellColors,
} from '../canvas/internal/colors'

export interface ResolvedCellColors {
  readonly foreground: [number, number, number, number] | null
  readonly background: [number, number, number, number] | null
}

const HEX_SHORT_LENGTH = 4
const HEX_LONG_LENGTH = 7
const HEX_LONG_ALPHA_LENGTH = 9

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
    const a = normalized.length === 8 ? parseInt(normalized.slice(6, 8), 16) : 255
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
  const a = parts[3] !== undefined
    ? Math.round(parseFloat(parts[3]!) * 255)
    : 255
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
    rgba ? rgba.map(clamp) as [number, number, number, number] : null

  const foreground = map(
    resolved.foreground ? rendererColorToRgba(resolved.foreground) : null,
  )
  const background = map(
    resolved.background ? rendererColorToRgba(resolved.background) : null,
  )

  return { foreground, background }
}
