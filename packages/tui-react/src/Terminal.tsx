import type {
  CreateCanvasRenderer,
  CursorOverlayStrategy,
  RendererCellMetrics,
  RendererCursorTheme,
  RendererFontMetrics,
  RendererMetrics,
  RendererPalette,
  RendererSelectionTheme,
  RendererTheme,
} from '@mana-ssh/tui-web-canvas-renderer'
import type { TerminalInterpreter } from '@mana-ssh/vt'
import {
  createInterpreter,
  createParser,
  getSelectionRowSegments,
  isSelectionCollapsed,
  type ParserEvent,
  type ParserEventSink,
  resolveTerminalCapabilities,
  type SelectionPoint,
  type TerminalSelection,
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
  selection: { background: '#264f78', foreground: '#ffffff' },
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

const extractSelectionText = (
  state: TerminalState,
  selection: TerminalSelection,
): string => {
  const segments = getSelectionRowSegments(selection, state.columns)
  if (segments.length === 0) {
    return ''
  }

  const lines: string[] = []
  let currentRow = segments[0]!.row
  let currentLine = ''

  const flushLine = () => {
    lines.push(currentLine)
    currentLine = ''
  }

  for (const segment of segments) {
    if (segment.row !== currentRow) {
      flushLine()
      currentRow = segment.row
    }

    const rowCells = state.buffer[segment.row] ?? []
    for (
      let column = segment.startColumn;
      column <= segment.endColumn;
      column += 1
    ) {
      const cell = rowCells[column]
      currentLine += cell?.char ?? ' '
    }
  }

  flushLine()
  return lines.join('\n')
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

const mergeSelectionTheme = (
  base: RendererSelectionTheme | undefined,
  override?: RendererSelectionTheme,
): RendererSelectionTheme | undefined => {
  if (!base && !override) {
    return undefined
  }
  const resolvedBackground = override?.background ?? base?.background
  const resolvedForeground =
    override && Object.prototype.hasOwnProperty.call(override, 'foreground')
      ? override.foreground
      : base?.foreground

  if (!resolvedBackground) {
    return undefined
  }

  const theme: RendererSelectionTheme = {
    background: resolvedBackground,
  }

  if (resolvedForeground !== undefined) {
    theme.foreground = resolvedForeground
  }

  return theme
}

const mergeTheme = (override?: Partial<RendererTheme>): RendererTheme => ({
  background: override?.background ?? DEFAULT_THEME.background,
  foreground: override?.foreground ?? DEFAULT_THEME.foreground,
  cursor: mergeCursorTheme(DEFAULT_THEME.cursor, override?.cursor),
  selection: mergeSelectionTheme(DEFAULT_THEME.selection, override?.selection),
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
  getSelection(): TerminalSelection | null
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
  readonly cursorOverlayStrategy?: CursorOverlayStrategy
  readonly onData?: (data: Uint8Array) => void
  readonly onDiagnostics?: (
    diagnostics: TerminalRendererHandle['diagnostics'],
  ) => void
  readonly onCursorSelectionChange?: (
    selection: TerminalSelection | null,
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
      cursorOverlayStrategy,
      onData,
      onDiagnostics,
      onCursorSelectionChange,
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
    const [containerSize, setContainerSize] = useState<{
      width: number
      height: number
    } | null>(null)

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

    const [currentSelection, setCurrentSelection] =
      useState<TerminalSelection | null>(interpreter.snapshot.selection ?? null)

    const [snapshotVersion, setSnapshotVersion] = useState(0)
    const snapshot = useMemo(
      () => interpreter.snapshot,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [snapshotVersion],
    )

    const handleSelectionChange = useCallback(
      (selection: TerminalSelection | null) => {
        setCurrentSelection(selection)
        onCursorSelectionChange?.(selection)
      },
      [onCursorSelectionChange],
    )

    const rendererHandle = useTerminalCanvasRenderer({
      renderer,
      metrics,
      theme,
      snapshot,
      onDiagnostics,
      onSelectionChange: handleSelectionChange,
      cursorOverlayStrategy,
    })

    const keyboardSelectionAnchorRef = useRef<SelectionPoint | null>(null)
    const pointerSelectionRef = useRef<{
      pointerId: number | null
      anchor: TerminalSelection['anchor'] | null
      lastSelection: TerminalSelection | null
    }>({ pointerId: null, anchor: null, lastSelection: null })

    const autoScrollRef = useRef<{
      timer: number | null
      direction: -1 | 0 | 1
    }>({
      timer: null,
      direction: 0,
    })

    const stopAutoScroll = useCallback(() => {
      const current = autoScrollRef.current
      if (current.timer !== null) {
        window.clearInterval(current.timer)
      }
      autoScrollRef.current = { timer: null, direction: 0 }
    }, [])

    const getPointerMetrics = useCallback(
      (event: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const offsetX = event.clientX - rect.left
        const offsetY = event.clientY - rect.top
        const column = clamp(
          Math.floor(offsetX / Math.max(metrics.cell.width, 1)),
          0,
          columns - 1,
        )
        const row = clamp(
          Math.floor(offsetY / Math.max(metrics.cell.height, 1)),
          0,
          rows - 1,
        )
        return { row, column, offsetX, offsetY, rect }
      },
      [columns, metrics.cell.height, metrics.cell.width, rows],
    )

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

    const clearSelection = useCallback(() => {
      const updates = interpreter.clearSelection()
      applyUpdates(updates)
      keyboardSelectionAnchorRef.current = null
    }, [applyUpdates, interpreter])

    const extendSelectionWithArrow = useCallback(
      (direction: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') => {
        const snapshot = interpreter.snapshot
        const { rows: totalRows, columns: totalColumns } = snapshot
        let existingSelection = snapshot.selection ?? null

        if (existingSelection && isSelectionCollapsed(existingSelection)) {
          clearSelection()
          existingSelection = null
        }

        let anchor = keyboardSelectionAnchorRef.current
        if (!anchor) {
          if (existingSelection) {
            anchor = existingSelection.anchor
          } else {
            const cursor = snapshot.cursor
            anchor = {
              row: cursor.row,
              column: cursor.column,
              timestamp: Date.now(),
            }
          }
          keyboardSelectionAnchorRef.current = anchor
        }

        const focusSource = existingSelection?.focus ?? snapshot.cursor
        let nextRow = focusSource.row
        let nextColumn = focusSource.column

        switch (direction) {
          case 'ArrowLeft':
            nextColumn = Math.max(0, focusSource.column - 1)
            break
          case 'ArrowRight':
            nextColumn = Math.min(totalColumns, focusSource.column + 1)
            break
          case 'ArrowUp':
            nextRow = Math.max(0, focusSource.row - 1)
            break
          case 'ArrowDown':
            nextRow = Math.min(totalRows - 1, focusSource.row + 1)
            break
          default:
            break
        }

        nextColumn = Math.max(0, Math.min(totalColumns, nextColumn))

        if (nextRow === anchor.row && nextColumn === anchor.column) {
          clearSelection()
          return
        }

        const selection: TerminalSelection = {
          anchor,
          focus: {
            row: nextRow,
            column: nextColumn,
            timestamp: Date.now(),
          },
          kind: existingSelection?.kind ?? 'normal',
          status: 'idle',
        }

        const updates = interpreter.updateSelection(selection)
        if (updates.length === 0) {
          return
        }
        applyUpdates(updates)
      },
      [applyUpdates, clearSelection, interpreter],
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

    const beginSelection = useCallback(
      (
        selection: TerminalSelection,
        pointerId: number,
        target: HTMLCanvasElement,
      ) => {
        stopAutoScroll()
        const updates = interpreter.setSelection(selection)
        applyUpdates(updates)
        keyboardSelectionAnchorRef.current = null
        pointerSelectionRef.current = {
          pointerId,
          anchor: selection.anchor,
          lastSelection: interpreter.snapshot.selection,
        }
        if (typeof target.setPointerCapture === 'function') {
          target.setPointerCapture(pointerId)
        }
      },
      [applyUpdates, interpreter, stopAutoScroll],
    )

    const updateSelectionFromPointer = useCallback(
      (selection: TerminalSelection) => {
        const updates = interpreter.updateSelection(selection)
        applyUpdates(updates)
        keyboardSelectionAnchorRef.current = null
        pointerSelectionRef.current.lastSelection =
          interpreter.snapshot.selection
      },
      [applyUpdates, interpreter],
    )

    const startAutoScroll = useCallback(
      (direction: -1 | 1) => {
        if (
          autoScrollRef.current.direction === direction &&
          autoScrollRef.current.timer !== null
        ) {
          return
        }
        stopAutoScroll()
        const timer = window.setInterval(() => {
          const pointerState = pointerSelectionRef.current
          if (pointerState.pointerId === null || !pointerState.anchor) {
            stopAutoScroll()
            return
          }
          const active =
            interpreter.snapshot.selection ?? pointerState.lastSelection
          if (!active) {
            return
          }
          const nextRow = clamp(active.focus.row + direction, 0, rows - 1)
          if (nextRow === active.focus.row) {
            return
          }
          const selection: TerminalSelection = {
            ...active,
            focus: {
              ...active.focus,
              row: nextRow,
              timestamp: Date.now(),
            },
            status: 'dragging',
          }
          updateSelectionFromPointer(selection)
        }, 50)
        autoScrollRef.current = { timer, direction }
      },
      [interpreter, rows, stopAutoScroll, updateSelectionFromPointer],
    )

    const endPointerSelection = useCallback(
      (
        selection: TerminalSelection | null,
        pointerId: number | null,
        target: HTMLCanvasElement,
      ) => {
        stopAutoScroll()
        keyboardSelectionAnchorRef.current = null
        if (
          pointerId !== null &&
          typeof target.hasPointerCapture === 'function' &&
          target.hasPointerCapture(pointerId)
        ) {
          if (typeof target.releasePointerCapture === 'function') {
            target.releasePointerCapture(pointerId)
          }
        }
        pointerSelectionRef.current.pointerId = null
        pointerSelectionRef.current.anchor = null
        pointerSelectionRef.current.lastSelection = selection
      },
      [stopAutoScroll],
    )

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 0) {
          return
        }
        event.preventDefault()
        focus()
        const { row, column } = getPointerMetrics(event)
        const timestamp = Date.now()
        const selection: TerminalSelection = {
          anchor: { row, column, timestamp },
          focus: { row, column, timestamp },
          kind: event.shiftKey ? 'rectangular' : 'normal',
          status: 'dragging',
        }
        beginSelection(selection, event.pointerId, event.currentTarget)
      },
      [beginSelection, focus, getPointerMetrics],
    )

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLCanvasElement>) => {
        const pointerState = pointerSelectionRef.current
        if (
          pointerState.pointerId !== event.pointerId ||
          !pointerState.anchor
        ) {
          return
        }
        event.preventDefault()
        const { row, column, offsetY, rect } = getPointerMetrics(event)
        const direction: -1 | 0 | 1 =
          offsetY < 0 ? -1 : offsetY > rect.height ? 1 : 0
        if (direction === 0) {
          stopAutoScroll()
        } else {
          startAutoScroll(direction)
        }
        const timestamp = Date.now()
        const selection: TerminalSelection = {
          anchor: pointerState.anchor,
          focus: { row, column, timestamp },
          kind: pointerState.lastSelection?.kind ?? 'normal',
          status: 'dragging',
        }
        updateSelectionFromPointer(selection)
      },
      [
        getPointerMetrics,
        startAutoScroll,
        stopAutoScroll,
        updateSelectionFromPointer,
      ],
    )

    const finalizeSelection = useCallback(
      (
        event: React.PointerEvent<HTMLCanvasElement>,
        status: TerminalSelection['status'],
      ) => {
        const pointerState = pointerSelectionRef.current
        if (pointerState.pointerId !== event.pointerId) {
          return
        }
        const activeSelection =
          interpreter.snapshot.selection ?? pointerState.lastSelection
        if (activeSelection) {
          const finalized: TerminalSelection = {
            ...activeSelection,
            status,
            focus: {
              ...activeSelection.focus,
              timestamp: Date.now(),
            },
          }
          updateSelectionFromPointer(finalized)
        }
        endPointerSelection(
          interpreter.snapshot.selection,
          event.pointerId,
          event.currentTarget,
        )
      },
      [endPointerSelection, interpreter, updateSelectionFromPointer],
    )

    const handlePointerUp = useCallback(
      (event: React.PointerEvent<HTMLCanvasElement>) => {
        event.preventDefault()
        finalizeSelection(event, 'idle')
      },
      [finalizeSelection],
    )

    const handlePointerCancel = useCallback(
      (event: React.PointerEvent<HTMLCanvasElement>) => {
        event.preventDefault()
        stopAutoScroll()
        const pointerState = pointerSelectionRef.current
        if (pointerState.pointerId !== event.pointerId) {
          return
        }
        endPointerSelection(
          pointerState.lastSelection,
          event.pointerId,
          event.currentTarget,
        )
      },
      [endPointerSelection, stopAutoScroll],
    )

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
        const key = event.key
        const lowerKey = key.length === 1 ? key.toLowerCase() : key
        const isArrowKey =
          key === 'ArrowUp' ||
          key === 'ArrowDown' ||
          key === 'ArrowLeft' ||
          key === 'ArrowRight'
        const isCopyCombo =
          (event.metaKey && lowerKey === 'c') ||
          (event.ctrlKey && event.shiftKey && lowerKey === 'c')
        const isPasteCombo =
          (event.metaKey && lowerKey === 'v') ||
          (event.ctrlKey && event.shiftKey && lowerKey === 'v')

        if (isCopyCombo || isPasteCombo) {
          return
        }

        if (key === 'Enter' && !onData) {
          event.preventDefault()
          write('\r\n')
          clearSelection()
          return
        }

        const shouldExtendSelection = event.shiftKey && isArrowKey

        if (shouldExtendSelection) {
          event.preventDefault()
          extendSelectionWithArrow(
            key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
          )
          return
        }

        const bytes = encodeKeyEvent(event)
        if (!bytes) {
          return
        }

        if (interpreter.snapshot.selection) {
          clearSelection()
        }

        keyboardSelectionAnchorRef.current = null

        event.preventDefault()
        emitData(bytes)
      },
      [
        clearSelection,
        emitData,
        extendSelectionWithArrow,
        interpreter,
        onData,
        write,
      ],
    )

    const replaceSelectionWithText = useCallback(
      (selection: TerminalSelection | null, replacement: string) => {
        const updates = interpreter.editSelection({
          selection: selection ?? undefined,
          replacement,
        })
        if (updates.length === 0) {
          return false
        }
        applyUpdates(updates)
        return true
      },
      [applyUpdates, interpreter],
    )

    const handlePaste = useCallback(
      (event: ReactClipboardEvent<HTMLDivElement>) => {
        const text = event.clipboardData.getData('text')
        if (!text) {
          return
        }
        event.preventDefault()
        const selection = interpreter.snapshot.selection ?? null
        const replacementApplied = replaceSelectionWithText(selection, text)

        const payload = TEXT_ENCODER.encode(text)
        if (replacementApplied) {
          onData?.(payload)
        } else {
          emitData(payload)
        }
      },
      [emitData, interpreter, onData, replaceSelectionWithText],
    )

    const handleCopy = useCallback(
      (event: ReactClipboardEvent<HTMLDivElement>) => {
        const selection = interpreter.snapshot.selection
        if (!selection) {
          return
        }
        const text = extractSelectionText(interpreter.snapshot, selection)
        if (!text) {
          return
        }
        event.preventDefault()
        event.clipboardData?.setData('text/plain', text)
      },
      [interpreter],
    )

    useEffect(() => {
      rendererHandle.sync(interpreter.snapshot)
      if (autoFocus) {
        focus()
      }
    }, [autoFocus, focus, interpreter, rendererHandle])

    useEffect(
      () => () => {
        stopAutoScroll()
      },
      [stopAutoScroll],
    )

    useImperativeHandle(
      ref,
      () => ({
        focus,
        write,
        reset,
        getSnapshot: () => interpreterRef.current!.snapshot,
        getSelection: () => currentSelection,
      }),
      [currentSelection, focus, reset, write],
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
        onCopy={handleCopy}
      >
        <canvas
          ref={rendererHandle.canvasRef as React.RefObject<HTMLCanvasElement>}
          className={canvasClassName}
          style={canvasStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
      </div>
    )
  },
)

Terminal.displayName = 'Terminal'
