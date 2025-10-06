import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  SelectionPoint,
  TerminalState,
} from '../terminal-types'

export type ShortcutGuideReason = 'hotkey' | 'imperative'

export interface MoveCursorOptions {
  readonly extendSelection: boolean
  readonly selectionAnchor: SelectionPoint | null
}

export interface HotkeyInterpreter {
  readonly moveCursorLeft: (options: MoveCursorOptions) => boolean
  readonly moveCursorRight: (options: MoveCursorOptions) => boolean
  readonly moveCursorUp: (options: MoveCursorOptions) => boolean
  readonly moveCursorDown: (options: MoveCursorOptions) => boolean
  readonly moveCursorLineStart: (options: MoveCursorOptions) => boolean
  readonly moveCursorLineEnd: (options: MoveCursorOptions) => boolean
  readonly moveCursorWordLeft: (options: MoveCursorOptions) => boolean
  readonly moveCursorWordRight: (options: MoveCursorOptions) => boolean
  readonly getSnapshot: () => TerminalState
}

export interface HotkeyContext {
  readonly interpreter: HotkeyInterpreter
  readonly performLocalErase: (direction: 'backspace' | 'delete') => boolean
  readonly encodeKeyEvent: (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => Uint8Array | null
  readonly emitData: (
    bytes: Uint8Array,
    options?: { skipLocalEcho?: boolean },
  ) => void
  readonly clearSelection: () => void
  readonly write: (data: Uint8Array | string) => void
  readonly onData?: (data: Uint8Array) => void
  readonly toggleShortcutGuide: (reason: ShortcutGuideReason) => void
  readonly shortcutGuideEnabled: boolean
  readonly keyboardSelectionAnchorRef: {
    current: SelectionPoint | null
  }
  readonly compositionStateRef: {
    current: { active: boolean; data: string }
  }
}

export interface HotkeyResult {
  readonly handled: boolean
  readonly preventDefault?: boolean
  readonly skipLocalEcho?: boolean
  readonly clearKeyboardAnchor?: boolean
}

export const createHotkeyContext = (context: HotkeyContext): HotkeyContext =>
  context
