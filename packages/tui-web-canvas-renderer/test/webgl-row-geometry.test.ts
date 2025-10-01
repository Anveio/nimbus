import { describe, expect, it } from 'vitest'
import type {
  TerminalAttributes,
  TerminalCell,
  TerminalState,
} from '@mana-ssh/vt'
import {
  __buildRowGeometryForTests as buildRowGeometry,
} from '../src/backends/gpu-webgl'
import { ColorCache } from '../src/internal/color-cache'
import type { GlyphAtlas, GlyphInfo } from '../src/internal/glyph-atlas'
import type {
  RendererMetrics,
  RendererTheme,
} from '../src/types'

const createAttributes = (
  overrides: Partial<TerminalAttributes> = {},
): TerminalAttributes => ({
  bold: false,
  faint: false,
  italic: false,
  underline: 'none' as const,
  blink: 'none',
  inverse: false,
  hidden: false,
  strikethrough: false,
  foreground: { type: 'default' },
  background: { type: 'default' },
  ...overrides,
})

const createCell = (char: string, overrides?: Partial<TerminalAttributes>): TerminalCell => ({
  char,
  attr: createAttributes(overrides),
  protected: false,
})

const createSnapshot = (rows: number, columns: number): TerminalState => ({
  rows,
  columns,
  cursor: { row: 0, column: 0 },
  scrollTop: 0,
  scrollBottom: rows - 1,
  buffer: Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => createCell(' ')),
  ),
  attributes: createAttributes(),
  tabStops: new Set(),
  autoWrap: true,
  originMode: false,
  cursorVisible: false,
  title: '',
  clipboard: null,
  lastSosPmApc: null,
  savedCursor: null,
  savedAttributes: null,
  selection: null,
  charsets: {
    g0: 'us_ascii',
    g1: 'us_ascii',
    g2: 'us_ascii',
    g3: 'us_ascii',
    gl: 'g0',
    gr: 'g1',
    singleShift: null,
  },
  keypadApplicationMode: false,
  cursorKeysApplicationMode: false,
  smoothScroll: false,
  reverseVideo: false,
  autoRepeat: true,
  protectedMode: 'off',
  lineAttributes: Array.from({ length: rows }, () => 'single'),
  c1Transmission: '8-bit',
  answerback: 'VT100',
  printer: {
    controller: false,
    autoPrint: false,
  },
})

const metrics: RendererMetrics = {
  devicePixelRatio: 1,
  font: {
    family: 'monospace',
    size: 14,
    letterSpacing: 0,
    lineHeight: 1,
  },
  cell: {
    width: 12,
    height: 24,
    baseline: 18,
  },
}

const theme: RendererTheme = {
  background: '#000000',
  foreground: '#ffffff',
  cursor: { color: '#ff00ff', opacity: 1, shape: 'block' },
  selection: { background: '#123456', foreground: '#fedcba' },
  palette: {
    ansi: Array.from({ length: 16 }, (_, index) => `#${(index + 1).toString(16).padStart(6, '0')}`),
    extended: [],
  },
}

const glyphAtlas = {
  getGlyph: (): GlyphInfo => ({
    width: metrics.cell.width,
    height: metrics.cell.height,
    u1: 0,
    v1: 0,
    u2: 1,
    v2: 1,
  }),
} as unknown as GlyphAtlas

const colorCache = new ColorCache()

describe('buildRowGeometry', () => {
  it('emits background and glyph quads for printable characters', () => {
    const snapshot = createSnapshot(1, 2)
    snapshot.buffer[0]![0] = createCell('A')
    const geometry = buildRowGeometry(
      {
        snapshot,
        metrics,
        theme,
        paletteOverrides: new Map(),
        glyphAtlas,
        colorCache,
        fallbackForeground: theme.foreground,
        fallbackBackground: theme.background,
        includeCursor: true,
      },
      {
        row: 0,
        toClipX: (value) => (value / (snapshot.columns * metrics.cell.width)) * 2 - 1,
        toClipY: (value) => 1 - (value / (snapshot.rows * metrics.cell.height)) * 2,
        selectionSegment: null,
        selectionTheme: theme.selection,
      },
    )

    expect(geometry.glyphVertexCount).toBe(6)
    expect(geometry.glyphCount).toBe(1)
    expect(geometry.backgroundPositions.length % 12).toBe(0)
    expect(geometry.glyphPositions.length).toBe(12)
  })

  it('draws selection highlight before cell backgrounds', () => {
    const snapshot = createSnapshot(1, 2)
    snapshot.selection = {
      anchor: { row: 0, column: 0, timestamp: 1 },
      focus: { row: 0, column: 2, timestamp: 2 },
      kind: 'normal',
      status: 'idle',
    }

    const geometry = buildRowGeometry(
      {
        snapshot,
        metrics,
        theme,
        paletteOverrides: new Map(),
        glyphAtlas,
        colorCache,
        fallbackForeground: theme.foreground,
        fallbackBackground: theme.background,
        includeCursor: false,
      },
      {
        row: 0,
        toClipX: (value) => (value / (snapshot.columns * metrics.cell.width)) * 2 - 1,
        toClipY: (value) => 1 - (value / (snapshot.rows * metrics.cell.height)) * 2,
        selectionSegment: { row: 0, startColumn: 0, endColumn: 1 },
        selectionTheme: theme.selection,
      },
    )

    expect(geometry.backgroundVertexCount).toBeGreaterThan(0)
    const [r, g, b] = colorCache.get(theme.selection!.background)
    expect(geometry.backgroundColors[0]).toBeCloseTo(r)
    expect(geometry.backgroundColors[1]).toBeCloseTo(g)
    expect(geometry.backgroundColors[2]).toBeCloseTo(b)
  })

  it('adds cursor quad when cursor is visible on the row', () => {
    const snapshot = createSnapshot(1, 1)
    snapshot.cursorVisible = true
    snapshot.cursor = { row: 0, column: 0 }

    const geometry = buildRowGeometry(
      {
        snapshot,
        metrics,
        theme,
        paletteOverrides: new Map(),
        glyphAtlas,
        colorCache,
        fallbackForeground: theme.foreground,
        fallbackBackground: theme.background,
        includeCursor: true,
      },
      {
        row: 0,
        toClipX: (value) => (value / (snapshot.columns * metrics.cell.width)) * 2 - 1,
        toClipY: (value) => 1 - (value / (snapshot.rows * metrics.cell.height)) * 2,
        selectionSegment: null,
        selectionTheme: theme.selection,
      },
    )

    const cursorColor = colorCache.get(theme.cursor.color)
    const lastColorIndex = geometry.backgroundColors.length - 4
    const cursorSlice = Array.from(
      geometry.backgroundColors.slice(lastColorIndex, lastColorIndex + 4),
    )
    expect(cursorSlice).toEqual(cursorColor)
  })
})
