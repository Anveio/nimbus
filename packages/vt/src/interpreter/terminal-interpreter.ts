import {
  ParserEventType,
  type ParserEvent,
  type ParserOptions,
  type TerminalCapabilities,
} from '../types'
import { resolveTerminalCapabilities } from '../capabilities'
import {
  blankCell,
  cloneAttributes,
  createInitialState,
  defaultAttributes,
  ensureRowCapacity,
  resetRow,
  type TerminalCell,
  type TerminalState,
} from './state'
import { type CellDelta, type TerminalUpdate } from './delta'

const textDecoder = new TextDecoder()

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

export interface InterpreterOptions {
  readonly parser?: ParserOptions
  readonly capabilities?: TerminalCapabilities
}

export class TerminalInterpreter {
  readonly capabilities: TerminalCapabilities
  private state: TerminalState

  constructor(options: InterpreterOptions = {}) {
    this.capabilities =
      options.capabilities ?? resolveTerminalCapabilities(options.parser ?? {})
    this.state = createInitialState(this.capabilities)
  }

  get snapshot(): TerminalState {
    return this.state
  }

  handleEvent(event: ParserEvent): TerminalUpdate[] {
    switch (event.type) {
      case ParserEventType.Print:
        return this.handlePrint(event.data)
      case ParserEventType.Execute:
        return this.handleExecute(event.codePoint)
      case ParserEventType.CsiDispatch:
        return this.handleCsi(event)
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
  }

  private handlePrint(data: Uint8Array): TerminalUpdate[] {
    if (data.length === 0) {
      return []
    }

    const text = textDecoder.decode(data)
    const cells: CellDelta[] = []
    const updates: TerminalUpdate[] = []

    for (const char of text) {
      const result = this.writeChar(char)
      cells.push(...result.cells)
      updates.push(...result.updates)
    }

    const mergedUpdates = [] as TerminalUpdate[]
    if (cells.length > 0) {
      mergedUpdates.push({ type: 'cells', cells })
    }
    mergedUpdates.push(...updates)
    return mergedUpdates
  }

  private writeChar(char: string): {
    cells: CellDelta[]
    updates: TerminalUpdate[]
  } {
    if (char === '\r') {
      return { cells: [], updates: this.carriageReturn() }
    }
    if (char === '\n') {
      return { cells: [], updates: this.lineFeed() }
    }

    const cells: CellDelta[] = []
    const updates: TerminalUpdate[] = []

    const row = this.state.cursor.row
    const column = this.state.cursor.column

    ensureRowCapacity(this.state, row)

    const cell: TerminalCell = {
      char,
      attr: cloneAttributes(this.state.attributes),
    }

    this.state.buffer[row][column] = cell
    cells.push({ row, column, cell })

    this.state.cursor.column += 1
    if (this.state.cursor.column >= this.state.columns) {
      this.state.cursor.column = this.state.columns - 1
      updates.push(...this.lineFeed())
    } else {
      updates.push(this.cursorUpdate())
    }

    return { cells, updates }
  }

  private handleExecute(codePoint: number): TerminalUpdate[] {
    switch (codePoint) {
      case 0x07:
        return [{ type: 'bell' }]
      case 0x08:
        return this.backspace()
      case 0x09:
        return this.horizontalTab()
      case 0x0a:
      case 0x0b:
      case 0x0c:
        return this.lineFeed()
      case 0x0d:
        return this.carriageReturn()
      default:
        return []
    }
  }

  private handleCsi(event: ParserEvent & { type: ParserEventType.CsiDispatch }): TerminalUpdate[] {
    const final = String.fromCharCode(event.finalByte)
    const params = event.params

    switch (final) {
      case 'A':
        return this.cursorUp(params[0] ?? 1)
      case 'B':
        return this.cursorDown(params[0] ?? 1)
      case 'C':
        return this.cursorForward(params[0] ?? 1)
      case 'D':
        return this.cursorBackward(params[0] ?? 1)
      case 'H':
      case 'f':
        return this.cursorPosition(params)
      case 'J':
        return this.eraseInDisplay(params[0] ?? 0)
      case 'K':
        return this.eraseInLine(params[0] ?? 0)
      case 'm':
        return this.selectGraphicRendition(params)
      default:
        return []
    }
  }

  private cursorPosition(params: ReadonlyArray<number>): TerminalUpdate[] {
    const row = clamp((params[0] ?? 1) - 1, 0, this.state.rows - 1)
    const column = clamp((params[1] ?? 1) - 1, 0, this.state.columns - 1)
    this.state.cursor = { row, column }
    return [this.cursorUpdate()]
  }

  private cursorUp(count: number): TerminalUpdate[] {
    this.state.cursor.row = clamp(
      this.state.cursor.row - count,
      0,
      this.state.rows - 1,
    )
    return [this.cursorUpdate()]
  }

  private cursorDown(count: number): TerminalUpdate[] {
    this.state.cursor.row = clamp(
      this.state.cursor.row + count,
      0,
      this.state.rows - 1,
    )
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

  private eraseInDisplay(param: number): TerminalUpdate[] {
    switch (param) {
      case 2:
        for (let row = 0; row < this.state.rows; row += 1) {
          resetRow(this.state, row)
        }
        this.state.cursor = { row: 0, column: 0 }
        return [
          { type: 'clear', scope: 'display' },
          this.cursorUpdate(),
        ]
      case 0:
      default:
        return this.clearFromCursor()
    }
  }

  private eraseInLine(param: number): TerminalUpdate[] {
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
      const cell = blankCell(this.state.attributes)
      this.state.buffer[row][column] = cell
      cells.push({ row, column, cell })
    }

    if (cells.length === 0) {
      return []
    }

    const scope = (param === 0 ? 'line-after-cursor' : 'line') as
      | 'line-after-cursor'
      | 'line'

    return [
      { type: 'cells', cells },
      { type: 'clear', scope },
    ]
  }

  private selectGraphicRendition(params: ReadonlyArray<number>): TerminalUpdate[] {
    if (params.length === 0) {
      this.state.attributes = cloneAttributes(defaultAttributes)
      return [{ type: 'attributes', attributes: this.state.attributes }]
    }

    let attributes = cloneAttributes(this.state.attributes)

    for (const param of params) {
      switch (param) {
        case 0:
          attributes = cloneAttributes(defaultAttributes)
          break
        case 1:
          attributes = { ...attributes, bold: true }
          break
        default:
          if (param >= 30 && param <= 37) {
            attributes = { ...attributes, fg: param - 30 }
          } else if (param === 39) {
            attributes = { ...attributes, fg: null }
          } else if (param >= 40 && param <= 47) {
            attributes = { ...attributes, bg: param - 40 }
          } else if (param === 49) {
            attributes = { ...attributes, bg: null }
          }
          break
      }
    }

    this.state.attributes = attributes
    return [{ type: 'attributes', attributes }]
  }

  private lineFeed(): TerminalUpdate[] {
    const updates: TerminalUpdate[] = []

    if (this.state.cursor.row >= this.state.rows - 1) {
      this.state.buffer.shift()
      this.state.buffer.push(
        Array.from({ length: this.state.columns }, () =>
          blankCell(this.state.attributes),
        ),
      )
      updates.push({ type: 'scroll', amount: 1 })
    } else {
      this.state.cursor.row += 1
    }

    this.state.cursor.column = 0
    updates.push(this.cursorUpdate())
    return updates
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
    const nextTab = Math.floor(this.state.cursor.column / 8) * 8 + 8
    this.state.cursor.column = clamp(nextTab, 0, this.state.columns - 1)
    return [this.cursorUpdate()]
  }

  private clearFromCursor(): TerminalUpdate[] {
    const cells: CellDelta[] = []
    const startRow = this.state.cursor.row
    const startColumn = this.state.cursor.column

    for (let column = startColumn; column < this.state.columns; column += 1) {
      const cell = blankCell(this.state.attributes)
      this.state.buffer[startRow][column] = cell
      cells.push({ row: startRow, column, cell })
    }

    for (let row = startRow + 1; row < this.state.rows; row += 1) {
      for (let column = 0; column < this.state.columns; column += 1) {
        const cell = blankCell(this.state.attributes)
        this.state.buffer[row][column] = cell
        cells.push({ row, column, cell })
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
