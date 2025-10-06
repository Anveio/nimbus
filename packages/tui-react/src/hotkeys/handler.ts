import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { HotkeyContext, HotkeyResult } from './context'

const noopResult: HotkeyResult = { handled: false }

const createResult = (
  options: Partial<HotkeyResult> & { handled?: boolean } = {},
): HotkeyResult => ({ handled: true, ...options })

const isArrowKey = (key: string) =>
  key === 'ArrowUp' ||
  key === 'ArrowDown' ||
  key === 'ArrowLeft' ||
  key === 'ArrowRight'

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

  if (key === 'Enter' && !context.onData) {
    context.write('\r\n')
    context.clearSelection()
    return createResult({ preventDefault: true })
  }

  const arrowKey = isArrowKey(key)
  const shouldExtendSelection = event.shiftKey && arrowKey
  const snapshot = context.runtime.getSnapshot()
  const previousCursor = snapshot.cursor
  const anchorPoint = shouldExtendSelection
    ? (context.keyboardSelectionAnchorRef.current ?? {
        row: previousCursor.row,
        column: previousCursor.column,
        timestamp: Date.now(),
      })
    : null

  let handledViaLocalErase = false
  if (!event.altKey && !event.ctrlKey && !event.metaKey) {
    if (key === 'Backspace') {
      handledViaLocalErase = context.performLocalErase('backspace')
      if (handledViaLocalErase) {
        const bytes = context.encodeKeyEvent(event)
        if (bytes) {
          context.emitData(bytes, { skipLocalEcho: true })
        }
        context.keyboardSelectionAnchorRef.current = null
        return createResult({ preventDefault: true })
      }
    } else if (key === 'Delete') {
      handledViaLocalErase = context.performLocalErase('delete')
      if (handledViaLocalErase) {
        const bytes = context.encodeKeyEvent(event)
        if (bytes) {
          context.emitData(bytes, { skipLocalEcho: true })
        }
        context.keyboardSelectionAnchorRef.current = null
        return createResult({ preventDefault: true })
      }
    }
  }

  if (arrowKey) {
    const isLineMotion = event.metaKey
    const isWordMotion =
      !isLineMotion && (event.altKey || (event.ctrlKey && !event.metaKey))

    let handled = false
    switch (key) {
      case 'ArrowLeft':
        handled = isLineMotion
          ? context.runtime.moveCursorLineStart({
              extendSelection: shouldExtendSelection,
              selectionAnchor: anchorPoint,
            })
          : isWordMotion
            ? context.runtime.moveCursorWordLeft({
                extendSelection: shouldExtendSelection,
                selectionAnchor: anchorPoint,
              })
            : context.runtime.moveCursorLeft({
                extendSelection: shouldExtendSelection,
                selectionAnchor: anchorPoint,
              })
        break
      case 'ArrowRight':
        handled = isLineMotion
          ? context.runtime.moveCursorLineEnd({
              extendSelection: shouldExtendSelection,
              selectionAnchor: anchorPoint,
            })
          : isWordMotion
            ? context.runtime.moveCursorWordRight({
                extendSelection: shouldExtendSelection,
                selectionAnchor: anchorPoint,
              })
            : context.runtime.moveCursorRight({
                extendSelection: shouldExtendSelection,
                selectionAnchor: anchorPoint,
              })
        break
      case 'ArrowUp':
        handled = context.runtime.moveCursorUp({
          extendSelection: shouldExtendSelection,
          selectionAnchor: anchorPoint,
        })
        break
      case 'ArrowDown':
        handled = context.runtime.moveCursorDown({
          extendSelection: shouldExtendSelection,
          selectionAnchor: anchorPoint,
        })
        break
      default:
        break
    }

    if (handled) {
      context.keyboardSelectionAnchorRef.current = shouldExtendSelection
        ? anchorPoint
        : null

      const bytes = context.encodeKeyEvent(event)
      if (bytes) {
        context.emitData(bytes, { skipLocalEcho: true })
      }
      return createResult({ preventDefault: true })
    }
  }

  const bytes = context.encodeKeyEvent(event)
  if (!bytes) {
    return noopResult
  }

  const selectionExists = Boolean(snapshot.selection)
  if (selectionExists && !event.shiftKey) {
    context.clearSelection()
  }

  if (!event.shiftKey) {
    context.keyboardSelectionAnchorRef.current = null
  }

  context.emitData(bytes)
  return createResult({ preventDefault: true })
}
