import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  SelectionPoint,
  TerminalState,
  TerminalUpdate,
} from '@mana-ssh/vt'

export type ShortcutGuideReason = 'hotkey' | 'imperative'

export interface MoveCursorOptions {
  readonly extendSelection: boolean
  readonly selectionAnchor: SelectionPoint | null
}

export interface HotkeyInterpreter {
  readonly moveCursorLeft: (options: MoveCursorOptions) => TerminalUpdate[]
  readonly moveCursorRight: (options: MoveCursorOptions) => TerminalUpdate[]
  readonly moveCursorUp: (options: MoveCursorOptions) => TerminalUpdate[]
  readonly moveCursorDown: (options: MoveCursorOptions) => TerminalUpdate[]
  readonly moveCursorLineStart: (options: MoveCursorOptions) => TerminalUpdate[]
  readonly moveCursorLineEnd: (options: MoveCursorOptions) => TerminalUpdate[]
  readonly moveCursorWordLeft: (options: MoveCursorOptions) => TerminalUpdate[]
  readonly moveCursorWordRight: (options: MoveCursorOptions) => TerminalUpdate[]
  readonly getSnapshot: () => TerminalState
}

export interface HotkeyContext {
  readonly interpreter: HotkeyInterpreter
  readonly performLocalErase: (direction: 'backspace' | 'delete') => boolean
  readonly applyUpdates: (updates: TerminalUpdate[]) => void
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

export const createHotkeyContext = (context: HotkeyContext): HotkeyContext => context
