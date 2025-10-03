import type { PrinterController, TerminalInterpreter } from '@mana/vt'
import {
  createInterpreter,
  createParser,
  type ParserEvent,
  type ParserEventSink,
  resolveTerminalCapabilities,
  type TerminalSelection,
  type TerminalState,
  type TerminalUpdate,
} from '@mana/vt'
import {
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { TerminalStatusMessage } from './accessibility/accessibility'
import type { ShortcutGuideReason } from './accessibility/accessibility-layer'
import {
  type ShortcutGuideConfig,
  TerminalAccessibilityLayer,
  useTerminalAccessibility,
} from './accessibility/accessibility-layer'
import {
  resolveAccessibilityOptions,
  resolveGraphicsOptions,
  resolveStylingOptions,
  type TerminalAccessibilityOptions,
  type TerminalGraphicsBackend,
  type TerminalGraphicsOptions,
  type TerminalStylingOptions,
} from './utils/terminal-options'
import {
  type TerminalFrameEvent,
  type TerminalInstrumentationOptions,
  useTerminalInstrumentation,
} from './instrumentation/terminal-instrumentation'
import type { PrinterEvent } from './printer'
import { usePrinterController } from './printer/controller'
import {
  type TerminalRendererHandle,
  useTerminalCanvasRenderer,
} from './renderer'
import { useTerminalSelection } from './selection/terminal-selection'
import { useTerminalUserEvents } from './user-events/terminal-user-events'

const DEFAULT_ROWS = 24
const DEFAULT_COLUMNS = 80
const TEXT_ENCODER = new TextEncoder()

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const createInterpreterInstance = (
  rows: number,
  columns: number,
  printer: PrinterController,
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
  return createInterpreter({ capabilities, printer })
}

export interface TerminalHandle {
  focus(): void
  write(data: Uint8Array | string): void
  reset(): void
  getSnapshot(): TerminalState
  getSelection(): TerminalSelection | null
  getPrinterEvents(): PrinterEvent[]
  getDiagnostics(): TerminalRendererHandle['diagnostics']
  getRendererBackend(): TerminalRendererHandle['backend']
  announceStatus(message: TerminalStatusMessage): void
  openShortcutGuide(): void
  closeShortcutGuide(): void
  toggleShortcutGuide(): void
}

export interface TerminalProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly accessibility?: TerminalAccessibilityOptions
  readonly styling?: TerminalStylingOptions
  readonly graphics?: TerminalGraphicsOptions
  readonly instrumentation?: TerminalInstrumentationOptions
  readonly onHandleReady?: (handle: TerminalHandle) => void
  readonly onShortcutGuideToggle?: (
    visible: boolean,
    reason: ShortcutGuideReason,
  ) => void
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  (
    {
      accessibility: accessibilityProp,
      styling: stylingProp,
      graphics: graphicsProp,
      instrumentation: instrumentationProp,
      onHandleReady,
      onShortcutGuideToggle,
      className,
      style,
      ...domProps
    },
    ref: ForwardedRef<TerminalHandle>,
  ) => {
    const instrumentation = useTerminalInstrumentation(instrumentationProp)
    const {
      controller: printerController,
      getEventsSnapshot: getPrinterEventsSnapshot,
      resetEvents: resetPrinterEvents,
    } = usePrinterController()

    const resolvedAccessibility = useMemo(
      () => resolveAccessibilityOptions(accessibilityProp),
      [
        accessibilityProp?.ariaLabel,
        accessibilityProp?.instructions,
        accessibilityProp?.shortcutGuide,
        accessibilityProp?.autoFocus,
      ],
    )

    const resolvedStyling = useMemo(
      () => resolveStylingOptions(stylingProp),
      [
        stylingProp?.rows,
        stylingProp?.columns,
        stylingProp?.autoResize,
        stylingProp?.localEcho,
        stylingProp?.theme,
        stylingProp?.metrics,
        stylingProp?.canvas?.className,
        stylingProp?.canvas?.style,
      ],
    )

    const resolvedGraphics = useMemo(
      () => resolveGraphicsOptions(graphicsProp),
      [
        graphicsProp?.backend,
        graphicsProp?.fallback,
        graphicsProp?.webgl,
        graphicsProp?.webgpu,
        graphicsProp?.captureDiagnosticsFrame,
        graphicsProp?.cursorOverlayStrategy,
      ],
    )

    const {
      rows: rowsProp,
      columns: columnsProp,
      autoResize,
      localEcho,
      theme,
      metrics,
      canvasClassName,
      canvasStyle,
    } = resolvedStyling
    const { renderer: rendererGraphicsOptions, cursorOverlayStrategy } = resolvedGraphics

    const containerRef = useRef<HTMLDivElement>(null)
    const focus = useCallback(() => {
      containerRef.current?.focus()
    }, [])

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
    }, [autoResize])

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

    const ensureInterpreter = useCallback(
      (nextRows: number, nextColumns: number) => {
        interpreterRef.current = createInterpreterInstance(
          nextRows,
          nextColumns,
          printerController,
        )
      },
      [printerController],
    )

    if (!interpreterRef.current) {
      ensureInterpreter(rows, columns)
    }

    const interpreter = interpreterRef.current!

    const [currentSelection, setCurrentSelection] =
      useState<TerminalSelection | null>(interpreter.snapshot.selection ?? null)

    const [snapshotVersion, setSnapshotVersion] = useState(0)
    const snapshot = useMemo(
      () => interpreter.snapshot,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [interpreter.snapshot],
    )

    const accessibility = useTerminalAccessibility({
      ariaLabel: resolvedAccessibility.ariaLabel,
      focusTerminal: focus,
      instructions: resolvedAccessibility.instructions ?? undefined,
      shortcutGuide: resolvedAccessibility.shortcutGuide as
        | ShortcutGuideConfig
        | false,
      snapshot,
      snapshotRevision: snapshotVersion,
      onShortcutGuideToggle,
    })

    const handleSelectionChange = useCallback(
      (selection: TerminalSelection | null) => {
        setCurrentSelection(selection)
        instrumentation.emitSelectionChange(selection)
      },
      [instrumentation],
    )

    const handleDiagnostics = useCallback(
      (diagnostics: TerminalRendererHandle['diagnostics']) => {
        instrumentation.emitDiagnostics(diagnostics)
      },
      [instrumentation],
    )

    const handleFrame = useCallback(
      (event: TerminalFrameEvent) => {
        instrumentation.emitFrame(event)
      },
      [instrumentation],
    )

    const rendererHandle = useTerminalCanvasRenderer({
      graphics: rendererGraphicsOptions,
      metrics,
      theme,
      snapshot,
      onDiagnostics: handleDiagnostics,
      onSelectionChange: handleSelectionChange,
      cursorOverlayStrategy,
      onFrame: handleFrame,
    })

    useEffect(() => {
      const current = interpreterRef.current
      if (!current) {
        ensureInterpreter(rows, columns)
        rendererHandle.sync(interpreterRef.current!.snapshot)
        setCurrentSelection(interpreterRef.current!.snapshot.selection ?? null)
        setSnapshotVersion((value) => value + 1)
        resetPrinterEvents()
        return
      }

      const { rows: currentRows, columns: currentColumns } = current.snapshot
      if (currentRows === rows && currentColumns === columns) {
        return
      }

      ensureInterpreter(rows, columns)
      parserRef.current = createParser()
      rendererHandle.sync(interpreterRef.current!.snapshot)
      setCurrentSelection(interpreterRef.current!.snapshot.selection ?? null)
      setSnapshotVersion((value) => value + 1)
      resetPrinterEvents()
    }, [ensureInterpreter, rendererHandle, resetPrinterEvents, rows, columns])

    const applyUpdates = useCallback(
      (updates: TerminalUpdate[]) => {
        if (updates.length === 0) {
          return
        }
        const paintUpdates: TerminalUpdate[] = []
        for (const update of updates) {
          switch (update.type) {
            case 'response':
              instrumentation.emitData(update.data)
              continue
            case 'c1-transmission':
              parserRef.current.setC1TransmissionMode(update.value)
              continue
            default:
              paintUpdates.push(update)
              break
          }
        }
        if (paintUpdates.length === 0) {
          return
        }
        rendererHandle.applyUpdates({
          snapshot: interpreter.snapshot,
          updates: paintUpdates,
        })
        setSnapshotVersion((value) => value + 1)
      },
      [interpreter, instrumentation, rendererHandle],
    )

    const selectionApi = useTerminalSelection({
      interpreter,
      applyUpdates,
      viewport: { rows, columns },
      metrics: {
        cellWidth: metrics.cell.width,
        cellHeight: metrics.cell.height,
      },
      focusTerminal: focus,
    })

    const sinkRef = useRef<ParserEventSink>({ onEvent: () => {} })

    const handleEvent = useCallback(
      (event: ParserEvent) => {
        const updates = interpreter.handleEvent(event)
        applyUpdates(updates)
      },
      [applyUpdates, interpreter],
    )

    sinkRef.current.onEvent = handleEvent

    const write = useCallback((input: Uint8Array | string) => {
      const buffer =
        typeof input === 'string' ? TEXT_ENCODER.encode(input) : input
      parserRef.current.write(buffer, sinkRef.current)
      setSnapshotVersion((value) => value + 1)
    }, [])

    const emitData = useCallback(
      (bytes: Uint8Array, options?: { skipLocalEcho?: boolean }) => {
        instrumentation.emitData(bytes)
        const hasExternalConsumer = instrumentation.hasExternalDataConsumer
        const shouldLocalEcho =
          !options?.skipLocalEcho && (!hasExternalConsumer || localEcho)
        if (shouldLocalEcho) {
          write(bytes)
        }
      },
      [instrumentation, localEcho, write],
    )

    const replaceSelectionWithText = selectionApi.replaceSelectionWithText
    const clearSelection = selectionApi.clearSelection

    const {
      handleCompositionStart,
      handleCompositionUpdate,
      handleCompositionEnd,
      handleKeyDown,
      handlePaste,
      handleCopy,
    } = useTerminalUserEvents({
      interpreter,
      applyUpdates,
      emitData,
      write,
      selection: {
        keyboardSelectionAnchorRef: selectionApi.keyboardSelectionAnchorRef,
        replaceSelectionWithText,
        clearSelection,
      },
      localEcho,
      shortcutGuide: {
        enabled: accessibility.adapter.shortcutGuide.enabled,
        toggleViaHotkey: () =>
          accessibility.adapter.shortcutGuide.toggle('hotkey'),
      },
      instrumentation: {
        hasExternalDataConsumer: instrumentation.hasExternalDataConsumer,
        onData: instrumentation.hasExternalDataConsumer
          ? instrumentation.emitData
          : undefined,
      },
    })

    useEffect(() => {
      rendererHandle.sync(interpreter.snapshot)
      if (resolvedAccessibility.autoFocus) {
        focus()
      }
    }, [focus, interpreter, rendererHandle, resolvedAccessibility.autoFocus])

    const reset = useCallback(() => {
      parserRef.current.reset()
      interpreter.reset()
      rendererHandle.sync(interpreter.snapshot)
      setSnapshotVersion((value) => value + 1)
      resetPrinterEvents()
      setCurrentSelection(interpreter.snapshot.selection ?? null)
    }, [interpreter, rendererHandle, resetPrinterEvents])

    const imperativeHandle = useMemo<TerminalHandle>(
      () => ({
        focus,
        write,
        reset,
        getSnapshot: () => interpreterRef.current!.snapshot,
        getSelection: () => currentSelection,
        getPrinterEvents: () => getPrinterEventsSnapshot(),
        getDiagnostics: () => rendererHandle.diagnostics,
        getRendererBackend: () => rendererHandle.backend,
        announceStatus: (message) =>
          accessibility.adapter.announceStatus(message),
        openShortcutGuide: () =>
          accessibility.adapter.shortcutGuide.open('imperative'),
        closeShortcutGuide: () =>
          accessibility.adapter.shortcutGuide.close('imperative'),
        toggleShortcutGuide: () =>
          accessibility.adapter.shortcutGuide.toggle('imperative'),
      }),
      [
        accessibility.adapter,
        currentSelection,
        focus,
        getPrinterEventsSnapshot,
        rendererHandle,
        reset,
        write,
      ],
    )

    useImperativeHandle(ref, () => imperativeHandle, [imperativeHandle])

    useEffect(() => {
      onHandleReady?.(imperativeHandle)
    }, [imperativeHandle, onHandleReady])

    return (
      <TerminalAccessibilityLayer
        {...accessibility.containerProps}
        {...domProps}
        ref={containerRef}
        className={className}
        style={style}
        onClick={focus}
        onCompositionStart={handleCompositionStart}
        onCompositionUpdate={handleCompositionUpdate}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCopy={handleCopy}
        adapter={accessibility.adapter}
        instructionsContent={resolvedAccessibility.instructions ?? null}
      >
        <canvas
          ref={rendererHandle.canvasRef as RefObject<HTMLCanvasElement>}
          className={canvasClassName}
          style={canvasStyle}
          onPointerDown={selectionApi.pointerHandlers.onPointerDown}
          onPointerMove={selectionApi.pointerHandlers.onPointerMove}
          onPointerUp={selectionApi.pointerHandlers.onPointerUp}
          onPointerCancel={selectionApi.pointerHandlers.onPointerCancel}
        />
      </TerminalAccessibilityLayer>
    )
  },
)

Terminal.displayName = 'Terminal'

export type { TerminalStatusMessage } from './accessibility/accessibility'
export type {
  ShortcutGuideConfig as TerminalShortcutGuideOptions,
  ShortcutGuideReason,
} from './accessibility/accessibility-layer'
export type {
  TerminalErrorEvent,
  TerminalErrorSource,
  TerminalFrameEvent,
  TerminalInstrumentationOptions,
} from './instrumentation/terminal-instrumentation'
export type { PrinterEvent } from './printer'
export type {
  TerminalAccessibilityOptions,
  TerminalGraphicsBackend,
  TerminalGraphicsOptions,
  TerminalStylingOptions,
} from './utils/terminal-options'
