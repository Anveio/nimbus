import type {
  TerminalCell,
  TerminalColor,
  TerminalSelection,
  TerminalState,
} from '@nimbus/vt'
import type {
  RendererConfiguration,
  RendererDirtyRegion,
  RendererFrameOverlays,
  RendererTheme,
  TerminalProfile,
} from '../types'

const createFallbackCanvas = (): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(1, 1)
  }
  if (typeof document !== 'undefined' && document?.createElement) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    return canvas
  }

  const stubContext = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    font: '12px monospace',
    globalAlpha: 1,
    setTransform: () => {},
    clearRect: () => {},
    fillRect: () => {},
    fillText: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    clip: () => {},
    measureText: () => ({ width: 0 }) as TextMetrics,
    canvas: undefined as unknown as HTMLCanvasElement,
  } as unknown as CanvasRenderingContext2D

  const stubCanvas = {
    width: 1,
    height: 1,
    getContext: (contextId: string) =>
      contextId === '2d' ? stubContext : null,
  } as unknown as HTMLCanvasElement

  ;(stubContext as { canvas: HTMLCanvasElement }).canvas = stubCanvas

  return stubCanvas
}

const terminalColorToCss = (
  color: TerminalColor,
  theme: RendererTheme,
): string => {
  switch (color.type) {
    case 'rgb':
      return `rgb(${color.r}, ${color.g}, ${color.b})`
    case 'ansi': {
      const palette = theme.palette.ansi[color.index]
      return palette ?? theme.foreground
    }
    case 'ansi-bright': {
      const palette = theme.palette.ansi[color.index + 8]
      return palette ?? theme.foreground
    }
    case 'palette': {
      const palette = theme.palette.extended?.[color.index]
      return palette ?? theme.foreground
    }
    default:
      return theme.foreground
  }
}

const terminalBackgroundToCss = (
  color: TerminalColor,
  theme: RendererTheme,
): string => {
  if (color.type === 'default') {
    return theme.background
  }
  return terminalColorToCss(color, theme)
}

const isCellSelected = (
  selection: TerminalSelection | null,
  row: number,
  column: number,
): boolean => {
  if (!selection) {
    return false
  }
  const {
    anchor: { row: anchorRow, column: anchorColumn },
    focus: { row: focusRow, column: focusColumn },
  } = selection
  const startRow = Math.min(anchorRow, focusRow)
  const endRow = Math.max(anchorRow, focusRow)
  if (row < startRow || row > endRow) {
    return false
  }
  if (startRow === endRow) {
    const minColumn = Math.min(anchorColumn, focusColumn)
    const maxColumn = Math.max(anchorColumn, focusColumn)
    return column >= minColumn && column <= maxColumn
  }
  if (row === startRow) {
    return column >= Math.min(anchorColumn, focusColumn)
  }
  if (row === endRow) {
    return column <= Math.max(anchorColumn, focusColumn)
  }
  return true
}

const buildFontString = (
  configuration: RendererConfiguration,
  bold: boolean,
  italic: boolean,
): string => {
  const parts: string[] = []
  if (italic) {
    parts.push('italic')
  }
  if (bold) {
    parts.push('bold')
  }
  const size = `${configuration.cell.height}px`
  parts.push(`${size} monospace`)
  return parts.join(' ')
}

export interface RenderResult {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
}

export class TextSurfaceRenderer {
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas
  private readonly ctx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
  private width = 1
  private height = 1

