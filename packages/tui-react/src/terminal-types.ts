/**
 * Local replica of the terminal shape used by the renderer/runtime bridge.
 * We intentionally mirror the pieces consumed by `@mana/tui-react` so the
 * package no longer depends on `@mana/vt` directly. The runtime created by
 * renderer implementations still conforms to these structures.
 */

export type SosPmApcKind = 'SOS' | 'PM' | 'APC'

export interface CursorPosition {
  readonly row: number
  readonly column: number
}

export interface TerminalColorRgb {
  readonly type: 'rgb'
  readonly r: number
  readonly g: number
  readonly b: number
}

export interface TerminalColorAnsi {
  readonly type: 'ansi'
  readonly index: number
}

export interface TerminalColorAnsiBright {
  readonly type: 'ansi-bright'
  readonly index: number
}

export interface TerminalColorPalette {
  readonly type: 'palette'
  readonly index: number
}

export interface TerminalColorDefault {
  readonly type: 'default'
}

export type TerminalColor =
  | TerminalColorRgb
  | TerminalColorAnsi
  | TerminalColorAnsiBright
  | TerminalColorPalette
  | TerminalColorDefault

export interface TerminalAttributes {
  readonly bold: boolean
  readonly faint: boolean
  readonly italic: boolean
  readonly underline: 'none' | 'single' | 'double'
  readonly blink: 'none' | 'slow' | 'rapid'
  readonly inverse: boolean
  readonly hidden: boolean
  readonly strikethrough: boolean
  readonly foreground: TerminalColor
  readonly background: TerminalColor
}

export interface TerminalCell {
  readonly char: string
  readonly attr: TerminalAttributes
  readonly protected: boolean
}

export interface ClipboardEntry {
  readonly kind: 'text'
  readonly data: string
}

export interface TerminalPointerModifierState {
  readonly shift?: boolean
  readonly alt?: boolean
  readonly meta?: boolean
  readonly ctrl?: boolean
}

export type TerminalPointerButton =
  | 'left'
  | 'middle'
  | 'right'
  | 'aux1'
  | 'aux2'
  | 'none'

export type TerminalSelectionKind = 'normal' | 'rectangular'
export type TerminalSelectionStatus = 'idle' | 'dragging'

export interface SelectionPoint {
  readonly row: number
  readonly column: number
  readonly timestamp: number
}

export interface TerminalSelection {
  readonly anchor: SelectionPoint
  readonly focus: SelectionPoint
  readonly kind: TerminalSelectionKind
  readonly status: TerminalSelectionStatus
}

export interface TerminalState {
  readonly rows: number
  readonly columns: number
  readonly cursor: CursorPosition
  readonly scrollTop: number
  readonly scrollBottom: number
  readonly buffer: TerminalCell[][]
  readonly attributes: TerminalAttributes
  readonly tabStops: ReadonlySet<number>
  readonly autoWrap: boolean
  readonly originMode: boolean
  readonly cursorVisible: boolean
  readonly title: string
  readonly clipboard: ClipboardEntry | null
  readonly lastSosPmApc: { readonly kind: SosPmApcKind; readonly data: string } | null
  readonly selection: TerminalSelection | null
  readonly keypadApplicationMode: boolean
  readonly cursorKeysApplicationMode: boolean
  readonly reverseVideo: boolean
  readonly lineAttributes: Array<'single' | 'double-top' | 'double-bottom'>
  readonly c1Transmission: '7-bit' | '8-bit'
  readonly answerback: string
  readonly printer: {
    readonly controller: boolean
    readonly autoPrint: boolean
  }
  readonly input: {
    readonly pointer: {
      readonly tracking: 'off' | 'button' | 'normal' | 'any-motion'
      readonly encoding: 'default' | 'utf8' | 'sgr'
    }
    readonly focusReporting: boolean
    readonly bracketedPaste: boolean
  }
}

export interface TerminalModeUpdate {
  readonly type: 'mode'
  readonly mode:
    | 'origin'
    | 'autowrap'
    | 'reverse-video'
    | 'smooth-scroll'
    | 'keypad-application'
    | 'cursor-keys-application'
    | 'focus-reporting'
    | 'bracketed-paste'
  readonly value: boolean
}

export interface TerminalPaletteUpdate {
  readonly type: 'palette'
  readonly index: number
  readonly color: TerminalColor
}

export interface TerminalPointerTrackingUpdate {
  readonly type: 'pointer-tracking'
  readonly tracking: 'off' | 'button' | 'normal' | 'any-motion'
  readonly encoding: 'default' | 'utf8' | 'sgr'
}

