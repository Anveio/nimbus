import type { RendererColor } from '../../../types'

export type ColorTuple = [number, number, number, number]

const HEX_REGEX =
  /^#(?:([\da-fA-F]{2})([\da-fA-F]{2})([\da-fA-F]{2})([\da-fA-F]{2})?|([\da-fA-F])([\da-fA-F])([\da-fA-F]))$/
const RGBA_REGEX =
  /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const normaliseByte = (value: number): number => clamp(value / 255, 0, 1)

const normaliseAlpha = (value: number): number => clamp(value, 0, 1)

const parseHex = (input: string): ColorTuple | null => {
  const match = HEX_REGEX.exec(input)
  if (!match) {
    return null
  }
  if (match[1] && match[2] && match[3]) {
    const r = parseInt(match[1]!, 16)
    const g = parseInt(match[2]!, 16)
    const b = parseInt(match[3]!, 16)
    const a = match[4] ? parseInt(match[4]!, 16) : 255
    return [
      normaliseByte(r),
      normaliseByte(g),
      normaliseByte(b),
      normaliseByte(a),
    ]
  }
  if (match[5] && match[6] && match[7]) {
    const r = parseInt(match[5]!, 16)
    const g = parseInt(match[6]!, 16)
    const b = parseInt(match[7]!, 16)
    return [
      normaliseByte(r * 17),
      normaliseByte(g * 17),
      normaliseByte(b * 17),
      1,
    ]
  }
  return null
}

const parseRgba = (input: string): ColorTuple | null => {
  const match = RGBA_REGEX.exec(input)
  if (!match) {
    return null
  }
  const r = parseFloat(match[1]!)
  const g = parseFloat(match[2]!)
  const b = parseFloat(match[3]!)
  const a = match[4] !== undefined ? parseFloat(match[4]!) : 1
  return [
    normaliseByte(r),
    normaliseByte(g),
    normaliseByte(b),
    normaliseAlpha(a),
  ]
}

const FALLBACK: ColorTuple = [1, 1, 1, 1]

export class ColorCache {
  private readonly cache = new Map<RendererColor, ColorTuple>()

  get(color: RendererColor): ColorTuple {
    const cached = this.cache.get(color)
    if (cached) {
      return cached
    }

    const parsed =
      parseHex(color) ??
      parseRgba(color) ??
      (color === 'transparent' ? ([0, 0, 0, 0] as ColorTuple) : null)

    const tuple = parsed ?? FALLBACK
    this.cache.set(color, tuple)
    return tuple
  }

  clear(): void {
    this.cache.clear()
  }
}
