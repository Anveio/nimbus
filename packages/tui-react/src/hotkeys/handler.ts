import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { HotkeyContext, HotkeyResult } from './context'
import type { TerminalUpdate } from '@mana/vt'

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
  if (event.nativeEvent.isComposing || context.compositionStateRef.current.active) {
    return noopResult
  }

  const key = event.key

  if (context.shortcutGuideEnabled && (key === '?' || (key === '/' && event.shiftKey))) {
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
  const snapshot = context.interpreter.getSnapshot()
  const previousCursor = snapshot.cursor
  const anchorPoint = shouldExtendSelection
    ? context.keyboardSelectionAnchorRef.current ?? {
        row: previousCursor.row,
        column: previousCursor.column,
        timestamp: Date.now(),
      }
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
    const isWordMotion = !isLineMotion && (event.altKey || (event.ctrlKey && !event.metaKey))

    let updates: TerminalUpdate[] = []
    switch (key) {
      case 'ArrowLeft':
        updates = isLineMotion
          ? context.interpreter.moveCursorLineStart({
              extendSelection: shouldExtendSelection,
              selectionAnchor: anchorPoint,
            })
          : isWordMotion
            ? context.interpreter.moveCursorWordLeft({
                extendSelection: shouldExtendSelection,
                selectionAnchor: anchorPoint,
              })
            : context.interpreter.moveCursorLeft({
                extendSelection: shouldExtendSelection,
                selectionAnchor: anchorPoint,
              })
        break
      case 'ArrowRight':
        updates = isLineMotion
          ? context.interpreter.moveCursorLineEnd({
              extendSelection: shouldExtendSelection,
              selectionAnchor: anchorPoint,
            })
          : isWordMotion
            ? context.interpreter.moveCursorWordRight({
                extendSelection: shouldExtendSelection,
                selectionAnchor: anchorPoint,
              })
            : context.interpreter.moveCursorRight({
                extendSelection: shouldExtendSelection,
                selectionAnchor: anchorPoint,
              })
        break
      case 'ArrowUp':
        updates = context.interpreter.moveCursorUp({
          extendSelection: shouldExtendSelection,
          selectionAnchor: anchorPoint,
        })
        break
      case 'ArrowDown':
        updates = context.interpreter.moveCursorDown({
          extendSelection: shouldExtendSelection,
          selectionAnchor: anchorPoint,
        })
        break
      default:
        break
    }

    if (updates.length > 0) {
      context.applyUpdates(updates)
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
