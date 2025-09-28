import type {
  TerminalAttributes,
  TerminalCell,
  TerminalState,
  TerminalUpdate,
} from '@mana-ssh/vt'

const DEFAULT_CELL: TerminalCell = {
  char: ' ',
  attr: { bold: false, fg: null, bg: null },
}

const DEFAULT_CURSOR_SHAPE: RendererCursorTheme['shape'] = 'block'

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

const ensureContext = (canvas: CanvasLike): CanvasRenderingContext2D => {
  const context = canvas.getContext('2d', {
    alpha: false,
    desynchronized: false,
  })
  if (!context) {
    throw new Error('Canvas 2D context is not available')
  }
  return context
}

const ensureDimensions = (
  canvas: CanvasLike,
  snapshot: TerminalState,
  metrics: RendererMetrics,
): { logicalWidth: number; logicalHeight: number } => {
  const logicalWidth = Math.max(1, snapshot.columns * metrics.cell.width)
  const logicalHeight = Math.max(1, snapshot.rows * metrics.cell.height)
  const scaledWidth = Math.max(
    1,
    Math.round(logicalWidth * metrics.devicePixelRatio),
  )
  const scaledHeight = Math.max(
    1,
    Math.round(logicalHeight * metrics.devicePixelRatio),
  )

  if (canvas.width !== scaledWidth) {
    canvas.width = scaledWidth
  }
  if (canvas.height !== scaledHeight) {
    canvas.height = scaledHeight
  }

  return { logicalWidth, logicalHeight }
}

