import type {
  RendererConfiguration,
  RendererInstance,
  TerminalProfile,
} from '@mana/webgl-renderer'
import type { HTMLAttributes } from 'react'
import { forwardRef, useCallback, useImperativeHandle, useMemo } from 'react'
import { useAutoResize } from './hooks/useAutoResize'
import { useRendererSession } from './renderer-session'
import {
  resolveAccessibilityOptions,
  resolveGraphicsOptions,
  resolveStylingOptions,
  type TerminalAccessibilityOptions,
  type TerminalGraphicsOptions,
  type TerminalStylingOptions,
} from './utils/terminal-options'

const DEFAULT_ROWS = 24
const DEFAULT_COLUMNS = 80

export interface TerminalHandle {
  write(data: Uint8Array | string): void
  getRenderer(): RendererInstance
}

export interface TerminalProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly accessibility?: TerminalAccessibilityOptions
  readonly styling?: TerminalStylingOptions
  readonly graphics?: TerminalGraphicsOptions
  readonly instrumentation?: unknown
}

export const TerminalTwo = forwardRef<TerminalHandle, TerminalProps>(
  (
    {
      accessibility: accessibilityProp,
      styling: stylingProp,
      graphics: graphicsProp,
      className,
      style,
      ...rest
    },
    ref,
  ) => {
    const resolvedAccessibility = useMemo(
      () => resolveAccessibilityOptions(accessibilityProp),
      [accessibilityProp],
    )

    const resolvedStyling = useMemo(
      () => resolveStylingOptions(stylingProp),
      [stylingProp],
    )

    const resolvedGraphics = useMemo(
      () => resolveGraphicsOptions(graphicsProp),
      [graphicsProp],
    )

    const {
      rows: rowsProp,
      columns: columnsProp,
      autoResize,
      metrics,
      theme,
    } = resolvedStyling
    const {
      width: cellWidth,
      height: cellHeight,
      baseline: cellBaseline,
    } = metrics.cell

    const { containerRef, rows, columns } = useAutoResize({
      rows: rowsProp,
      columns: columnsProp,
      autoResize: autoResize ?? true,
      defaultRows: DEFAULT_ROWS,
      defaultColumns: DEFAULT_COLUMNS,
      cellMetrics: { width: cellWidth, height: cellHeight },
    })

    const cssWidth = columns * cellWidth
    const cssHeight = rows * cellHeight
    const devicePixelRatio = metrics.devicePixelRatio ?? 1

    const configuration = useMemo<RendererConfiguration>(
      () => ({
        grid: { rows, columns },
        cssPixels: { width: cssWidth, height: cssHeight },
        devicePixelRatio,
        framebufferPixels: {
          width: Math.max(1, Math.round(cssWidth * devicePixelRatio)),
          height: Math.max(1, Math.round(cssHeight * devicePixelRatio)),
        },
        cell: {
          width: cellWidth,
          height: cellHeight,
          baseline: cellBaseline,
        },
      }),
      [
        cellBaseline,
        cellHeight,
        cellWidth,
        columns,
        cssHeight,
        cssWidth,
        devicePixelRatio,
        rows,
      ],
    )

    const profile = useMemo<TerminalProfile>(
      () => ({
        theme,
        overlays: {},
      }),
      [theme],
    )

    const session = useRendererSession({
      configuration,
      profile,
      creationKey: resolvedGraphics.renderer.backend ?? 'auto',
    })

    const { canvasRef, dispatch, renderer } = session

    const write = useCallback(
      (payload: Uint8Array | string) => {
        dispatch({ type: 'runtime.data', data: payload })
      },
      [dispatch],
    )

    const getRenderer = useCallback(() => {
      if (!renderer) {
        throw new Error('Renderer not yet initialised')
      }
      return renderer
    }, [renderer])

    useImperativeHandle(ref, () => ({ write, getRenderer }), [write, getRenderer])

    return (
      <div
        {...rest}
        ref={containerRef}
        className={className}
        style={style}
        role={resolvedAccessibility.ariaLabel ? 'presentation' : undefined}
      >
        <canvas ref={canvasRef} />
      </div>
    )
  },
)

TerminalTwo.displayName = 'TerminalTwo'
