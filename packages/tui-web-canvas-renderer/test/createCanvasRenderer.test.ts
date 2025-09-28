import type { TerminalCell, TerminalState, TerminalUpdate } from '@mana-ssh/vt'
import { createCanvas, Image } from 'canvas'
import type { Canvas } from 'canvas'
import pixelmatch from 'pixelmatch'
import { describe, expect, test } from 'vitest'
import {
  type CanvasLike,
  type CanvasRenderer,
  createCanvasRenderer,
  type RendererMetrics,
  type RendererTheme,
} from '../src/index'
import { writeComparisonArtifacts } from './utils/generate-test-artifacts'

const HEX_REGEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const hexToRgba = (hex: string): [number, number, number, number] => {
  const match = HEX_REGEX.exec(hex)

  if (!match) {
    throw new Error(`Unsupported colour format: ${hex}`)
  }

  const raw = match[1]!
  const parse = (slice: string) => Number.parseInt(slice, 16)
  const r = parse(raw.slice(0, 2))
  const g = parse(raw.slice(2, 4))
  const b = parse(raw.slice(4, 6))
  const a = raw.length === 8 ? parse(raw.slice(6, 8)) : 255
  return [r, g, b, a]
}

type TestCanvas = CanvasLike & Canvas

const createTestCanvas = (width = 1, height = 1): TestCanvas => {
  const canvas = createCanvas(width, height)
  const originalGetContext = canvas.getContext.bind(canvas)

  return Object.assign(canvas, {
    getContext(
      contextId: '2d',
      options?: CanvasRenderingContext2DSettings,
    ): CanvasRenderingContext2D | null {
      const context = originalGetContext(contextId, options)
      return context as unknown as CanvasRenderingContext2D | null
    },
  }) as unknown as TestCanvas
}

const loadImage = (buffer: Buffer): Promise<Image> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = (error) => reject(error)
    image.src = buffer
  })

/**
 * Runs a pixel-level comparison between an expected PNG buffer and the current
 * canvas contents. On mismatch we emit the raw images plus the composite
 * side-by-side artefact, then throw with a pointer to the generated files.
 */
const assertCanvasEquals = async (
  caseName: string,
  expectedBuffer: Buffer,
  actualCanvas: Canvas,
): Promise<void> => {
  const expectedImage = await loadImage(expectedBuffer)
  const width = actualCanvas.width
  const height = actualCanvas.height

  const expectedCanvas = createCanvas(width, height)
  const expectedContext = expectedCanvas.getContext('2d')
  if (!expectedContext) {
    throw new Error('Failed to create expected canvas context')
  }
  expectedContext.drawImage(expectedImage, 0, 0, width, height)
  const expectedData = expectedContext.getImageData(0, 0, width, height).data

  const actualContext = actualCanvas.getContext('2d')
  if (!actualContext) {
    throw new Error('Failed to access actual canvas context')
  }
  const actualData = actualContext.getImageData(0, 0, width, height).data

  const diffCanvas = createCanvas(width, height)
  const diffContext = diffCanvas.getContext('2d')
  if (!diffContext) {
    throw new Error('Failed to create diff canvas context')
  }
  const diffImageData = diffContext.createImageData(width, height)

  const mismatched = pixelmatch(
    expectedData,
    actualData,
    diffImageData.data,
    width,
    height,
    { threshold: 0.05 },
  )

  if (mismatched > 0) {
    diffContext.putImageData(diffImageData, 0, 0)
    const actualBuffer = actualCanvas.toBuffer('image/png')
    const diffBuffer = diffCanvas.toBuffer('image/png')
    const artifacts = await writeComparisonArtifacts({
      caseName,
      expected: expectedBuffer,
      actual: actualBuffer,
      diff: diffBuffer,
    })

    throw new Error(
      `Canvas mismatch for "${caseName}" (${mismatched} pixels). See artifacts in ${artifacts.sideBySidePath}`,
    )
  }
}

