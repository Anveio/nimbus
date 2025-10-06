import type { RendererEvent, RendererSession } from '@mana/webgl-renderer'
import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSelectionAutoScroll } from './auto-scroll'

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

type TerminalState = RendererSession['runtime']['snapshot']
type RuntimeSelectionEvent = Extract<
  RendererEvent,
  { type: 'runtime.selection.set' }
>

type TerminalSelection = RuntimeSelectionEvent['selection']
type SelectionPoint = TerminalSelection['anchor']

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
  readonly offsetX: number
  readonly offsetY: number
  readonly rectWidth: number
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
    offsetX,
    offsetY,
    rectWidth: rect.width,
    rectHeight: rect.height,
  }
}

type PointerButton = Extract<
  RendererEvent,
  { type: 'runtime.pointer' }
>['button']

const mapPointerButton = (button: number): PointerButton => {
  switch (button) {
    case 0:
      return 'left'
    case 1:
      return 'middle'
    case 2:
      return 'right'
    case 3:
      return 'aux1'
    case 4:
      return 'aux2'
    default:
      return 'none'
  }
}

const extractModifierState = (event: ReactPointerEvent<HTMLCanvasElement>) => ({
  shift: event.shiftKey || undefined,
  alt: event.altKey || event.metaKey || undefined,
  meta: event.metaKey || undefined,
  ctrl: event.ctrlKey || undefined,
})

export interface UseTerminalSelectionOptions {
  readonly dispatch: (event: RendererEvent) => void
  readonly getSnapshot: () => TerminalState
  readonly viewport: { readonly rows: number; readonly columns: number }
  readonly metrics: { readonly cellWidth: number; readonly cellHeight: number }
  readonly focusTerminal: () => void
}

export interface UseTerminalSelectionResult {
  readonly keyboardSelectionAnchorRef: Ref<SelectionPoint | null>
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
  const { dispatch, getSnapshot, viewport, metrics, focusTerminal } = options

  const keyboardSelectionAnchorRef = useRef<SelectionPoint | null>(null)
  const pointerSelectionRef = useRef<PointerSelectionState>(
    createPointerSelectionState(),
  )

  const autoScroll = useSelectionAutoScroll()

  const stopAutoScroll = useCallback(() => {
    autoScroll.stop()
  }, [autoScroll])

  const dispatchSelectionEvent = useCallback(
    (
      type: 'runtime.selection.set' | 'runtime.selection.update',
      selection: TerminalSelection,
    ) => {
      dispatch({ type, selection })
    },
    [dispatch],
  )

