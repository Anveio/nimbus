import type {
  CreateCanvasRenderer,
  RendererCellMetrics,
  RendererCursorTheme,
  RendererFontMetrics,
  RendererMetrics,
  RendererPalette,
  RendererTheme,
} from '@mana-ssh/tui-web-canvas-renderer'
import type { TerminalInterpreter } from '@mana-ssh/vt'
import {
  createInterpreter,
  createParser,
  type ParserEvent,
  type ParserEventSink,
  resolveTerminalCapabilities,
  type TerminalState,
  type TerminalUpdate,
} from '@mana-ssh/vt'
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type TerminalRendererHandle,
  useTerminalCanvasRenderer,
} from './renderer'

const DEFAULT_ROWS = 24
const DEFAULT_COLUMNS = 80
const TEXT_ENCODER = new TextEncoder()

const DEFAULT_THEME: RendererTheme = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: { color: '#58a6ff', opacity: 1, shape: 'block' },
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
  },
}

const DEFAULT_FONT: RendererFontMetrics = {
  family: `'Fira Code', Menlo, monospace`,
  size: 14,
  letterSpacing: 0,
  lineHeight: 1.2,
}

const DEFAULT_CELL: RendererCellMetrics = {
  width: 9,
  height: 18,
  baseline: 14,
}

const DEFAULT_METRICS: RendererMetrics = {
  devicePixelRatio:
    typeof window !== 'undefined' && window.devicePixelRatio
      ? window.devicePixelRatio
      : 1,
  font: DEFAULT_FONT,
  cell: DEFAULT_CELL,
}

const mergeCursorTheme = (
  base: RendererCursorTheme,
  override?: Partial<RendererCursorTheme>,
): RendererCursorTheme => ({
  color: override?.color ?? base.color,
  opacity: override?.opacity ?? base.opacity,
  shape: override?.shape ?? base.shape,
})

const mergePalette = (
  base: RendererPalette,
  override?: Partial<RendererPalette>,
): RendererPalette => ({
  ansi: override?.ansi ?? base.ansi,
  extended: override?.extended ?? base.extended,
})

const mergeTheme = (override?: Partial<RendererTheme>): RendererTheme => ({
  background: override?.background ?? DEFAULT_THEME.background,
  foreground: override?.foreground ?? DEFAULT_THEME.foreground,
  cursor: mergeCursorTheme(DEFAULT_THEME.cursor, override?.cursor),
  selection: override?.selection,
  palette: mergePalette(DEFAULT_THEME.palette, override?.palette),
})

const mergeFont = (
  override?: Partial<RendererFontMetrics>,
): RendererFontMetrics => ({
  family: override?.family ?? DEFAULT_FONT.family,
  size: override?.size ?? DEFAULT_FONT.size,
  letterSpacing: override?.letterSpacing ?? DEFAULT_FONT.letterSpacing,
  lineHeight: override?.lineHeight ?? DEFAULT_FONT.lineHeight,
})

const mergeCell = (
  override?: Partial<RendererCellMetrics>,
): RendererCellMetrics => ({
  width: override?.width ?? DEFAULT_CELL.width,
  height: override?.height ?? DEFAULT_CELL.height,
  baseline: override?.baseline ?? DEFAULT_CELL.baseline,
})

const mergeMetrics = (override?: {
  readonly devicePixelRatio?: number
  readonly font?: Partial<RendererFontMetrics>
  readonly cell?: Partial<RendererCellMetrics>
}): RendererMetrics => ({
  devicePixelRatio:
    override?.devicePixelRatio ?? DEFAULT_METRICS.devicePixelRatio,
  font: mergeFont(override?.font),
  cell: mergeCell(override?.cell),
})