export type TerminalUpdate =
  | { readonly type: 'cells'; readonly cells: ReadonlyArray<{ readonly row: number; readonly column: number; readonly cell: TerminalCell }> }
  | { readonly type: 'cursor'; readonly position: CursorPosition }
  | { readonly type: 'clear'; readonly scope: 'display' | 'display-after-cursor' | 'line' | 'line-after-cursor' }
  | { readonly type: 'scroll'; readonly amount: number }
  | { readonly type: 'bell' }
  | { readonly type: 'attributes'; readonly attributes: TerminalAttributes }
  | { readonly type: 'scroll-region'; readonly top: number; readonly bottom: number }
  | TerminalModeUpdate
  | { readonly type: 'cursor-visibility'; readonly value: boolean }
  | { readonly type: 'osc'; readonly identifier: string; readonly data: string }
  | { readonly type: 'title'; readonly title: string }
  | { readonly type: 'clipboard'; readonly clipboard: ClipboardEntry }
  | TerminalPaletteUpdate
  | TerminalPointerTrackingUpdate
  | { readonly type: 'selection-set'; readonly selection: TerminalSelection }
  | { readonly type: 'selection-update'; readonly selection: TerminalSelection }
  | { readonly type: 'selection-clear' }
  | { readonly type: 'c1-transmission'; readonly value: '7-bit' | '8-bit' }
  | {
      readonly type: 'dcs-start'
      readonly finalByte: number
      readonly params: ReadonlyArray<number>
      readonly intermediates: ReadonlyArray<number>
    }
  | { readonly type: 'dcs-data'; readonly data: string }
  | {
      readonly type: 'dcs-end'
      readonly finalByte: number
      readonly params: ReadonlyArray<number>
      readonly intermediates: ReadonlyArray<number>
      readonly data: string
    }
  | { readonly type: 'sos-pm-apc'; readonly kind: SosPmApcKind; readonly data: string }
  | { readonly type: 'response'; readonly data: Uint8Array }

export const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

export interface SelectionBounds {
  readonly topLeft: SelectionPoint
  readonly bottomRight: SelectionPoint
}

const clonePoint = (
  point: SelectionPoint,
  row: number,
  column: number,
): SelectionPoint => ({
  row,
  column,
  timestamp: point.timestamp,
})

const comparePoints = (a: SelectionPoint, b: SelectionPoint): number => {
  if (a.row !== b.row) {
    return a.row - b.row
  }
  if (a.column !== b.column) {
    return a.column - b.column
  }
  return a.timestamp - b.timestamp
}

const clampCaret = (value: number, columns: number): number => {
  if (columns <= 0) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > columns) {
    return columns
  }
  return value
}

export const getSelectionBounds = (
  selection: TerminalSelection,
): SelectionBounds => {
  if (selection.kind === 'rectangular') {
    const minRow = Math.min(selection.anchor.row, selection.focus.row)
    const maxRow = Math.max(selection.anchor.row, selection.focus.row)
    const minColumn = Math.min(selection.anchor.column, selection.focus.column)
    const maxColumn = Math.max(selection.anchor.column, selection.focus.column)

    const topSource =
      selection.anchor.row <= selection.focus.row
        ? selection.anchor
        : selection.focus
    const bottomSource =
      selection.anchor.row >= selection.focus.row
        ? selection.anchor
        : selection.focus

    return {
      topLeft: clonePoint(topSource, minRow, minColumn),
      bottomRight: clonePoint(bottomSource, maxRow, maxColumn),
    }
  }

  const order = comparePoints(selection.anchor, selection.focus)
  if (order <= 0) {
    return {
      topLeft: selection.anchor,
      bottomRight: selection.focus,
    }
  }
  return {
    topLeft: selection.focus,
    bottomRight: selection.anchor,
  }
}

export interface SelectionRowSegment {
  readonly row: number
  readonly startColumn: number
  readonly endColumn: number
}

export const getSelectionRowSegment = (
  selection: TerminalSelection,
  row: number,
  columns: number,
): SelectionRowSegment | null => {
  if (columns <= 0) {
    return null
  }

  const { topLeft, bottomRight } = getSelectionBounds(selection)
  if (row < topLeft.row || row > bottomRight.row) {
    return null
  }

  if (selection.kind === 'rectangular') {
    const caretStart = clampCaret(
      Math.min(selection.anchor.column, selection.focus.column),
      columns,
    )
    const caretEnd = clampCaret(
      Math.max(selection.anchor.column, selection.focus.column),
      columns,
    )
    if (caretStart >= caretEnd) {
      return null
    }
    return {
      row,
      startColumn: caretStart,
      endColumn: caretEnd - 1,
    }
  }

  const rowStartCaret = clampCaret(
    row === topLeft.row ? topLeft.column : 0,
    columns,
  )
  const rowEndCaret = clampCaret(
    row === bottomRight.row ? bottomRight.column : columns,
    columns,
  )

  if (rowStartCaret >= rowEndCaret) {
    return null
  }
  return {
    row,
    startColumn: rowStartCaret,
    endColumn: rowEndCaret - 1,
  }
}

export const getSelectionRowSegments = (
  selection: TerminalSelection,
  columns: number,
): ReadonlyArray<SelectionRowSegment> => {
  if (columns <= 0) {
    return []
  }

  const { topLeft, bottomRight } = getSelectionBounds(selection)
  const segments: SelectionRowSegment[] = []
  for (let row = topLeft.row; row <= bottomRight.row; row += 1) {
    const segment = getSelectionRowSegment(selection, row, columns)
    if (segment) {
      segments.push(segment)
    }
  }
  return segments
}

export const isSelectionCollapsed = (selection: TerminalSelection): boolean => {
  const { topLeft, bottomRight } = getSelectionBounds(selection)
  return (
    topLeft.row === bottomRight.row && topLeft.column === bottomRight.column
  )
}
