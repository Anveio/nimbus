import type {
  SelectionPoint,
  TerminalInterpreter,
  TerminalSelection,
  TerminalUpdate,
} from '@mana/vt'
import { isSelectionCollapsed } from '@mana/vt'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useSelectionAutoScroll } from './auto-scroll'

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

export const createLinearSelection = (
  row: number,
  startColumn: number,
  endColumn: number,
): TerminalSelection => {
  const timestamp = Date.now()
  return {
    anchor: {
      row,
      column: startColumn,
      timestamp,
    },
    focus: {
      row,
      column: endColumn,
      timestamp: timestamp + 1,
    },
    kind: 'normal',
    status: 'idle',
  }
}

interface PointerSelectionState {
  pointerId: number | null
  anchor: TerminalSelection['anchor'] | null
  lastSelection: TerminalSelection | null
}

const createPointerSelectionState = (): PointerSelectionState => ({
  pointerId: null,
  anchor: null,
  lastSelection: null,
})

interface PointerMetrics {
  readonly row: number
  readonly column: number
  readonly offsetY: number
  readonly rectHeight: number
}

const resolvePointerMetrics = (
  event: ReactPointerEvent<HTMLCanvasElement>,
  rows: number,
  columns: number,
  cellWidth: number,
  cellHeight: number,
): PointerMetrics => {
  const rect = event.currentTarget.getBoundingClientRect()
  const offsetX = event.clientX - rect.left
  const offsetY = event.clientY - rect.top
  const column = clamp(
    Math.floor(offsetX / Math.max(cellWidth, 1)),
    0,
    columns - 1,
  )
  const row = clamp(Math.floor(offsetY / Math.max(cellHeight, 1)), 0, rows - 1)
  return {
    row,
    column,
    offsetY,
    rectHeight: rect.height,
  }
}

export interface UseTerminalSelectionOptions {
  readonly interpreter: TerminalInterpreter
  readonly applyUpdates: (updates: TerminalUpdate[]) => void
  readonly viewport: { readonly rows: number; readonly columns: number }
  readonly metrics: { readonly cellWidth: number; readonly cellHeight: number }
  readonly focusTerminal: () => void
}

export interface UseTerminalSelectionResult {
  readonly keyboardSelectionAnchorRef: MutableRefObject<SelectionPoint | null>
  readonly pointerHandlers: {
    readonly onPointerDown: (
      event: ReactPointerEvent<HTMLCanvasElement>,
    ) => void
    readonly onPointerMove: (
      event: ReactPointerEvent<HTMLCanvasElement>,
    ) => void
    readonly onPointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void
    readonly onPointerCancel: (
      event: ReactPointerEvent<HTMLCanvasElement>,
    ) => void
  }
  readonly clearSelection: () => void
  readonly replaceSelectionWithText: (
    selection: TerminalSelection | null,
    replacement: string,
  ) => boolean
  readonly stopAutoScroll: () => void
}