  constructor() {
    this.canvas = createFallbackCanvas()
    const context = this.canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!context) {
      throw new Error('Unable to acquire 2D context for text surface')
    }
    this.ctx = context
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) {
      return
    }
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
  }

  render(
    snapshot: TerminalState,
    configuration: RendererConfiguration,
    profile: TerminalProfile,
    overlays: RendererFrameOverlays,
    regions?: ReadonlyArray<RendererDirtyRegion> | null,
  ): RenderResult {
    const theme = profile.theme ?? {
      background: '#000000',
      foreground: '#ffffff',
      cursor: { color: '#ffffff' },
      palette: {
        ansi: Array.from({ length: 16 }, () => '#ffffff'),
      },
    }

    const ctx = this.ctx
    const width = this.width
    const height = this.height

    const logicalWidth = configuration.cssPixels.width
    const logicalHeight = configuration.cssPixels.height
    const scaleX = width / logicalWidth
    const scaleY = height / logicalHeight

    ctx.save()
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0)
    const paintCell = (
      row: number,
      column: number,
      cell: TerminalCell | undefined,
      cellWidth: number,
      cellHeight: number,
      baseline: number,
      selection: TerminalSelection | null,
    ): void => {
      const x = column * cellWidth
      const yTop = row * cellHeight
      const y = yTop + baseline
      const selected = isCellSelected(selection, row, column)

      if (selected) {
        ctx.fillStyle =
          theme.selection?.background ?? 'rgba(255, 255, 255, 0.2)'
        ctx.fillRect(x, yTop, cellWidth, cellHeight)
      } else {
        ctx.fillStyle = theme.background
        ctx.fillRect(x, yTop, cellWidth, cellHeight)
      }

      if (!cell) {
        return
      }

      const background = terminalBackgroundToCss(cell.attr.background, theme)
      if (background !== theme.background && !selected) {
        ctx.fillStyle = background
        ctx.fillRect(x, yTop, cellWidth, cellHeight)
      }

      ctx.font = buildFontString(
        configuration,
        cell.attr.bold,
        cell.attr.italic,
      )
      ctx.fillStyle = selected
        ? (theme.selection?.foreground ?? theme.background)
        : terminalColorToCss(cell.attr.foreground, theme)
      ctx.fillText(cell.char, x, y)
    }

    const paintRegion = (
      rowStart: number,
      rowEnd: number,
      columnStart: number,
      columnEnd: number,
      cellWidth: number,
      cellHeight: number,
      baseline: number,
      selection: TerminalSelection | null,
    ) => {
      const regionX = columnStart * cellWidth
      const regionY = rowStart * cellHeight
      const regionWidth = (columnEnd - columnStart) * cellWidth
      const regionHeight = (rowEnd - rowStart) * cellHeight
      ctx.clearRect(regionX, regionY, regionWidth, regionHeight)
      ctx.fillStyle = theme.background
      ctx.fillRect(regionX, regionY, regionWidth, regionHeight)

      for (let row = rowStart; row < rowEnd; row += 1) {
        const bufferRow = snapshot.buffer[row]
        for (let column = columnStart; column < columnEnd; column += 1) {
          const cell: TerminalCell | undefined = bufferRow?.[column]
          paintCell(
            row,
            column,
            cell,
            cellWidth,
            cellHeight,
            baseline,
            selection,
          )
        }
      }
    }

    const cellWidth = configuration.cell.width
    const cellHeight = configuration.cell.height
    const baseline = configuration.cell.baseline ?? cellHeight

    ctx.textBaseline = 'alphabetic'

    const selection = overlays.selection ?? snapshot.selection ?? null

    if (!regions || regions.length === 0) {
      paintRegion(
        0,
        snapshot.rows,
        0,
        snapshot.columns,
        cellWidth,
        cellHeight,
        baseline,
        selection,
      )
    } else {
      for (const region of regions) {
        paintRegion(
          region.rowStart,
          region.rowEnd,
          region.columnStart,
          region.columnEnd,
          cellWidth,
          cellHeight,
          baseline,
          selection,
        )
      }
    }

    const cursor = overlays.cursor
    if (cursor?.visible !== false) {
      const column = snapshot.cursor.column
      const row = snapshot.cursor.row
      const cursorX = column * cellWidth
      const cursorY = row * cellHeight
      ctx.fillStyle = cursor?.color ?? theme.cursor.color
      const opacity = cursor?.opacity ?? theme.cursor.opacity ?? 1
      ctx.globalAlpha = opacity
      switch (cursor?.shape ?? theme.cursor.shape ?? 'block') {
        case 'underline':
          ctx.fillRect(cursorX, cursorY + cellHeight - 2, cellWidth, 2)
          break
        case 'bar':
          ctx.fillRect(
            cursorX,
            cursorY,
            Math.max(1, cellWidth * 0.15),
            cellHeight,
          )
          break
        case 'block':
        default:
          ctx.fillRect(cursorX, cursorY, cellWidth, cellHeight)
          break
      }
      ctx.globalAlpha = 1
    }

    ctx.restore()

    return { canvas: this.canvas }
  }
}