const encodeKeyEvent = (
  event: React.KeyboardEvent<HTMLDivElement>,
): Uint8Array | null => {
  if (event.metaKey) {
    return null
  }

  // Ctrl combinations (A-Z)
  if (event.ctrlKey && event.key.length === 1) {
    const upper = event.key.toUpperCase()
    const code = upper.charCodeAt(0)
    if (code >= 64 && code <= 95) {
      return new Uint8Array([code - 64])
    }
  }

  if (event.altKey && event.key.length === 1) {
    const charBytes = TEXT_ENCODER.encode(event.key)
    const buffer = new Uint8Array(charBytes.length + 1)
    buffer[0] = 0x1b
    buffer.set(charBytes, 1)
    return buffer
  }

  switch (event.key) {
    case 'Enter':
      return TEXT_ENCODER.encode('\r')
    case 'Backspace':
      return new Uint8Array([0x7f])
    case 'Tab':
      return TEXT_ENCODER.encode('\t')
    case 'ArrowUp':
      return TEXT_ENCODER.encode('\u001b[A')
    case 'ArrowDown':
      return TEXT_ENCODER.encode('\u001b[B')
    case 'ArrowRight':
      return TEXT_ENCODER.encode('\u001b[C')
    case 'ArrowLeft':
      return TEXT_ENCODER.encode('\u001b[D')
    case 'Home':
      return TEXT_ENCODER.encode('\u001b[H')
    case 'End':
      return TEXT_ENCODER.encode('\u001b[F')
    case 'PageUp':
      return TEXT_ENCODER.encode('\u001b[5~')
    case 'PageDown':
      return TEXT_ENCODER.encode('\u001b[6~')
    case 'Escape':
      return new Uint8Array([0x1b])
    default:
      break
  }

  if (event.key.length === 1 && !event.ctrlKey) {
    return TEXT_ENCODER.encode(event.key)
  }

  return null
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const createInterpreterInstance = (
  rows: number,
  columns: number,
): TerminalInterpreter => {
  const baseCapabilities = resolveTerminalCapabilities({})
  const capabilities = {
    ...baseCapabilities,
    features: {
      ...baseCapabilities.features,
      initialRows: rows,
      initialColumns: columns,
    },
  }
  return createInterpreter({ capabilities })
}

export interface TerminalHandle {
  focus(): void
  write(data: Uint8Array | string): void
  reset(): void
  getSnapshot(): TerminalState
}

export interface TerminalProps extends HTMLAttributes<HTMLDivElement> {
  readonly rows?: number
  readonly columns?: number
  readonly theme?: Partial<RendererTheme>
  readonly metrics?: {
    readonly devicePixelRatio?: number
    readonly font?: Partial<RendererFontMetrics>
    readonly cell?: Partial<RendererCellMetrics>
  }
  readonly renderer?: CreateCanvasRenderer
  readonly onData?: (data: Uint8Array) => void
  readonly onDiagnostics?: (
    diagnostics: TerminalRendererHandle['diagnostics'],
  ) => void
  readonly localEcho?: boolean
  readonly autoFocus?: boolean
  readonly autoResize?: boolean
  readonly ariaLabel?: string
  readonly canvasClassName?: string
  readonly canvasStyle?: CSSProperties
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  (
    {
      rows: rowsProp,
      columns: columnsProp,
      theme: themeOverride,
      metrics: metricsOverride,
      renderer,
      onData,
      onDiagnostics,
      localEcho = true,
      autoFocus = true,
      autoResize = true,
      ariaLabel = 'Terminal',
      className,
      canvasClassName,
      canvasStyle,
      style,
      ...rest
    },
    ref: ForwardedRef<TerminalHandle>,
  ) => {
    const theme = useMemo(() => mergeTheme(themeOverride), [themeOverride])
    const metrics = useMemo(
      () => mergeMetrics(metricsOverride),
      [metricsOverride],
    )

    const containerRef = useRef<HTMLDivElement>(null)
    const [containerSize, setContainerSize] = useState<
      { width: number; height: number } | null
    >(null)

    useEffect(() => {
      if (!autoResize) {
        setContainerSize(null)
        return undefined
      }
      const node = containerRef.current
      if (!node) {
        return
      }
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) {
          return
        }
        const { width, height } = entry.contentRect
        if (!Number.isNaN(width) && !Number.isNaN(height)) {
          setContainerSize({ width, height })
        }
      })
      observer.observe(node)
      return () => observer.disconnect()
    }, [autoResize, metrics.cell.width, metrics.cell.height])

    const fallbackWidth = (columnsProp ?? DEFAULT_COLUMNS) * metrics.cell.width
    const fallbackHeight = (rowsProp ?? DEFAULT_ROWS) * metrics.cell.height
    const effectiveSize = autoResize ? containerSize : null
    const availableWidth = effectiveSize?.width ?? fallbackWidth
    const availableHeight = effectiveSize?.height ?? fallbackHeight

    const autoColumns = Math.max(
      1,
      Math.floor(availableWidth / Math.max(metrics.cell.width, 1)),
    )
    const autoRows = Math.max(
      1,
      Math.floor(availableHeight / Math.max(metrics.cell.height, 1)),
    )

    const rows = clamp(rowsProp ?? autoRows, 1, 500)
    const columns = clamp(columnsProp ?? autoColumns, 1, 500)

    const interpreterRef = useRef<TerminalInterpreter | null>(null)
    const parserRef = useRef(createParser())

    if (!interpreterRef.current) {
      interpreterRef.current = createInterpreterInstance(rows, columns)
    }

    const interpreter = interpreterRef.current

    const [snapshotVersion, setSnapshotVersion] = useState(0)
    const snapshot = useMemo(
      () => interpreter.snapshot,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [snapshotVersion],
    )

    const rendererHandle = useTerminalCanvasRenderer({
      renderer,
      metrics,
      theme,
      snapshot,
      onDiagnostics,
    })

    useEffect(() => {
      const current = interpreterRef.current
      if (!current) {
        interpreterRef.current = createInterpreterInstance(rows, columns)
        rendererHandle.sync(interpreterRef.current.snapshot)
        setSnapshotVersion((value) => value + 1)
        return
      }

      const { rows: currentRows, columns: currentColumns } = current.snapshot
      if (currentRows === rows && currentColumns === columns) {
        return
      }

      interpreterRef.current = createInterpreterInstance(rows, columns)
      parserRef.current = createParser()
      rendererHandle.sync(interpreterRef.current.snapshot)
      setSnapshotVersion((value) => value + 1)
    }, [rows, columns, rendererHandle])

    const applyUpdates = useCallback(
      (updates: TerminalUpdate[]) => {
        if (updates.length === 0) {
          return
        }
        rendererHandle.applyUpdates({ snapshot: interpreter.snapshot, updates })
        setSnapshotVersion((value) => value + 1)
      },
      [interpreter, rendererHandle],
    )

    const handleEvent = useCallback(
      (event: ParserEvent) => {
        const updates = interpreter.handleEvent(event)
        applyUpdates(updates)
      },
      [applyUpdates, interpreter],
    )

    const sinkRef = useRef<ParserEventSink>({ onEvent: handleEvent })
    sinkRef.current.onEvent = handleEvent

    const write = useCallback((input: Uint8Array | string) => {
      const buffer =
        typeof input === 'string' ? TEXT_ENCODER.encode(input) : input
      parserRef.current.write(buffer, sinkRef.current)
      setSnapshotVersion((value) => value + 1)
    }, [])

    const focus = useCallback(() => {
      containerRef.current?.focus()
    }, [])

    const reset = useCallback(() => {
      parserRef.current.reset()
      interpreter.reset()
      rendererHandle.sync(interpreter.snapshot)
      setSnapshotVersion((value) => value + 1)
    }, [interpreter, rendererHandle])

    const emitData = useCallback(
      (bytes: Uint8Array) => {
        onData?.(bytes)
        if (!onData || localEcho) {
          write(bytes)
        }
      },
      [localEcho, onData, write],
    )

    const handleKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' && !onData) {
          event.preventDefault()
          write('\r\n')
          return
        }

        const bytes = encodeKeyEvent(event)
        if (!bytes) {
          return
        }
        event.preventDefault()
        emitData(bytes)
      },
      [emitData, onData, write],
    )

    const handlePaste = useCallback(
      (event: ReactClipboardEvent<HTMLDivElement>) => {
        const text = event.clipboardData.getData('text')
        if (!text) {
          return
        }
        event.preventDefault()
        emitData(TEXT_ENCODER.encode(text))
      },
      [emitData],
    )

    useEffect(() => {
      rendererHandle.sync(interpreter.snapshot)
      if (autoFocus) {
        focus()
      }
    }, [autoFocus, focus, interpreter, rendererHandle])

    useImperativeHandle(
      ref,
      () => ({
        focus,
        write,
        reset,
        getSnapshot: () => interpreterRef.current!.snapshot,
      }),
      [focus, reset, write],
    )

    return (
      <div
        {...rest}
        ref={containerRef}
        role="textbox"
        tabIndex={0}
        aria-label={ariaLabel}
        className={className}
        style={style}
        onClick={focus}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      >
        <canvas
          ref={rendererHandle.canvasRef as React.RefObject<HTMLCanvasElement>}
          className={canvasClassName}
          style={canvasStyle}
        />
      </div>
    )
  },
)

Terminal.displayName = 'Terminal'