export const useTerminalSelection = (
  options: UseTerminalSelectionOptions,
): UseTerminalSelectionResult => {
  const { interpreter, applyUpdates, viewport, metrics, focusTerminal } =
    options

  const keyboardSelectionAnchorRef = useRef<SelectionPoint | null>(null)
  const pointerSelectionRef = useRef<PointerSelectionState>(
    createPointerSelectionState(),
  )

  const autoScroll = useSelectionAutoScroll()

  const stopAutoScroll = useCallback(() => {
    autoScroll.stop()
  }, [autoScroll])

  const setSelection = useCallback(
    (
      selection: TerminalSelection,
      capture?: { pointerId: number; target: HTMLCanvasElement },
    ) => {
      const updates = interpreter.setSelection(selection)
      applyUpdates(updates)
      keyboardSelectionAnchorRef.current = null
      pointerSelectionRef.current = {
        pointerId: capture?.pointerId ?? pointerSelectionRef.current.pointerId,
        anchor: selection.anchor,
        lastSelection: selection,
      }
      if (capture && typeof capture.target.setPointerCapture === 'function') {
        capture.target.setPointerCapture(capture.pointerId)
      }
    },
    [applyUpdates, interpreter],
  )

  const updateSelection = useCallback(
    (selection: TerminalSelection) => {
      const updates = interpreter.updateSelection(selection)
      applyUpdates(updates)
      keyboardSelectionAnchorRef.current = null
      pointerSelectionRef.current = {
        ...pointerSelectionRef.current,
        lastSelection: selection,
      }
    },
    [applyUpdates, interpreter],
  )

  const endPointerSelection = useCallback(
    (
      selection: TerminalSelection | null,
      pointerId: number | null,
      target: HTMLCanvasElement,
    ) => {
      autoScroll.stop()
      keyboardSelectionAnchorRef.current = null
      if (
        pointerId !== null &&
        typeof target.hasPointerCapture === 'function' &&
        target.hasPointerCapture(pointerId) &&
        typeof target.releasePointerCapture === 'function'
      ) {
        target.releasePointerCapture(pointerId)
      }
      pointerSelectionRef.current = {
        pointerId: null,
        anchor: null,
        lastSelection: selection,
      }
    },
    [autoScroll],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      focusTerminal()

      const { row, column } = resolvePointerMetrics(
        event,
        viewport.rows,
        viewport.columns,
        metrics.cellWidth,
        metrics.cellHeight,
      )
      const timestamp = Date.now()
      const clampedColumn = interpreter.clampCursorColumn(row, column)
      const selection: TerminalSelection = {
        anchor: { row, column: clampedColumn, timestamp },
        focus: { row, column: clampedColumn, timestamp },
        kind: event.shiftKey ? 'rectangular' : 'normal',
        status: 'dragging',
      }
      setSelection(selection, {
        pointerId: event.pointerId,
        target: event.currentTarget,
      })
    },
    [
      focusTerminal,
      interpreter,
      metrics.cellHeight,
      metrics.cellWidth,
      setSelection,
      viewport.columns,
      viewport.rows,
    ],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const pointerState = pointerSelectionRef.current
      if (pointerState.pointerId !== event.pointerId || !pointerState.anchor) {
        return
      }
      event.preventDefault()
      const { row, column, offsetY, rectHeight } = resolvePointerMetrics(
        event,
        viewport.rows,
        viewport.columns,
        metrics.cellWidth,
        metrics.cellHeight,
      )

      const direction: -1 | 0 | 1 =
        offsetY < 0 ? -1 : offsetY > rectHeight ? 1 : 0
      if (direction === 0) {
        autoScroll.stop()
      } else {
        autoScroll.start(direction, () => {
          const state = pointerSelectionRef.current
          if (state.pointerId === null || !state.anchor) {
            autoScroll.stop()
            return
          }
          const active = interpreter.snapshot.selection ?? state.lastSelection
          if (!active) {
            return
          }
          const nextRow = clamp(
            active.focus.row + direction,
            0,
            viewport.rows - 1,
          )
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
          updateSelection(selection)
        })
      }

      const timestamp = Date.now()
      const clampedColumn = interpreter.clampCursorColumn(row, column)
      const selection: TerminalSelection = {
        anchor: pointerState.anchor,
        focus: { row, column: clampedColumn, timestamp },
        kind: pointerState.lastSelection?.kind ?? 'normal',
        status: 'dragging',
      }
      updateSelection(selection)
    },
    [
      autoScroll,
      interpreter,
      metrics.cellHeight,
      metrics.cellWidth,
      updateSelection,
      viewport.columns,
      viewport.rows,
    ],
  )

  const finalizeSelection = useCallback(
    (
      event: ReactPointerEvent<HTMLCanvasElement>,
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
        updateSelection(finalized)
      }
      endPointerSelection(
        interpreter.snapshot.selection,
        event.pointerId,
        event.currentTarget,
      )
    },
    [endPointerSelection, interpreter, updateSelection],
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      finalizeSelection(event, 'idle')
      const selection = interpreter.snapshot.selection
      if (!selection || isSelectionCollapsed(selection)) {
        const { row, column } = resolvePointerMetrics(
          event,
          viewport.rows,
          viewport.columns,
          metrics.cellWidth,
          metrics.cellHeight,
        )
        const clampedColumn = interpreter.clampCursorColumn(row, column)
        const updates = interpreter.moveCursorTo(
          { row, column: clampedColumn },
          {
            extendSelection: false,
            clampToLineEnd: true,
            clampToContentRow: true,
          },
        )
        applyUpdates(updates)
      }
    },
    [
      applyUpdates,
      finalizeSelection,
      interpreter,
      metrics.cellHeight,
      metrics.cellWidth,
      viewport.columns,
      viewport.rows,
    ],
  )

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      autoScroll.stop()
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
    [autoScroll, endPointerSelection],
  )

  const clearSelection = useCallback(() => {
    const updates = interpreter.clearSelection()
    applyUpdates(updates)
    keyboardSelectionAnchorRef.current = null
  }, [applyUpdates, interpreter])

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
      keyboardSelectionAnchorRef.current = null
      return true
    },
    [applyUpdates, interpreter],
  )

  useEffect(
    () => () => {
      autoScroll.stop()
      pointerSelectionRef.current = createPointerSelectionState()
    },
    [autoScroll],
  )

  const pointerHandlers = useMemo(
    () => ({
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    }),
    [
      handlePointerCancel,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
    ],
  )

  return {
    keyboardSelectionAnchorRef,
    pointerHandlers,
    clearSelection,
    replaceSelectionWithText,
    stopAutoScroll,
  }
}
