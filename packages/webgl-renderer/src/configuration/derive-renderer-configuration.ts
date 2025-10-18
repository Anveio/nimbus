import type { RendererConfiguration } from '../types'

export interface RendererConfigurationController {
  readonly configuration: RendererConfiguration | null
  refresh(): RendererConfiguration
  subscribe(listener: (configuration: RendererConfiguration) => void): () => void
  dispose(): void
}

export interface DeriveRendererConfigurationOptions {
  readonly surfaceDensity?: number
  readonly minimumGrid?: {
    readonly rows?: number
    readonly columns?: number
  }
  readonly measurementText?: string
  readonly measureCellMetrics?: (input: {
    readonly canvas: HTMLCanvasElement
    readonly computedStyle: CSSStyleDeclaration
    readonly measurementText: string
  }) => {
    readonly width: number
    readonly height: number
    readonly baseline: number
  }
}

const DEFAULT_MEASUREMENT_TEXT = 'MMMMMMMMMM'
const EPSILON = 0.001

const toPixels = (value: string, fallback: number): number => {
  if (!value) {
    return fallback
  }
  if (value === 'normal') {
    return fallback
  }
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const buildFontString = (style: CSSStyleDeclaration): string => {
  if (style.font) {
    return style.font
  }
  const fontStyle = style.fontStyle || 'normal'
  const fontVariant = style.fontVariant || 'normal'
  const fontWeight = style.fontWeight || 'normal'
  const fontSize = style.fontSize || '16px'
  const lineHeight =
    style.lineHeight && style.lineHeight !== 'normal'
      ? `/${style.lineHeight}`
      : ''
  const fontFamily = style.fontFamily || 'monospace'
  return `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize}${lineHeight} ${fontFamily}`
}

const defaultMeasureCellMetrics = (input: {
  readonly canvas: HTMLCanvasElement
  readonly computedStyle: CSSStyleDeclaration
  readonly measurementText: string
}): { readonly width: number; readonly height: number; readonly baseline: number } => {
  const measurementText =
    input.measurementText.length > 0
      ? input.measurementText
      : DEFAULT_MEASUREMENT_TEXT
  const ownerDocument = input.canvas.ownerDocument ?? document

  const fontSizePx = toPixels(input.computedStyle.fontSize, 16)
  const fallbackHeight = toPixels(
    input.computedStyle.lineHeight,
    Math.round(fontSizePx * 1.2),
  )

  try {
    const measurementCanvas = ownerDocument.createElement('canvas')
    const context = measurementCanvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas 2D context unavailable')
    }
    context.font = buildFontString(input.computedStyle)
    const metrics = context.measureText(measurementText)
    const glyphCount = Math.max(1, measurementText.length)
    const width = metrics.width / glyphCount
    const ascent =
      metrics.actualBoundingBoxAscent && Number.isFinite(metrics.actualBoundingBoxAscent)
        ? metrics.actualBoundingBoxAscent
        : fontSizePx
    const descent =
      metrics.actualBoundingBoxDescent &&
      Number.isFinite(metrics.actualBoundingBoxDescent)
        ? metrics.actualBoundingBoxDescent
        : Math.max(0, fallbackHeight - ascent)
    const baseline = ascent
    const height = ascent + descent
    return {
      width: width > EPSILON ? width : fontSizePx,
      height: height > EPSILON ? height : fallbackHeight,
      baseline: baseline > EPSILON ? baseline : fontSizePx,
    }
  } catch {
    return {
      width: fontSizePx,
      height: fallbackHeight,
      baseline: fontSizePx,
    }
  }
}

const clampPositive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

const areConfigurationsEqual = (
  a: RendererConfiguration | null,
  b: RendererConfiguration,
): boolean => {
  if (!a) {
    return false
  }
  if (
    a.surfaceDensity !== b.surfaceDensity ||
    Math.abs(a.surfaceDimensions.width - b.surfaceDimensions.width) > EPSILON ||
    Math.abs(a.surfaceDimensions.height - b.surfaceDimensions.height) > EPSILON ||
    a.surfaceOrientation !== b.surfaceOrientation
  ) {
    return false
  }
  if (
    a.grid.rows !== b.grid.rows ||
    a.grid.columns !== b.grid.columns ||
    Math.abs(a.cell.width - b.cell.width) > EPSILON ||
    Math.abs(a.cell.height - b.cell.height) > EPSILON ||
    Math.abs((a.cell.baseline ?? 0) - (b.cell.baseline ?? 0)) > EPSILON
  ) {
    return false
  }
  if (a.framebufferPixels && b.framebufferPixels) {
    if (
      Math.abs(a.framebufferPixels.width - b.framebufferPixels.width) > EPSILON ||
      Math.abs(a.framebufferPixels.height - b.framebufferPixels.height) > EPSILON
    ) {
      return false
    }
  } else if (a.framebufferPixels || b.framebufferPixels) {
    return false
  }
  return true
}

