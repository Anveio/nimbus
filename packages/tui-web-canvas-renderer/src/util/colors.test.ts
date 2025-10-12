import type { TerminalAttributes, TerminalColor } from '@nimbus/vt'
import { describe, expect, it } from 'vitest'
import type { RendererPalette, RendererTheme } from '../types'
import {
  type PaletteOverrides,
  rendererColorToRgba,
  resolveCellColorBytes,
  resolveCellColors,
  resolvePaletteEntry,
  resolvePaletteOverrideColor,
  rgba,
  terminalColorToCss,
} from './colors'

const basePalette: RendererPalette = {
  ansi: [
    '#1a1a1a',
    '#ff0000',
    '#00ff00',
    '#ffff00',
    '#0000ff',
    '#ff00ff',
    '#00ffff',
    '#ffffff',
    '#7f7f7f',
    '#ff7f7f',
    '#7fff7f',
    '#ffff7f',
    '#7f7fff',
    '#ff7fff',
    '#7fffff',
    '#f5f5f5',
  ],
  extended: ['#101010', '#202020', '#303030'],
}

const baseTheme: RendererTheme = {
  background: '#000000',
  foreground: '#ffffff',
  cursor: { color: '#00ff00', opacity: 0.8 },
  palette: basePalette,
}

const defaultAttributes: TerminalAttributes = {
  bold: false,
  faint: false,
  italic: false,
  underline: 'none',
  blink: 'none',
  inverse: false,
  hidden: false,
  strikethrough: false,
  foreground: { type: 'default' },
  background: { type: 'default' },
}

const withColors = (
  colors: Partial<Record<'foreground' | 'background', TerminalColor>>,
): TerminalAttributes => ({
  ...defaultAttributes,
  ...colors,
})

const emptyOverrides = new Map<number, string>() satisfies PaletteOverrides

describe('rgba', () => {
  it('clamps and rounds each channel', () => {
    expect(rgba(-1.2, 127.5, 512.1, 1.8)).toBe('rgba(0, 128, 255, 1)')
  })

  it('returns normalized alpha when within range', () => {
    expect(rgba(10, 20, 30, 0.42)).toBe('rgba(10, 20, 30, 0.42)')
  })
})

describe('rendererColorToRgba', () => {
  it('parses shorthand hex colours', () => {
    expect(rendererColorToRgba('#3af')).toEqual([51, 170, 255, 255])
    expect(rendererColorToRgba('#3afc')).toEqual([51, 170, 255, 204])
  })

  it('parses long form hex colours with optional alpha', () => {
    expect(rendererColorToRgba('#123456')).toEqual([18, 52, 86, 255])
    expect(rendererColorToRgba('#12345678')).toEqual([18, 52, 86, 120])
  })

  it('parses rgb and rgba css colours including percents', () => {
    expect(rendererColorToRgba('rgb(10, 20, 30)')).toEqual([10, 20, 30, 255])
    expect(rendererColorToRgba('rgba(10, 20, 30, 0.5)')).toEqual([
      10, 20, 30, 128,
    ])
    expect(rendererColorToRgba('rgb(10%, 20%, 30%)')).toEqual([26, 51, 77, 255])
  })

  it('throws for unsupported strings', () => {
    expect(() => rendererColorToRgba('hsl(0, 100%, 50%)')).toThrowError(
      /Unsupported renderer colour string/,
    )
  })
})

describe('resolvePaletteEntry', () => {
  it('returns fallback for negative or NaN indices', () => {
    expect(
      resolvePaletteEntry(basePalette, emptyOverrides, -1, '#111111'),
    ).toBe('#111111')
    expect(
      resolvePaletteEntry(basePalette, emptyOverrides, Number.NaN, '#222222'),
    ).toBe('#222222')
  })

  it('returns override before palette entry', () => {
    const overrides: PaletteOverrides = new Map([[3, '#abcdef']])
    expect(resolvePaletteEntry(basePalette, overrides, 3, '#111111')).toBe(
      '#abcdef',
    )
  })

  it('handles ansi and extended palette entries', () => {
    expect(resolvePaletteEntry(basePalette, emptyOverrides, 1, '#111111')).toBe(
      '#ff0000',
    )
    expect(
      resolvePaletteEntry(basePalette, emptyOverrides, 18, '#111111'),
    ).toBe('#303030')
  })

  it('falls back when extended palette entry missing', () => {
    expect(
      resolvePaletteEntry(basePalette, emptyOverrides, 30, '#999999'),
    ).toBe('#999999')
  })
})

