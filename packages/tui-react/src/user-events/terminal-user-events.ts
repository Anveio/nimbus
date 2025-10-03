import type {
  SelectionPoint,
  TerminalInterpreter,
  TerminalSelection,
  TerminalState,
  TerminalUpdate,
} from '@mana/vt'
import { getSelectionRowSegments } from '@mana/vt'
import {
  useCallback,
  useRef,
  type MutableRefObject,
} from 'react'
import type {
  ClipboardEvent as ReactClipboardEvent,
  CompositionEvent as ReactCompositionEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createLinearSelection } from '../selection/terminal-selection'
import { handleTerminalHotkey } from '../hotkeys'

const TEXT_ENCODER = new TextEncoder()

const encodeKeyEvent = (
  event: ReactKeyboardEvent<HTMLDivElement>,
): Uint8Array | null => {
  if (event.metaKey) {
    return null
  }

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
    case 'Delete':
      return TEXT_ENCODER.encode('\u001b[3~')
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

interface SelectionControllers {
  readonly keyboardSelectionAnchorRef: MutableRefObject<SelectionPoint | null>
  readonly replaceSelectionWithText: (
    selection: TerminalSelection | null,
    replacement: string,
  ) => boolean
  readonly clearSelection: () => void
}

interface ShortcutGuideBridge {
  readonly enabled: boolean
  readonly toggleViaHotkey: () => void
}

interface InstrumentationBridge {
  readonly hasExternalDataConsumer: boolean
  readonly onData?: (payload: Uint8Array) => void
}

export interface TerminalUserEventsOptions {
  readonly interpreter: TerminalInterpreter
  readonly applyUpdates: (updates: TerminalUpdate[]) => void
  readonly emitData: (bytes: Uint8Array, options?: { skipLocalEcho?: boolean }) => void
  readonly write: (input: Uint8Array | string) => void
  readonly selection: SelectionControllers
  readonly localEcho: boolean
  readonly shortcutGuide: ShortcutGuideBridge
  readonly instrumentation: InstrumentationBridge
}

export interface TerminalUserEventHandlers {
  readonly handleCompositionStart: (
    event: ReactCompositionEvent<HTMLDivElement>,
  ) => void
  readonly handleCompositionUpdate: (
    event: ReactCompositionEvent<HTMLDivElement>,
  ) => void
  readonly handleCompositionEnd: (
    event: ReactCompositionEvent<HTMLDivElement>,
  ) => void
  readonly handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  readonly handlePaste: (event: ReactClipboardEvent<HTMLDivElement>) => void
  readonly handleCopy: (event: ReactClipboardEvent<HTMLDivElement>) => void
}

export const useTerminalUserEvents = (
  options: TerminalUserEventsOptions,
): TerminalUserEventHandlers => {
  const {
    interpreter,
    applyUpdates,
    emitData,
    write,
    selection,
    localEcho,
    shortcutGuide,
    instrumentation,
  } = options

  const compositionStateRef = useRef<{ active: boolean; data: string }>({
    active: false,
    data: '',
  })

  const flushComposition = useCallback(
    (value: string | null | undefined) => {
      selection.keyboardSelectionAnchorRef.current = null
      const text = value ?? ''
      if (!text) {
        return
      }

      const currentSelection = interpreter.snapshot.selection ?? null
      const replacementApplied = selection.replaceSelectionWithText(
        currentSelection,
        text,
      )
      const payload = TEXT_ENCODER.encode(text)
      emitData(payload, { skipLocalEcho: replacementApplied })
    },
    [emitData, interpreter, selection],
  )

  const handleCompositionStart = useCallback(
    (_event: ReactCompositionEvent<HTMLDivElement>) => {
      compositionStateRef.current = { active: true, data: '' }
    },
    [],
  )

  const handleCompositionUpdate = useCallback(
    (event: ReactCompositionEvent<HTMLDivElement>) => {
      compositionStateRef.current = {
        active: true,
        data: event.data ?? '',
      }
    },
    [],
  )

  const handleCompositionEnd = useCallback(
    (event: ReactCompositionEvent<HTMLDivElement>) => {
      const data = event.data ?? compositionStateRef.current.data
      compositionStateRef.current = { active: false, data: '' }
      flushComposition(data)
    },
    [flushComposition],
  )

  const performLocalErase = useCallback(
    (direction: 'backspace' | 'delete'): boolean => {
      if (!localEcho) {
        return false
      }

      const snapshot = interpreter.snapshot
      const activeSelection = snapshot.selection
      if (activeSelection) {
        return selection.replaceSelectionWithText(activeSelection, '')
      }

      const { row, column } = snapshot.cursor
      if (direction === 'backspace') {
        if (column <= 0) {
          return false
        }
        const newSelection = createLinearSelection(row, column - 1, column)
        return selection.replaceSelectionWithText(newSelection, '')
      }

      if (column >= snapshot.columns) {
        return false
      }

      const rowBuffer = snapshot.buffer[row] ?? []
      const targetCell = rowBuffer[column]
      if (!targetCell || targetCell.char === ' ') {
        return false
      }

      const newSelection = createLinearSelection(row, column, column + 1)
      return selection.replaceSelectionWithText(newSelection, '')
    },
    [interpreter, localEcho, selection],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing || compositionStateRef.current.active) {
        return
      }

      const result = handleTerminalHotkey(event, {
        interpreter: {
          moveCursorLeft: (options) => interpreter.moveCursorLeft(options),
          moveCursorRight: (options) => interpreter.moveCursorRight(options),
          moveCursorUp: (options) => interpreter.moveCursorUp(options),
          moveCursorDown: (options) => interpreter.moveCursorDown(options),
          moveCursorLineStart: (options) =>
            interpreter.moveCursorLineStart(options),
          moveCursorLineEnd: (options) =>
            interpreter.moveCursorLineEnd(options),
          moveCursorWordLeft: (options) =>
            interpreter.moveCursorWordLeft(options),
          moveCursorWordRight: (options) =>
            interpreter.moveCursorWordRight(options),
          getSnapshot: () => interpreter.snapshot,
        },
        performLocalErase,
        applyUpdates,
        encodeKeyEvent,
        emitData,
        clearSelection: selection.clearSelection,
        write,
        onData: instrumentation.hasExternalDataConsumer
          ? instrumentation.onData
          : undefined,
        toggleShortcutGuide: () => {
          if (shortcutGuide.enabled) {
            shortcutGuide.toggleViaHotkey()
          }
        },
        shortcutGuideEnabled: shortcutGuide.enabled,
        keyboardSelectionAnchorRef: selection.keyboardSelectionAnchorRef,
        compositionStateRef,
      })

      if (!result.handled) {
        return
      }

      if (result.preventDefault) {
        event.preventDefault()
      }
    },
    [
      applyUpdates,
      emitData,
      instrumentation,
      interpreter,
      performLocalErase,
      selection,
      shortcutGuide,
      write,
    ],
  )

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      const text = event.clipboardData.getData('text')
      if (!text) {
        return
      }
      event.preventDefault()
      const selectionSnapshot = interpreter.snapshot.selection ?? null
      const replacementApplied = selection.replaceSelectionWithText(
        selectionSnapshot,
        text,
      )
      const payload = TEXT_ENCODER.encode(text)
      emitData(payload, { skipLocalEcho: replacementApplied })
    },
    [emitData, interpreter, selection],
  )

  const handleCopy = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      const selectionSnapshot = interpreter.snapshot.selection
      if (!selectionSnapshot) {
        return
      }
      const text = extractSelectionText(interpreter.snapshot, selectionSnapshot)
      if (!text) {
        return
      }
      event.preventDefault()
      event.clipboardData?.setData('text/plain', text)
    },
    [interpreter],
  )

  return {
    handleCompositionStart,
    handleCompositionUpdate,
    handleCompositionEnd,
    handleKeyDown,
    handlePaste,
    handleCopy,
  }
}
