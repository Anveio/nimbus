import type { TerminalState } from '@mana/vt'
import type { CanvasLike, RendererMetrics } from '../../../types'

export interface CanvasLayout {
  readonly logicalWidth: number
  readonly logicalHeight: number
  readonly scaledWidth: number
  readonly scaledHeight: number
}

export const ensureCanvasDimensions = (
  canvas: CanvasLike,
  snapshot: TerminalState,
  metrics: RendererMetrics,
): CanvasLayout => {
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

  return {
    logicalWidth,
    logicalHeight,
    scaledWidth,
    scaledHeight,
  }
}

export const setCanvasStyleSize = (
  canvas: CanvasLike,
  layout: CanvasLayout,
): void => {
  if (typeof (canvas as HTMLCanvasElement).style === 'undefined') {
    return
  }
  const domCanvas = canvas as HTMLCanvasElement
  domCanvas.style.width = `${layout.logicalWidth}px`
  domCanvas.style.height = `${layout.logicalHeight}px`
}
