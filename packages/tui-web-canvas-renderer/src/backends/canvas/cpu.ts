import type {
  SelectionRowSegment,
  TerminalAttributes,
  TerminalCell,
  TerminalSelection,
  TerminalState,
} from '@nimbus/vt'
import { getSelectionRowSegments } from '@nimbus/vt'
import type {
  CanvasLike,
  CanvasRenderer,
  CanvasRendererDiagnostics,
  CanvasRendererOptions,
  CursorOverlayStrategy,
  RendererCursorTheme,
  RendererMetrics,
  RendererTheme,
} from '../../types'
import {
  type PaletteOverrides,
  resolveCellColors,
  resolvePaletteOverrideColor,
} from '../../util/colors'
import { fontString } from '../../util/fonts'
import { hashFrameBytes } from '../../util/frame-hash'
import { ensureCanvasDimensions, setCanvasStyleSize } from './internal/layout'

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
  protected: false,
}

const DEFAULT_CURSOR_SHAPE: RendererCursorTheme['shape'] = 'block'

const updateBackendAttribute = (canvas: CanvasLike, backend: string): void => {
  if (typeof (canvas as HTMLCanvasElement).dataset === 'undefined') {
    return
  }
  const element = canvas as HTMLCanvasElement
  element.dataset.nimbusRendererBackend = backend
  element.dataset.manaRendererBackend = backend
}

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

const defaultCursorOverlay: CursorOverlayStrategy = ({
  ctx,
  snapshot,
  metrics,
  theme,
}) => {
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
  cursorOverlayStrategy: CursorOverlayStrategy,
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

  const reverseVideo = Boolean(snapshot.reverseVideo)
  const fallbackForeground = reverseVideo ? theme.background : theme.foreground
  const fallbackBackground = reverseVideo ? theme.foreground : theme.background

  ctx.fillStyle = fallbackBackground
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
        (selectionSegment.endColumn - selectionSegment.startColumn + 1) *
        cellWidth
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
        fallbackForeground,
        fallbackBackground,
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
      const shouldDrawGlyph = Boolean(
        char && char !== ' ' && effectiveForeground,
      )

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
    cursorOverlayStrategy({
      ctx,
      snapshot,
      metrics,
      theme,
      selection: snapshot.selection ?? null,
    })
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
  cursorOverlayStrategy: CursorOverlayStrategy,
): FrameStats => {
  const layout = ensureCanvasDimensions(canvas, snapshot, metrics)
  setCanvasStyleSize(canvas, layout)
  return repaint(
    ctx,
    snapshot,
    metrics,
    theme,
    paletteOverrides,
    layout,
    cursorOverlayStrategy,
  )
}

const ensureNotDisposed = (disposed: boolean): void => {
  if (disposed) {
    throw new Error('CanvasRenderer instance has been disposed')
  }
}

export const createCpuCanvasRenderer = (
  options: CanvasRendererOptions,
): CanvasRenderer => {
  const canvas = options.canvas
  const ctx = ensureContext(canvas)
  updateBackendAttribute(canvas, 'cpu-2d')

  let disposed = false
  let theme = options.theme
  let metrics = options.metrics
  let currentSnapshot = options.snapshot
  const paletteOverrides: PaletteOverrides = new Map()
  const cursorOverlayStrategy: CursorOverlayStrategy =
    options.cursorOverlayStrategy ?? defaultCursorOverlay
  let pendingDcs: {
    readonly finalByte: number
    readonly params: ReadonlyArray<number>
    readonly intermediates: ReadonlyArray<number>
    data: string
  } | null = null

  let diagnostics: CanvasRendererDiagnostics = {
    lastFrameDurationMs: null,
    lastDrawCallCount: null,
    gpuFrameDurationMs: null,
    gpuDrawCallCount: null,
    lastOsc: null,
    lastSosPmApc: null,
    lastDcs: null,
    frameHash: undefined,
  }

  const captureFrameHash = Boolean(options.captureDiagnosticsFrame)

  const refreshFrameHash = (): void => {
    if (!captureFrameHash) {
      diagnostics = { ...diagnostics, frameHash: undefined }
      return
    }
    const width = canvas.width || 0
    const height = canvas.height || 0
    if (width === 0 || height === 0) {
      diagnostics = {
        ...diagnostics,
        frameHash: hashFrameBytes(new Uint8Array(0), width, height),
      }
      return
    }
    const data = ctx.getImageData(0, 0, width, height).data
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    diagnostics = {
      ...diagnostics,
      frameHash: hashFrameBytes(bytes, width, height),
    }
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
    refreshFrameHash()
  }

  applyFrameStats(
    fullRepaint(
      ctx,
      canvas,
      currentSnapshot,
      metrics,
      theme,
      paletteOverrides,
      cursorOverlayStrategy,
    ),
  )
  emitSelectionChange()

  const renderer: CanvasRenderer = {
    canvas,
    applyUpdates({
      snapshot,
      updates,
      metrics: nextMetrics,
      theme: nextTheme,
    }) {
      ensureNotDisposed(disposed)
      const pendingUpdates = updates ?? []

      const metricsChanged = typeof nextMetrics !== 'undefined'
      const themeChanged = typeof nextTheme !== 'undefined'

      if (metricsChanged) {
        metrics = nextMetrics
      }
      if (themeChanged) {
        theme = nextTheme
      }
      currentSnapshot = snapshot

      let requiresRepaint = metricsChanged || themeChanged
      let selectionChanged = metricsChanged

      for (const update of pendingUpdates) {
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
          case 'response':
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
      if (metricsChanged) {
        currentSelection = snapshotSelection
      } else if (!selectionChanged && snapshotSelection !== currentSelection) {
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
            cursorOverlayStrategy,
          ),
        )
      }

      if (selectionChanged) {
        emitSelectionChange()
      }
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
          cursorOverlayStrategy,
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
