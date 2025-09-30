import { resolveTerminalCapabilities } from '../capabilities'
import {
  type ParserEvent,
  ParserEventType,
  type ParserOptions,
  type TerminalCapabilities,
  type C1TransmissionMode,
} from '../types'
import {
  type PrinterController,
  createNoopPrinterController,
} from '../printer/controller'
import type { CellDelta, TerminalUpdate } from './delta'
import type { SelectionPoint, TerminalSelection } from './selection'
import {
  areSelectionsEqual,
  clampSelectionRange,
  getSelectionRange,
  isSelectionCollapsed,
} from './selection'
import {
  blankCell,
  type CharsetId,
  type ClipboardEntry,
  clearAllTabStops,
  clearTabStop,
  cloneAttributes,
  createInitialState,
  defaultAttributes,
  ensureRowCapacity,
  nextTabStop,
  resetRow,
  resetTabStops,
  setCell,
  setTabStop,
  type TerminalAttributes,
  type TerminalCell,
  type TerminalColor,
  type TerminalState,
} from './state'
import { resolveCharset, translateGlyph } from './charsets'

const QUESTION_MARK = '?'.charCodeAt(0)

const cloneSelection = (selection: TerminalSelection): TerminalSelection => ({
  anchor: {
    row: selection.anchor.row,
    column: selection.anchor.column,
    timestamp: selection.anchor.timestamp,
  },
  focus: {
    row: selection.focus.row,
    column: selection.focus.column,
    timestamp: selection.focus.timestamp,
  },
  kind: selection.kind,
  status: selection.status,
})

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const clampColorComponent = (value: number): number =>
  clamp(Math.trunc(value), 0, 255)

interface EditSelectionOptions {
  readonly replacement: string
  readonly selection?: TerminalSelection | null
  readonly attributesOverride?: TerminalAttributes
}

interface CursorMoveOptions {
  readonly extendSelection?: boolean
  readonly selectionAnchor?: SelectionPoint | null
  readonly clampToLineEnd?: boolean
  readonly clampToContentRow?: boolean
}

const cloneCell = (cell: TerminalCell): TerminalCell => ({
  char: cell.char,
  attr: cloneAttributes(cell.attr),
  protected: cell.protected,
})

const cellsFromText = (
  text: string,
  attributes: TerminalAttributes,
): TerminalCell[] =>
  Array.from(text).map((char) => ({
    char,
    attr: cloneAttributes(attributes),
    protected: false,
  }))

interface ActiveDcs {
  readonly finalByte: number
  readonly params: ReadonlyArray<number>
  readonly intermediates: ReadonlyArray<number>
  readonly chunks: string[]
}

export interface InterpreterOptions {
  readonly parser?: ParserOptions
  readonly capabilities?: TerminalCapabilities
  readonly printer?: PrinterController
}

export class TerminalInterpreter {
  readonly capabilities: TerminalCapabilities
  private state: TerminalState
  private readonly textDecoder = new TextDecoder()
  private readonly printDecoder = new TextDecoder('utf-8', { fatal: false })
  private activeDcs: ActiveDcs | null = null
  private readonly printer: PrinterController

  constructor(options: InterpreterOptions = {}) {
    this.capabilities =
      options.capabilities ?? resolveTerminalCapabilities(options.parser ?? {})
    this.state = createInitialState(this.capabilities)
    this.printer = options.printer ?? createNoopPrinterController()
  }

  get snapshot(): TerminalState {
    return this.state
  }

  moveCursorLeft(options: CursorMoveOptions = {}): TerminalUpdate[] {
    const targetColumn = Math.max(this.state.cursor.column - 1, 0)
    return this.moveCursorTo(
      {
        row: this.state.cursor.row,
        column: targetColumn,
      },
      options,
    )
  }

  moveCursorRight(options: CursorMoveOptions = {}): TerminalUpdate[] {
    const targetColumn = Math.min(
      this.state.cursor.column + 1,
      this.state.columns - 1,
    )
    return this.moveCursorTo(
      {
        row: this.state.cursor.row,
        column: targetColumn,
      },
      options,
    )
  }

  moveCursorUp(options: CursorMoveOptions = {}): TerminalUpdate[] {
    const targetRow = Math.max(this.state.cursor.row - 1, 0)
    return this.moveCursorTo(
      {
        row: targetRow,
        column: this.state.cursor.column,
      },
      options,
    )
  }

  moveCursorDown(options: CursorMoveOptions = {}): TerminalUpdate[] {
    const targetRow = Math.min(this.state.cursor.row + 1, this.state.rows - 1)
    return this.moveCursorTo(
      {
        row: targetRow,
        column: this.state.cursor.column,
      },
      options,
    )
  }

  moveCursorWordLeft(options: CursorMoveOptions = {}): TerminalUpdate[] {
    const targetColumn = this.findWordBoundaryLeft(
      this.state.cursor.row,
      this.state.cursor.column,
    )
    return this.moveCursorTo(
      {
        row: this.state.cursor.row,
        column: targetColumn,
      },
      options,
    )
  }

  moveCursorWordRight(options: CursorMoveOptions = {}): TerminalUpdate[] {
    const targetColumn = this.findWordBoundaryRight(
      this.state.cursor.row,
      this.state.cursor.column,
    )
    return this.moveCursorTo(
      {
        row: this.state.cursor.row,
        column: targetColumn,
      },
      options,
    )
  }

  moveCursorLineStart(options: CursorMoveOptions = {}): TerminalUpdate[] {
    return this.moveCursorTo(
      {
        row: this.state.cursor.row,
        column: 0,
      },
      options,
    )
  }

  moveCursorLineEnd(options: CursorMoveOptions = {}): TerminalUpdate[] {
    const targetColumn = this.findLineEndColumn(this.state.cursor.row)
    return this.moveCursorTo(
      {
        row: this.state.cursor.row,
        column: targetColumn,
      },
      options,
    )
  }

  handleEvent(event: ParserEvent): TerminalUpdate[] {
    switch (event.type) {
      case ParserEventType.Print:
        return this.handlePrint(event.data)
      case ParserEventType.Execute:
        return this.handleExecute(event.codePoint)
      case ParserEventType.CsiDispatch:
        return this.handleCsi(event)
      case ParserEventType.EscDispatch:
        return this.handleEsc(event)
      case ParserEventType.OscDispatch:
        return this.handleOsc(event)
      case ParserEventType.DcsHook:
        return this.handleDcsHook(event)
      case ParserEventType.DcsPut:
        return this.handleDcsPut(event)
      case ParserEventType.DcsUnhook:
        return this.handleDcsUnhook()
      case ParserEventType.SosPmApcDispatch:
        return this.handleSosPmApc(event)
      default:
        return []
    }
  }