const getPixel = (
  renderer: CanvasRenderer,
  x: number,
  y: number,
): [number, number, number, number] => {
  const ctx = renderer.canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Unable to read canvas context')
  }
  const data = ctx.getImageData(x, y, 1, 1).data
  return [data[0]!, data[1]!, data[2]!, data[3]!]
}

const createTheme = (): RendererTheme => ({
  background: '#101010',
  foreground: '#f0f0f0',
  cursor: { color: '#ff00ff', opacity: 1, shape: 'block' },
  palette: {
    ansi: [
      '#000000',
      '#ff5555',
      '#50fa7b',
      '#f1fa8c',
      '#bd93f9',
      '#ff79c6',
      '#8be9fd',
      '#bbbbbb',
      '#44475a',
      '#ff6e6e',
      '#69ff94',
      '#ffffa5',
      '#d6acff',
      '#ff92df',
      '#a4ffff',
      '#ffffff',
    ],
    extended: [],
  },
})

const baseMetrics: RendererMetrics = {
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

const createBlankCell = (): TerminalCell => ({
  char: ' ',
  attr: { bold: false, fg: null, bg: null },
})

const createSnapshot = (rows: number, columns: number): TerminalState => ({
  rows,
  columns,
  cursor: { row: 0, column: 0 },
  scrollTop: 0,
  scrollBottom: rows - 1,
  buffer: Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => createBlankCell()),
  ),
  attributes: { bold: false, fg: null, bg: null },
  tabStops: new Set<number>(),
  autoWrap: true,
  originMode: false,
  cursorVisible: false,
  savedCursor: null,
  savedAttributes: null,
})