describe('terminalColorToCss', () => {
  it('returns fallback for default when not treated as null', () => {
    const color = terminalColorToCss(
      { type: 'default' },
      baseTheme,
      emptyOverrides,
      '#fedcba',
      false,
    )
    expect(color).toBe('#fedcba')
  })

  it('returns null for default when treatDefaultAsNull is true', () => {
    const color = terminalColorToCss(
      { type: 'default' },
      baseTheme,
      emptyOverrides,
      '#fedcba',
      true,
    )
    expect(color).toBeNull()
  })

  it('resolves ansi bright colours with offset and overrides', () => {
    const overrides: PaletteOverrides = new Map([[12, '#c0ffee']])
    const ansiBright = terminalColorToCss(
      { type: 'ansi-bright', index: 4 },
      baseTheme,
      emptyOverrides,
      '#fedcba',
      false,
    )
    const overriddenBright = terminalColorToCss(
      { type: 'ansi-bright', index: 4 },
      baseTheme,
      overrides,
      '#fedcba',
      false,
    )
    expect(ansiBright).toBe('#7f7fff')
    expect(overriddenBright).toBe('#c0ffee')
  })

  it('returns rgb strings for rgb terminal colours', () => {
    expect(
      terminalColorToCss(
        { type: 'rgb', r: 12, g: 24, b: 48 },
        baseTheme,
        emptyOverrides,
        '#fedcba',
        false,
      ),
    ).toBe('rgba(12, 24, 48, 1)')
  })
})

describe('resolveCellColors', () => {
  it('prefers terminal attributes and respects default background nullability', () => {
    const attributes = withColors({
      foreground: { type: 'ansi', index: 1 },
      background: { type: 'default' },
    })
    const resolved = resolveCellColors(
      attributes,
      baseTheme,
      emptyOverrides,
      '#abcabc',
      '#defdef',
    )
    expect(resolved.foreground).toBe('#ff0000')
    expect(resolved.background).toBeNull()
  })

  it('swaps foreground/background when inverse is set', () => {
    const attributes: TerminalAttributes = {
      ...withColors({
        foreground: { type: 'ansi', index: 4 },
        background: { type: 'ansi', index: 2 },
      }),
      inverse: true,
    }
    const resolved = resolveCellColors(
      attributes,
      baseTheme,
      emptyOverrides,
      '#abcabc',
      '#defdef',
    )
    expect(resolved.foreground).toBe('#00ff00')
    expect(resolved.background).toBe('#0000ff')
  })

  it('nulls foreground when hidden attribute is set', () => {
    const attributes: TerminalAttributes = {
      ...withColors({
        foreground: { type: 'ansi', index: 5 },
        background: { type: 'ansi', index: 7 },
      }),
      hidden: true,
    }
    const resolved = resolveCellColors(
      attributes,
      baseTheme,
      emptyOverrides,
      '#abcabc',
      '#defdef',
    )
    expect(resolved.foreground).toBeNull()
    expect(resolved.background).toBe('#ffffff')
  })
})

describe('resolveCellColorBytes', () => {
  it('converts resolved css colours into byte tuples', () => {
    const attributes = withColors({
      foreground: { type: 'rgb', r: 12.4, g: 128.6, b: 250.9 },
      background: { type: 'ansi', index: 3 },
    })
    const resolved = resolveCellColorBytes(
      attributes,
      baseTheme,
      emptyOverrides,
      '#010101',
      '#020202',
    )
    expect(resolved.foreground).toEqual([12, 129, 251, 255])
    expect(resolved.background).toEqual([255, 255, 0, 255])
  })

  it('returns null components when css colour resolves to null', () => {
    const attributes = withColors({
      foreground: { type: 'default' },
      background: { type: 'default' },
    })
    const resolved = resolveCellColorBytes(
      attributes,
      baseTheme,
      emptyOverrides,
      '#010101',
      '#020202',
    )
    expect(resolved.foreground).toEqual([1, 1, 1, 255])
    expect(resolved.background).toBeNull()
  })
})

describe('resolvePaletteOverrideColor', () => {
  it('returns null for default terminal colours', () => {
    expect(
      resolvePaletteOverrideColor(
        { type: 'default' },
        baseTheme,
        emptyOverrides,
        4,
      ),
    ).toBeNull()
  })

  it('resolves to override or palette entry for ansi indices', () => {
    const overrides: PaletteOverrides = new Map([[13, '#ffeeaa']])
    expect(
      resolvePaletteOverrideColor(
        { type: 'ansi-bright', index: 5 },
        baseTheme,
        emptyOverrides,
        13,
      ),
    ).toBe('#ff7fff')
    expect(
      resolvePaletteOverrideColor(
        { type: 'ansi-bright', index: 5 },
        baseTheme,
        overrides,
        13,
      ),
    ).toBe('#ffeeaa')
  })

  it('falls back to theme foreground when palette entry missing', () => {
    expect(
      resolvePaletteOverrideColor(
        { type: 'palette', index: 999 },
        baseTheme,
        emptyOverrides,
        999,
      ),
    ).toBe('#ffffff')
  })

  it('returns rgba strings for rgb terminal colours', () => {
    expect(
      resolvePaletteOverrideColor(
        { type: 'rgb', r: 9, g: 18, b: 27 },
        baseTheme,
        emptyOverrides,
        12,
      ),
    ).toBe('rgba(9, 18, 27, 1)')
  })
})