  handleEvents(events: Iterable<ParserEvent>): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []
    for (const event of events) {
      updates.push(...this.handleEvent(event))
    }
    return updates
  }

  reset(): void {
    this.state = createInitialState(this.capabilities)
    this.activeDcs = null
    this.printDecoder.decode()
  }

  setSelection(selection: TerminalSelection): TerminalUpdate[] {
    return this.applySelection(selection, 'selection-set')
  }

  updateSelection(selection: TerminalSelection): TerminalUpdate[] {
    const hasExistingSelection = this.state.selection !== null
    return this.applySelection(
      selection,
      hasExistingSelection ? 'selection-update' : 'selection-set',
    )
  }

  clearSelection(): TerminalUpdate[] {
    if (this.state.selection === null) {
      return []
    }
    this.state.selection = null
    return [{ type: 'selection-clear' }]
  }

  editSelection(options: EditSelectionOptions): TerminalUpdate[] {
    const replacement = options.replacement
    const activeSelection = options.selection ?? this.state.selection
    const selectionIsCollapsed =
      !activeSelection || isSelectionCollapsed(activeSelection)

    const defaultSelection: TerminalSelection = selectionIsCollapsed
      ? {
          anchor: {
            row: this.state.cursor.row,
            column: this.state.cursor.column,
            timestamp: Date.now(),
          },
          focus: {
            row: this.state.cursor.row,
            column: this.state.cursor.column,
            timestamp: Date.now(),
          },
          kind: 'normal',
          status: 'idle',
        }
      : activeSelection!

    if (defaultSelection.kind === 'rectangular') {
      return []
    }

    const range = clampSelectionRange(
      getSelectionRange(defaultSelection),
      this.state.rows,
      this.state.columns,
    )

    const startRow = range.start.row
    const startColumn = clamp(range.start.column, 0, this.state.columns)
    const endRow = range.end.row
    const endColumn = clamp(range.end.column, 0, this.state.columns)

    const replacementAttributes =
      options.attributesOverride ?? this.state.attributes

    const beforeCells: TerminalCell[] = []
    const afterCells: TerminalCell[] = []

    if (startRow < this.state.rows) {
      ensureRowCapacity(this.state, startRow)
      const row = this.state.buffer[startRow] ?? []
      for (
        let column = 0;
        column < Math.min(startColumn, this.state.columns);
        column += 1
      ) {
        const cell = row[column]
        if (cell) {
          beforeCells.push(cloneCell(cell))
        }
      }
    }

    if (endRow < this.state.rows) {
      ensureRowCapacity(this.state, endRow)
      const row = this.state.buffer[endRow] ?? []
      for (let column = endColumn; column < this.state.columns; column += 1) {
        const cell = row[column]
        if (cell) {
          afterCells.push(cloneCell(cell))
        }
      }
    }

    const replacementLines = replacement.split(/\r?\n/)

    if (
      replacement.startsWith(' ') &&
      beforeCells.length > 0 &&
      beforeCells[beforeCells.length - 1]!.char === ' '
    ) {
      beforeCells.pop()
    }

    const composedLines: TerminalCell[][] = []

    if (replacementLines.length === 0) {
      composedLines.push([...beforeCells, ...afterCells])
    } else {
      replacementLines.forEach((line, index) => {
        const lineCells = cellsFromText(line, replacementAttributes)
        if (index === 0) {
          composedLines.push([...beforeCells, ...lineCells])
        } else {
          composedLines.push([...lineCells])
        }
      })
      composedLines[composedLines.length - 1]?.push(...afterCells)
    }

    const cellUpdates: CellDelta[] = []

    const writeRow = (rowIndex: number, cells: TerminalCell[]): void => {
      if (rowIndex < 0 || rowIndex >= this.state.rows) {
        return
      }
      ensureRowCapacity(this.state, rowIndex)
      const limit = Math.min(cells.length, this.state.columns)
      for (let column = 0; column < limit; column += 1) {
        const cell = cloneCell(cells[column]!)
        setCell(this.state, rowIndex, column, cell)
        cellUpdates.push({ row: rowIndex, column, cell })
      }
      for (let column = limit; column < this.state.columns; column += 1) {
        const cell = blankCell(this.state.attributes)
        setCell(this.state, rowIndex, column, cell)
        cellUpdates.push({ row: rowIndex, column, cell })
      }
    }

    const chunks: TerminalCell[][] = []
    composedLines.forEach((line) => {
      if (line.length === 0) {
        chunks.push([])
        return
      }
      for (let index = 0; index < line.length; index += this.state.columns) {
        chunks.push(line.slice(index, index + this.state.columns))
      }
    })

    if (composedLines.length === 0) {
      chunks.push(beforeCells.concat(afterCells))
    }

    let rowsWritten = 0
    const maxRows = this.state.rows
    for (const chunk of chunks) {
      const rowIndex = startRow + rowsWritten
      if (rowIndex >= maxRows) {
        break
      }
      writeRow(rowIndex, chunk)
      rowsWritten += 1
    }

    const originalSpan = endRow >= startRow ? endRow - startRow + 1 : 1
    if (rowsWritten < originalSpan) {
      for (
        let rowIndex = startRow + rowsWritten;
        rowIndex <= endRow && rowIndex < this.state.rows;
        rowIndex += 1
      ) {
        const blanks: TerminalCell[] = Array.from(
          { length: this.state.columns },
          () => blankCell(this.state.attributes),
        )
        writeRow(rowIndex, blanks)
      }
    }

    if (
      cellUpdates.length === 0 &&
      replacement.length === 0 &&
      selectionIsCollapsed
    ) {
      return []
    }

    const updates: TerminalUpdate[] = []
    if (cellUpdates.length > 0) {
      updates.push({ type: 'cells', cells: cellUpdates })
    }

    const newCursor = this.resolveCursorAfterEdit({
      startRow,
      startColumn,
      replacement,
    })

    this.state.cursor = newCursor
    updates.push(this.cursorUpdate())

    if (!selectionIsCollapsed) {
      updates.push(...this.clearSelection())
    }

    return updates
  }

  private applySelection(
    selection: TerminalSelection,
    updateType: 'selection-set' | 'selection-update',
  ): TerminalUpdate[] {
    const next = cloneSelection(selection)
    const previous = this.state.selection
    this.state.selection = next
    if (areSelectionsEqual(previous, next)) {
      return []
    }
    return [{ type: updateType, selection: next }]
  }

  private handlePrint(data: Uint8Array): TerminalUpdate[] {
    if (data.length === 0) {
      return []
    }

    if (this.state.printer.controller || this.state.printer.autoPrint) {
      this.printer.write(data.slice())
    }

    const text = this.printDecoder.decode(data, { stream: true })
    const cellUpdates: CellDelta[] = []
    const miscUpdates: TerminalUpdate[] = []

    for (const char of text) {
      const result = this.writeChar(char)
      cellUpdates.push(...result.cells)
      miscUpdates.push(...result.updates)
    }

    const updates: TerminalUpdate[] = []
    if (cellUpdates.length > 0) {
      updates.push({ type: 'cells', cells: cellUpdates })
    }
    updates.push(...miscUpdates)
    return updates
  }

  private writeChar(char: string): {
    cells: CellDelta[]
    updates: TerminalUpdate[]
  } {
    if (char === '\r') {
      return { cells: [], updates: this.carriageReturn() }
    }
    if (char === '\n') {
      return { cells: [], updates: this.lineFeed(true) }
    }

    const row = this.state.cursor.row
    const column = this.state.cursor.column
    ensureRowCapacity(this.state, row)

    const renderedChar = this.renderChar(char)
    const cell: TerminalCell = {
      char: renderedChar,
      attr: cloneAttributes(this.state.attributes),
      protected: this.state.protectedMode === 'dec',
    }
    setCell(this.state, row, column, cell)

    const cells: CellDelta[] = [{ row, column, cell }]
    const updates: TerminalUpdate[] = []

    this.state.cursor.column += 1
    if (this.state.cursor.column >= this.state.columns) {
      if (this.state.autoWrap && this.capabilities.features.supportsAutoWrap) {
        this.state.cursor.column = this.state.columns - 1
        updates.push(...this.lineFeed(true))
      } else {
        this.state.cursor.column = this.state.columns - 1
        updates.push(this.cursorUpdate())
      }
    } else {
      updates.push(this.cursorUpdate())
    }

    return { cells, updates }
  }

  private resolveCursorAfterEdit(params: {
    startRow: number
    startColumn: number
    replacement: string
  }): { row: number; column: number } {
    let row = clamp(params.startRow, 0, this.state.rows - 1)
    let column = clamp(params.startColumn, 0, this.state.columns - 1)

    if (params.replacement.length === 0) {
      return { row, column }
    }

    for (const char of params.replacement) {
      if (char === '\n') {
        row = clamp(row + 1, 0, this.state.rows - 1)
        column = 0
        continue
      }

      column += 1
      if (column >= this.state.columns) {
        column = 0
        row = clamp(row + 1, 0, this.state.rows - 1)
      }
    }

    return { row, column }
  }

  moveCursorTo(
    target: { row: number; column: number },
    options: CursorMoveOptions,
  ): TerminalUpdate[] {
    const clampedRow = options.clampToContentRow
      ? this.clampRowToContent(target.row)
      : clamp(target.row, 0, Math.max(0, this.state.rows - 1))
    const clampedColumn = options.clampToLineEnd
      ? this.clampColumnForRow(clampedRow, target.column)
      : clamp(target.column, 0, Math.max(0, this.state.columns - 1))

    const previousCursor = { ...this.state.cursor }
    const updates: TerminalUpdate[] = []

    this.state.cursor = { row: clampedRow, column: clampedColumn }
    updates.push(this.cursorUpdate())

    if (options.extendSelection) {
      const anchor =
        options.selectionAnchor ??
        this.state.selection?.anchor ??
        ({
          row: previousCursor.row,
          column: previousCursor.column,
          timestamp: Date.now(),
        } satisfies SelectionPoint)

      const selection: TerminalSelection = {
        anchor,
        focus: {
          row: this.state.cursor.row,
          column: this.state.cursor.column,
          timestamp: Date.now(),
        },
        kind: 'normal',
        status: 'idle',
      }

      const selectionUpdates = this.state.selection
        ? this.updateSelection(selection)
        : this.setSelection(selection)
      updates.unshift(...selectionUpdates)
    } else if (this.state.selection) {
      updates.unshift(...this.clearSelection())
    }

    return updates
  }

  clampCursorColumn(row: number, column: number): number {
    const clampedRow = clamp(row, 0, Math.max(0, this.state.rows - 1))
    return this.clampColumnForRow(clampedRow, column)
  }

  private clampColumnForRow(row: number, column: number): number {
    const maxColumn = this.findLineEndColumn(row)
    return clamp(column, 0, maxColumn)
  }

  private clampRowToContent(row: number): number {
    const maxRow = this.findLastContentRow()
    return clamp(row, 0, maxRow)
  }

  private findLineEndColumn(row: number): number {
    if (this.state.columns === 0) {
      return 0
    }
    const rowBuffer = this.state.buffer[row] ?? []
    for (let index = this.state.columns - 1; index >= 0; index -= 1) {
      const char = rowBuffer[index]?.char ?? ' '
      if (char !== ' ') {
        return Math.min(index + 1, this.state.columns - 1)
      }
    }
    return 0
  }

  private findWordBoundaryLeft(row: number, column: number): number {
    if (column <= 0) {
      return 0
    }
    const rowBuffer = this.state.buffer[row] ?? []
    let index = column

    while (index > 0 && this.isWhitespace(rowBuffer[index - 1]?.char ?? ' ')) {
      index -= 1
    }

    while (index > 0 && !this.isWhitespace(rowBuffer[index - 1]?.char ?? ' ')) {
      index -= 1
    }

    return index
  }

  private findWordBoundaryRight(row: number, column: number): number {
    const rowBuffer = this.state.buffer[row] ?? []
    let index = column
    const maxColumn = this.findLineEndColumn(row)

    while (
      index <= maxColumn &&
      !this.isWhitespace(rowBuffer[index]?.char ?? ' ')
    ) {
      index += 1
    }

    while (
      index <= maxColumn &&
      this.isWhitespace(rowBuffer[index]?.char ?? ' ')
    ) {
      index += 1
    }

    return Math.min(index, maxColumn)
  }

  private isWhitespace(char: string): boolean {
    return char.trim().length === 0
  }

  private resolveCharsetForCode(codePoint: number): {
    charset: CharsetId
    baseChar: string
  } {
    const charsets = this.state.charsets

    if (codePoint > 0xff) {
      if (charsets.singleShift) {
        this.state.charsets = { ...charsets, singleShift: null }
      }
      return {
        charset: charsets[charsets.gl],
        baseChar: String.fromCodePoint(codePoint),
      }
    }

    if (codePoint >= 0x80) {
      if (charsets.singleShift) {
        this.state.charsets = { ...charsets, singleShift: null }
      }
      return {
        charset: charsets[charsets.gl],
        baseChar: String.fromCodePoint(codePoint),
      }
    }

    let selector: 'g0' | 'g1' | 'g2' | 'g3' = charsets.gl
    let baseCode = codePoint

    if (charsets.singleShift) {
      selector = charsets.singleShift
      this.state.charsets = { ...charsets, singleShift: null }
      baseCode = codePoint & 0x7f
    } else if (codePoint >= 0x20 && codePoint <= 0x7f) {
      selector = charsets.gl
    } else if (codePoint >= 0xa0 && codePoint <= 0xff) {
      selector = charsets.gr
      baseCode = (codePoint & 0x7f) || 0x20
    }

    const charsetId = charsets[selector]
    const baseChar = String.fromCharCode(baseCode)
    return { charset: charsetId, baseChar }
  }

  private renderChar(char: string): string {
    if (char.length === 0) {
      return char
    }
    const codePoint = char.codePointAt(0) ?? char.charCodeAt(0)
    if (codePoint > 0xff || codePoint >= 0x80) {
      if (this.state.charsets.singleShift) {
        this.state.charsets = { ...this.state.charsets, singleShift: null }
      }
      return char
    }
    const { charset, baseChar } = this.resolveCharsetForCode(codePoint)
    return translateGlyph(baseChar, charset)
  }

  private emitResponse(payload: string): TerminalUpdate[] {
    const normalised = this.applyC1Transmission(payload)
    return [{ type: 'response', data: this.encodeResponse(normalised) }]
  }

  private applyC1Transmission(sequence: string): string {
    if (this.state.c1Transmission !== '8-bit') {
      return sequence
    }
    return sequence.replaceAll('\u001B[', String.fromCharCode(0x9b))
  }

  private setC1Transmission(mode: C1TransmissionMode): TerminalUpdate[] {
    if (!this.capabilities.features.supportsC1TransmissionToggle) {
      return []
    }
    if (this.state.c1Transmission === mode) {
      return []
    }
    this.state.c1Transmission = mode
    return [{ type: 'c1-transmission', value: mode }]
  }

  private encodeResponse(sequence: string): Uint8Array {
    const bytes: number[] = []
    for (let index = 0; index < sequence.length; index += 1) {
      const code = sequence.charCodeAt(index)
      if (code <= 0xff) {
        bytes.push(code)
      } else {
        bytes.push(QUESTION_MARK)
      }
    }
    return Uint8Array.from(bytes)
  }

  private setAnswerbackMessage(message: string): void {
    const filtered = Array.from(message)
      .filter((char) => {
        const code = char.charCodeAt(0)
        return code >= 0x20 && code <= 0x7e
      })
      .join('')
    this.state.answerback = filtered.slice(0, 30)
  }

  private collectColonSubparameters(
    params: ReadonlyArray<number>,
    separators: ReadonlyArray<'colon' | 'semicolon'>,
    baseIndex: number,
  ): { values: number[]; lastIndex: number } {
    const values: number[] = []
    let currentIndex = baseIndex

    while (
      currentIndex < params.length &&
      separators[currentIndex] === 'colon'
    ) {
      const nextIndex = currentIndex + 1
      if (nextIndex >= params.length) {
        break
      }
      values.push(params[nextIndex] ?? 0)
      currentIndex = nextIndex
    }

    return { values, lastIndex: currentIndex }
  }

  private setGlSelector(selector: 'g0' | 'g1' | 'g2' | 'g3'): void {
    this.state.charsets = { ...this.state.charsets, gl: selector }
  }

  private setGrSelector(selector: 'g0' | 'g1' | 'g2' | 'g3'): void {
    this.state.charsets = { ...this.state.charsets, gr: selector }
  }

  private setSingleShift(selector: 'g2' | 'g3'): TerminalUpdate[] {
    this.state.charsets = { ...this.state.charsets, singleShift: selector }
    return []
  }

  private setProtectedMode(mode: 'off' | 'dec'): TerminalUpdate[] {
    this.state.protectedMode = mode
    return []
  }

  private handleDecsca(params: ReadonlyArray<number>): TerminalUpdate[] {
    const mode = params[0] ?? 0
    switch (mode) {
      case 1:
        return this.setProtectedMode('dec')
      case 0:
      case 2:
      default:
        return this.setProtectedMode('off')
    }
  }

  private setLineAttribute(
    row: number,
    attribute: 'single' | 'double-top' | 'double-bottom',
  ): TerminalUpdate[] {
    if (row < 0 || row >= this.state.lineAttributes.length) {
      return []
    }
    this.state.lineAttributes[row] = attribute
    return []
  }

  private setPrinterControllerMode(enabled: boolean): void {
    if (this.state.printer.controller === enabled) {
      return
    }
    this.state.printer.controller = enabled
    this.printer.setPrinterControllerMode(enabled)
  }

  private setPrinterAutoPrintMode(enabled: boolean): void {
    if (this.state.printer.autoPrint === enabled) {
      return
    }
    this.state.printer.autoPrint = enabled
    this.printer.setAutoPrintMode(enabled)
  }

  private printScreen(): void {
    const lines = this.collectScreenLines()
    this.printer.printScreen(lines)
  }

  private collectScreenLines(): string[] {
    const lines: string[] = []
    for (let row = 0; row < this.state.rows; row += 1) {
      const bufferRow = this.state.buffer[row] ?? []
      const line = bufferRow
        .map((cell) => cell?.char ?? ' ')
        .join('')
        .replace(/\s+$/u, '')
      lines.push(line)
    }
    return lines
  }

  private designateCharset(
    register: 'g0' | 'g1' | 'g2' | 'g3',
    designator: string,
  ): void {
    const charset = resolveCharset(designator)
    if (
      charset !== 'us_ascii' &&
      charset !== 'dec_special' &&
      !this.capabilities.features.supportsNationalReplacementCharsets
    ) {
      return
    }
    this.state.charsets = {
      ...this.state.charsets,
      [register]: charset,
    }
  }

  private findLastContentRow(): number {
    for (let row = this.state.rows - 1; row >= 0; row -= 1) {
      const rowBuffer = this.state.buffer[row]
      if (!rowBuffer) {
        continue
      }
      for (let column = 0; column < this.state.columns; column += 1) {
        const char = rowBuffer[column]?.char ?? ' '
        if (char !== ' ') {
          return Math.min(row, this.state.rows - 1)
        }
      }
    }
    return 0
  }

  private handleExecute(codePoint: number): TerminalUpdate[] {
    switch (codePoint) {
      case 0x05:
        return this.emitResponse(this.state.answerback)
      case 0x07:
        return [{ type: 'bell' }]
      case 0x08:
        return this.backspace()
      case 0x09:
        return this.horizontalTab()
      case 0x0a:
      case 0x0b:
      case 0x0c:
        return this.lineFeed(true)
      case 0x0d:
        return this.carriageReturn()
      case 0x0e: // SO -> invoke G1 into GL
        this.setGlSelector('g1')
        return []
      case 0x0f: // SI -> invoke G0 into GL
        this.setGlSelector('g0')
        return []
      default:
        return []
    }
  }

  private decode(buffer: Uint8Array): string {
    if (buffer.length === 0) {
      return ''
    }
    return this.textDecoder.decode(buffer)
  }

  private handleEsc(
    event: ParserEvent & { type: ParserEventType.EscDispatch },
  ): TerminalUpdate[] {
    const final = String.fromCharCode(event.finalByte)
    if (event.intermediates.length > 0) {
      const prefix = String.fromCharCode(event.intermediates[0]!)
      switch (prefix) {
        case '(':
          this.designateCharset('g0', final)
          return []
        case ')':
          this.designateCharset('g1', final)
          return []
        case '*':
          this.designateCharset('g2', final)
          return []
        case '+':
          this.designateCharset('g3', final)
          return []
        case '#':
          switch (final) {
            case '3':
              return this.setLineAttribute(this.state.cursor.row, 'double-top')
            case '4':
              return this.setLineAttribute(this.state.cursor.row, 'double-bottom')
            case '5':
              return this.setLineAttribute(this.state.cursor.row, 'single')
            case '8':
              return this.applyScreenAlignmentPattern()
            default:
              break
          }
          break
        default:
          break
      }
    }

    switch (final) {
      case 'D':
        return this.index()
      case 'E':
        return [...this.lineFeed(true), ...this.carriageReturn()]
      case 'H':
        return this.setTabStop()
      case 'M':
        return this.reverseIndex()
      case '7':
        return this.saveCursor()
      case '8':
        return this.restoreCursor()
      case '1':
        return this.setLineAttribute(this.state.cursor.row, 'double-top')
      case '2':
        return this.setLineAttribute(this.state.cursor.row, 'double-bottom')
      case '=':
        return this.setKeypadApplicationMode(true)
      case '>':
        return this.setKeypadApplicationMode(false)
      case 'Z':
        return this.emitResponse('\u001B/Z')
      case 'N':
        return this.setSingleShift('g2')
      case 'O':
        return this.setSingleShift('g3')
      case 'n':
        this.setGlSelector('g2')
        return []
      case 'o':
        this.setGlSelector('g3')
        return []
      case '~':
        this.setGrSelector('g1')
        return []
      case '}':
        this.setGrSelector('g2')
        return []
      case '|':
        this.setGrSelector('g3')
        return []
      case 'c':
        return this.resetToInitialState()
      default:
        return []
    }
  }

  private handleOsc(
    event: ParserEvent & { type: ParserEventType.OscDispatch },
  ): TerminalUpdate[] {
    const raw = this.decode(event.data)
    const separator = raw.indexOf(';')
    const identifier = separator === -1 ? raw : raw.slice(0, separator)
    const payload = separator === -1 ? '' : raw.slice(separator + 1)
    const oscId = identifier === '' ? '0' : identifier

    const updates: TerminalUpdate[] = [
      { type: 'osc', identifier: oscId, data: payload },
    ]

    switch (oscId) {
      case '0':
      case '2':
        this.state.title = payload
        updates.push({ type: 'title', title: payload })
        break
      case '4':
        updates.push(...this.parsePaletteUpdates(payload))
        break
      case '52': {
        const selectionSplit = payload.indexOf(';')
        const selection =
          selectionSplit === -1 ? 'c' : payload.slice(0, selectionSplit) || 'c'
        const data =
          selectionSplit === -1 ? '' : payload.slice(selectionSplit + 1)
        const clipboard: ClipboardEntry = { selection, data }
        this.state.clipboard = clipboard
        updates.push({ type: 'clipboard', clipboard })
        break
      }
      default:
        break
    }

    return updates
  }

  private parsePaletteUpdates(data: string): TerminalUpdate[] {
    if (data.trim() === '') {
      return []
    }

    const parts = data.split(';')
    const updates: TerminalUpdate[] = []

    for (let index = 0; index < parts.length - 1; index += 2) {
      const slot = Number.parseInt(parts[index] ?? '', 10)
      const spec = parts[index + 1] ?? ''
      if (Number.isNaN(slot)) {
        continue
      }
      const color = this.parseColorSpec(spec)
      if (!color) {
        continue
      }
      updates.push({ type: 'palette', index: slot, color })
    }

    return updates
  }

  private parseColorSpec(spec: string): TerminalColor | null {
    const trimmed = spec.trim()
    if (trimmed.startsWith('rgb:')) {
      const [, channels] = trimmed.split(':')
      if (!channels) {
        return null
      }
      const components = channels.split('/')
      if (components.length !== 3) {
        return null
      }
      const rHex = components[0] ?? ''
      const gHex = components[1] ?? ''
      const bHex = components[2] ?? ''
      if (!rHex || !gHex || !bHex) {
        return null
      }
      const parseComponent = (value: string): number | null => {
        const normalized = value.length === 0 ? '0' : value
        const int = Number.parseInt(normalized, 16)
        if (Number.isNaN(int)) {
          return null
        }
        const scale = 16 ** normalized.length - 1 || 1
        return clampColorComponent((int / scale) * 255)
      }
      const r = parseComponent(rHex)
      const g = parseComponent(gHex)
      const b = parseComponent(bHex)
      if (r === null || g === null || b === null) {
        return null
      }
      return { type: 'rgb', r, g, b }
    }

    if (trimmed.startsWith('#')) {
      const hex = trimmed.slice(1)
      if (hex.length === 6) {
        const r = Number.parseInt(hex.slice(0, 2), 16)
        const g = Number.parseInt(hex.slice(2, 4), 16)
        const b = Number.parseInt(hex.slice(4, 6), 16)
        if ([r, g, b].some((value) => Number.isNaN(value))) {
          return null
        }
        return {
          type: 'rgb',
          r: clampColorComponent(r),
          g: clampColorComponent(g),
          b: clampColorComponent(b),
        }
      }
    }

    return null
  }

  private handleDcsHook(
    event: ParserEvent & { type: ParserEventType.DcsHook },
  ): TerminalUpdate[] {
    this.activeDcs = {
      finalByte: event.finalByte,
      params: [...event.params],
      intermediates: [...event.intermediates],
      chunks: [],
    }
    return [
      {
        type: 'dcs-start',
        finalByte: event.finalByte,
        params: [...event.params],
        intermediates: [...event.intermediates],
      },
    ]
  }

  private handleDcsPut(
    event: ParserEvent & { type: ParserEventType.DcsPut },
  ): TerminalUpdate[] {
    if (!this.activeDcs) {
      return []
    }
    const chunk = this.decode(event.data)
    this.activeDcs.chunks.push(chunk)
    return [{ type: 'dcs-data', data: chunk }]
  }

  private handleDcsUnhook(): TerminalUpdate[] {
    if (!this.activeDcs) {
      return []
    }
    const { finalByte, params, intermediates, chunks } = this.activeDcs
    const data = chunks.join('')
    if (
      String.fromCharCode(finalByte) === 'q' &&
      intermediates.includes('$'.charCodeAt(0))
    ) {
      this.setAnswerbackMessage(data)
    }
    this.activeDcs = null
    return [
      {
        type: 'dcs-end',
        finalByte,
        params,
        intermediates,
        data,
      },
    ]
  }

  private handleSosPmApc(
    event: ParserEvent & { type: ParserEventType.SosPmApcDispatch },
  ): TerminalUpdate[] {
    const data = this.decode(event.data)
    this.state.lastSosPmApc = { kind: event.kind, data }
    return [{ type: 'sos-pm-apc', kind: event.kind, data }]
  }

  private handleCsi(
    event: ParserEvent & { type: ParserEventType.CsiDispatch },
  ): TerminalUpdate[] {
    if (event.intermediates.length > 0) {
      const intermediate = String.fromCharCode(event.intermediates[0]!)
      if (intermediate === '"' && String.fromCharCode(event.finalByte) === 'q') {
        return this.handleDecsca(event.params)
      }
    }

    const final = String.fromCharCode(event.finalByte)
    const params = event.params
    const separators = event.paramSeparators ?? []

    if (
      event.prefix === QUESTION_MARK &&
      (final === 'h' || final === 'l' || final === 'J' || final === 'K' || final === 'p')
    ) {
      return this.handleDecPrivateMode(event)
    }

    switch (final) {
      case 'A':
        return this.cursorUp(params[0] ?? 1)
      case 'B':
        return this.cursorDown(params[0] ?? 1)
      case 'C':
        return this.cursorForward(params[0] ?? 1)
      case 'D':
        return this.cursorBackward(params[0] ?? 1)
      case 'E':
        return this.cursorNextLine(params[0] ?? 1)
      case 'F':
        return this.cursorPreviousLine(params[0] ?? 1)
      case 'G':
        return this.cursorColumnAbsolute(params[0] ?? 1)
      case 'H':
      case 'f':
        return this.cursorPosition(params)
      case 'J':
        return this.eraseInDisplay(params[0] ?? 0)
      case 'K':
        return this.eraseInLine(params[0] ?? 0)
      case '@':
        return this.insertCharacters(params[0] ?? 1)
      case 'P':
        return this.deleteCharacters(params[0] ?? 1)
      case 'L':
        return this.insertLines(params[0] ?? 1)
      case 'M':
        return this.deleteLines(params[0] ?? 1)
      case 'X':
        return this.eraseCharacters(params[0] ?? 1)
      case 'm':
        return this.selectGraphicRendition(params, separators)
      case 'r':
        return this.setScrollRegion(params)
      case 'g':
        return this.clearTabStops(params[0] ?? 0)
      case 'c': {
        if (event.prefix === null) {
          const primary = this.capabilities.features.primaryDeviceAttributes
          return primary ? this.emitResponse(primary) : []
        }
        if (String.fromCharCode(event.prefix) === '>') {
          const secondary =
            this.capabilities.features.secondaryDeviceAttributes
          return secondary ? this.emitResponse(secondary) : []
        }
        return []
      }
      case 'n': {
        const request = params[0] ?? 0
        switch (request) {
          case 0:
          case 5:
            return this.emitResponse('\u001B[0n')
          case 6: {
            const row = this.state.cursor.row + 1
            const column = this.state.cursor.column + 1
            return this.emitResponse(`\u001B[${row};${column}R`)
          }
          default:
            return []
        }
      }
      case 'i':
        return this.handleMediaCopy(event)
      default:
        return []
    }
  }

  private handleDecPrivateMode(
    event: ParserEvent & { type: ParserEventType.CsiDispatch },
  ): TerminalUpdate[] {
    const final = String.fromCharCode(event.finalByte)
    if (
      final === 'p' &&
      event.intermediates.includes('$'.charCodeAt(0))
    ) {
      return this.reportPrivateModes(event.params)
    }

    if (final === 'J') {
      return this.eraseInDisplay(event.params[0] ?? 0, { selective: true })
    }

    if (final === 'K') {
      return this.eraseInLine(event.params[0] ?? 0, { selective: true })
    }

    if (final !== 'h' && final !== 'l') {
      return []
    }

    const enable = final === 'h'
    const updates: TerminalUpdate[] = []

    for (const param of event.params) {
      switch (param) {
        case 1: // DECCKM
          this.state.cursorKeysApplicationMode = enable
          updates.push({
            type: 'mode',
            mode: 'cursor-keys-application',
            value: enable,
          })
          break
        case 3: // DECCOLM
          updates.push(...this.setColumns(enable ? 132 : 80))
          break
        case 6: // DECOM
          updates.push(...this.setOriginMode(enable))
          break
        case 7: // DECAWM
          updates.push(...this.setAutoWrap(enable))
          break
        case 8: // DECARM
          this.state.autoRepeat = enable
          break
        case 4: // DECSCLM (smooth scroll)
          this.state.smoothScroll = enable
          updates.push({
            type: 'mode',
            mode: 'smooth-scroll',
            value: enable,
          })
          break
        case 5: // DECSCNM (reverse video)
          this.state.reverseVideo = enable
          updates.push({
            type: 'mode',
            mode: 'reverse-video',
            value: enable,
          })
          break
        case 25: // DECTCEM
          updates.push(...this.setCursorVisibility(enable))
          break
        case 66: {
          const mode: C1TransmissionMode = enable ? '7-bit' : '8-bit'
          updates.push(...this.setC1Transmission(mode))
          break
        }
        default:
          break
      }
    }

    return updates
  }

  private handleMediaCopy(
    event: ParserEvent & { type: ParserEventType.CsiDispatch },
  ): TerminalUpdate[] {
    const params = event.params.length === 0 ? [0] : event.params
    if (event.prefix === QUESTION_MARK) {
      for (const param of params) {
        switch (param) {
          case 4:
            this.setPrinterAutoPrintMode(true)
            break
          case 5:
            this.setPrinterControllerMode(true)
            break
          case 6:
            this.printScreen()
            break
          default:
            break
        }
      }
      return []
    }

    for (const param of params) {
      switch (param) {
        case 0:
          this.printScreen()
          break
        case 4:
          this.setPrinterAutoPrintMode(false)
          this.setPrinterControllerMode(false)
          break
        case 5:
          this.setPrinterControllerMode(true)
          break
        default:
          break
      }
    }
    return []
  }

  private reportPrivateModes(params: ReadonlyArray<number>): TerminalUpdate[] {
    if (params.length === 0) {
      return []
    }

    const updates: TerminalUpdate[] = []
    for (const ps of params) {
      const value = this.getPrivateModeValue(ps)
      const response = `\u001B[?${ps};${value}$y`
      updates.push(...this.emitResponse(response))
    }
    return updates
  }

  private getPrivateModeValue(ps: number): number {
    switch (ps) {
      case 6:
        return this.state.originMode ? 1 : 2
      case 7:
        return this.state.autoWrap ? 1 : 2
      case 25:
        return this.state.cursorVisible ? 1 : 2
      case 5:
        return this.state.reverseVideo ? 1 : 2
      default:
        return 0
    }
  }

  private setOriginMode(enabled: boolean): TerminalUpdate[] {
    if (!this.capabilities.features.supportsOriginMode) {
      return []
    }
    this.state.originMode = enabled
    if (enabled) {
      this.state.cursor = { row: this.state.scrollTop, column: 0 }
    }
    return [
      { type: 'mode', mode: 'origin', value: enabled },
      this.cursorUpdate(),
    ]
  }

  private setAutoWrap(enabled: boolean): TerminalUpdate[] {
    if (!this.capabilities.features.supportsAutoWrap) {
      return []
    }
    this.state.autoWrap = enabled
    return [{ type: 'mode', mode: 'autowrap', value: enabled }]
  }

  private setCursorVisibility(visible: boolean): TerminalUpdate[] {
    if (!this.capabilities.features.supportsCursorVisibility) {
      return []
    }
    this.state.cursorVisible = visible
    return [{ type: 'cursor-visibility', value: visible }]
  }

  private setScrollRegion(params: ReadonlyArray<number>): TerminalUpdate[] {
    if (!this.capabilities.features.supportsScrollRegions) {
      return []
    }
    let top = clamp((params[0] ?? 1) - 1, 0, this.state.rows - 1)
    let bottom = clamp(
      (params[1] ?? this.state.rows) - 1,
      0,
      this.state.rows - 1,
    )

    if (top >= bottom) {
      top = 0
      bottom = this.state.rows - 1
    }

    this.state.scrollTop = top
    this.state.scrollBottom = bottom

    const updates: TerminalUpdate[] = [{ type: 'scroll-region', top, bottom }]
    if (this.state.originMode) {
      this.state.cursor = { row: top, column: 0 }
      updates.push(this.cursorUpdate())
    }
    return updates
  }

  private clearTabStops(mode: number): TerminalUpdate[] {
    if (!this.capabilities.features.supportsTabStops) {
      return []
    }
    switch (mode) {
      case 0:
      case 2:
        clearTabStop(this.state, this.state.cursor.column)
        break
      case 3:
        clearAllTabStops(this.state)
        break
      default:
        break
    }
    return []
  }

  private setTabStop(): TerminalUpdate[] {
    if (!this.capabilities.features.supportsTabStops) {
      return []
    }
    setTabStop(this.state, this.state.cursor.column)
    return []
  }

  private cursorPosition(params: ReadonlyArray<number>): TerminalUpdate[] {
    const baseRow = this.state.originMode ? this.state.scrollTop : 0
    const minRow = this.state.originMode ? this.state.scrollTop : 0
    const maxRow = this.state.originMode
      ? this.state.scrollBottom
      : this.state.rows - 1

    const row = clamp(baseRow + (params[0] ?? 1) - 1, minRow, maxRow)
    const column = clamp((params[1] ?? 1) - 1, 0, this.state.columns - 1)
    this.state.cursor = { row, column }
    return [this.cursorUpdate()]
  }

  private cursorUp(count: number): TerminalUpdate[] {
    const minRow = this.state.originMode ? this.state.scrollTop : 0
    const maxRow = this.state.originMode
      ? this.state.scrollBottom
      : this.state.rows - 1
    this.state.cursor.row = clamp(this.state.cursor.row - count, minRow, maxRow)
    return [this.cursorUpdate()]
  }

  private cursorDown(count: number): TerminalUpdate[] {
    const minRow = this.state.originMode ? this.state.scrollTop : 0
    const maxRow = this.state.originMode
      ? this.state.scrollBottom
      : this.state.rows - 1
    this.state.cursor.row = clamp(this.state.cursor.row + count, minRow, maxRow)
    return [this.cursorUpdate()]
  }

  private cursorForward(count: number): TerminalUpdate[] {
    this.state.cursor.column = clamp(
      this.state.cursor.column + count,
      0,
      this.state.columns - 1,
    )
    return [this.cursorUpdate()]
  }

  private cursorBackward(count: number): TerminalUpdate[] {
    this.state.cursor.column = clamp(
      this.state.cursor.column - count,
      0,
      this.state.columns - 1,
    )
    return [this.cursorUpdate()]
  }

  private cursorNextLine(count: number): TerminalUpdate[] {
    const steps = Math.max(1, count)
    const updates: TerminalUpdate[] = []
    for (let index = 0; index < steps; index += 1) {
      updates.push(...this.lineFeed(true))
    }
    return updates
  }

  private cursorPreviousLine(count: number): TerminalUpdate[] {
    const steps = Math.max(1, count)
    const updates: TerminalUpdate[] = []
    for (let index = 0; index < steps; index += 1) {
      updates.push(...this.reverseIndex())
    }
    this.state.cursor.column = 0
    updates.push(this.cursorUpdate())
    return updates
  }

  private cursorColumnAbsolute(value: number): TerminalUpdate[] {
    const column = clamp(value - 1, 0, this.state.columns - 1)
    this.state.cursor.column = column
    return [this.cursorUpdate()]
  }

  private eraseInDisplay(
    param: number,
    options: { selective?: boolean } = {},
  ): TerminalUpdate[] {
    const selective = options.selective ?? false
    switch (param) {
      case 2:
        if (!selective) {
          for (let row = 0; row < this.state.rows; row += 1) {
            resetRow(this.state, row)
            this.state.lineAttributes[row] = 'single'
          }
          this.state.cursor = { row: 0, column: 0 }
          return [{ type: 'clear', scope: 'display' }, this.cursorUpdate()]
        }
        {
          const cells: CellDelta[] = []
          for (let row = 0; row < this.state.rows; row += 1) {
            for (let column = 0; column < this.state.columns; column += 1) {
              const delta = this.clearCell(row, column, true)
              if (delta) {
                cells.push(delta)
              }
            }
          }
          if (cells.length === 0) {
            return []
          }
          this.state.cursor = { row: 0, column: 0 }
          return [{ type: 'cells', cells }, this.cursorUpdate()]
        }
      default:
        return this.clearFromCursor(selective)
    }
  }

  private eraseInLine(
    param: number,
    options: { selective?: boolean } = {},
  ): TerminalUpdate[] {
    const selective = options.selective ?? false
    const row = this.state.cursor.row
    let start = this.state.cursor.column
    let end = this.state.columns - 1

    if (param === 1) {
      start = 0
      end = this.state.cursor.column
    } else if (param === 2) {
      start = 0
    }

    const cells: CellDelta[] = []

    for (let column = start; column <= end; column += 1) {
      const delta = this.clearCell(row, column, selective)
      if (delta) {
        cells.push(delta)
      }
    }

    if (cells.length === 0) {
      return []
    }

    const scope = param === 0 ? 'line-after-cursor' : 'line'

    return [
      { type: 'cells', cells },
      { type: 'clear', scope },
    ]
  }

  private selectGraphicRendition(
    params: ReadonlyArray<number>,
    separators: ReadonlyArray<'colon' | 'semicolon'>,
  ): TerminalUpdate[] {
    let attributes = cloneAttributes(
      params.length === 0 ? defaultAttributes : this.state.attributes,
    )

    const setForeground = (color: TerminalColor): void => {
      attributes = { ...attributes, foreground: color }
    }

    const setBackground = (color: TerminalColor): void => {
      attributes = { ...attributes, background: color }
    }

    for (let index = 0; index < params.length; index += 1) {
      const param = params[index] ?? 0
      const separator = separators[index] ?? 'semicolon'
      switch (param) {
        case 0:
          attributes = cloneAttributes(defaultAttributes)
          break
        case 1:
          attributes = { ...attributes, bold: true }
          break
        case 2:
          attributes = { ...attributes, faint: true }
          break
        case 3:
          attributes = { ...attributes, italic: true }
          break
        case 4: {
          if (separator === 'colon') {
            const { values, lastIndex } = this.collectColonSubparameters(
              params,
              separators,
              index,
            )
            const style = values[0] ?? 0
            switch (style) {
              case 0:
                attributes = { ...attributes, underline: 'none' }
                break
              case 1:
                attributes = { ...attributes, underline: 'single' }
                break
              case 2:
                attributes = { ...attributes, underline: 'double' }
                break
              case 3:
                attributes = { ...attributes, underline: 'single' }
                break
              default:
                break
            }
            index = lastIndex
            continue
          }
          attributes = { ...attributes, underline: 'single' }
          break
        }
        case 5:
          attributes = { ...attributes, blink: 'slow' }
          break
        case 6:
          attributes = { ...attributes, blink: 'rapid' }
          break
        case 7:
          attributes = { ...attributes, inverse: true }
          break
        case 8:
          attributes = { ...attributes, hidden: true }
          break
        case 9:
          attributes = { ...attributes, strikethrough: true }
          break
        case 21:
          attributes = { ...attributes, underline: 'double' }
          break
        case 22:
          attributes = { ...attributes, bold: false, faint: false }
          break
        case 23:
          attributes = { ...attributes, italic: false }
          break
        case 24:
          attributes = { ...attributes, underline: 'none' }
          break
        case 25:
          attributes = { ...attributes, blink: 'none' }
          break
        case 27:
          attributes = { ...attributes, inverse: false }
          break
        case 28:
          attributes = { ...attributes, hidden: false }
          break
        case 29:
          attributes = { ...attributes, strikethrough: false }
          break
        case 30:
        case 31:
        case 32:
        case 33:
        case 34:
        case 35:
        case 36:
        case 37:
          setForeground({ type: 'ansi', index: param - 30 })
          break
        case 38: {
          if (separator === 'colon') {
            const { values, lastIndex } = this.collectColonSubparameters(
              params,
              separators,
              index,
            )
            const mode = values[0] ?? 0
            if (mode === 5 && values.length >= 2) {
              const paletteIndex = clamp(values[1] ?? 0, 0, 255)
              setForeground({ type: 'palette', index: paletteIndex })
            } else if (mode === 2 && values.length >= 4) {
              const r = clampColorComponent(values[values.length - 3] ?? 0)
              const g = clampColorComponent(values[values.length - 2] ?? 0)
              const b = clampColorComponent(values[values.length - 1] ?? 0)
              setForeground({ type: 'rgb', r, g, b })
            }
            index = lastIndex
            continue
          }
          const mode = params[index + 1]
          if (mode === 5 && params.length > index + 2) {
            const paletteIndex = clamp(params[index + 2] ?? 0, 0, 255)
            setForeground({ type: 'palette', index: paletteIndex })
            index += 2
          } else if (mode === 2 && params.length > index + 4) {
            const r = clampColorComponent(params[index + 2] ?? 0)
            const g = clampColorComponent(params[index + 3] ?? 0)
            const b = clampColorComponent(params[index + 4] ?? 0)
            setForeground({ type: 'rgb', r, g, b })
            index += 4
          }
          break
        }
        case 39:
          setForeground({ type: 'default' })
          break
        case 40:
        case 41:
        case 42:
        case 43:
        case 44:
        case 45:
        case 46:
        case 47:
          setBackground({ type: 'ansi', index: param - 40 })
          break
        case 48: {
          if (separator === 'colon') {
            const { values, lastIndex } = this.collectColonSubparameters(
              params,
              separators,
              index,
            )
            const mode = values[0] ?? 0
            if (mode === 5 && values.length >= 2) {
              const paletteIndex = clamp(values[1] ?? 0, 0, 255)
              setBackground({ type: 'palette', index: paletteIndex })
            } else if (mode === 2 && values.length >= 4) {
              const r = clampColorComponent(values[values.length - 3] ?? 0)
              const g = clampColorComponent(values[values.length - 2] ?? 0)
              const b = clampColorComponent(values[values.length - 1] ?? 0)
              setBackground({ type: 'rgb', r, g, b })
            }
            index = lastIndex
            continue
          }
          const mode = params[index + 1]
          if (mode === 5 && params.length > index + 2) {
            const paletteIndex = clamp(params[index + 2] ?? 0, 0, 255)
            setBackground({ type: 'palette', index: paletteIndex })
            index += 2
          } else if (mode === 2 && params.length > index + 4) {
            const r = clampColorComponent(params[index + 2] ?? 0)
            const g = clampColorComponent(params[index + 3] ?? 0)
            const b = clampColorComponent(params[index + 4] ?? 0)
            setBackground({ type: 'rgb', r, g, b })
            index += 4
          }
          break
        }
        case 58: {
          if (separator === 'colon') {
            const { lastIndex } = this.collectColonSubparameters(
              params,
              separators,
              index,
            )
            index = lastIndex
            continue
          }
          break
        }
        case 49:
          setBackground({ type: 'default' })
          break
        case 90:
        case 91:
        case 92:
        case 93:
        case 94:
        case 95:
        case 96:
        case 97:
          setForeground({ type: 'ansi-bright', index: param - 90 })
          break
        case 100:
        case 101:
        case 102:
        case 103:
        case 104:
        case 105:
        case 106:
        case 107:
          setBackground({ type: 'ansi-bright', index: param - 100 })
          break
        default:
          break
      }
    }

    this.state.attributes = attributes
    return [{ type: 'attributes', attributes }]
  }

  private lineFeed(resetColumn: boolean): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []
    const { cursor } = this.state

    if (this.withinScrollRegion(cursor.row)) {
      if (cursor.row === this.state.scrollBottom) {
        this.scrollRegionUp()
        updates.push({ type: 'scroll', amount: 1 })
      } else {
        cursor.row += 1
      }
    } else if (cursor.row < this.state.rows - 1) {
      cursor.row += 1
    }

    if (resetColumn) {
      cursor.column = 0
    }

    this.clampCursorRow()
    updates.push(this.cursorUpdate())
    return updates
  }

  private index(): TerminalUpdate[] {
    return this.lineFeed(false)
  }

  private reverseIndex(): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []
    const { cursor } = this.state

    if (this.withinScrollRegion(cursor.row)) {
      if (cursor.row === this.state.scrollTop) {
        this.scrollRegionDown()
        updates.push({ type: 'scroll', amount: -1 })
      } else {
        cursor.row -= 1
      }
    } else if (cursor.row > 0) {
      cursor.row -= 1
    }

    this.clampCursorRow()
    updates.push(this.cursorUpdate())
    return updates
  }

  private scrollRegionUp(): void {
    const top = this.state.scrollTop
    const bottom = this.state.scrollBottom
    for (let row = top; row < bottom; row += 1) {
      this.state.buffer[row] = this.state.buffer[row + 1]!
      this.state.lineAttributes[row] = this.state.lineAttributes[row + 1]!
    }
    this.state.buffer[bottom] = Array.from({ length: this.state.columns }, () =>
      blankCell(this.state.attributes),
    )
    this.state.lineAttributes[bottom] = 'single'
  }

  private scrollRegionDown(): void {
    const top = this.state.scrollTop
    const bottom = this.state.scrollBottom
    for (let row = bottom; row > top; row -= 1) {
      this.state.buffer[row] = this.state.buffer[row - 1]!
      this.state.lineAttributes[row] = this.state.lineAttributes[row - 1]!
    }
    this.state.buffer[top] = Array.from({ length: this.state.columns }, () =>
      blankCell(this.state.attributes),
    )
    this.state.lineAttributes[top] = 'single'
  }

  private carriageReturn(): TerminalUpdate[] {
    this.state.cursor.column = 0
    return [this.cursorUpdate()]
  }

  private backspace(): TerminalUpdate[] {
    if (this.state.cursor.column > 0) {
      this.state.cursor.column -= 1
    }
    return [this.cursorUpdate()]
  }

  private horizontalTab(): TerminalUpdate[] {
    if (this.capabilities.features.supportsTabStops) {
      const next = nextTabStop(this.state, this.state.cursor.column)
      if (next !== null) {
        this.state.cursor.column = next
      } else {
        this.state.cursor.column = this.state.columns - 1
      }
    } else {
      const next = Math.floor(this.state.cursor.column / 8) * 8 + 8
      this.state.cursor.column = clamp(next, 0, this.state.columns - 1)
    }
    return [this.cursorUpdate()]
  }

  private insertCharacters(count: number): TerminalUpdate[] {
    const amount = clamp(count, 1, this.state.columns)
    const row = this.state.cursor.row
    const startColumn = this.state.cursor.column
    if (startColumn >= this.state.columns) {
      return []
    }

    const effective = Math.min(amount, this.state.columns - startColumn)
    const cells: CellDelta[] = []
    const rowBuffer = this.state.buffer[row] ?? []

    for (
      let column = this.state.columns - 1;
      column >= startColumn + effective;
      column -= 1
    ) {
      const source = rowBuffer[column - effective]
      const cell = source ? cloneCell(source) : blankCell(this.state.attributes)
      setCell(this.state, row, column, cell)
      cells.push({ row, column, cell })
    }

    for (
      let column = startColumn;
      column < startColumn + effective && column < this.state.columns;
      column += 1
    ) {
      const cell = blankCell(this.state.attributes)
      setCell(this.state, row, column, cell)
      cells.push({ row, column, cell })
    }

    if (cells.length === 0) {
      return []
    }

    return [{ type: 'cells', cells }]
  }

  private deleteCharacters(count: number): TerminalUpdate[] {
    const amount = clamp(count, 1, this.state.columns)
    const row = this.state.cursor.row
    const startColumn = this.state.cursor.column
    if (startColumn >= this.state.columns) {
      return []
    }

    const effective = Math.min(amount, this.state.columns - startColumn)
    const cells: CellDelta[] = []
    const rowBuffer = this.state.buffer[row] ?? []

    for (
      let column = startColumn;
      column < this.state.columns - effective;
      column += 1
    ) {
      const source = rowBuffer[column + effective]
      const cell = source ? cloneCell(source) : blankCell(this.state.attributes)
      setCell(this.state, row, column, cell)
      cells.push({ row, column, cell })
    }

    for (
      let column = this.state.columns - effective;
      column < this.state.columns;
      column += 1
    ) {
      const cell = blankCell(this.state.attributes)
      setCell(this.state, row, column, cell)
      cells.push({ row, column, cell })
    }

    if (cells.length === 0) {
      return []
    }

    return [{ type: 'cells', cells }]
  }

  private eraseCharacters(count: number): TerminalUpdate[] {
    const amount = clamp(count, 1, this.state.columns)
    const row = this.state.cursor.row
    const startColumn = this.state.cursor.column
    const cells: CellDelta[] = []

    for (
      let column = startColumn;
      column < startColumn + amount && column < this.state.columns;
      column += 1
    ) {
      const cell = blankCell(this.state.attributes)
      setCell(this.state, row, column, cell)
      cells.push({ row, column, cell })
    }

    if (cells.length === 0) {
      return []
    }
    return [{ type: 'cells', cells }]
  }

  private insertLines(count: number): TerminalUpdate[] {
    const row = this.state.cursor.row
    if (!this.withinScrollRegion(row)) {
      return []
    }
    const amount = clamp(
      count,
      1,
      this.state.scrollBottom - row + 1,
    )
    const cells: CellDelta[] = []

    for (
      let targetRow = this.state.scrollBottom;
      targetRow >= row + amount;
      targetRow -= 1
    ) {
      const sourceRow = targetRow - amount
      this.state.lineAttributes[targetRow] = this.state.lineAttributes[sourceRow]!
      for (let column = 0; column < this.state.columns; column += 1) {
        const source = this.state.buffer[sourceRow]?.[column]
        const cell = source
          ? cloneCell(source)
          : blankCell(this.state.attributes)
        setCell(this.state, targetRow, column, cell)
        cells.push({ row: targetRow, column, cell })
      }
    }

    for (let targetRow = row; targetRow < row + amount; targetRow += 1) {
      this.state.lineAttributes[targetRow] = 'single'
      for (let column = 0; column < this.state.columns; column += 1) {
        const cell = blankCell(this.state.attributes)
        setCell(this.state, targetRow, column, cell)
        cells.push({ row: targetRow, column, cell })
      }
    }

    if (cells.length === 0) {
      return []
    }

    return [{ type: 'cells', cells }]
  }

  private deleteLines(count: number): TerminalUpdate[] {
    const row = this.state.cursor.row
    if (!this.withinScrollRegion(row)) {
      return []
    }
    const amount = clamp(
      count,
      1,
      this.state.scrollBottom - row + 1,
    )
    const cells: CellDelta[] = []

    for (
      let targetRow = row;
      targetRow <= this.state.scrollBottom - amount;
      targetRow += 1
    ) {
      const sourceRow = targetRow + amount
      this.state.lineAttributes[targetRow] = this.state.lineAttributes[sourceRow]!
      for (let column = 0; column < this.state.columns; column += 1) {
        const source = this.state.buffer[sourceRow]?.[column]
        const cell = source
          ? cloneCell(source)
          : blankCell(this.state.attributes)
        setCell(this.state, targetRow, column, cell)
        cells.push({ row: targetRow, column, cell })
      }
    }

    for (
      let targetRow = this.state.scrollBottom - amount + 1;
      targetRow <= this.state.scrollBottom;
      targetRow += 1
    ) {
      this.state.lineAttributes[targetRow] = 'single'
      for (let column = 0; column < this.state.columns; column += 1) {
        const cell = blankCell(this.state.attributes)
        setCell(this.state, targetRow, column, cell)
        cells.push({ row: targetRow, column, cell })
      }
    }

    if (cells.length === 0) {
      return []
    }

    return [{ type: 'cells', cells }]
  }

  private clearCell(
    row: number,
    column: number,
    selective: boolean,
  ): CellDelta | null {
    const rowBuffer = this.state.buffer[row]
    if (!rowBuffer) {
      return null
    }
    const existing = rowBuffer[column]
    if (!existing) {
      return null
    }
    if (selective && existing.protected) {
      return null
    }
    const cell = blankCell(this.state.attributes)
    setCell(this.state, row, column, cell)
    return { row, column, cell }
  }

  private clearFromCursor(selective = false): TerminalUpdate[] {
    const cells: CellDelta[] = []
    const startRow = this.state.cursor.row
    const startColumn = this.state.cursor.column

    for (let column = startColumn; column < this.state.columns; column += 1) {
      const delta = this.clearCell(startRow, column, selective)
      if (delta) {
        cells.push(delta)
      }
    }

    for (let row = startRow + 1; row < this.state.rows; row += 1) {
      for (let column = 0; column < this.state.columns; column += 1) {
        const delta = this.clearCell(row, column, selective)
        if (delta) {
          cells.push(delta)
        }
      }
    }

    if (cells.length === 0) {
      return []
    }

    return [
      { type: 'cells', cells },
      { type: 'clear', scope: 'display-after-cursor' },
    ]
  }

  private applyScreenAlignmentPattern(): TerminalUpdate[] {
    const cells: CellDelta[] = []
    for (let row = 0; row < this.state.rows; row += 1) {
      this.state.lineAttributes[row] = 'single'
      for (let column = 0; column < this.state.columns; column += 1) {
        const cell: TerminalCell = {
          char: 'E',
          attr: cloneAttributes(this.state.attributes),
          protected: false,
        }
        setCell(this.state, row, column, cell)
        cells.push({ row, column, cell })
      }
    }
    this.state.cursor = { row: 0, column: 0 }
    const updates: TerminalUpdate[] = []
    if (cells.length > 0) {
      updates.push({ type: 'cells', cells })
      updates.push({ type: 'clear', scope: 'display' })
    }
    updates.push(this.cursorUpdate())
    return updates
  }

  private resetToInitialState(): TerminalUpdate[] {
    this.reset()
    return [
      { type: 'clear', scope: 'display' },
      { type: 'scroll-region', top: this.state.scrollTop, bottom: this.state.scrollBottom },
      this.cursorUpdate(),
      { type: 'attributes', attributes: this.state.attributes },
      { type: 'mode', mode: 'origin', value: this.state.originMode },
      { type: 'mode', mode: 'autowrap', value: this.state.autoWrap },
      { type: 'mode', mode: 'reverse-video', value: this.state.reverseVideo },
      { type: 'mode', mode: 'smooth-scroll', value: this.state.smoothScroll },
      {
        type: 'mode',
        mode: 'keypad-application',
        value: this.state.keypadApplicationMode,
      },
      {
        type: 'mode',
        mode: 'cursor-keys-application',
        value: this.state.cursorKeysApplicationMode,
      },
    ]
  }

  private setKeypadApplicationMode(enabled: boolean): TerminalUpdate[] {
    this.state.keypadApplicationMode = enabled
    return [
      {
        type: 'mode',
        mode: 'keypad-application',
        value: enabled,
      },
    ]
  }

  private setColumns(columns: number): TerminalUpdate[] {
    if (columns === this.state.columns) {
      return []
    }

    this.state.columns = columns
    for (let row = 0; row < this.state.rows; row += 1) {
      this.state.buffer[row] = Array.from({ length: columns }, () =>
        blankCell(this.state.attributes),
      )
      this.state.lineAttributes[row] = 'single'
    }
    if (this.capabilities.features.supportsTabStops) {
      resetTabStops(this.state)
    }
    this.state.scrollTop = 0
    this.state.scrollBottom = this.state.rows - 1
    this.state.cursor = { row: 0, column: 0 }
    this.state.protectedMode = 'off'

    return [
      { type: 'clear', scope: 'display' },
      { type: 'scroll-region', top: this.state.scrollTop, bottom: this.state.scrollBottom },
      this.cursorUpdate(),
    ]
  }

  private saveCursor(): TerminalUpdate[] {
    this.state.savedCursor = { ...this.state.cursor }
    this.state.savedAttributes = cloneAttributes(this.state.attributes)
    return []
  }

  private restoreCursor(): TerminalUpdate[] {
    if (!this.state.savedCursor || !this.state.savedAttributes) {
      return []
    }
    this.state.cursor = { ...this.state.savedCursor }
    this.state.attributes = cloneAttributes(this.state.savedAttributes)
    return [
      this.cursorUpdate(),
      { type: 'attributes', attributes: this.state.attributes },
    ]
  }

  private withinScrollRegion(row: number): boolean {
    return row >= this.state.scrollTop && row <= this.state.scrollBottom
  }

  private clampCursorRow(): void {
    const minRow = this.state.originMode ? this.state.scrollTop : 0
    const maxRow = this.state.originMode
      ? this.state.scrollBottom
      : this.state.rows - 1
    this.state.cursor.row = clamp(this.state.cursor.row, minRow, maxRow)
  }

  private cursorUpdate(): TerminalUpdate {
    return {
      type: 'cursor',
      position: { ...this.state.cursor },
    }
  }
}

export const createInterpreter = (
  options?: InterpreterOptions,
): TerminalInterpreter => new TerminalInterpreter(options)
