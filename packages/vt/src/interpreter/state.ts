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

export const createInitialState = (
  capabilities: TerminalCapabilities,
): TerminalState => {
  const rows = capabilities.features.initialRows
  const columns = capabilities.features.initialColumns
  const attributes = DEFAULT_ATTRIBUTES

  return {
    rows,
    columns,
    cursor: { row: 0, column: 0 },
    scrollTop: 0,
    scrollBottom: rows - 1,
    buffer: Array.from({ length: rows }, () => createRow(columns, attributes)),
    attributes,
  }
}

export const ensureRowCapacity = (state: TerminalState, row: number): void => {
  while (row >= state.rows) {
    state.buffer.push(createRow(state.columns, state.attributes))
    state.rows += 1
    state.scrollBottom = state.rows - 1
  }
}

export const resetRow = (state: TerminalState, row: number): void => {
  if (row < 0 || row >= state.rows) {
    return
  }
  state.buffer[row] = createRow(state.columns, state.attributes)
}

export const blankCell = createBlankCell

export const defaultAttributes = DEFAULT_ATTRIBUTES
