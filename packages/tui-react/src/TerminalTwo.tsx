import {
  createRendererRoot,
  type RendererConfiguration,
  type RendererRoot,
  type TerminalProfile,
  type WebglRendererSession,
} from '@mana/webgl-renderer'
import type { HTMLAttributes } from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAutoResize } from './hooks/useAutoResize'
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
  getRenderer(): WebglRendererSession | null
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

    const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
    const rootRef = useRef<RendererRoot | null>(null)
    const sessionRef = useRef<WebglRendererSession | null>(null)
    const configurationRef = useRef(configuration)
    const profileRef = useRef(profile)

    useEffect(() => {
      const element = canvas
      if (!element) {
        return
      }

      const root = createRendererRoot(element)
      rootRef.current = root
      const session = root.mount({
        configuration: configurationRef.current,
        profile: profileRef.current,
        surface: { renderRoot: element },
      })
      sessionRef.current = session

      return () => {
        if (sessionRef.current === session) {
          sessionRef.current = null
        }
        if (rootRef.current === root) {
          rootRef.current = null
        }
        root.dispose()
      }
    }, [canvas])

    useEffect(() => {
      if (!sessionRef.current) {
        return
      }
      configurationRef.current = configuration
      sessionRef.current.dispatch({
        type: 'renderer.configure',
        configuration,
      })
    }, [configuration])

    useEffect(() => {
      if (!sessionRef.current) {
        return
      }
      profileRef.current = profile
      sessionRef.current.dispatch({ type: 'profile.update', profile })
    }, [profile])

    const write = useCallback((payload: Uint8Array | string) => {
      sessionRef.current?.dispatch({ type: 'runtime.data', data: payload })
    }, [])

    useImperativeHandle(
      ref,
      () => ({ write, getRenderer: () => sessionRef.current }),
      [write],
    )

    return (
      <div
        {...rest}
        ref={containerRef}
        className={className}
        style={style}
        role={resolvedAccessibility.ariaLabel ? 'presentation' : undefined}
      >
        <canvas ref={setCanvas} />
      </div>
    )
  },
)

TerminalTwo.displayName = 'TerminalTwo'
