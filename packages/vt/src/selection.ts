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

const comparePoints = (a: SelectionPoint, b: SelectionPoint): number => {
  if (a.row !== b.row) {
    return a.row - b.row
  }
  if (a.column !== b.column) {
    return a.column - b.column
  }
  return a.timestamp - b.timestamp
}

const clonePoint = (point: SelectionPoint, row: number, column: number): SelectionPoint => ({
  row,
  column,
  timestamp: point.timestamp,
})

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

const clampColumn = (value: number, columns: number): number => {
  if (columns <= 0) {
    return 0
  }
  return clamp(value, 0, columns - 1)
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
    const startColumn = clampColumn(
      Math.min(selection.anchor.column, selection.focus.column),
      columns,
    )
    const endColumn = clampColumn(
      Math.max(selection.anchor.column, selection.focus.column),
      columns,
    )
    if (startColumn > endColumn) {
      return null
    }
    return {
      row,
      startColumn,
      endColumn,
    }
  }

  const startColumn = clampColumn(
    row === topLeft.row ? topLeft.column : 0,
    columns,
  )
  const endColumn = clampColumn(
    row === bottomRight.row ? bottomRight.column : columns - 1,
    columns,
  )
  if (startColumn > endColumn) {
    return null
  }
  return {
    row,
    startColumn,
    endColumn,
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