describe('createCanvasRenderer', () => {
  test('paints the initial snapshot using the theme background', async () => {
    const theme = createTheme()
    const snapshot = createSnapshot(2, 2)
    const canvas = createTestCanvas(1, 1)
    const renderer = createCanvasRenderer({
      canvas,
      metrics: baseMetrics,
      theme,
      snapshot,
    })

    const expectedCanvas = createCanvas(canvas.width, canvas.height)
    const expectedContext = expectedCanvas.getContext('2d')
    if (!expectedContext) {
      throw new Error('Failed to create expected context')
    }
    expectedContext.fillStyle = theme.background
    expectedContext.fillRect(0, 0, expectedCanvas.width, expectedCanvas.height)

    await assertCanvasEquals(
      'initial-background',
      expectedCanvas.toBuffer('image/png'),
      canvas,
    )

    expect(renderer.diagnostics.lastDrawCallCount).toBeGreaterThan(0)
    renderer.dispose()
  })

  test('applies cell updates and repaints with palette colours', async () => {
    const theme = createTheme()
    const snapshot = createSnapshot(2, 2)
    const canvas = createTestCanvas(1, 1)

    const renderer = createCanvasRenderer({
      canvas,
      metrics: baseMetrics,
      theme,
      snapshot,
    })

    const updatedCell: TerminalCell = {
      char: ' ',
      attr: { bold: false, fg: null, bg: 1 },
    }
    snapshot.buffer[0]![0] = updatedCell
    const updates: TerminalUpdate[] = [
      {
        type: 'cells',
        cells: [
          {
            row: 0,
            column: 0,
            cell: updatedCell,
          },
        ],
      },
    ]

    renderer.applyUpdates({ snapshot, updates })

    const expectedCanvas = createCanvas(canvas.width, canvas.height)
    const expectedContext = expectedCanvas.getContext('2d')
    if (!expectedContext) {
      throw new Error('Failed to create expected context')
    }
    expectedContext.fillStyle = theme.background
    expectedContext.fillRect(0, 0, expectedCanvas.width, expectedCanvas.height)
    expectedContext.fillStyle = theme.palette.ansi[1]!
    expectedContext.fillRect(0, 0, baseMetrics.cell.width, baseMetrics.cell.height)

    await assertCanvasEquals(
      'update-cell-bg',
      expectedCanvas.toBuffer('image/png'),
      canvas,
    )

    renderer.dispose()
  })

  test('renders foreground glyphs using palette colours', async () => {
    const theme = createTheme()
    const snapshot = createSnapshot(1, 1)
    snapshot.buffer[0]![0] = {
      char: 'A',
      attr: { bold: false, fg: 2, bg: null },
    }
    const canvas = createTestCanvas(1, 1)

    createCanvasRenderer({
      canvas,
      metrics: baseMetrics,
      theme,
      snapshot,
    })

    const expectedCanvas = createCanvas(canvas.width, canvas.height)
    const expectedContext = expectedCanvas.getContext('2d')
    if (!expectedContext) {
      throw new Error('Failed to create expected context')
    }
    expectedContext.fillStyle = theme.background
    expectedContext.fillRect(0, 0, expectedCanvas.width, expectedCanvas.height)
    expectedContext.font = `${baseMetrics.font.size}px ${baseMetrics.font.family}`
    expectedContext.textBaseline = 'alphabetic'
    expectedContext.fillStyle = theme.palette.ansi[2]!
    expectedContext.fillText('A', 0, baseMetrics.cell.baseline)

    await assertCanvasEquals(
      'foreground-palette',
      expectedCanvas.toBuffer('image/png'),
      canvas,
    )
  })

  test('recalculates canvas size on resize', () => {
    const theme = createTheme()
    const snapshot = createSnapshot(3, 4)
    const canvas = createTestCanvas(1, 1)

    const renderer = createCanvasRenderer({
      canvas,
      metrics: baseMetrics,
      theme,
      snapshot,
    })

    const nextMetrics: RendererMetrics = {
      ...baseMetrics,
      devicePixelRatio: 2,
      cell: { ...baseMetrics.cell, width: 16, height: 28 },
    }

    renderer.resize({ snapshot, metrics: nextMetrics })

    expect(canvas.width).toBe(snapshot.columns * nextMetrics.cell.width * 2)
    expect(canvas.height).toBe(snapshot.rows * nextMetrics.cell.height * 2)
    renderer.dispose()
  })

  test('setTheme triggers repaint with new background colour', async () => {
    const theme = createTheme()
    const snapshot = createSnapshot(2, 2)
    const canvas = createTestCanvas(1, 1)

    const renderer = createCanvasRenderer({
      canvas,
      metrics: baseMetrics,
      theme,
      snapshot,
    })

    const nextTheme: RendererTheme = {
      ...theme,
      background: '#202040',
    }

    renderer.setTheme(nextTheme)

    const expectedCanvas = createCanvas(canvas.width, canvas.height)
    const expectedContext = expectedCanvas.getContext('2d')
    if (!expectedContext) {
      throw new Error('Failed to create expected context')
    }
    expectedContext.fillStyle = nextTheme.background
    expectedContext.fillRect(0, 0, expectedCanvas.width, expectedCanvas.height)

    await assertCanvasEquals(
      'theme-background',
      expectedCanvas.toBuffer('image/png'),
      canvas,
    )

    renderer.dispose()
  })

  test('draws the cursor when visible', () => {
    const theme = createTheme()
    const snapshot = createSnapshot(2, 2)
    snapshot.cursorVisible = true
    const canvas = createTestCanvas(1, 1)

    const renderer = createCanvasRenderer({
      canvas,
      metrics: baseMetrics,
      theme,
      snapshot,
    })

    const pixel = getPixel(
      renderer,
      baseMetrics.cell.width - 1,
      baseMetrics.cell.height - 1,
    )
    const cursorColour = hexToRgba(theme.cursor.color)
    expect(pixel[0]).toBe(cursorColour[0])
    expect(pixel[1]).toBe(cursorColour[1])
    expect(pixel[2]).toBe(cursorColour[2])
    renderer.dispose()
  })

  test('throws when using the renderer after disposal', () => {
    const theme = createTheme()
    const snapshot = createSnapshot(1, 1)
    const canvas = createTestCanvas(1, 1)
    const renderer = createCanvasRenderer({
      canvas,
      metrics: baseMetrics,
      theme,
      snapshot,
    })

    renderer.dispose()
    expect(() => renderer.sync(snapshot)).toThrowError(
      'CanvasRenderer instance has been disposed',
    )
  })
})
