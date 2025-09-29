import type { SosPmApcKind, TerminalCapabilities } from '../types'
import type { TerminalSelection } from './selection'

export type TerminalColor =
  | { readonly type: 'default' }
  | { readonly type: 'ansi'; readonly index: number }
  | { readonly type: 'ansi-bright'; readonly index: number }
  | { readonly type: 'palette'; readonly index: number }
  | { readonly type: 'rgb'; readonly r: number; readonly g: number; readonly b: number }

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
  char: string
  attr: TerminalAttributes
}

export interface CursorPosition {
  row: number
  column: number
}

export interface ClipboardEntry {
  readonly selection: string
  readonly data: string
}

export type CharsetId = 'us_ascii' | 'dec_special'

export interface TerminalCharsets {
  g0: CharsetId
  g1: CharsetId
  g2: CharsetId
  g3: CharsetId
  gl: 'g0' | 'g1' | 'g2' | 'g3'
  gr: 'g0' | 'g1' | 'g2' | 'g3'
  singleShift: 'g2' | 'g3' | null
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
  title: string
  clipboard: ClipboardEntry | null
  lastSosPmApc: { readonly kind: SosPmApcKind; readonly data: string } | null
  savedCursor: CursorPosition | null
  savedAttributes: TerminalAttributes | null
  selection: TerminalSelection | null
  charsets: TerminalCharsets
  keypadApplicationMode: boolean
  cursorKeysApplicationMode: boolean
  smoothScroll: boolean
  reverseVideo: boolean
  autoRepeat: boolean
}

const cloneColor = (color: TerminalColor): TerminalColor => {
  switch (color.type) {
    case 'ansi':
    case 'ansi-bright':
    case 'palette':
      return { type: color.type, index: color.index }
    case 'rgb':
      return { type: 'rgb', r: color.r, g: color.g, b: color.b }
    case 'default':
    default:
      return { type: 'default' }
  }
}

export const cloneAttributes = (
  attributes: TerminalAttributes,
): TerminalAttributes => ({
  bold: attributes.bold,
  faint: attributes.faint,
  italic: attributes.italic,
  underline: attributes.underline,
  blink: attributes.blink,
  inverse: attributes.inverse,
  hidden: attributes.hidden,
  strikethrough: attributes.strikethrough,
  foreground: cloneColor(attributes.foreground),
  background: cloneColor(attributes.background),
})

const DEFAULT_COLOR: TerminalColor = { type: 'default' }

const DEFAULT_ATTRIBUTES: TerminalAttributes = {
  bold: false,
  faint: false,
  italic: false,
  underline: 'none',
  blink: 'none',
  inverse: false,
  hidden: false,
  strikethrough: false,
  foreground: DEFAULT_COLOR,
  background: DEFAULT_COLOR,
}

const createBlankCell = (attributes: TerminalAttributes): TerminalCell => ({
  char: ' ',
  attr: cloneAttributes(attributes),
})

const createRow = (
  columns: number,
  attributes: TerminalAttributes,
): TerminalCell[] =>
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
  const attributes = cloneAttributes(DEFAULT_ATTRIBUTES)
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
    title: '',
    clipboard: null,
    lastSosPmApc: null,
    savedCursor: null,
    savedAttributes: null,
    selection: null,
    charsets: {
      g0: 'us_ascii',
      g1: 'us_ascii',
      g2: 'us_ascii',
      g3: 'us_ascii',
      gl: 'g0',
      gr: 'g1',
      singleShift: null,
    },
    keypadApplicationMode: false,
    cursorKeysApplicationMode: false,
    smoothScroll: false,
    reverseVideo: false,
    autoRepeat: true,
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
  const cell = rowBuffer[column]
  if (!cell) {
    throw new Error(`cell out of bounds: ${row}, ${column}`)
  }
  return cell
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
