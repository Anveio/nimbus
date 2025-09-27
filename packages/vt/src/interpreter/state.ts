import type { TerminalCapabilities } from '../types'

export interface TerminalAttributes {
  readonly bold: boolean
  readonly fg: number | null
  readonly bg: number | null
}

export interface TerminalCell {
  char: string
  attr: TerminalAttributes
}

export interface CursorPosition {
  row: number
  column: number
}

export interface TerminalState {
  rows: number
  columns: number
  cursor: CursorPosition
  scrollTop: number
  scrollBottom: number
  buffer: TerminalCell[][]
  attributes: TerminalAttributes
  tabStops: Set<number>
  autoWrap: boolean
  originMode: boolean
  cursorVisible: boolean
  savedCursor: CursorPosition | null
  savedAttributes: TerminalAttributes | null
}

export const cloneAttributes = (attributes: TerminalAttributes): TerminalAttributes => ({
  bold: attributes.bold,
  fg: attributes.fg,
  bg: attributes.bg,
})

const DEFAULT_ATTRIBUTES: TerminalAttributes = {
  bold: false,
  fg: null,
  bg: null,
}

const createBlankCell = (attributes: TerminalAttributes): TerminalCell => ({
  char: ' ',
  attr: cloneAttributes(attributes),
})

const createRow = (columns: number, attributes: TerminalAttributes): TerminalCell[] =>
  Array.from({ length: columns }, () => createBlankCell(attributes))

const createDefaultTabStops = (columns: number): Set<number> => {
  const stops = new Set<number>()
  for (let column = 8; column < columns; column += 8) {
    stops.add(column)
  }
  return stops
}

export const createInitialState = (
  capabilities: TerminalCapabilities,
): TerminalState => {
  const rows = capabilities.features.initialRows
  const columns = capabilities.features.initialColumns
  const attributes = DEFAULT_ATTRIBUTES
  const tabStops = capabilities.features.supportsTabStops
    ? createDefaultTabStops(columns)
    : new Set<number>()

  return {
    rows,
    columns,
    cursor: { row: 0, column: 0 },
    scrollTop: 0,
    scrollBottom: rows - 1,
    buffer: Array.from({ length: rows }, () => createRow(columns, attributes)),
    attributes,
    tabStops,
    autoWrap: capabilities.features.supportsAutoWrap,
    originMode: false,
    cursorVisible: true,
    savedCursor: null,
    savedAttributes: null,
  }
}

export const ensureRowCapacity = (state: TerminalState, row: number): void => {
  while (row >= state.rows) {
    state.buffer.push(createRow(state.columns, state.attributes))
    state.rows += 1
    state.scrollBottom = state.rows - 1
  }
}

export const getCell = (
  state: TerminalState,
  row: number,
  column: number,
): TerminalCell => {
  ensureRowCapacity(state, row)
  if (column < 0 || column >= state.columns) {
    throw new Error(`column out of bounds: ${column}`)
  }
  const rowBuffer = state.buffer[row]
  if (!rowBuffer) {
    throw new Error(`row out of bounds: ${row}`)
  }
  return rowBuffer[column]
}

export const setCell = (
  state: TerminalState,
  row: number,
  column: number,
  cell: TerminalCell,
): void => {
  ensureRowCapacity(state, row)
  if (column < 0 || column >= state.columns) {
    throw new Error(`column out of bounds: ${column}`)
  }
  const rowBuffer = state.buffer[row]
  if (!rowBuffer) {
    throw new Error(`row out of bounds: ${row}`)
  }
  rowBuffer[column] = cell
}

export const resetRow = (state: TerminalState, row: number): void => {
  if (row < 0 || row >= state.rows) {
    return
  }
  state.buffer[row] = createRow(state.columns, state.attributes)
}

export const blankCell = createBlankCell

export const defaultAttributes = DEFAULT_ATTRIBUTES

export const setTabStop = (state: TerminalState, column: number): void => {
  state.tabStops.add(column)
}

export const clearTabStop = (state: TerminalState, column: number): void => {
  state.tabStops.delete(column)
}

export const clearAllTabStops = (state: TerminalState): void => {
  state.tabStops.clear()
}

export const nextTabStop = (
  state: TerminalState,
  column: number,
): number | null => {
  for (let col = column + 1; col < state.columns; col += 1) {
    if (state.tabStops.has(col)) {
      return col
    }
  }
  return null
}

export const resetTabStops = (state: TerminalState): void => {
  state.tabStops = createDefaultTabStops(state.columns)
}
