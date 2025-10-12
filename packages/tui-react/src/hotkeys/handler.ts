import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  HotkeyContext,
  HotkeyRendererEvent,
  HotkeyResult,
} from './context'
import type {
  SelectionPoint,
  TerminalRuntimeCursorMoveDirection,
} from '@nimbus/webgl-renderer'

const noopResult: HotkeyResult = { handled: false }

const createResult = (
  options: Partial<HotkeyResult> & { handled?: boolean } = {},
): HotkeyResult => ({ handled: true, ...options })

const isArrowKey = (key: string) =>
  key === 'ArrowUp' ||
  key === 'ArrowDown' ||
  key === 'ArrowLeft' ||
  key === 'ArrowRight'

const createRendererKeyEvent = (
  event: ReactKeyboardEvent<HTMLDivElement>,
): HotkeyRendererEvent => ({
  type: 'runtime.key',
  key: event.key,
  code: event.code,
  alt: event.altKey,
  ctrl: event.ctrlKey,
  meta: event.metaKey,
  shift: event.shiftKey,
})

export const handleTerminalHotkey = (
  event: ReactKeyboardEvent<HTMLDivElement>,
  context: HotkeyContext,
): HotkeyResult => {
  if (
    event.nativeEvent.isComposing ||
    context.compositionStateRef.current.active
  ) {
    return noopResult
  }

  const key = event.key

  if (
    context.shortcutGuideEnabled &&
    (key === '?' || (key === '/' && event.shiftKey))
  ) {
    context.toggleShortcutGuide('hotkey')
    return createResult({ preventDefault: true })
  }

  if (key === 'Process') {
    return noopResult
  }

  const lowerKey = key.length === 1 ? key.toLowerCase() : key

  const isCopyCombo =
    (event.metaKey && lowerKey === 'c') ||
    (event.ctrlKey && event.shiftKey && lowerKey === 'c')
  const isPasteCombo =
    (event.metaKey && lowerKey === 'v') ||
    (event.ctrlKey && event.shiftKey && lowerKey === 'v')

  if (isCopyCombo || isPasteCombo) {
    return noopResult
  }

  const snapshot = context.runtime.snapshot
  const arrowKey = isArrowKey(key)
  const shouldExtendSelection = event.shiftKey && arrowKey

  if (key === 'Enter') {
    if (snapshot.selection) {
      context.clearSelection()
    }
    context.keyboardSelectionAnchorRef.current = null
    return createResult({
      preventDefault: true,
      rendererEvents: [createRendererKeyEvent(event)],
    })
  }

  if (!event.altKey && !event.ctrlKey && !event.metaKey) {
    if (key === 'Backspace') {
      const handledViaLocalErase = context.performLocalErase('backspace')
      if (handledViaLocalErase) {
        context.keyboardSelectionAnchorRef.current = null
        if (snapshot.selection) {
          context.clearSelection()
        }
        return createResult({
          preventDefault: true,
          skipLocalEcho: true,
          rendererEvents: [createRendererKeyEvent(event)],
        })
      }
    } else if (key === 'Delete') {
      const handledViaLocalErase = context.performLocalErase('delete')
      if (handledViaLocalErase) {
        context.keyboardSelectionAnchorRef.current = null
        if (snapshot.selection) {
          context.clearSelection()
        }
        return createResult({
          preventDefault: true,
          skipLocalEcho: true,
          rendererEvents: [createRendererKeyEvent(event)],
        })
      }
    }
  }

  if (arrowKey) {
    const previousCursor = snapshot.cursor
    if (shouldExtendSelection) {
      const currentAnchor = context.keyboardSelectionAnchorRef.current
      context.keyboardSelectionAnchorRef.current = currentAnchor ?? {
        row: previousCursor.row,
        column: previousCursor.column,
        timestamp: Date.now(),
      }
    } else {
      context.keyboardSelectionAnchorRef.current = null
      if (snapshot.selection) {
        context.clearSelection()
      }
    }

    const selectionAnchor = context.keyboardSelectionAnchorRef.current
    const isLineMotion = event.metaKey
    const isWordMotion =
      !isLineMotion && (event.altKey || (event.ctrlKey && !event.metaKey))

    const direction: TerminalRuntimeCursorMoveDirection | null = (() => {
      switch (key) {
        case 'ArrowLeft':
          if (isLineMotion) {
            return 'line-start'
          }
          if (isWordMotion) {
            return 'word-left'
          }
          return 'left'
        case 'ArrowRight':
          if (isLineMotion) {
            return 'line-end'
          }
          if (isWordMotion) {
            return 'word-right'
          }
          return 'right'
        case 'ArrowUp':
          return 'up'
        case 'ArrowDown':
          return 'down'
        default:
          return null
      }
    })()

    if (!direction) {
      return noopResult
    }

    return createResult({
      preventDefault: true,
      rendererEvents: [
        {
          type: 'runtime.cursor.move',
          direction,
          options: {
            extendSelection: shouldExtendSelection,
            selectionAnchor: shouldExtendSelection ? selectionAnchor : null,
          },
        },
      ],
    })
  }

  const selectionExists = Boolean(snapshot.selection)
  if (selectionExists && !event.shiftKey) {
    context.clearSelection()
  }

  if (!event.shiftKey) {
    context.keyboardSelectionAnchorRef.current = null
  }

  return createResult({
    preventDefault: true,
    rendererEvents: [createRendererKeyEvent(event)],
  })
}
