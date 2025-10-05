import {
  createTerminalRuntime,
  type TerminalRuntime,
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
import { useAutoResize } from './hooks/useAutoResize'
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
        accessibilityProp,
      ],
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
      localEcho,
      theme,
      metrics,
      canvasClassName,
      canvasStyle,
    } = resolvedStyling
    const { renderer: rendererGraphicsOptions, cursorOverlayStrategy } =
      resolvedGraphics

    const { containerRef, rows, columns } = useAutoResize({
      rows: rowsProp,
      columns: columnsProp,
      autoResize: autoResize ?? true,
      defaultRows: DEFAULT_ROWS,
      defaultColumns: DEFAULT_COLUMNS,
      cellMetrics: metrics.cell,
    })
    const focus = useCallback(() => {
      containerRef.current?.focus()
    }, [containerRef.current?.focus])

    const runtimeRef = useRef<TerminalRuntime | null>(null)

    const ensureRuntime = useCallback(
      (nextRows: number, nextColumns: number) => {
        runtimeRef.current = createTerminalRuntime({
          features: {
            initialRows: nextRows,
            initialColumns: nextColumns,
          },
          printer: printerController,
        })
      },
      [printerController],
    )

    if (!runtimeRef.current) {
      ensureRuntime(rows, columns)
    }

    const runtime = runtimeRef.current!
    const interpreter = runtime.interpreter

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
      const current = runtimeRef.current
      if (!current) {
        ensureRuntime(rows, columns)
        const nextRuntime = runtimeRef.current!
        rendererHandle.sync(nextRuntime.snapshot)
        setCurrentSelection(nextRuntime.snapshot.selection ?? null)
        setSnapshotVersion((value) => value + 1)
        resetPrinterEvents()
        return
      }

      const { rows: currentRows, columns: currentColumns } = current.snapshot
      if (currentRows === rows && currentColumns === columns) {
        return
      }

      ensureRuntime(rows, columns)
      const nextRuntime = runtimeRef.current!
      rendererHandle.sync(nextRuntime.snapshot)
      setCurrentSelection(nextRuntime.snapshot.selection ?? null)
      setSnapshotVersion((value) => value + 1)
      resetPrinterEvents()
    }, [ensureRuntime, rendererHandle, resetPrinterEvents, rows, columns])

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
              runtimeRef.current?.parser.setC1TransmissionMode(update.value)
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

    const write = useCallback(
      (input: Uint8Array | string) => {
        const runtimeInstance = runtimeRef.current
        if (!runtimeInstance) {
          return
        }
        const updates = runtimeInstance.write(input)
        applyUpdates(updates)
      },
      [applyUpdates],
    )

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
      const runtimeInstance = runtimeRef.current
      if (!runtimeInstance) {
        return
      }
      runtimeInstance.reset()
      const freshInterpreter = runtimeInstance.interpreter
      rendererHandle.sync(freshInterpreter.snapshot)
      setSnapshotVersion((value) => value + 1)
      resetPrinterEvents()
      setCurrentSelection(freshInterpreter.snapshot.selection ?? null)
    }, [rendererHandle, resetPrinterEvents])

    const imperativeHandle = useMemo<TerminalHandle>(
      () => ({
        focus,
        write,
        reset,
        getSnapshot: () => runtimeRef.current!.snapshot,
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
  TerminalGraphicsOptions,
  TerminalStylingOptions,
} from './utils/terminal-options'
