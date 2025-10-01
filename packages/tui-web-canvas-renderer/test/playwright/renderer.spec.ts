import path from 'node:path'
import {
  expect,
  test,
  type Page,
} from '@playwright/test'
import type {
  TerminalAttributes,
  TerminalCell,
  TerminalSelection,
  TerminalState,
  TerminalUpdate,
} from '@mana-ssh/vt'
import type {
  RendererMetrics,
  RendererTheme,
} from '../../src/types'

const HARNESS_BUNDLE = path.resolve(
  __dirname,
  'dist/harness.js',
)

const hexToRgba = (hex: string): [number, number, number, number] => {
  const normalized = hex.replace('#', '')
  if (normalized.length === 6) {
    const r = Number.parseInt(normalized.slice(0, 2), 16)
    const g = Number.parseInt(normalized.slice(2, 4), 16)
    const b = Number.parseInt(normalized.slice(4, 6), 16)
    return [r, g, b, 255]
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  const a = Number.parseInt(normalized.slice(6, 8), 16)
  return [r, g, b, a]
}

const createTheme = (): RendererTheme => ({
  background: '#101010',
  foreground: '#f0f0f0',
  cursor: { color: '#ff00ff', opacity: 1, shape: 'block' },
  selection: { background: '#123456', foreground: '#ffffff' },
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

const baseAttributes = (): TerminalAttributes => ({
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
})

const createAttributes = (
  overrides: Partial<TerminalAttributes> = {},
): TerminalAttributes => ({
  ...baseAttributes(),
  ...overrides,
})

const createBlankCell = (): TerminalCell => ({
  char: ' ',
  attr: createAttributes(),
  protected: false,
})

const createSelection = (
  anchorRow: number,
  anchorColumn: number,
  focusRow = anchorRow,
  focusColumn = anchorColumn,
): TerminalSelection => ({
  anchor: { row: anchorRow, column: anchorColumn, timestamp: 1 },
  focus: { row: focusRow, column: focusColumn, timestamp: 2 },
  kind: 'normal',
  status: 'idle',
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
  attributes: createAttributes(),
  tabStops: new Set<number>(),
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

const withHarness = async (page: Page, fn: () => Promise<void>) => {
  try {
    await fn()
  } finally {
    await page.evaluate(() => {
      window.__manaRendererTest__?.dispose()
    })
  }
}

const initRenderer = async (
  page: Page,
  options: Parameters<NonNullable<typeof window.__manaRendererTest__>['initRenderer']>[0],
) => {
  await page.evaluate((opts) => {
    window.__manaRendererTest__?.initRenderer(opts)
  }, options)
}

const applyUpdates = async (
  page: Page,
  options: Parameters<NonNullable<typeof window.__manaRendererTest__>['applyUpdates']>[0],
) => {
  await page.evaluate((opts) => {
    window.__manaRendererTest__?.applyUpdates(opts)
  }, options)
}

const resizeRenderer = async (
  page: Page,
  options: Parameters<NonNullable<typeof window.__manaRendererTest__>['resize']>[0],
) => {
  await page.evaluate((opts) => {
    window.__manaRendererTest__?.resize(opts)
  }, options)
}

const setTheme = async (page: Page, theme: RendererTheme) => {
  await page.evaluate((nextTheme) => {
    window.__manaRendererTest__?.setTheme(nextTheme)
  }, theme)
}

const syncRenderer = async (page: Page, snapshot: TerminalState) => {
  await page.evaluate((nextSnapshot) => {
    window.__manaRendererTest__?.sync(nextSnapshot)
  }, snapshot)
}

const getPixel = async (page: Page, x: number, y: number) => {
  return page.evaluate(
    ({ px, py }) => window.__manaRendererTest__!.getPixel(px, py),
    { px: x, py: y },
  )
}

const getDiagnostics = async (page: Page) => {
  return page.evaluate(() => window.__manaRendererTest__?.getDiagnostics())
}

const getSelectionEvents = async (page: Page) => {
  return page.evaluate(() => window.__manaRendererTest__?.getSelectionEvents())
}

const getOverlayEvents = async (page: Page) => {
  return page.evaluate(() => window.__manaRendererTest__?.getOverlayEvents())
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: HARNESS_BUNDLE })
  await page.goto('about:blank')
  await page.setContent('<!DOCTYPE html><html><body></body></html>')
  await page.waitForFunction(() => Boolean(window.__manaRendererTest__))
})

test.describe('createCanvasRenderer (browser)', () => {
  test('paints the initial snapshot using the theme background', async ({
    page,
  }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(2, 2)
      await initRenderer(page, {
        snapshot,
        theme,
        metrics: baseMetrics,
      })

      const pixel = await getPixel(page, 0, 0)
      const expected = hexToRgba(theme.background)
      expect(pixel[0]).toBe(expected[0])
      expect(pixel[1]).toBe(expected[1])
      expect(pixel[2]).toBe(expected[2])
    })
  })

  test('applies cell updates and repaints with palette colours', async ({
    page,
  }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(2, 2)
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      const updatedCell: TerminalCell = {
        char: ' ',
        attr: createAttributes({
          background: { type: 'ansi', index: 1 },
        }),
        protected: false,
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

      await applyUpdates(page, { snapshot, updates })

      const pixel = await getPixel(
        page,
        0,
        0,
      )
      const expected = hexToRgba(theme.palette.ansi[1]!)
      expect(pixel[0]).toBe(expected[0])
      expect(pixel[1]).toBe(expected[1])
      expect(pixel[2]).toBe(expected[2])
    })
  })

  test('renders foreground glyphs using palette colours', async ({ page }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(2, 2)
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      const updatedCell: TerminalCell = {
        char: 'A',
        attr: createAttributes({ foreground: { type: 'ansi', index: 4 } }),
        protected: false,
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

      await applyUpdates(page, { snapshot, updates })
      const { max } = await page.evaluate(({ cellWidth, cellHeight }) => {
        const canvas = document.querySelector('canvas')
        if (!canvas) {
          throw new Error('Canvas not present')
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          throw new Error('Unable to access 2D context')
        }
        const data = ctx.getImageData(0, 0, cellWidth, cellHeight).data
        let maxR = 0
        let maxG = 0
        let maxB = 0
        for (let index = 0; index < data.length; index += 4) {
          const r = data[index]!
          const g = data[index + 1]!
          const b = data[index + 2]!
          if (r + g + b > maxR + maxG + maxB) {
            maxR = r
            maxG = g
            maxB = b
          }
        }
        return { max: [maxR, maxG, maxB] as [number, number, number] }
      }, {
        cellWidth: baseMetrics.cell.width,
        cellHeight: baseMetrics.cell.height,
      })
      const expected = hexToRgba(theme.palette.ansi[4]!)
      expect(max[0]).toBeGreaterThanOrEqual(expected[0] - 5)
      expect(max[1]).toBeGreaterThanOrEqual(expected[1] - 5)
      expect(max[2]).toBeGreaterThanOrEqual(expected[2] - 5)
    })
  })

  test('recalculates canvas size on resize', async ({ page }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(2, 2)
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      snapshot.rows = 4
      snapshot.columns = 4
      snapshot.buffer = Array.from({ length: 4 }, () =>
        Array.from({ length: 4 }, () => createBlankCell()),
      )
      const nextMetrics: RendererMetrics = {
        ...baseMetrics,
        cell: {
          ...baseMetrics.cell,
          width: 10,
          height: 18,
        },
      }

      await resizeRenderer(page, {
        snapshot,
        metrics: nextMetrics,
      })

      const diagnostics = await getDiagnostics(page)
      expect(diagnostics?.lastFrameDurationMs).not.toBeNull()
    })
  })

  test('setTheme triggers repaint with new background colour', async ({
    page,
  }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(2, 2)
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      const nextTheme: RendererTheme = {
        ...theme,
        background: '#222222',
      }
      await setTheme(page, nextTheme)

      const pixel = await getPixel(page, 0, 0)
      const expected = hexToRgba(nextTheme.background)
      expect(pixel[0]).toBe(expected[0])
      expect(pixel[1]).toBe(expected[1])
      expect(pixel[2]).toBe(expected[2])
    })
  })

  test('draws the cursor when visible', async ({ page }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(2, 2)
      snapshot.cursorVisible = true
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      const pixel = await getPixel(
        page,
        baseMetrics.cell.width - 1,
        baseMetrics.cell.height - 1,
      )
      const expected = hexToRgba(theme.cursor.color)
      expect(pixel[0]).toBe(expected[0])
      expect(pixel[1]).toBe(expected[1])
      expect(pixel[2]).toBe(expected[2])
    })
  })

  test('cursor overlay draws above selection highlights', async ({ page }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(2, 2)
      snapshot.cursorVisible = true
      snapshot.selection = createSelection(0, 0, 0, 0)
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      const pixel = await getPixel(
        page,
        baseMetrics.cell.width - 1,
        baseMetrics.cell.height - 1,
      )
      const expected = hexToRgba(theme.cursor.color)
      expect(pixel[0]).toBe(expected[0])
      expect(pixel[1]).toBe(expected[1])
      expect(pixel[2]).toBe(expected[2])
    })
  })

  test('custom cursor overlay strategy receives selection context', async ({
    page,
  }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(2, 2)
      snapshot.cursorVisible = true
      snapshot.selection = createSelection(0, 0, 0, 1)
      await initRenderer(page, {
        snapshot,
        theme,
        metrics: baseMetrics,
        useCustomCursorOverlay: true,
      })

      const events = await getOverlayEvents(page)
      expect(events).toBeTruthy()
      expect(events!.length).toBe(1)
      expect(events![0]?.selection).toEqual(snapshot.selection)
    })
  })

  test('applies palette overrides from terminal updates', async ({ page }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(1, 1)
      snapshot.buffer[0]![0] = {
        char: ' ',
        attr: createAttributes({
          background: { type: 'ansi', index: 1 },
        }),
        protected: false,
      }
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      const updates: TerminalUpdate[] = [
        {
          type: 'palette',
          index: 1,
          color: { type: 'rgb', r: 0, g: 128, b: 255 },
        },
        {
          type: 'cells',
          cells: [
            {
              row: 0,
              column: 0,
              cell: snapshot.buffer[0]![0]!,
            },
          ],
        },
      ]

      await applyUpdates(page, { snapshot, updates })
      const pixel = await getPixel(page, 0, 0)
      expect(pixel[0]).toBe(0)
      expect(pixel[1]).toBe(128)
      expect(pixel[2]).toBe(255)
    })
  })

  test('tracks selection changes and notifies listeners', async ({ page }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(2, 2)
      snapshot.selection = createSelection(0, 0, 0, 1)
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      const initialEvents = await getSelectionEvents(page)
      expect(initialEvents).toBeTruthy()
      expect(initialEvents!.length).toBe(1)
      expect(initialEvents![0]).toEqual(snapshot.selection)

      const selectionBg = hexToRgba(theme.selection!.background)
      const initialPixel = await getPixel(page, 0, 0)
      expect(initialPixel[0]).toBe(selectionBg[0])
      expect(initialPixel[1]).toBe(selectionBg[1])
      expect(initialPixel[2]).toBe(selectionBg[2])

      const nextSelection = createSelection(1, 0, 1, 1)
      snapshot.selection = nextSelection
      await applyUpdates(page, {
        snapshot,
        updates: [
          { type: 'selection-update', selection: nextSelection },
        ],
      })

      const events = await getSelectionEvents(page)
      expect(events).toBeTruthy()
      expect(events!.length).toBe(2)
      expect(events![1]).toEqual(nextSelection)

      const secondRowPixel = await getPixel(page, 0, baseMetrics.cell.height)
      expect(secondRowPixel[0]).toBe(selectionBg[0])
      expect(secondRowPixel[1]).toBe(selectionBg[1])
      expect(secondRowPixel[2]).toBe(selectionBg[2])

      snapshot.selection = null
      await applyUpdates(page, {
        snapshot,
        updates: [{ type: 'selection-clear' }],
      })

      const clearedEvents = await getSelectionEvents(page)
      expect(clearedEvents).toBeTruthy()
      expect(clearedEvents![clearedEvents!.length - 1]).toBeNull()
      const background = hexToRgba(theme.background)
      const clearedPixel = await getPixel(page, 0, 0)
      expect(clearedPixel[0]).toBe(background[0])
      expect(clearedPixel[1]).toBe(background[1])
      expect(clearedPixel[2]).toBe(background[2])
    })
  })

  test('records OSC, DCS, and SOS diagnostics without forcing repaint', async ({
    page,
  }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(1, 1)
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      const updates: TerminalUpdate[] = [
        { type: 'osc', identifier: '0', data: 'window title' },
        { type: 'sos-pm-apc', kind: 'SOS', data: 'status' },
        {
          type: 'dcs-start',
          finalByte: 'q'.charCodeAt(0),
          params: [1],
          intermediates: [],
        },
        { type: 'dcs-data', data: 'payload' },
        {
          type: 'dcs-end',
          finalByte: 'q'.charCodeAt(0),
          params: [1],
          intermediates: [],
          data: '',
        },
      ]

      const before = await getDiagnostics(page)
      await applyUpdates(page, { snapshot, updates })
      const after = await getDiagnostics(page)
      expect(after).toBeTruthy()
      expect(after?.lastOsc).toEqual({ identifier: '0', data: 'window title' })
      expect(after?.lastSosPmApc).toEqual({ kind: 'SOS', data: 'status' })
      expect(after?.lastDcs).toEqual({
        finalByte: 'q'.charCodeAt(0),
        params: [1],
        intermediates: [],
        data: 'payload',
      })
      expect(after?.lastDrawCallCount).toBe(before?.lastDrawCallCount)
    })
  })

  test('throws when using the renderer after disposal', async ({ page }) => {
    await withHarness(page, async () => {
      const theme = createTheme()
      const snapshot = createSnapshot(1, 1)
      await initRenderer(page, { snapshot, theme, metrics: baseMetrics })

      await page.evaluate(() => {
        window.__manaRendererTest__?.dispose()
      })

      await expect(
        page.evaluate(() => {
          window.__manaRendererTest__?.sync(null as unknown as TerminalState)
        }),
      ).rejects.toThrow()
    })
  })
})