const scheduleMicrotask = (callback: () => void): void => {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(callback)
    return
  }
  Promise.resolve()
    .then(callback)
    .catch(() => {
      /* no-op */
    })
}

export const deriveRendererConfiguration = (
  canvas: HTMLCanvasElement,
  options: DeriveRendererConfigurationOptions = {},
): RendererConfigurationController => {
  const listeners = new Set<(configuration: RendererConfiguration) => void>()

  let disposed = false
  let configuration: RendererConfiguration | null = null
  let resizeObserver: ResizeObserver | null = null
  let windowResizeListener: (() => void) | null = null

  const measure = (): RendererConfiguration => {
    const ownerDocument = canvas.ownerDocument ?? document
    const defaultSurfaceDensity =
      typeof ownerDocument.defaultView !== 'undefined' &&
      ownerDocument.defaultView
        ? ownerDocument.defaultView.devicePixelRatio ?? 1
        : 1
    const surfaceDensity =
      options.surfaceDensity ?? clampPositive(defaultSurfaceDensity, 1)

    const rect = canvas.getBoundingClientRect?.()
    const cssWidth = clampPositive(
      rect?.width ?? canvas.clientWidth ?? canvas.width ?? 0,
      1,
    )
    const cssHeight = clampPositive(
      rect?.height ?? canvas.clientHeight ?? canvas.height ?? 0,
      1,
    )

    const framebufferWidth = clampPositive(
      Math.round(cssWidth * surfaceDensity),
      1,
    )
    const framebufferHeight = clampPositive(
      Math.round(cssHeight * surfaceDensity),
      1,
    )

    const computedStyle =
      ownerDocument.defaultView?.getComputedStyle(canvas) ??
      ({} as CSSStyleDeclaration)

    const measurementText =
      options.measurementText ?? DEFAULT_MEASUREMENT_TEXT

    const cellMetrics = (options.measureCellMetrics ?? defaultMeasureCellMetrics)(
      {
        canvas,
        computedStyle,
        measurementText,
      },
    )

    const minimumRows = options.minimumGrid?.rows ?? 1
    const minimumColumns = options.minimumGrid?.columns ?? 1

    const columns = Math.max(
      minimumColumns,
      Math.floor(cssWidth / Math.max(cellMetrics.width, EPSILON)),
    )
    const rows = Math.max(
      minimumRows,
      Math.floor(cssHeight / Math.max(cellMetrics.height, EPSILON)),
    )

    let surfaceOrientation: RendererConfiguration['surfaceOrientation']
    if (Math.abs(cssWidth - cssHeight) <= EPSILON) {
      surfaceOrientation = 'square'
    } else if (cssWidth > cssHeight) {
      surfaceOrientation = 'landscape'
    } else {
      surfaceOrientation = 'portrait'
    }

    return Object.freeze({
      grid: {
        rows: rows > 0 ? rows : minimumRows,
        columns: columns > 0 ? columns : minimumColumns,
      },
      surfaceDimensions: {
        width: cssWidth,
        height: cssHeight,
      },
      surfaceDensity,
      surfaceOrientation,
      framebufferPixels: {
        width: framebufferWidth,
        height: framebufferHeight,
      },
      cell: {
        width: cellMetrics.width,
        height: cellMetrics.height,
        baseline: cellMetrics.baseline,
      },
    })
  }

  const publish = (next: RendererConfiguration): RendererConfiguration => {
    if (!areConfigurationsEqual(configuration, next)) {
      configuration = next
      for (const listener of listeners) {
        listener(next)
      }
    }
    return configuration ?? next
  }

  const refresh = (): RendererConfiguration => {
    const next = measure()
    return publish(next)
  }

  const scheduleRefresh = () => {
    if (disposed) {
      return
    }
    scheduleMicrotask(() => {
      if (disposed) {
        return
      }
      refresh()
    })
  }

  const subscribe = (
    listener: (configuration: RendererConfiguration) => void,
  ): (() => void) => {
    listeners.add(listener)
    if (configuration) {
      listener(configuration)
    }
    return () => {
      listeners.delete(listener)
    }
  }

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    listeners.clear()
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (windowResizeListener && canvas.ownerDocument?.defaultView) {
      canvas.ownerDocument.defaultView.removeEventListener(
        'resize',
        windowResizeListener,
      )
      windowResizeListener = null
    }
  }

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      scheduleRefresh()
    })
    resizeObserver.observe(canvas)
  } else if (canvas.ownerDocument?.defaultView) {
    const handler = () => {
      scheduleRefresh()
    }
    windowResizeListener = handler
    canvas.ownerDocument.defaultView.addEventListener('resize', handler)
  }

  const documentFonts = canvas.ownerDocument?.fonts
  if (documentFonts && typeof documentFonts.ready?.then === 'function') {
    documentFonts
      .ready.then(() => {
        scheduleRefresh()
      })
      .catch(() => {
        /* no-op */
      })
  }

  scheduleRefresh()

  return {
    get configuration() {
      return configuration
    },
    refresh,
    subscribe,
    dispose,
  }
}
