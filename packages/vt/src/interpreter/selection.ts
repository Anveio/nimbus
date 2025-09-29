export interface SelectionPoint {
  readonly row: number
  readonly column: number
  readonly timestamp: number
}

export type SelectionKind = 'normal' | 'rectangular'

export type SelectionStatus = 'idle' | 'dragging'

export interface TerminalSelection {
  readonly anchor: SelectionPoint
  readonly focus: SelectionPoint
  readonly kind: SelectionKind
  readonly status: SelectionStatus
}

export interface SelectionBounds {
  readonly topLeft: SelectionPoint
  readonly bottomRight: SelectionPoint
}

export interface SelectionRowSegment {
  readonly row: number
  readonly startColumn: number
  readonly endColumn: number
}

export interface SelectionRange {
  readonly start: SelectionPoint
  readonly end: SelectionPoint
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

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

export const getSelectionBounds = (selection: TerminalSelection): SelectionBounds => {
  if (selection.kind === 'rectangular') {
    const minRow = Math.min(selection.anchor.row, selection.focus.row)
    const maxRow = Math.max(selection.anchor.row, selection.focus.row)
    const minColumn = Math.min(selection.anchor.column, selection.focus.column)
    const maxColumn = Math.max(selection.anchor.column, selection.focus.column)

    const topSource = selection.anchor.row <= selection.focus.row
      ? selection.anchor
      : selection.focus
    const bottomSource = selection.anchor.row >= selection.focus.row
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

export const isSelectionCollapsed = (
  selection: TerminalSelection,
): boolean => {
  const { topLeft, bottomRight } = getSelectionBounds(selection)
  return topLeft.row === bottomRight.row && topLeft.column === bottomRight.column
}

export const getSelectionRange = (
  selection: TerminalSelection,
): SelectionRange => {
  const { topLeft, bottomRight } = getSelectionBounds(selection)
  return {
    start: {
      row: topLeft.row,
      column: topLeft.column,
      timestamp: topLeft.timestamp,
    },
    end: {
      row: bottomRight.row,
      column: bottomRight.column,
      timestamp: bottomRight.timestamp,
    },
  }
}

export const clampSelectionRange = (
  range: SelectionRange,
  rows: number,
  columns: number,
): SelectionRange => {
  const maxRow = Math.max(0, rows - 1)
  const clampRow = (row: number): number => clamp(row, 0, maxRow)
  return {
    start: {
      row: clampRow(range.start.row),
      column: clampCaret(range.start.column, columns),
      timestamp: range.start.timestamp,
    },
    end: {
      row: clampRow(range.end.row),
      column: clampCaret(range.end.column, columns),
      timestamp: range.end.timestamp,
    },
  }
}

export const areSelectionsEqual = (
  a: TerminalSelection | null,
  b: TerminalSelection | null,
): boolean => {
  if (a === b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  return (
    a.kind === b.kind &&
    a.status === b.status &&
    a.anchor.row === b.anchor.row &&
    a.anchor.column === b.anchor.column &&
    a.anchor.timestamp === b.anchor.timestamp &&
    a.focus.row === b.focus.row &&
    a.focus.column === b.focus.column &&
    a.focus.timestamp === b.focus.timestamp
  )
}
