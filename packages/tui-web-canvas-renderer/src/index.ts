import type {
  SosPmApcKind,
  TerminalAttributes,
  TerminalCell,
  TerminalColor,
  TerminalState,
  TerminalSelection,
  TerminalUpdate,
} from '@mana-ssh/vt'
import { getSelectionRowSegments } from '@mana-ssh/vt'
import type { SelectionRowSegment } from '@mana-ssh/vt'

const createDefaultAttributes = (): TerminalAttributes => ({
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

const DEFAULT_CELL: TerminalCell = {
  char: ' ',
  attr: createDefaultAttributes(),
}

const DEFAULT_CURSOR_SHAPE: RendererCursorTheme['shape'] = 'block'
const BRIGHT_OFFSET = 8

type PaletteOverrides = Map<number, RendererColor>

interface FrameStats {
  readonly lastFrameDurationMs: number
  readonly lastDrawCallCount: number
}

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

const clampByte = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)))

const clampAlpha = (value: number): number => Math.max(0, Math.min(1, value))

const rgba = (r: number, g: number, b: number, alpha = 1): RendererColor =>
  `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${clampAlpha(alpha)})`

const resolvePaletteEntry = (
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

const terminalColorToCss = (
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

const resolveCellColors = (
  attributes: TerminalAttributes,
  theme: RendererTheme,
  overrides: PaletteOverrides,
): {
  foreground: RendererColor | null
  background: RendererColor | null
} => {
  let foreground = terminalColorToCss(
    attributes.foreground,
    theme,
    overrides,
    theme.foreground,
    false,
  )

  let background = terminalColorToCss(
    attributes.background,
    theme,
    overrides,
    theme.background,
    true,
  )

  if (attributes.inverse) {
    const resolvedForeground = foreground ?? theme.foreground
    const resolvedBackground = background ?? theme.background
    background = resolvedForeground
    foreground = resolvedBackground
  }

  if (attributes.hidden) {
    foreground = null
  }

  return { foreground, background }
}

const resolvePaletteOverrideColor = (
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

const fontString = (
  font: RendererFontMetrics,
  bold: boolean,
  italic: boolean,
): string =>
  `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${font.size}px ${font.family}`

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
  paletteOverrides: PaletteOverrides,
  layout: { logicalWidth: number; logicalHeight: number },
): FrameStats => {
  const start = now()
  let drawCalls = 0

  ctx.save()
  ctx.setTransform(
    metrics.devicePixelRatio,
    0,
    0,
    metrics.devicePixelRatio,
    0,
    0,
  )
  ctx.imageSmoothingEnabled = false
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = fontString(metrics.font, false, false)

  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, layout.logicalWidth, layout.logicalHeight)
  drawCalls += 1

  const selectionTheme = theme.selection
  const selectionSegments =
    selectionTheme && snapshot.selection
      ? getSelectionRowSegments(snapshot.selection, snapshot.columns)
      : []
  const selectionSegmentsByRow: Map<number, SelectionRowSegment> | null =
    selectionSegments.length > 0
      ? new Map(selectionSegments.map((segment) => [segment.row, segment]))
      : null

  const cellWidth = metrics.cell.width
  const cellHeight = metrics.cell.height
  let currentFont = ctx.font

  for (let row = 0; row < snapshot.rows; row += 1) {
    const bufferRow = snapshot.buffer[row]
    const selectionSegment = selectionSegmentsByRow?.get(row) ?? null
    if (selectionSegment && selectionTheme?.background) {
      const highlightX = selectionSegment.startColumn * cellWidth
      const highlightWidth =
        (selectionSegment.endColumn - selectionSegment.startColumn + 1) * cellWidth
      ctx.fillStyle = selectionTheme.background
      ctx.fillRect(highlightX, row * cellHeight, highlightWidth, cellHeight)
      drawCalls += 1
    }

    for (let column = 0; column < snapshot.columns; column += 1) {
      const cell = bufferRow?.[column] ?? DEFAULT_CELL
      const x = column * cellWidth
      const y = row * cellHeight

      const isSelected =
        selectionSegment !== null &&
        column >= selectionSegment.startColumn &&
        column <= selectionSegment.endColumn

      const { foreground, background } = resolveCellColors(
        cell.attr,
        theme,
        paletteOverrides,
      )

      let effectiveForeground = foreground
      let effectiveBackground = background

      if (isSelected) {
        if (selectionTheme?.foreground) {
          effectiveForeground = selectionTheme.foreground
        }
        effectiveBackground = null
      }

      if (effectiveBackground) {
        ctx.fillStyle = effectiveBackground
        ctx.fillRect(x, y, cellWidth, cellHeight)
        drawCalls += 1
      }

      const char = cell.char
      const shouldDrawGlyph = Boolean(char && char !== ' ' && effectiveForeground)

      if (shouldDrawGlyph) {
        const nextFont = fontString(
          metrics.font,
          cell.attr.bold,
          cell.attr.italic,
        )
        if (nextFont !== currentFont) {
          ctx.font = nextFont
          currentFont = nextFont
        }

        const previousAlpha = ctx.globalAlpha
        if (cell.attr.faint) {
          ctx.globalAlpha = previousAlpha * 0.6
        }

        if (effectiveForeground) {
          ctx.fillStyle = effectiveForeground
        }
        ctx.fillText(char!, x, y + metrics.cell.baseline)
        drawCalls += 1

        if (cell.attr.faint) {
          ctx.globalAlpha = previousAlpha
        }
      }

      const shouldDrawDecoration =
        Boolean(effectiveForeground) &&
        (cell.attr.underline !== 'none' || cell.attr.strikethrough)

      if (shouldDrawDecoration && effectiveForeground) {
        const previousAlpha = ctx.globalAlpha
        if (cell.attr.faint) {
          ctx.globalAlpha = previousAlpha * 0.6
        }

        ctx.fillStyle = effectiveForeground

        if (cell.attr.underline !== 'none') {
          const thickness = Math.max(1, Math.round(cellHeight * 0.08))
          const baseY = y + cellHeight - thickness
          ctx.fillRect(x, baseY, cellWidth, thickness)
          drawCalls += 1
          if (cell.attr.underline === 'double') {
            const gap = thickness + 2
            const secondY = Math.max(y, baseY - gap)
            ctx.fillRect(x, secondY, cellWidth, thickness)
            drawCalls += 1
          }
        }

        if (cell.attr.strikethrough) {
          const thickness = Math.max(1, Math.round(cellHeight * 0.08))
          const strikeY =
            y + Math.round(cellHeight / 2) - Math.floor(thickness / 2)
          ctx.fillRect(x, strikeY, cellWidth, thickness)
          drawCalls += 1
        }

        if (cell.attr.faint) {
          ctx.globalAlpha = previousAlpha
        }
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
  paletteOverrides: PaletteOverrides,
): FrameStats => {
  const layout = ensureDimensions(canvas, snapshot, metrics)
  return repaint(ctx, snapshot, metrics, theme, paletteOverrides, layout)
}

const ensureNotDisposed = (disposed: boolean): void => {
  if (disposed) {
    throw new Error('CanvasRenderer instance has been disposed')
  }
}

export const createCanvasRenderer: CreateCanvasRenderer = (options) => {
  const canvas = options.canvas
  const ctx = ensureContext(canvas)

  let disposed = false
  let theme = options.theme
  let metrics = options.metrics
  let currentSnapshot = options.snapshot
  const paletteOverrides: PaletteOverrides = new Map()
  let pendingDcs: {
    readonly finalByte: number
    readonly params: ReadonlyArray<number>
    readonly intermediates: ReadonlyArray<number>
    data: string
  } | null = null

  let diagnostics: CanvasRendererDiagnostics = {
    lastFrameDurationMs: null,
    lastDrawCallCount: null,
    lastOsc: null,
    lastSosPmApc: null,
    lastDcs: null,
  }

  let currentSelection: TerminalSelection | null =
    currentSnapshot.selection ?? null
  let selectionListener = options.onSelectionChange

  const emitSelectionChange = (): void => {
    selectionListener?.(currentSelection)
  }

  const applyFrameStats = (frame: FrameStats): void => {
    diagnostics = {
      ...diagnostics,
      lastFrameDurationMs: frame.lastFrameDurationMs,
      lastDrawCallCount: frame.lastDrawCallCount,
    }
  }

  applyFrameStats(
    fullRepaint(ctx, canvas, currentSnapshot, metrics, theme, paletteOverrides),
  )
  emitSelectionChange()

  const renderer: CanvasRenderer = {
    canvas,
    applyUpdates({ snapshot, updates }) {
      ensureNotDisposed(disposed)
      currentSnapshot = snapshot

      let requiresRepaint = false
      let selectionChanged = false

      for (const update of updates) {
        switch (update.type) {
          case 'cells':
          case 'clear':
          case 'cursor':
          case 'scroll':
          case 'attributes':
          case 'scroll-region':
          case 'mode':
          case 'cursor-visibility':
            requiresRepaint = true
            break
          case 'palette': {
            const nextColor = resolvePaletteOverrideColor(
              update.color,
              theme,
              paletteOverrides,
              update.index,
            )
            if (nextColor === null) {
              paletteOverrides.delete(update.index)
            } else {
              paletteOverrides.set(update.index, nextColor)
            }
            requiresRepaint = true
            break
          }
          case 'osc':
            diagnostics = {
              ...diagnostics,
              lastOsc: {
                identifier: update.identifier,
                data: update.data,
              },
            }
            break
          case 'sos-pm-apc':
            diagnostics = {
              ...diagnostics,
              lastSosPmApc: {
                kind: update.kind,
                data: update.data,
              },
            }
            break
          case 'dcs-start':
            pendingDcs = {
              finalByte: update.finalByte,
              params: [...update.params],
              intermediates: [...update.intermediates],
              data: '',
            }
            break
          case 'dcs-data':
            if (pendingDcs) {
              pendingDcs = {
                ...pendingDcs,
                data: pendingDcs.data + update.data,
              }
            }
            break
          case 'dcs-end': {
            const accumulated = pendingDcs?.data ?? ''
            diagnostics = {
              ...diagnostics,
              lastDcs: {
                finalByte: update.finalByte,
                params: [...update.params],
                intermediates: [...update.intermediates],
                data: accumulated + update.data,
              },
            }
            pendingDcs = null
            break
          }
          case 'selection-set':
          case 'selection-update':
            currentSelection = update.selection
            selectionChanged = true
            requiresRepaint = true
            break
          case 'selection-clear':
            if (currentSelection !== null) {
              currentSelection = null
              selectionChanged = true
              requiresRepaint = true
            }
            break
          default:
            requiresRepaint = true
            break
        }
      }

      const snapshotSelection = snapshot.selection ?? null
      if (!selectionChanged && snapshotSelection !== currentSelection) {
        currentSelection = snapshotSelection
        selectionChanged = true
      }

      if (requiresRepaint) {
        applyFrameStats(
          fullRepaint(
            ctx,
            canvas,
            currentSnapshot,
            metrics,
            theme,
            paletteOverrides,
          ),
        )
      }

      if (selectionChanged) {
        emitSelectionChange()
      }
    },
    resize({ snapshot, metrics: nextMetrics }) {
      ensureNotDisposed(disposed)
      metrics = nextMetrics
      currentSnapshot = snapshot
      currentSelection = snapshot.selection ?? null
      applyFrameStats(
        fullRepaint(
          ctx,
          canvas,
          currentSnapshot,
          metrics,
          theme,
          paletteOverrides,
        ),
      )
      emitSelectionChange()
    },
    setTheme(nextTheme) {
      ensureNotDisposed(disposed)
      theme = nextTheme
      applyFrameStats(
        fullRepaint(
          ctx,
          canvas,
          currentSnapshot,
          metrics,
          theme,
          paletteOverrides,
        ),
      )
    },
    sync(snapshot) {
      ensureNotDisposed(disposed)
      currentSnapshot = snapshot
      currentSelection = snapshot.selection ?? null
      applyFrameStats(
        fullRepaint(
          ctx,
          canvas,
          currentSnapshot,
          metrics,
          theme,
          paletteOverrides,
        ),
      )
      emitSelectionChange()
    },
    dispose() {
      disposed = true
      selectionListener = undefined
    },
    get diagnostics() {
      return diagnostics
    },
    get currentSelection() {
      return currentSelection
    },
    set onSelectionChange(listener) {
      selectionListener = listener
      emitSelectionChange()
    },
    get onSelectionChange() {
      return selectionListener
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
  readonly onSelectionChange?: (selection: TerminalSelection | null) => void
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
  /** Most recent OSC payload observed, if any. */
  readonly lastOsc: {
    readonly identifier: string
    readonly data: string
  } | null
  /** Most recent SOS/PM/APC payload observed, if any. */
  readonly lastSosPmApc: {
    readonly kind: SosPmApcKind
    readonly data: string
  } | null
  /** Most recent DCS payload observed, if any. */
  readonly lastDcs: {
    readonly finalByte: number
    readonly params: ReadonlyArray<number>
    readonly intermediates: ReadonlyArray<number>
    readonly data: string
  } | null
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
  readonly currentSelection: TerminalSelection | null
  onSelectionChange?: (selection: TerminalSelection | null) => void
}

export type CreateCanvasRenderer = (
  options: CanvasRendererOptions,
) => CanvasRenderer