const resolvePaletteColor = (
  palette: RendererPalette,
  index: number,
  fallback: RendererColor,
): RendererColor => {
  if (Number.isNaN(index) || index < 0) {
    return fallback
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

const resolveForeground = (
  attributes: TerminalAttributes,
  theme: RendererTheme,
): RendererColor => {
  if (attributes.fg == null) {
    return theme.foreground
  }
  return resolvePaletteColor(theme.palette, attributes.fg, theme.foreground)
}

const resolveBackground = (
  attributes: TerminalAttributes,
  theme: RendererTheme,
): RendererColor | null => {
  if (attributes.bg == null) {
    return null
  }
  return resolvePaletteColor(theme.palette, attributes.bg, theme.background)
}

const fontString = (
  font: RendererFontMetrics,
  bold: boolean,
): string => `${bold ? 'bold ' : ''}${font.size}px ${font.family}`

const drawCursor = (
  ctx: CanvasRenderingContext2D,
  snapshot: TerminalState,
  metrics: RendererMetrics,
  theme: RendererTheme,
): void => {
  const { cursor } = snapshot
  const x = cursor.column * metrics.cell.width
  const y = cursor.row * metrics.cell.height
  const width = metrics.cell.width
  const height = metrics.cell.height
  const cursorTheme = theme.cursor
  const opacity = cursorTheme.opacity ?? 1
  const shape = cursorTheme.shape ?? DEFAULT_CURSOR_SHAPE

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = cursorTheme.color

  switch (shape) {
    case 'underline': {
      const underlineHeight = Math.max(1, height * 0.15)
      ctx.fillRect(x, y + height - underlineHeight, width, underlineHeight)
      break
    }
    case 'bar': {
      const barWidth = Math.max(1, width * 0.2)
      ctx.fillRect(x, y, barWidth, height)
      break
    }
    case 'block':
    default: {
      ctx.fillRect(x, y, width, height)
      break
    }
  }

  ctx.restore()
}

const repaint = (
  ctx: CanvasRenderingContext2D,
  snapshot: TerminalState,
  metrics: RendererMetrics,
  theme: RendererTheme,
  layout: { logicalWidth: number; logicalHeight: number },
): CanvasRendererDiagnostics => {
  const start = now()
  let drawCalls = 0

  ctx.save()
  ctx.setTransform(metrics.devicePixelRatio, 0, 0, metrics.devicePixelRatio, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = fontString(metrics.font, false)

  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, layout.logicalWidth, layout.logicalHeight)
  drawCalls += 1

  const cellWidth = metrics.cell.width
  const cellHeight = metrics.cell.height
  let currentFont = ctx.font

  for (let row = 0; row < snapshot.rows; row += 1) {
    const bufferRow = snapshot.buffer[row]
    for (let column = 0; column < snapshot.columns; column += 1) {
      const cell = bufferRow?.[column] ?? DEFAULT_CELL
      const x = column * cellWidth
      const y = row * cellHeight

      const bg = resolveBackground(cell.attr, theme)
      if (bg) {
        ctx.fillStyle = bg
        ctx.fillRect(x, y, cellWidth, cellHeight)
        drawCalls += 1
      }

      const char = cell.char
      if (char && char !== ' ') {
        const nextFont = fontString(metrics.font, cell.attr.bold)
        if (nextFont !== currentFont) {
          ctx.font = nextFont
          currentFont = nextFont
        }
        ctx.fillStyle = resolveForeground(cell.attr, theme)
        ctx.fillText(char, x, y + metrics.cell.baseline)
        drawCalls += 1
      }
    }
  }

  if (snapshot.cursorVisible) {
    drawCursor(ctx, snapshot, metrics, theme)
    drawCalls += 1
  }

  ctx.restore()
  const end = now()

  return {
    lastFrameDurationMs: end - start,
    lastDrawCallCount: drawCalls,
  }
}

const fullRepaint = (
  ctx: CanvasRenderingContext2D,
  canvas: CanvasLike,
  snapshot: TerminalState,
  metrics: RendererMetrics,
  theme: RendererTheme,
): CanvasRendererDiagnostics => {
  const layout = ensureDimensions(canvas, snapshot, metrics)
  return repaint(ctx, snapshot, metrics, theme, layout)
}

const ensureNotDisposed = (disposed: boolean): void => {
  if (disposed) {
    throw new Error('CanvasRenderer instance has been disposed')
  }
}

export const createCanvasRenderer: CreateCanvasRenderer = (
  options,
) => {
  const canvas = options.canvas
  const ctx = ensureContext(canvas)

  let disposed = false
  let theme = options.theme
  let metrics = options.metrics
  let currentSnapshot = options.snapshot
  let diagnostics: CanvasRendererDiagnostics = {
    lastFrameDurationMs: null,
    lastDrawCallCount: null,
  }

  diagnostics = fullRepaint(ctx, canvas, currentSnapshot, metrics, theme)

  const renderer: CanvasRenderer = {
    canvas,
    applyUpdates({ snapshot }) {
      ensureNotDisposed(disposed)
      currentSnapshot = snapshot
      diagnostics = fullRepaint(ctx, canvas, currentSnapshot, metrics, theme)
    },
    resize({ snapshot, metrics: nextMetrics }) {
      ensureNotDisposed(disposed)
      metrics = nextMetrics
      currentSnapshot = snapshot
      diagnostics = fullRepaint(ctx, canvas, currentSnapshot, metrics, theme)
    },
    setTheme(nextTheme) {
      ensureNotDisposed(disposed)
      theme = nextTheme
      diagnostics = fullRepaint(ctx, canvas, currentSnapshot, metrics, theme)
    },
    sync(snapshot) {
      ensureNotDisposed(disposed)
      currentSnapshot = snapshot
      diagnostics = fullRepaint(ctx, canvas, currentSnapshot, metrics, theme)
    },
    dispose() {
      disposed = true
    },
    get diagnostics() {
      return diagnostics
    },
  }

  return renderer
}

export type RendererColor = string

export interface CanvasLike {
  width: number
  height: number
  getContext(
    contextId: '2d',
    options?: CanvasRenderingContext2DSettings,
  ): CanvasRenderingContext2D | null
}

export interface RendererPalette {
  /**
   * ANSI palette (index 0–15). Consumers should provide at least 16 entries.
   */
  readonly ansi: ReadonlyArray<RendererColor>
  /**
   * Optional 256-colour extension (indices 16–255).
   */
  readonly extended?: ReadonlyArray<RendererColor>
}

export interface RendererCursorTheme {
  readonly color: RendererColor
  /**
   * Cursor opacity in the range `[0, 1]`. Defaults to `1` (opaque) when omitted.
   */
  readonly opacity?: number
  readonly shape?: 'block' | 'underline' | 'bar'
}

export interface RendererSelectionTheme {
  readonly background: RendererColor
  readonly foreground?: RendererColor
}

export interface RendererTheme {
  readonly background: RendererColor
  readonly foreground: RendererColor
  readonly cursor: RendererCursorTheme
  readonly selection?: RendererSelectionTheme
  readonly palette: RendererPalette
}

export interface RendererFontMetrics {
  /** Font family string used when configuring the 2D context. */
  readonly family: string
  /** Font size in CSS pixels. */
  readonly size: number
  /** Additional letter spacing applied between cells, in CSS pixels. */
  readonly letterSpacing: number
  /** Line height multiplier relative to the font size. */
  readonly lineHeight: number
}

export interface RendererCellMetrics {
  /** Logical cell width in CSS pixels (before DPR scaling). */
  readonly width: number
  /** Logical cell height in CSS pixels (before DPR scaling). */
  readonly height: number
  /** Baseline offset from the top of the cell, in CSS pixels. */
  readonly baseline: number
}

export interface RendererMetrics {
  /** Device pixel ratio used to scale the backing store. */
  readonly devicePixelRatio: number
  readonly font: RendererFontMetrics
  readonly cell: RendererCellMetrics
}

export interface CanvasRendererOptions {
  readonly canvas: CanvasLike
  readonly metrics: RendererMetrics
  readonly theme: RendererTheme
  /**
   * Initial interpreter snapshot used to paint the full screen buffer.
   */
  readonly snapshot: TerminalState
}

export interface CanvasRendererUpdateOptions {
  readonly snapshot: TerminalState
  readonly updates: ReadonlyArray<TerminalUpdate>
}

export interface CanvasRendererResizeOptions {
  readonly snapshot: TerminalState
  readonly metrics: RendererMetrics
}

export interface CanvasRendererDiagnostics {
  /** Last frame render duration in milliseconds. */
  readonly lastFrameDurationMs: number | null
  /** Total number of draw calls in the most recent frame. */
  readonly lastDrawCallCount: number | null
}

export interface CanvasRenderer {
  readonly canvas: CanvasLike
  applyUpdates(options: CanvasRendererUpdateOptions): void
  resize(options: CanvasRendererResizeOptions): void
  setTheme(theme: RendererTheme): void
  /** Resynchronise the canvas with the entire snapshot (full repaint). */
  sync(snapshot: TerminalState): void
  dispose(): void
  readonly diagnostics: CanvasRendererDiagnostics
}

export type CreateCanvasRenderer = (
  options: CanvasRendererOptions,
) => CanvasRenderer