  const setSelection = useCallback(
    (
      selection: TerminalSelection,
      capture?: { pointerId: number; target: HTMLCanvasElement },
    ) => {
      dispatchSelectionEvent('runtime.selection.set', selection)
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
    [dispatchSelectionEvent],
  )

  const updateSelection = useCallback(
    (selection: TerminalSelection) => {
      dispatchSelectionEvent('runtime.selection.update', selection)
      keyboardSelectionAnchorRef.current = null
      pointerSelectionRef.current = {
        ...pointerSelectionRef.current,
        lastSelection: selection,
      }
    },
    [dispatchSelectionEvent],
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

  const dispatchPointerEvent = useCallback(
    (
      event: ReactPointerEvent<HTMLCanvasElement>,
      action: 'down' | 'move' | 'up' | 'cancel',
      cell: { row: number; column: number },
      offset: { offsetX: number; offsetY: number },
    ) => {
      dispatch({
        type: 'runtime.pointer',
        action,
        pointerId: event.pointerId,
        button: mapPointerButton(event.button),
        buttons: event.buttons ?? 0,
        position: { x: offset.offsetX, y: offset.offsetY },
        cell: { row: cell.row + 1, column: cell.column + 1 },
        modifiers: extractModifierState(event),
      })
    },
    [dispatch],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      focusTerminal()

      const metricsInfo = resolvePointerMetrics(
        event,
        viewport.rows,
        viewport.columns,
        metrics.cellWidth,
        metrics.cellHeight,
      )
      const { row, column, offsetX, offsetY } = metricsInfo

      dispatchPointerEvent(event, 'down', { row, column }, { offsetX, offsetY })

      const timestamp = Date.now()
      const selection: TerminalSelection = {
        anchor: {
          row: metricsInfo.row,
          column: metricsInfo.column,
          timestamp,
        },
        focus: {
          row: metricsInfo.row,
          column: metricsInfo.column,
          timestamp,
        },
        kind: event.shiftKey ? 'rectangular' : 'normal',
        status: 'dragging',
      }
      setSelection(selection, {
        pointerId: event.pointerId,
        target: event.currentTarget,
      })
    },
    [
      dispatchPointerEvent,
      focusTerminal,
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

      const metricsInfo = resolvePointerMetrics(
        event,
        viewport.rows,
        viewport.columns,
        metrics.cellWidth,
        metrics.cellHeight,
      )
      const { row, column, offsetX, offsetY } = metricsInfo

      dispatchPointerEvent(event, 'move', { row, column }, { offsetX, offsetY })

      const direction: -1 | 0 | 1 =
        metricsInfo.offsetY < 0
          ? -1
          : metricsInfo.offsetY > metricsInfo.rectHeight
            ? 1
            : 0
      if (direction === 0) {
        autoScroll.stop()
      } else {
        autoScroll.start(direction, () => {
          const state = pointerSelectionRef.current
          if (state.pointerId === null || !state.anchor) {
            autoScroll.stop()
            return
          }
          const snapshot = getSnapshot()
          const active = snapshot.selection ?? state.lastSelection
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

      const selection: TerminalSelection = {
        anchor: pointerState.anchor,
        focus: {
          row: metricsInfo.row,
          column: metricsInfo.column,
          timestamp: Date.now(),
        },
        kind: pointerState.lastSelection?.kind ?? 'normal',
        status: 'dragging',
      }
      updateSelection(selection)
    },
    [
      autoScroll,
      dispatchPointerEvent,
      getSnapshot,
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
      const snapshot = getSnapshot()
      const activeSelection = snapshot.selection ?? pointerState.lastSelection
      if (activeSelection) {
        const finalized: TerminalSelection = {
          ...activeSelection,
          status,
          focus: {
            ...activeSelection.focus,
            timestamp: Date.now(),
          },
        }
        dispatchSelectionEvent('runtime.selection.update', finalized)
      }
      endPointerSelection(
        snapshot.selection,
        event.pointerId,
        event.currentTarget,
      )
    },
    [dispatchSelectionEvent, endPointerSelection, getSnapshot],
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.preventDefault()

      const metricsInfo = resolvePointerMetrics(
        event,
        viewport.rows,
        viewport.columns,
        metrics.cellWidth,
        metrics.cellHeight,
      )
      const { row, column, offsetX, offsetY } = metricsInfo

      dispatchPointerEvent(event, 'up', { row, column }, { offsetX, offsetY })

      finalizeSelection(event, 'idle')

      const snapshot = getSnapshot()
      const selection = snapshot.selection
      if (!selection || selection.anchor === selection.focus) {
        dispatch({
          type: 'runtime.selection.clear',
        })
        dispatch({
          type: 'runtime.cursor.set',
          position: {
            row: metricsInfo.row,
            column: metricsInfo.column,
          },
          options: {
            clampToContentRow: true,
            clampToLineEnd: true,
            extendSelection: false,
          },
        })
      }
    },
    [
      dispatch,
      dispatchPointerEvent,
      finalizeSelection,
      getSnapshot,
      metrics.cellHeight,
      metrics.cellWidth,
      viewport.columns,
      viewport.rows,
    ],
  )

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.preventDefault()

      const metricsInfo = resolvePointerMetrics(
        event,
        viewport.rows,
        viewport.columns,
        metrics.cellWidth,
        metrics.cellHeight,
      )
      const { row, column, offsetX, offsetY } = metricsInfo

      dispatchPointerEvent(
        event,
        'cancel',
        { row, column },
        { offsetX, offsetY },
      )

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
    [
      autoScroll,
      dispatchPointerEvent,
      endPointerSelection,
      metrics.cellHeight,
      metrics.cellWidth,
      viewport.columns,
      viewport.rows,
    ],
  )

  const clearSelection = useCallback(() => {
    dispatch({ type: 'runtime.selection.clear' })
    keyboardSelectionAnchorRef.current = null
  }, [dispatch])

  const replaceSelectionWithText = useCallback(
    (selection: TerminalSelection | null, replacement: string) => {
      dispatch({
        type: 'runtime.selection.replace',
        replacement,
        selection: selection ?? undefined,
      })
      keyboardSelectionAnchorRef.current = null
      return true
    },
    [dispatch],
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
